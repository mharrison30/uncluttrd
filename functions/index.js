const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret, defineString } = require("firebase-functions/params");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { toFile } = require("openai/uploads");
const admin = require("firebase-admin");
// Phase C4 (DeletionImplementation.md): the REAL Phase C3 hard-delete
// engine, not a second implementation. Firebase Functions deploy only
// bundles this "functions" source directory (firebase.json), so
// scripts/runSpaceMigration.js (and its own shared/spaceMigration.js
// dependency) can't be required from outside it directly - ./scripts and
// ./shared here are generated copies, kept in sync automatically by
// scripts/prepareFunctionsDeploy.js (see that script's own header for the
// full reasoning; it runs as this functions codebase's predeploy hook).
const { hardDeleteAreaAdmin, hardDeleteRoomAdmin, hardDeleteAccountAdmin, deleteStoragePrefixesAdmin } = require("./scripts/runSpaceMigration");
// Hand-authored, NOT a generated copy - lives beside index.js, outside the
// scripts/ and shared/ directories prepareFunctionsDeploy.js overwrites.
const { purgeExpiredDeletedPlanStorage } = require("./planStoragePurge");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const OPENAI_KEY = defineSecret("OPENAI_KEY");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
// RevenueCat webhook signing secrets (X-RevenueCat-Webhook-Signature) and a
// RevenueCat secret API key (server-to-server REST calls - distinct from
// the public appl_.../goog_... keys used client-side for Purchases.configure).
// All project-scoped: set independently per Firebase project via
// `firebase functions:secrets:set`, same as ANTHROPIC_KEY/OPENAI_KEY above.
// Real values set on cluttrd-staging 2026-07-21. Correction to the original
// assumption here: `firebase functions:secrets:set` explicitly warns that a
// redeploy IS required to pick up a new secret version - it does not
// resolve `latest` per-invocation the way that was first assumed.
//
// Two separate webhook secrets, not one (DecisionLog.md 2026-07-24): each
// RevenueCat webhook integration (one per store - App Store, Play Store)
// generates its own distinct signing secret, and a single incoming request
// is only ever signed with the one matching secret for whichever store sent
// it. revenueCatWebhook below tries both against every request rather than
// requiring a specific one, so either store's deliveries verify correctly
// without needing to know in advance which store an event came from.
const REVENUECAT_WEBHOOK_SECRET_IOS = defineSecret("REVENUECAT_WEBHOOK_SECRET_IOS");
const REVENUECAT_WEBHOOK_SECRET_ANDROID = defineSecret("REVENUECAT_WEBHOOK_SECRET_ANDROID");
const REVENUECAT_SECRET_API_KEY = defineSecret("REVENUECAT_SECRET_API_KEY");
// Not a secret (an identifier, not a credential) - needed for the v2 REST
// API's URL path. One RevenueCat project serves both the production and
// iOS Staging apps (DecisionLog.md 2026-07-16), so this value is the same
// across environments - real value set directly here rather than only in
// .env.cluttrd-staging, since it's not actually environment-specific.
const REVENUECAT_PROJECT_ID = defineString("REVENUECAT_PROJECT_ID", { default: "projc4cb5734" });
// RevenueCat's INTERNAL entitlement id for "Uncluttrd Pro" - NOT the
// developer-facing lookup_key string (confirmed wrong 2026-07-24: the V2
// API's GET .../active_entitlements response's entitlement_id field returns
// this internal id, e.g. "entl16a5fcafc4", never the "Uncluttrd Pro" string
// - that string only appears as the entitlement's separate `lookup_key`
// field, e.g. via GET .../entitlements. The original TEMP DEBUG comment
// below flagged this exact ambiguity as unconfirmed; real webhook deliveries
// proved it wrong the "Uncluttrd Pro" way, silently computing isPro=false
// for every genuinely-entitled customer since this webhook went live. Do
// NOT change this back to "Uncluttrd Pro" - that is the client-side
// entitlements.active[] key (a different RevenueCat API/SDK, correctly
// keyed by lookup_key there), not this server-side REST endpoint's shape.
const PRO_ENTITLEMENT_ID = "entl16a5fcafc4";
// Resend's shared sandbox sender - works with no domain verification, but
// can only deliver to the email address the Resend account itself signed up
// with. Fine for a single-recipient canary alert; would need a verified
// custom domain to send to any other address.
const CANARY_ALERT_FROM = "Uncluttrd Canary <onboarding@resend.dev>";
const CANARY_ALERT_TO = "michael@earthwiseenergy.net";
// Verified custom domain (DKIM/MX/SPF all confirmed 2026-07-23) - distinct
// from CANARY_ALERT_FROM's Resend sandbox sender, used for real user-facing
// transactional email (welcome, Pro upgrade, re-engagement).
const TRANSACTIONAL_EMAIL_FROM = "Uncluttrd <hello@uncluttrd.app>";

const FREE_MONTHLY_LIMIT = 3;
const IDEMPOTENCY_TTL_DAYS = 60; // within the requested 30-90 day range; requires a Firestore TTL policy on expiresAt (console/gcloud config, not code)
const DELETION_AUDIT_TTL_DAYS = 30; // requires a Firestore TTL policy on expiresAt, same as above
const DELETION_CHECK_GRACE_MINUTES = 10; // give the client's Auth deletion call time to land before flagging

// Dedicated test account the canary calls analyzePhoto as, so the check
// exercises the real authenticated path a live user takes (auth + a
// generated analysisId), not just "is the function reachable." Defaults to
// the account already flagged isTestAccount: true in its own Firestore doc
// (users/{uid}), which is also isPro: true so canary runs never touch the
// free-plan count. Override by setting a different uid via `firebase
// functions:config` / a deployed .env value if a separate dedicated account
// is preferred.
const CANARY_TEST_UID = defineString("CANARY_TEST_UID", { default: "m4ecZ9B9B1XmDrOiAQfFPjdjyNB3" });
// The project's public, client-embedded Firebase API key (same value
// already shipped inside GoogleService-Info.plist) - used only to exchange
// a custom token for a real ID token via the Identity Toolkit REST API.
// Not a secret: Firebase API keys are designed to be public and rely on
// security rules/App Check for protection, not secrecy. Project-scoped the
// same way as CANARY_TEST_UID: the default here is production's key, and
// .env.cluttrd-staging overrides it for staging deploys - otherwise a
// staging-minted custom token gets exchanged against production's Identity
// Toolkit, which fails on project mismatch.
const CANARY_WEB_API_KEY = defineString("CANARY_WEB_API_KEY", { default: "AIzaSyAvgaO7X_IyUDZbUrYGGB4k_tTV6TpQOl4" });
// A small, genuinely valid, real JPEG (64x64, derived from the app's own
// favicon) - large/real enough that Anthropic actually processes it and
// returns real analysis text, not just enough to pass a byte-count check.
const CANARY_TEST_IMAGE_BASE64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAoHBwkHBgoJCAkLCwoMDxkQDw4ODx4WFxIZJCAmJSMgIyIoLTkwKCo2KyIjMkQyNjs9QEBAJjBGS0U+Sjk/QD3/2wBDAQsLCw8NDx0QEB09KSMpPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT3/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxmlVS7AKMk10XhbwNq/iqYfYoP3APzTOcKP517b4c+EmhaNbf6XCt5csOZJF4X6D+tAHl/g74S6p4gMdzfD7JZNg7m+8w9h/9evVJPhH4afRxYra7XHIn/jz9euPbNbTQ6pohBt2bULMdY5G/eoPY/wAX44qHUPH2haZp7XV1d7CvBhI/ebvTHrQB4j4v+FWreHGea3X7VZLk+avUD3Hb8zXExW7zTiFQN59TXoXi/wCMOqa4ZLbS82VmcjKn53Hue30rjfDaxvrtuZwTEGy5A6Dp/PFAHW6D8IdW1uwjuxsijcZBkfbu9CBg8VkeKvh/qnhYqbmMNG3R1bcD7Dgc19PJ5UMICbViUcY4AFeMfF3xrb6jeW2h6e6yxxSiSZxyNw4AH5mgDsvBeiz23grSLrSLgwzSWkbvC3MchKjPHYn1rcTxRBaqU1pfsFwoyQxyjf7rdx+ApngMg+BNEwQcWcQ4/wB0U7xbbQ3llZwXEayRPdoGVhweGoAT7bqWtsBp6fY7I/8ALzIPnb/dX0981V1T4daFrFm0V7AZZ263THMpP+91q21nqei4bT5De2o628zfOo/2W7/Tiquq/EPQ9HsWmvZnimXj7My/vc+mOn60AeNeMfhNqvh0yXNl/ptivO9RhlHuP/r1wkUklvIkyZDA8HFd14u+Ler+IDJb2TGysjxtRvmYe5/pXXeHPhtpXirwBYXBXyL0x/61R1OB1H9aAPOLrxvrd3piWjavcpCFCGFWOMe/rWAxii/1bGQkfexjFb/irwLqnhSb/TIh5J+7KrZDH26VzVAH0r4P0m6tvBukXek3JSR7SN3gkOY3JUZ/3T74qzquuLMdPtb6FrS8F2hMbfdbhslT3H5Ve8CSpJ4H0YI6sVs4wcHodop3i21hvLKyhuEDxvdoCD9GoA3eteCfHf8A5Gez/wCuJ/pXrzW2qaKQbJ2vrQdYZW/eIP8AZbv9OK8W+M+pQ6l4htHhDqViIdHGGQ8cEUAedV7DonxT0/wr4CsbO3Q3Woqn3Oirx3P/ANavHqKAN7xD4y1fxVdh9SuWaMHKwqcIv0FYNOi/1q/Wm0Ab/hnxpq3hacNYXBERPzRN90/UV65p/wATtP8AE9vp8M4+zXYu0JXOVIAPf/61eCUqO0bhkOGHQ0AfZSsHAKkEHuDXgnx3A/4SezPcwn+lZnhD4q6r4e8u2nYXFmoA2Ox4+h5xUXxR8T2XirVLO8sC21Yirhux4oA4elA9eBSZx0ooAXdjpxSUUUAf/9k=";

// "Calendar month" is defined in UTC server-side - the simplest, most
// tamper-resistant definition, though it means a user right at a month
// boundary could see rollover at a different local-clock moment than
// midnight-their-timezone. Flagged as a deliberate choice, not an oversight.
const currentMonthUTC = () => new Date().toISOString().slice(0, 7); // "YYYY-MM"

// timeoutSeconds: 300 (2026-08-12). This function had no timeoutSeconds and
// so inherited the 60s v2 default, which stopped being survivable once the
// evidence-rule commits (7a55b48, bfea005) grew the prompt and the response
// it asks for: every analysis attempt after them returned HTTP 504 at
// exactly 60s, meaning no new plan could be created at all.
//
// Measured, not guessed: with the FULL 26k prompt but a one-line response
// the call returns in 1.8s, versus 2.0s for a trivial prompt. Prompt length
// costs essentially nothing - the whole cost is GENERATING the three-approach
// JSON, so trimming instructions would not have helped. 300s matches
// generateVisualization's own limit, chosen there for the same "genuinely
// slow, not stuck" reason.
//
// Note this is a ceiling, not a target: the client's own httpsCallable
// timeout and the user's patience both bind well before it. Two-stage
// generation is the real fix for the latency; this stops the bleeding.
exports.analyzePhoto = onCall(
  // REVENUECAT_SECRET_API_KEY is required now that the free-limit gate below
  // verifies entitlement against RevenueCat rather than trusting the
  // client-writable users/{uid}.isPro mirror.
  { secrets: [ANTHROPIC_KEY, REVENUECAT_SECRET_API_KEY], maxInstances: 10, timeoutSeconds: 300 },
  async (request) => {
    const { imageBase64, prompt, analysisId, priorPhotoBase64 } = request.data || {};

    if (!imageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing image or prompt.");
    }

    // HOTFIX (2026-07-15): build 15, the live public App Store version at
    // time of writing, predates analysisId entirely and calls this function
    // without it. Requiring request.auth and analysisId as hard
    // preconditions (added in 85168f3) rejected every real production call
    // outright - restored to exactly analyzePhoto's pre-85168f3 shape (no
    // auth requirement, imageBase64/prompt only) for the base call. Auth +
    // free-plan enforcement + idempotency now only engage when BOTH a uid
    // and an analysisId are present - the exact shape the Companion-era
    // client sends. Anything older/different is processed with no count
    // check and no idempotency protection, same as this function behaved
    // before 85168f3. See BACKLOG.md - temporary compatibility shim until
    // build 15 is no longer the live App Store version.
    const uid = request.auth?.uid || null;
    const enforceLimit = !!(uid && analysisId);
    let userRef = null;
    let idemRef = null;
    let month = null;
    // Authoritative Pro entitlement, resolved ONCE below and reused by both
    // the pre-check and the counting transaction. Declared here so the
    // transaction can read it; false is the safe default for the
    // no-uid/no-analysisId shape, which skips limit enforcement entirely
    // anyway (see the hotfix note above).
    let entitled = false;

    if (enforceLimit) {
      userRef = db.collection("users").doc(uid);
      // Structured as a subcollection under the user's own doc so ownership is
      // enforced by path, not a separate uid-match check in code or rules.
      idemRef = userRef.collection("analysisIdempotency").doc(analysisId);

      // Idempotency: a retry of the same analysisId (network retry, Cloud
      // Function retry) replays the original result - no second Anthropic
      // call, no second count, no double-counting.
      const idemSnap = await idemRef.get();
      if (idemSnap.exists) {
        const cached = idemSnap.data();
        return { text: cached.text, analysesRemaining: cached.analysesRemaining };
      }

      // Pre-check (plain read, outside any transaction) - reject before paying
      // for an Anthropic call the user isn't entitled to make.
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      month = currentMonthUTC();

      // Pro entitlement is verified against RevenueCat, NOT read from
      // users/{uid}.isPro. That field is client-writable under the current
      // Firestore rules (affectedKeys().hasOnly(['isPro','hasSeenTutorial'])),
      // so trusting it here meant one updateDoc bought unlimited Anthropic
      // vision calls. Same authority generateVisualization already uses.
      //
      // CANARY_TEST_UID is unconditionally exempt from the free-plan limit,
      // independent of isPro/RevenueCat state - the canary exists to monitor
      // analyzePhoto's own availability, not to test subscription gating, and
      // its entitlement can legitimately lapse on its own (e.g. a sandbox
      // subscription naturally expiring) without that being a real incident.
      // Short-circuited BEFORE the RevenueCat call so the canary never
      // depends on RevenueCat being reachable at all.
      // Structural fix, not a per-incident Firestore patch - see DecisionLog.md.
      if (uid === CANARY_TEST_UID.value()) {
        entitled = true;
      } else {
        const verified = await verifyProEntitlement(uid);
        if (verified === null) {
          // RevenueCat unreachable or unparseable. Falling back to the cached
          // mirror rather than denying: an outage must not lock paying users
          // out of the app's core feature. Same outage policy as
          // generateVisualization. The exposure this leaves is narrowed to
          // "forged isPro AND RevenueCat down simultaneously".
          entitled = userData.isPro === true;
          console.warn(`[analyzePhoto] uid=${uid} RevenueCat unreachable, falling back to cached isPro=${entitled}`);
        } else {
          entitled = verified;
        }
      }

      if (!entitled) {
        const effectiveCount = userData.analysisCountMonth === month ? (userData.analysisCount || 0) : 0;
        if (effectiveCount >= FREE_MONTHLY_LIMIT) {
          throw new HttpsError("resource-exhausted", "Free plan limit reached for this month.");
        }
      }
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    let text;
    try {
      // Remembered Home v1 Step 2 (RememberedHomeDesign.md §1e):
      // priorPhotoBase64 is optional and absent for every first-time
      // analysis - the content array is then exactly today's single-image
      // shape, byte-identical to before this change. When present (a
      // returning visit to an existing Space), it's placed FIRST, ahead of
      // the new photo - same fixed, prompt-narrated multi-image ordering
      // already proven by generateNextAction below (original/before/after),
      // not a new pattern.
      const content = [];
      if (priorPhotoBase64) {
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: priorPhotoBase64 } });
      }
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: imageBase64,
        },
      });
      content.push({ type: "text", text: prompt });

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        // Bumped from 1500 (2026-08-08, JSON parse fragility
        // investigation), then from 4000 to 6000 (Approach Selection Phase
        // A, ApproachSelectionDesign.md Sections 2/3): the response is a
        // single JSON object now carrying THREE full approaches
        // (strategyDescription, organizingGuidance, taskChecklist,
        // productRecommendations, visualizationDirection each) plus
        // problemsFound, scopeSize, and the existing room/area
        // classification + reasoning fields - meaningfully larger than the
        // old three-tier schema this replaces. A response cut off
        // mid-generation still returns HTTP 200 with partial text (no
        // server-side JSON validation happens here), surfacing only later
        // as a client-side JSON.parse failure - the same fragility that
        // originally motivated the 1500->4000 bump, now recurring at the
        // new schema's larger size. 6000 is comfortably below
        // claude-sonnet-4-5's standard (non-beta) 8192 output-token cap, so
        // no extended-output beta header is needed. Verified empirically
        // against a real photo as part of this same implementation pass -
        // stop_reason: "end_turn", not "max_tokens" (see the existing
        // stop_reason/looksLikeValidJson logging just below).
        max_tokens: 6000,
        messages: [
          {
            role: "user",
            content,
          },
        ],
      });
      text = message.content.find((b) => b.type === "text")?.text || "";
      // Observability only (2026-08-08) - never enforced, never thrown; a
      // malformed/truncated response still returns to the client exactly
      // as before. stop_reason distinguishes a genuinely truncated
      // response ("max_tokens") from a normal completion ("end_turn")
      // that happens to be invalid JSON for some other reason - the two
      // were previously indistinguishable after the fact, which is
      // exactly what left root cause unconfirmed in the prior
      // investigation. jsonMatch/looksLikeValidJson mirrors the client's
      // own extraction (App.js's raw.match(/\{[\s\S]*\}/) + JSON.parse)
      // so this log reflects what the client will actually attempt, not
      // a separate check.
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let looksLikeValidJson = false;
      if (jsonMatch) {
        try {
          JSON.parse(jsonMatch[0]);
          looksLikeValidJson = true;
        } catch (parseErr) {
          looksLikeValidJson = false;
        }
      }
      console.log(`analyzePhoto response: stop_reason=${message.stop_reason} | textLength=${text.length} | looksLikeValidJson=${looksLikeValidJson}`);
    } catch (err) {
      throw new HttpsError("internal", err.message || "Analysis failed.");
    }

    // Only on success: re-read and re-check inside the transaction itself,
    // not just trusting the earlier pre-check. If a concurrent request
    // already used the last slot between the pre-check and now, this
    // request's already-paid-for Anthropic call is not counted or cached -
    // accepted per the approved design rather than building a reservation
    // system for a rare concurrency edge case. The user still sees their
    // plan; it's simply not charged against their limit either way.
    // Skipped entirely for a request with no uid/analysisId (see the
    // hotfix note above) - there's no safe, idempotency-protected way to
    // count against a limit for a caller shape that can't dedupe a retry.
    let analysesRemaining = null;
    if (enforceLimit) {
      try {
        await db.runTransaction(async (tx) => {
          const freshSnap = await tx.get(userRef);
          const freshData = freshSnap.exists ? freshSnap.data() : {};
          const expiresAt = admin.firestore.Timestamp.fromMillis(
            Date.now() + IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000
          );

          // Reuses `entitled` from the pre-check rather than re-reading
          // isPro or re-querying RevenueCat. Two reasons: a second network
          // call would double the added latency and could disagree with the
          // decision the request was already admitted under, and re-reading
          // freshData.isPro here would reintroduce the exact forgeable path
          // this change removes. `entitled` already folds in the
          // CANARY_TEST_UID exemption, which still matters here - without it
          // canary's analysisCount would climb indefinitely in the background
          // even though it can never actually be blocked, which is confusing
          // bookkeeping for an account that isn't really free-tier-metered.
          //
          // The transaction still re-reads the COUNT (freshData below), which
          // is the value that genuinely races between concurrent requests.
          // Entitlement does not race on that timescale.
          if (entitled) {
            analysesRemaining = null;
            tx.set(idemRef, {
              text,
              analysesRemaining: null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              expiresAt,
            });
            return;
          }

          const freshEffectiveCount = freshData.analysisCountMonth === month ? (freshData.analysisCount || 0) : 0;
          if (freshEffectiveCount >= FREE_MONTHLY_LIMIT) {
            // Lost the race - do not increment, do not cache. Anthropic cost
            // is accepted as spent; the user still gets to see this result.
            analysesRemaining = 0;
            return;
          }

          const newCount = freshEffectiveCount + 1;
          tx.set(userRef, { analysisCount: newCount, analysisCountMonth: month }, { merge: true });
          analysesRemaining = FREE_MONTHLY_LIMIT - newCount;
          tx.set(idemRef, {
            text,
            analysesRemaining,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt,
          });
        });
      } catch (txErr) {
        // The analysis itself already succeeded - don't fail the whole
        // request over bookkeeping. Log and still return the plan.
        console.error("analyzePhoto count transaction failed:", txErr.message);
      }
    }

    return { text, analysesRemaining };
  }
);

// Area Identity Phase B: Visual Recognition (AreaIdentityDesign.md §6).
// Multimodal comparison, NOT a second analyzePhoto call - takes today's
// already-analyzed photo plus up to 6 reference images (up to 3 candidate
// Areas x up to 2 distinct photos each, narrowing/dedup done by the
// caller) and asks Claude a single, narrow question: does today's photo
// show the same physical area as any of the labeled candidates? No
// numeric confidence ever requested or parsed - "ranked" means the
// order the model lists candidates in, nothing more. Zero new
// dependencies (same @anthropic-ai/sdk client, same secret, same model),
// per the design doc's own explicit rejection of embeddings/vector DB at
// this scale. Not gated by the free-plan analysis count - this is an
// internal step of a single user-facing "take a photo" action, not a
// separately-invoked feature, so it must never consume a second credit
// against analyzePhoto's own limit.
exports.compareAreaCandidates = onCall(
  { secrets: [ANTHROPIC_KEY], maxInstances: 10 },
  async (request) => {
    const { todayImageBase64, candidates } = request.data || {};

    if (!todayImageBase64 || !Array.isArray(candidates) || candidates.length === 0) {
      throw new HttpsError("invalid-argument", "Missing today's photo or candidate reference images.");
    }
    for (const c of candidates) {
      if (!c || !c.areaId || !Array.isArray(c.images) || c.images.length === 0) {
        throw new HttpsError("invalid-argument", "Each candidate needs an areaId and at least one reference image.");
      }
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    const image = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });

    // Fixed image order, narrated in the prompt text itself (same pattern
    // as generateNextAction's original/before/after and analyzePhoto's
    // priorPhotoBase64/today ordering) - Image 1 is always today's photo,
    // then each candidate's reference photo(s) in sequence, so the model
    // never has to guess which numbered image belongs to which areaId.
    const content = [image(todayImageBase64)];
    const legendLines = [];
    let imageNumber = 2;
    for (const c of candidates) {
      const numbers = [];
      for (const imgB64 of c.images) {
        content.push(image(imgB64));
        numbers.push(imageNumber);
        imageNumber++;
      }
      legendLines.push(`Image${numbers.length > 1 ? "s" : ""} ${numbers.join(" and ")}: candidate Area "${c.areaId}"${c.displayName ? ` ("${c.displayName}")` : ""}.`);
    }

    const prompt = `Image 1 is TODAY's photo of a space the user just photographed. ${legendLines.join(" ")}\n\nDoes TODAY's photo (Image 1) show the SAME PHYSICAL AREA as any of the candidate Areas above? Compare the physical space, furniture, and fixtures themselves, not the level of organization or tidiness - the same shelf, desk, or corner can look very different messy vs. organized and still be the same physical area. A candidate Area with more than one reference image may show it in different states (freshly organized vs. later re-cluttered) - treat all of that candidate's images as evidence for the SAME physical area, not competing options.\n\nThese photos are all from the SAME ROOM, so walls, windows, flooring, paint color, and general room features will naturally look similar. Ignore room-level ambient features. Compare ONLY the primary organizing target - the specific furniture, fixture, shelving unit, cabinet, or area being organized. Two photos of the same entertainment center should match. Two photos showing different furniture (an entertainment center vs. a seating area) should NOT match, even if the background walls and windows are identical.\n\nReturn ONLY valid JSON, nothing else (no markdown, no backticks): {"candidates":[{"areaId":"the matching candidate's exact areaId string","evidenceReason":"one short phrase citing the specific visible evidence (e.g. the same wavy-edged corner shelf, the same dark wood desk against a window)"}]}\n\nList candidates in the JSON array in descending order of how confident you are, but do NOT include any numeric score or percentage anywhere in your response - reasoning only. If NONE of the candidates show the same physical area as today's photo, return {"candidates":[]}. Never invent a match "candidates" array with more entries than the number of candidate Areas actually shown above.`;

    content.push({ type: "text", text: prompt });

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        messages: [{ role: "user", content }],
      });
      const text = message.content.find((b) => b.type === "text")?.text || "";
      console.log(`compareAreaCandidates: candidateAreas=${candidates.length} totalImages=${content.length - 1} stop_reason=${message.stop_reason} inputTokens=${message.usage?.input_tokens} outputTokens=${message.usage?.output_tokens}`);
      return { text, usage: message.usage || null };
    } catch (err) {
      throw new HttpsError("internal", err.message || "Area comparison failed.");
    }
  }
);

exports.generateNextAction = onCall(
  { secrets: [ANTHROPIC_KEY], maxInstances: 10 },
  async (request) => {
    const { originalImageBase64, beforeImageBase64, afterImageBase64, prompt } = request.data || {};

    if (!originalImageBase64 || !beforeImageBase64 || !afterImageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing original/before/after image or prompt.");
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    const image = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        // Bumped from 650 (itself bumped from 500 for the completion
        // judgment): the batch workflow (DecisionLog.md 2026-07-18) returns
        // a balanced session's worth of items, not one action, so the
        // response needs comparable headroom to analyzePhoto's own 1500.
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              // Order matches the prompt's photo 1/2/3 language - original
              // (whole-project baseline), before (this step), after (this step).
              image(originalImageBase64),
              image(beforeImageBase64),
              image(afterImageBase64),
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const text = message.content.find((b) => b.type === "text")?.text || "";
      return { text };
    } catch (err) {
      throw new HttpsError("internal", err.message || "Next action generation failed.");
    }
  }
);

// ---- Two-Stage Analysis, CALL 2 (TwoStageAnalysisDesign.md §4/§5) --------
// A separate function rather than a mode flag on analyzePhoto, for three
// reasons that are each individually sufficient:
//
//   1. Quota. analyzePhoto decrements the user's free monthly allowance
//      whenever uid + analysisId are present. Call 2 is the SAME analysis
//      continuing, so routing it through that function would either charge
//      the user twice for one photo or require a "don't count this one"
//      flag - a flag that, if ever sent wrongly, silently gives away free
//      analyses. Separation makes the miscount unrepresentable.
//   2. Signature. Call 2 sends no image at all (see §4). analyzePhoto
//      requires imageBase64 and rejects a request without it.
//   3. Operations. The two calls have genuinely different latency profiles
//      and failure meanings - Call 1 failing means "no plan"; Call 2
//      failing means "plan exists, detail pending" - and they should be
//      separately monitorable and separately tunable.
//
// Auth is required outright here. Unlike analyzePhoto, this function has no
// legacy App Store build calling it, so there is no compatibility shim to
// preserve: it was born after the auth-required era.
exports.analyzePhotoDetail = onCall(
  { secrets: [ANTHROPIC_KEY], maxInstances: 10, timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to finish an analysis.");
    }
    const { prompt, planId } = request.data || {};
    if (!prompt) {
      throw new HttpsError("invalid-argument", "Missing prompt.");
    }
    // Ownership, same shape as generateVisualization's: a supplied planId
    // must resolve under this caller's own subcollection. Call 2 always has
    // one (it exists to finish a plan that has already been written), so
    // unlike the visualization case there is no null fallback.
    if (planId) {
      let snap;
      try {
        snap = await db.collection("users").doc(uid).collection("plans").doc(String(planId)).get();
      } catch (e) {
        console.error(`[analyzePhotoDetail] uid=${uid} planId=${planId} ownership lookup failed: ${e.message}`);
        throw new HttpsError("internal", "Couldn't verify this plan. Please try again.");
      }
      if (!snap.exists) {
        console.warn(`[analyzePhotoDetail] uid=${uid} requested planId=${planId} it does not own`);
        throw new HttpsError("permission-denied", "You don't have access to this plan.");
      }
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    try {
      // Text only. No image content block - that absence IS the guarantee
      // that Call 2 cannot re-analyze the photograph.
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        // Same ceiling as analyzePhoto. Call 2's response is the larger
        // half of the old single response (three approaches' guidance,
        // checklists, recommendations and visualization directions), so it
        // needs the same headroom even though its prompt is smaller.
        max_tokens: 6000,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      });
      const text = message.content.find((b) => b.type === "text")?.text || "";
      console.log(`analyzePhotoDetail response: planId=${planId} stop_reason=${message.stop_reason} | textLength=${text.length} | outputTokens=${message.usage?.output_tokens}`);
      return { text, stopReason: message.stop_reason, outputTokens: message.usage?.output_tokens ?? null };
    } catch (err) {
      console.error(`[analyzePhotoDetail] uid=${uid} planId=${planId} failed: ${err.message}`);
      throw new HttpsError("internal", err.message || "Detail generation failed.");
    }
  }
);

exports.generateVisualization = onCall(
  { secrets: [OPENAI_KEY, REVENUECAT_SECRET_API_KEY], maxInstances: 10, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    // Security fix (VisualizationAlignmentImplementation.md §4). This
    // function had NO auth check at all: the Pro gate lived entirely in the
    // client, so anyone holding the callable's URL could spend OpenAI image
    // credits on this project's key without an account, let alone a
    // subscription. Two gates now, in order of strength.
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to generate a visualization.");
    }

    const { imageBase64, prompt, planId } = request.data || {};

    if (!imageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing image or prompt.");
    }

    // Ownership. planId is null for a plan whose background save has not
    // finished yet, which is a real and common state when the user taps
    // quickly - that case falls back to the authenticated-only gate above
    // rather than blocking a legitimate visualization. When a planId IS
    // supplied it must resolve under THIS caller's own subcollection, so a
    // signed-in user cannot visualize somebody else's plan by id.
    if (planId) {
      let planSnap;
      try {
        planSnap = await db.collection("users").doc(uid).collection("plans").doc(String(planId)).get();
      } catch (e) {
        console.error(`[generateVisualization] uid=${uid} planId=${planId} ownership lookup failed: ${e.message}`);
        throw new HttpsError("internal", "Couldn't verify this plan. Please try again.");
      }
      if (!planSnap.exists) {
        console.warn(`[generateVisualization] uid=${uid} requested planId=${planId} which it does not own`);
        throw new HttpsError("permission-denied", "You don't have access to this plan.");
      }
    }

    // ---- Pro entitlement, server side (2026-08-12) --------------------
    // The client-side isPro check stays where it is - it shows the paywall
    // without a network round trip. This is the backstop for a caller that
    // never ran that code.
    //
    // Why RevenueCat is queried rather than users/{uid}.isPro being read:
    // that field is STILL CLIENT-WRITABLE. firestore.rules allows
    //   affectedKeys().hasOnly(['isPro', 'hasSeenTutorial'])
    // on users/{uid}, so any signed-in user can grant themselves Pro with a
    // single updateDoc. A server-side read of that field would therefore be
    // a copy of the client check wearing a server costume, not a security
    // control. The webhook mirror exists and is real, but it is not yet
    // authoritative BECAUSE of that rule - closing it is the documented
    // last step of the migration (BACKLOG.md) and is deliberately not done
    // here, since it can lock out paying users if the webhook is not
    // verified end to end first.
    //
    // The latency objection does not apply to this function specifically:
    // it already spends 20-60s generating an image, so a ~200ms entitlement
    // check is noise.
    const entitled = await verifyProEntitlement(uid);
    if (entitled === false) {
      console.warn(`[generateVisualization] uid=${uid} rejected: no active Pro entitlement`);
      throw new HttpsError("failed-precondition", "Pro subscription required.");
    }
    if (entitled === null) {
      // RevenueCat unreachable. Falling back to the cached mirror rather
      // than denying: an outage at RevenueCat must not lock paying users
      // out of a feature they have paid for. This narrows the residual hole
      // to "forged isPro AND RevenueCat down simultaneously", which an
      // attacker cannot arrange, and it is logged so it is visible.
      let cached = false;
      try {
        const snap = await db.collection("users").doc(uid).get();
        cached = snap.exists && snap.data().isPro === true;
      } catch (e) {
        console.error(`[generateVisualization] entitlement fallback read failed for uid=${uid}: ${e.message}`);
      }
      console.warn(`[generateVisualization] uid=${uid} RevenueCat unreachable, falling back to cached isPro=${cached}`);
      if (!cached) throw new HttpsError("failed-precondition", "Pro subscription required.");
    }

    const openai = new OpenAI({ apiKey: OPENAI_KEY.value() });

    try {
      const imageBuffer = Buffer.from(imageBase64, "base64");
      const imageFile = await toFile(imageBuffer, "photo.png", {
        type: "image/png",
      });

      const result = await openai.images.edit({
        model: "gpt-image-2",
        image: imageFile,
        prompt: prompt,
        size: "1024x1024",
        quality: "low",
      });

      const b64 = result.data?.[0]?.b64_json || "";
      return { b64 };
    } catch (err) {
      throw new HttpsError("internal", err.message || "Visualization failed.");
    }
  }
);

// --- Deletion monitoring (pure observability - no change to the existing
// client-side deletion flow). A client can delete users/{uid} without also
// deleting the Auth account (see BACKLOG.md), which would let someone get a
// fresh free-plan allowance by re-registering the same Auth account. This
// pair of functions gives a queryable signal if that's actually happening,
// without touching the deletion flow itself.

exports.recordUserDocDeletion = onDocumentDeleted("users/{userId}", async (event) => {
  const { userId } = event.params;
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + DELETION_AUDIT_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  await db.collection("deletionAudit").doc(userId).set({
    uid: userId,
    firestoreDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
    checked: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });
});

exports.checkOrphanedUserDeletions = onSchedule("every 30 minutes", async () => {
  const cutoffMs = Date.now() - DELETION_CHECK_GRACE_MINUTES * 60 * 1000;
  // Equality-only filter (checked == false) so this runs on the automatic
  // single-field index - no composite index to provision before deploying.
  // The grace-period cutoff is applied in code below instead of in the query.
  const snap = await db.collection("deletionAudit").where("checked", "==", false).get();

  for (const doc of snap.docs) {
    const data = doc.data();
    const deletedAtMs = data.firestoreDeletedAt ? data.firestoreDeletedAt.toMillis() : 0;
    if (deletedAtMs > cutoffMs) continue; // still within the grace window - check it on a later sweep

    const uid = doc.id;
    try {
      await admin.auth().getUser(uid);
      // Auth account still exists well after the Firestore doc was deleted -
      // the delete-without-deleteUser bypass. Logged only; no action taken.
      console.warn(`[deletionAudit] uid ${uid}: Firestore user doc deleted but Auth account still exists - possible free-plan bypass.`);
    } catch (err) {
      if (err.code !== "auth/user-not-found") {
        console.error(`[deletionAudit] uid ${uid}: getUser check failed, will retry next sweep:`, err.message);
        continue; // leave unchecked so this gets rechecked
      }
      // Expected path: the Auth account is really gone, full deletion completed normally.
    }
    await doc.ref.set({ checked: true, checkedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
});

// --- Production canary for analyzePhoto ---------------------------------
// Built directly in response to the Jul 15, 2026 outage (build 15, the live
// App Store version, was rejected by analyzePhoto's new auth/analysisId
// requirement for hours before it was caught by a real user report - see
// BACKLOG.md and DecisionLog.md). This exists specifically so that class of
// regression is caught within one run interval (15 minutes), not hours.
//
// Alerting is a direct call to Resend's transactional email API, in the same
// execution that detects the failure - not a Cloud Monitoring log-based
// metric + alert policy. That pipeline proved unreliable to verify across
// multiple attempts (the metric wasn't findable in the alert policy picker,
// the policy didn't show up when checked, then wasn't findable in Metrics
// Explorer either) - a problem with confirming it works, not just a
// preference. A direct API call has one failure mode to reason about: either
// the email sends or it doesn't, both visible in this function's own logs.
// The "[CANARY_ALERT]" log line stays as-is, additively - useful for direct
// log inspection regardless of whether the email pipeline is healthy.
exports.analyzePhotoCanary = onSchedule(
  { schedule: "every 15 minutes", secrets: [RESEND_API_KEY] },
  async () => {
    const uid = CANARY_TEST_UID.value();
    if (!uid) {
      const msg = "CANARY_TEST_UID is not configured - canary cannot run.";
      console.error(`[CANARY_ALERT] ${msg}`);
      await sendCanaryAlertEmail(msg);
      return;
    }

    const analysisId = `canary-${Date.now()}`;
    try {
      // Mint a real ID token for the dedicated test account, exactly like a
      // real signed-in user's client would send - this exercises the actual
      // authenticated path real users take, not just "is the function up."
      const customToken = await admin.auth().createCustomToken(uid);
      const signInResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${CANARY_WEB_API_KEY.value()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        }
      );
      const signInData = await signInResp.json();
      if (!signInResp.ok || !signInData.idToken) {
        throw new Error(`Custom token exchange failed: ${JSON.stringify(signInData)}`);
      }

      // Derived from the running project, not hardcoded to production - so
      // the canary always calls its own project's analyzePhoto, never
      // production's regardless of which project this function is deployed to.
      const callResp = await fetch(
        `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/analyzePhoto`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${signInData.idToken}`,
          },
          body: JSON.stringify({
            data: { imageBase64: CANARY_TEST_IMAGE_BASE64, prompt: "Reply with only the word: ok", analysisId },
          }),
        }
      );
      const callData = await callResp.json();

      if (!callResp.ok || callData.error) {
        throw new Error(`analyzePhoto call failed: HTTP ${callResp.status} - ${JSON.stringify(callData.error || callData)}`);
      }

      console.log(`[canary] analyzePhoto OK | analysisId=${analysisId} | responseLength=${callData.result?.text?.length ?? 0}`);
    } catch (err) {
      // Distinct, greppable tag - kept for direct log inspection even though
      // alerting no longer depends on anything watching for it.
      const msg = `analyzePhoto canary failed | analysisId=${analysisId} | error=${err.message}`;
      console.error(`[CANARY_ALERT] ${msg}`);
      await sendCanaryAlertEmail(msg);
    }
  }
);

// Shared Resend sender for every outbound email this project sends (canary
// alert + the welcome/Pro-upgrade/re-engagement user emails below). Never
// throws out to the caller - a Resend outage or bad key must not crash the
// caller (revenueCatWebhook still has to answer RevenueCat with 200, the
// re-engagement scheduler must not let one user's failure abort the batch,
// and the canary alert itself must not mask the original failure it's
// reporting) - a send failure just logs a distinctly-tagged line instead.
async function sendEmail({ from, to, subject, text, html, headers }) {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
        // List-Unsubscribe / List-Unsubscribe-Post, when supplied, give Gmail
        // and Outlook their native one-click unsubscribe control. That control
        // materially improves deliverability for bulk mail, and it is the
        // difference between a recipient unsubscribing and a recipient marking
        // the message as spam - the latter damages sender reputation for
        // everyone else on the list.
        ...(headers ? { headers } : {}),
      }),
    });
    if (!resp.ok) {
      console.error(`[sendEmail] Resend send failed (to=${JSON.stringify(to)}, subject="${subject}"): HTTP ${resp.status} - ${await resp.text()}`);
    }
  } catch (err) {
    console.error(`[sendEmail] Resend send threw (to=${JSON.stringify(to)}, subject="${subject}"): ${err.message}`);
  }
}

// Sends the canary failure email in the same execution that detected the
// failure - thin wrapper over sendEmail keeping this call site's existing
// behavior (from/to/subject) unchanged.
async function sendCanaryAlertEmail(errorMessage) {
  await sendEmail({
    from: CANARY_ALERT_FROM,
    to: [CANARY_ALERT_TO],
    subject: "analyzePhoto canary failed",
    text: `analyzePhoto canary failed at ${new Date().toISOString()}\n\n${errorMessage}`,
  });
}

// Re-fetches and writes the authoritative isPro state for a single uid -
// shared by revenueCatWebhook's normal single-uid path (event.app_user_id)
// and its TRANSFER path below, which can touch several uids from one event.
// Deliberately does NOT try to derive active/inactive from the event's own
// `type`/`entitlement_ids` - RevenueCat's own guidance is that several event
// types (BILLING_ISSUE, PRODUCT_CHANGE, REFUND_REVERSED) are ambiguous
// without extra context, so every delivery re-fetches the authoritative
// current state via the REST API and writes whatever that says, rather than
// modeling event-type transition semantics here.
// Returns the resulting isPro value, or null if the entitlement fetch
// itself failed for this uid (logged, not thrown - a 404 e.g. a sandbox/
// test app_user_id, or a TRANSFER source uid RevenueCat only half-knows
// about, is a real non-retryable case for that one uid, not the whole event).
// ---- Strict entitlement verification, for AUTHORIZATION ------------------
// Deliberately NOT syncProStatus. That function maps every non-OK response
// to null so the webhook can skip a uid it cannot resolve (e.g. a TRANSFER
// source RevenueCat only half-knows) without writing a wrong value. That is
// right for a sync job and dangerous for an authorization gate: a 404 means
// RevenueCat has never seen this customer, i.e. they have definitively not
// purchased - and collapsing that into "unavailable" let a forged
// users/{uid}.isPro through the fallback. A real test caught exactly that.
//
// Returns: true (active), false (definitively not entitled), or null
// (RevenueCat genuinely unreachable - 5xx, network, malformed).
async function verifyProEntitlement(uid) {
  let resp;
  try {
    resp = await fetch(
      `https://api.revenuecat.com/v2/projects/${REVENUECAT_PROJECT_ID.value()}/customers/${encodeURIComponent(uid)}/active_entitlements`,
      { headers: { Authorization: `Bearer ${REVENUECAT_SECRET_API_KEY.value()}` } }
    );
  } catch (e) {
    console.error(`[entitlement] network failure for uid=${uid}: ${e.message}`);
    return null;
  }
  // Unknown customer. Not an outage - an answer.
  if (resp.status === 404) return false;
  // 4xx other than 404 means our request was wrong (bad key, bad project),
  // which must not silently grant access either.
  if (resp.status >= 400 && resp.status < 500) {
    console.error(`[entitlement] client-error response for uid=${uid}: HTTP ${resp.status}`);
    return false;
  }
  if (!resp.ok) {
    console.error(`[entitlement] upstream unavailable for uid=${uid}: HTTP ${resp.status}`);
    return null;
  }
  try {
    const data = await resp.json();
    return (data.items || []).some((item) => item.entitlement_id === PRO_ENTITLEMENT_ID);
  } catch (e) {
    console.error(`[entitlement] unparseable response for uid=${uid}: ${e.message}`);
    return null;
  }
}

async function syncProStatus(uid) {
  const activeResp = await fetch(
    `https://api.revenuecat.com/v2/projects/${REVENUECAT_PROJECT_ID.value()}/customers/${encodeURIComponent(uid)}/active_entitlements`,
    { headers: { Authorization: `Bearer ${REVENUECAT_SECRET_API_KEY.value()}` } }
  );
  if (!activeResp.ok) {
    console.error(`[revenueCatWebhook] active_entitlements fetch failed for uid=${uid}: HTTP ${activeResp.status} - ${await activeResp.text()}`);
    return null;
  }
  const activeData = await activeResp.json();
  const isPro = (activeData.items || []).some((item) => item.entitlement_id === PRO_ENTITLEMENT_ID);

  // Read before write, reused for both the Pro-transition check below and
  // the upgrade email's content - not a second round-trip. Not
  // transactional: two events for the same uid delivered close together
  // could both read wasPro=false before either write lands, producing two
  // upgrade emails. Accepted, low-stakes edge case (a friendly duplicate
  // email, not a billing/security issue) - same risk tolerance as
  // analyzePhoto's accepted lost-race case elsewhere in this file.
  const userRef = db.doc(`users/${uid}`);
  const userSnapBefore = await userRef.get();
  const wasPro = userSnapBefore.exists && userSnapBefore.data().isPro === true;

  try {
    await userRef.update({ isPro });
  } catch (updateErr) {
    // User doc doesn't exist (e.g. a TRANSFER event's source uid, or a
    // sandbox test app_user_id with no real account) - logged, not
    // retried, same reasoning as the entitlement-fetch-failed case above.
    console.error(`[revenueCatWebhook] Firestore write failed for uid=${uid}: ${updateErr.message}`);
  }

  // Only on a genuine transition to Pro - not every delivery, and not
  // re-confirming an already-Pro user (e.g. a BILLING_ISSUE resolving
  // itself, or an unrelated event/uid re-triggering this handler).
  if (isPro === true && !wasPro && userSnapBefore.exists) {
    const { email, displayName } = userSnapBefore.data();
    if (email) {
      await sendEmail({
        from: TRANSACTIONAL_EMAIL_FROM,
        to: email,
        subject: "Welcome to Uncluttrd Pro! 🎉",
        text: proUpgradeEmailText(displayName),
      });
    }
  }

  return isPro;
}

// RevenueCat webhook -> Firestore isPro sync (DecisionLog.md 2026-07-21),
// replacing the client-writable isPro field with a server-verified one -
// see BACKLOG.md's "RevenueCat Webhook -> Cloud Function -> Firestore Sync"
// item for the full history of why the client-write approach was interim.
// No event-type filtering: any webhook delivery is treated as "something
// changed, go verify" (see syncProStatus above for why).
exports.revenueCatWebhook = onRequest(
  { secrets: [REVENUECAT_WEBHOOK_SECRET_IOS, REVENUECAT_WEBHOOK_SECRET_ANDROID, REVENUECAT_SECRET_API_KEY, RESEND_API_KEY] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // Signature verification BEFORE any parsing/processing - reject
    // anything that isn't genuinely from RevenueCat before it can do
    // anything, including being counted for idempotency. Signed payload is
    // "{timestamp}.{raw body bytes}", HMAC-SHA256 with the signing secret,
    // hex-encoded - verified against RevenueCat's documented algorithm, not
    // assumed. req.rawBody is populated automatically by the Cloud
    // Functions framework before body-parsing, same mechanism Stripe-style
    // webhook verification relies on elsewhere in the ecosystem.
    const signatureHeader = req.get("X-RevenueCat-Webhook-Signature");
    if (!signatureHeader) {
      console.error("[revenueCatWebhook] Missing signature header");
      res.status(401).send("Missing signature");
      return;
    }
    const sigParts = Object.fromEntries(
      signatureHeader.split(",").map((kv) => {
        const idx = kv.indexOf("=");
        return [kv.slice(0, idx), kv.slice(idx + 1)];
      })
    );
    const { t: timestamp, v1: providedSignature } = sigParts;
    if (!timestamp || !providedSignature) {
      console.error("[revenueCatWebhook] Malformed signature header");
      res.status(401).send("Malformed signature");
      return;
    }
    const signedPayload = `${timestamp}.${req.rawBody.toString("utf8")}`;
    const providedBuf = Buffer.from(providedSignature, "utf8");
    // Tries both store integrations' secrets - a request is only ever
    // signed with the one matching whichever store actually sent it, so
    // exactly one of these should match for any genuine delivery. Filters
    // out an unset secret's value (the empty string a not-yet-configured
    // defineSecret resolves to) so an unconfigured platform can never
    // accidentally match via an empty-secret HMAC.
    const signatureValid = [REVENUECAT_WEBHOOK_SECRET_IOS.value(), REVENUECAT_WEBHOOK_SECRET_ANDROID.value()]
      .filter(Boolean)
      .some((secret) => {
        const expectedSignature = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
        const expectedBuf = Buffer.from(expectedSignature, "utf8");
        // Length check before timingSafeEqual - it throws on mismatched
        // buffer lengths rather than returning false.
        return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
      });
    if (!signatureValid) {
      console.error("[revenueCatWebhook] Invalid signature");
      res.status(401).send("Invalid signature");
      return;
    }

    const event = req.body?.event;
    // TRANSFER events have no app_user_id at all - confirmed against
    // RevenueCat's own docs 2026-07-24, not assumed. They carry
    // transferred_from/transferred_to arrays instead (entitlements moving
    // between app_user_ids - RevenueCat merging an anonymous pre-login
    // identity into a real uid produces exactly this). Every other event
    // type still requires app_user_id as before.
    const isTransfer = event?.type === "TRANSFER";
    const malformed = !event || !event.id
      || (!isTransfer && !event.app_user_id)
      || (isTransfer && !(event.transferred_to || []).length);
    if (malformed) {
      console.error(`[revenueCatWebhook] Malformed event payload: ${JSON.stringify(req.body)}`);
      res.status(400).send("Malformed event");
      return;
    }

    // Normal events: app_user_id is expected to equal the Firebase uid
    // directly - the client calls Purchases.logIn(u.uid) at sign-in, so
    // RevenueCat's subscriber identity and this app's Firebase uid are the
    // same value by construction. Not re-derived or looked up here.
    // TRANSFER events: every real uid on either side of the move, since
    // both gain/lose entitlements and should be re-synced - filtered of
    // RevenueCat's own anonymous ids ($RCAnonymousID:...), which aren't
    // Firebase uids and have no Firestore doc to update.
    const targetUids = isTransfer
      ? [...new Set([...(event.transferred_from || []), ...(event.transferred_to || [])])].filter((id) => !id.startsWith("$RCAnonymousID:"))
      : [event.app_user_id];

    try {
      const results = [];
      for (const uid of targetUids) {
        // Scoped under each user's own doc, same convention as
        // analyzePhoto's analysisIdempotency - ownership enforced by path,
        // not a uid-match check in code or rules. Per-(uid, event.id) rather
        // than one event-wide record, since a TRANSFER can touch multiple
        // uids and a partial failure shouldn't block reprocessing whichever
        // ones weren't reached yet.
        const eventRef = db.collection("users").doc(uid).collection("revenueCatWebhookEvents").doc(event.id);
        const eventSnap = await eventRef.get();
        if (eventSnap.exists) {
          console.log(`[revenueCatWebhook] Duplicate event ${event.id} for uid=${uid}, already processed`);
          continue;
        }

        const isPro = await syncProStatus(uid);
        if (isPro === null) continue; // entitlement fetch failed for this uid, logged inside syncProStatus - not idempotency-marked, but no retry either since the overall response is still 200 below

        await eventRef.set({
          type: event.type,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          isPro,
        });
        results.push(`${uid}->isPro=${isPro}`);
      }

      console.log(`[revenueCatWebhook] Processed ${event.type} (event ${event.id}): ${results.join(", ") || "no uids updated"}`);
      res.status(200).send("OK");
    } catch (err) {
      console.error(`[revenueCatWebhook] Unhandled error for event ${event.id}: ${err.message}`);
      res.status(500).send("Internal error");
    }
  }
);

// {{FirstName}} substitution shared by all three user-facing email
// templates below - same source as the in-app "Hi, [Name]" greeting
// (App.js's user.displayName?.split(' ')[0]).
const firstNameFrom = (displayName) => (displayName || "").trim().split(" ")[0] || "there";

const welcomeEmailText = (displayName) => `Hi ${firstNameFrom(displayName)},

Welcome to Uncluttrd!

We're Michael and Chantelle, the founders of Uncluttrd. Thanks for giving our app a try.

We built Uncluttrd because we believe getting organized shouldn't feel overwhelming. Sometimes all you need is a place to start.

Ready to begin?

1. Open the app.
2. Snap a photo of your space.
3. Let Uncluttrd create your personalized organizing space.

If you ever have a question, suggestion, or just want to say hello, simply reply to this email. It comes directly to us, and we'd love to hear from you.

Let's turn clutter into calm.

Michael & Chantelle
Co-Founders, Uncluttrd`;

const proUpgradeEmailText = (displayName) => `Hi ${firstNameFrom(displayName)},

Thank you for becoming an Uncluttrd Pro member!

Your support helps us continue improving Uncluttrd and build new features that make organizing easier for everyone.

As a Pro member, you've unlocked:

✅ Unlimited organizing spaces
✅ Companion, your AI organizing coach
✅ AI room visualizations
✅ PDF exports

We can't wait to see what you organize next.

If you ever have a question, an idea, or run into an issue, simply reply to this email. We personally read every message.

Welcome to the next level of organizing.

Michael & Chantelle
Co-Founders, Uncluttrd`;

const reengagementEmailText = (displayName) => `Hi ${firstNameFrom(displayName)},

We noticed you haven't created your first organizing space yet, and that's perfectly okay.

Whenever you're ready, just open the app, snap a photo of the space you'd like to organize, and let Uncluttrd build a personalized space to help you get started.

If you ran into a problem or have a question, just reply to this email. It comes directly to us, and we're always happy to help.

We can't wait to see what you organize first.

Michael & Chantelle
Co-Founders, Uncluttrd`;

// Fires once, on genuine new-signup doc creation only - gated on the
// isNewSignup marker App.js's real signup call site sets explicitly
// (DecisionLog.md 2026-07-24), not on bare users/{uid} doc creation.
// ensureUserDocument (App.js) also creates this doc on a legacy user's
// first login after any auth resolution, not just real signups - without
// this gate, those users would incorrectly get a "welcome" email too.
// Any future Admin-SDK bulk-write script touching users/{uid} docs won't
// accidentally trigger this either, for the same reason.
exports.sendWelcomeEmail = onDocumentCreated(
  { document: "users/{userId}", secrets: [RESEND_API_KEY] },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.isNewSignup !== true) return;
    if (!data.email) {
      console.error(`[sendWelcomeEmail] No email on new signup doc for uid=${event.params.userId}`);
      return;
    }
    await sendEmail({
      from: TRANSACTIONAL_EMAIL_FROM,
      to: data.email,
      subject: "Welcome to Uncluttrd! 👋",
      text: welcomeEmailText(data.displayName),
    });
  }
);

// Fires once per user, roughly 24h after signup, only if they still have
// zero plans. Window is 30h-24h ago (not a tight 25h-24h) on an hourly
// schedule so a single failed/skipped run's cohort still gets caught by
// the next run - the reengagementEmailSentAt check (in-memory, not a query
// clause - see the comment below) is what actually prevents a double-send
// within that overlap, not the window alone.
exports.reengagementNudge = onSchedule(
  { schedule: "every 60 minutes", secrets: [RESEND_API_KEY] },
  async () => {
    const now = Date.now();
    const windowStart = admin.firestore.Timestamp.fromMillis(now - 30 * 60 * 60 * 1000);
    const windowEnd = admin.firestore.Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
    // Both clauses are range filters on the same field (createdAt) - served
    // by the automatic single-field index, no composite index needed. Same
    // reasoning as checkOrphanedUserDeletions above for why the "already
    // sent" check stays an in-memory filter instead of a third where()
    // clause: Firestore's `!=`/not-equal-style filters exclude documents
    // where the field doesn't exist at all, which is the common case here
    // (reengagementEmailSentAt is absent until the first successful send).
    const snap = await db.collection("users")
      .where("createdAt", ">=", windowStart)
      .where("createdAt", "<=", windowEnd)
      .get();

    for (const doc of snap.docs) {
      try {
        const data = doc.data();
        if (data.reengagementEmailSentAt) continue;
        const plansSnap = await doc.ref.collection("plans").limit(1).get();
        if (!plansSnap.empty) continue;
        if (!data.email) continue;
        await sendEmail({
          from: TRANSACTIONAL_EMAIL_FROM,
          to: data.email,
          subject: "Ready when you are.",
          text: reengagementEmailText(data.displayName),
        });
        await doc.ref.update({ reengagementEmailSentAt: admin.firestore.FieldValue.serverTimestamp() });
      } catch (err) {
        console.error(`[reengagementNudge] Failed for uid=${doc.id}: ${err.message}`);
      }
    }
  }
);

// --- Phase C4: retention cleanup job (DeletionDesign.md's "Soft-Delete
// Revision" background job / DeletionImplementation.md Phase C4) ---------
// Hard-deletes Rooms/Areas once their 30-day soft-delete retention window
// has passed, by calling the Phase C3 hard-delete engine
// (hardDeleteRoomAdmin/hardDeleteAreaAdmin, required above) - this file
// deliberately contains no deletion logic of its own, only the
// discovery/scheduling/logging around calling that engine.
//
// Exported as a plain, directly-callable function (not just the
// onSchedule wrapper below) specifically so a real-staging test can
// invoke it with a shorter/overridden retentionDays, the same pattern
// DeletionDesign.md's own background-job sketch already called for -
// proving this against real 30-day-old data would mean waiting 30 real
// days. `db` is an explicit parameter (matching every function in
// scripts/runSpaceMigration.js's own dependency-injection convention)
// rather than reaching for this file's own module-level `db`, so a test
// script can pass in its own Admin app's Firestore instance directly.
async function runExpiredDeletionSweep(db, { retentionDays = 30 } = {}) {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const summary = {
    rooms: { discovered: 0, deleted: 0, alreadyGone: 0, failed: 0 },
    areas: { discovered: 0, deleted: 0, alreadyGone: 0, skippedParentDeleted: 0, failed: 0 },
    plans: null,
  };
  const fmtDeletedAt = (ts) => (ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : String(ts));

  // Pass 1: expired Rooms, first. hardDeleteRoomAdmin already recursively
  // hard-deletes every Area under it (Phase C3), so this pass alone fully
  // closes out a Room-level soft-delete, Areas included - matching
  // DeletionDesign.md's own "Rooms first" ordering.
  //
  // deletedAt <= cutoff alone (no separate retired == true clause) is a
  // sufficient filter, not an oversight: deletedAt is NEVER set without
  // retired: true also being set (softDeleteRoom/softDeleteArea's own
  // contract) and a bare merge/reclassification tombstone (retired: true,
  // no deletedAt) never matches a range filter on a field it doesn't have
  // - Invariant/requirement 4's "naturally excludes them," confirmed by
  // testing (d) below, not just asserted. This also keeps the query on a
  // single field, servable by a collection-group field-override index
  // (firestore.indexes.json) rather than a composite index, matching this
  // file's own established preference (see checkOrphanedUserDeletions/
  // reengagementNudge's identical reasoning for their own range queries).
  const spacesSnap = await db.collectionGroup("spaces").where("deletedAt", "<=", cutoff).get();
  for (const spaceDoc of spacesSnap.docs) {
    summary.rooms.discovered++;
    const uid = spaceDoc.ref.parent.parent.id;
    const roomId = spaceDoc.id;
    const deletedAt = spaceDoc.data().deletedAt;
    try {
      const result = await hardDeleteRoomAdmin(db, uid, roomId);
      const outcome = result.outcome === "hard-deleted" ? "deleted" : result.outcome === "already-deleted" ? "already-gone" : "failed";
      if (outcome === "deleted") summary.rooms.deleted++;
      else if (outcome === "already-gone") summary.rooms.alreadyGone++;
      else summary.rooms.failed++;
      console.log(`[cleanupExpiredDeletions] Room uid=${uid} roomId=${roomId} deletedAt=${fmtDeletedAt(deletedAt)} outcome=${outcome}${outcome === "failed" ? ` detail=${JSON.stringify(result)}` : ""}`);
    } catch (e) {
      summary.rooms.failed++;
      console.error(`[cleanupExpiredDeletions] Room uid=${uid} roomId=${roomId} deletedAt=${fmtDeletedAt(deletedAt)} outcome=failed error=${e.message}`);
    }
  }

  // Pass 2: expired standalone Areas - independently soft-deleted, not via
  // a Room-level cascade. Governing rule (stated explicitly, not just
  // implemented): once a Room is soft-deleted, its child Areas become
  // part of THAT Room's retained/restorable graph - the Room's own
  // expiration governs the whole subtree from that point on, regardless
  // of any individual Area's own (possibly much older) deletedAt. Cleaning
  // up such an Area early, ahead of its parent Room, would make a future
  // Restore Room incomplete. So every candidate here is skipped whenever
  // its parent Space is itself currently user-deleted (retired === true
  // AND has a deletedAt) - independent of whether the ROOM has reached
  // its own cutoff yet; Pass 1 above is the only thing that ever cleans up
  // that subtree, whenever the ROOM's own deletedAt expires.
  const areasSnap = await db.collectionGroup("areas").where("deletedAt", "<=", cutoff).get();
  for (const areaDoc of areasSnap.docs) {
    summary.areas.discovered++;
    const roomRef = areaDoc.ref.parent.parent;
    const uid = roomRef.parent.parent.id;
    const roomId = roomRef.id;
    const areaId = areaDoc.id;
    const deletedAt = areaDoc.data().deletedAt;
    try {
      const spaceSnap = await roomRef.get();
      const parentIsUserDeleted = spaceSnap.exists && spaceSnap.data().retired === true && !!spaceSnap.data().deletedAt;
      if (parentIsUserDeleted) {
        summary.areas.skippedParentDeleted++;
        console.log(`[cleanupExpiredDeletions] Area uid=${uid} roomId=${roomId} areaId=${areaId} deletedAt=${fmtDeletedAt(deletedAt)} outcome=skipped-parent-deleted`);
        continue;
      }
      const result = await hardDeleteAreaAdmin(db, uid, roomId, areaId);
      const outcome = result.outcome === "hard-deleted" ? "deleted" : result.outcome === "already-deleted" ? "already-gone" : "failed";
      if (outcome === "deleted") summary.areas.deleted++;
      else if (outcome === "already-gone") summary.areas.alreadyGone++;
      else summary.areas.failed++;
      console.log(`[cleanupExpiredDeletions] Area uid=${uid} roomId=${roomId} areaId=${areaId} deletedAt=${fmtDeletedAt(deletedAt)} outcome=${outcome}${outcome === "failed" ? ` detail=${JSON.stringify(result)}` : ""}`);
    } catch (e) {
      summary.areas.failed++;
      console.error(`[cleanupExpiredDeletions] Area uid=${uid} roomId=${roomId} areaId=${areaId} deletedAt=${fmtDeletedAt(deletedAt)} outcome=failed error=${e.message}`);
    }
  }

  // Pass 3: Storage of individually soft-deleted plans past the same window.
  // Runs after the Room/Area passes, which hard-delete their own plans
  // outright, so nothing here overlaps them. See planStoragePurge.js for why
  // this purges files and keeps the plan document as a tombstone.
  //
  // Isolated in its own try: a failure here (for example the plans.deletedAt
  // collection-group index not yet deployed) must not hide the Room/Area
  // results above, and the pass simply retries tomorrow.
  try {
    summary.plans = await purgeExpiredDeletedPlanStorage({
      db,
      bucket: admin.storage().bucket(),
      deleteStoragePrefixes: deleteStoragePrefixesAdmin,
      fieldValue: admin.firestore.FieldValue,
      timestampFromMillis: (ms) => admin.firestore.Timestamp.fromMillis(ms),
      retentionDays,
    });
  } catch (e) {
    summary.plans = { failed: "pass", error: e.message };
    console.error(`[cleanupExpiredDeletions] Plan storage pass failed: ${e.message}`);
  }

  console.log(`[cleanupExpiredDeletions] SUMMARY: ${JSON.stringify(summary)}`);
  return summary;
}

exports.cleanupExpiredDeletions = onSchedule(
  { schedule: "0 3 * * *", timeZone: "UTC" },
  async () => {
    await runExpiredDeletionSweep(db, { retentionDays: 30 });
  }
);

// Not a Cloud Function - a plain export. firebase-functions v2 only treats
// exports created via its own builders (onCall/onSchedule/etc, which
// attach internal __endpoint metadata) as deployable; a bare function like
// this is inert to `firebase deploy` and simply available to
// require("./index.js") from a real-staging test script, matching
// DeletionDesign.md's own explicit reasoning for why this needs to exist
// as a directly-callable export in the first place.
exports.runExpiredDeletionSweep = runExpiredDeletionSweep;

// --- Phase C5: server-side account deletion (DeletionImplementation.md) ---
// The ONLY entry point Delete Account is allowed to use, client-side - the
// client calls this callable and does nothing else itself (no direct
// Firestore/Storage/Auth SDK calls of its own for deletion anymore). uid
// is taken exclusively from request.auth.uid, the ID token Firebase
// Callable Functions already verifies server-side - never a client-
// supplied parameter, so there is no way for an authenticated caller to
// ever trigger this against any account but their own. All the actual
// work is scripts/runSpaceMigration.js's hardDeleteAccountAdmin (required
// above) - this wrapper only enforces auth and translates its result into
// either a plain success or an HttpsError the client's own retry UI can
// act on.
//
// timeoutSeconds/maxInstances: an account with many Rooms/photos can take
// a while (real per-Room, per-plan, per-Storage-prefix work, not a single
// fast write) - generateVisualization's own 300s precedent, reused here
// for the same "genuinely slow, not stuck" reasoning. maxInstances kept
// low (this is a rare, destructive, one-per-user-ever operation, not a
// hot path - no reason to allow high concurrency).
exports.hardDeleteAccount = onCall(
  { maxInstances: 5, timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Must be signed in to delete your account.");
    }
    const uid = request.auth.uid;
    let result;
    try {
      result = await hardDeleteAccountAdmin(db, uid);
    } catch (e) {
      console.error(`[hardDeleteAccount] uid=${uid} threw: ${e.message}`);
      throw new HttpsError("internal", "Something went wrong deleting your account. Please try again.");
    }
    if (result.outcome !== "hard-deleted") {
      // "content-incomplete" or "auth-delete-failed" - hardDeleteAccountAdmin's
      // own content-gate already guarantees nothing was left half-done
      // (the profile doc/Auth account are only ever touched once every
      // content phase reports zero failures), so a retry is always safe -
      // report failure so the client shows its own error+retry UI rather
      // than a false "success."
      console.error(`[hardDeleteAccount] uid=${uid} incomplete: outcome=${result.outcome}`);
      throw new HttpsError("internal", "Account deletion didn't fully complete. Please try again.");
    }
    return { outcome: result.outcome };
  }
);

// ---------------------------------------------------------------------------
// UNSUBSCRIBE  (CAN-SPAM)
// ---------------------------------------------------------------------------
// Public, unauthenticated, token-addressed. The token is a per-user UUID stored
// on the user document; it is the only credential, so it is never logged and
// never echoed in an error message.
//
// WHY GET DOES NOT UNSUBSCRIBE
// A bare GET that mutates is the classic mistake here. Outlook Safe Links,
// Gmail's prefetcher and corporate mail scanners all fetch links in received
// mail with no human involved. If GET performed the opt-out, some recipients
// would be silently unsubscribed for the crime of receiving the message. So:
//
//   GET  -> renders a confirmation page with a single button
//   POST -> performs the opt-out
//
// That is still one human click, which CAN-SPAM allows, and it survives
// scanners. The exception is RFC 8058 one-click, where Gmail and Outlook POST
// from their own UI - a genuine human action, honoured immediately.
exports.handleUnsubscribe = onRequest(async (req, res) => {
  const token = String((req.query && req.query.token) || (req.body && req.body.token) || "").trim();

  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:#F7F8FA;color:#0F2A52;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border-radius:16px;padding:32px;max-width:440px;box-shadow:0 2px 16px rgba(15,42,82,.08);text-align:center}
h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.55;color:#54607A;margin:0 0 20px}
button{background:#1E9E52;color:#fff;border:0;border-radius:10px;padding:13px 26px;font-size:15px;font-weight:600;cursor:pointer}
a{color:#166E38}</style></head><body><div class="card">${body}</div></body></html>`;

  // Deliberately identical for "no token" and "unknown token" - a
  // distinguishable response would let someone test tokens for validity.
  const genericDone = () => res.status(200).send(page("Unsubscribed",
    `<h1>You're unsubscribed</h1><p>You won't receive further product emails from Uncluttrd.
     If that was a mistake, reply to any earlier email and we'll put you back on.</p>
     <p><a href="https://uncluttrd.app">uncluttrd.app</a></p>`));

  try {
    if (!token) return genericDone();

    // GET: confirm first, never mutate.
    if (req.method === "GET") {
      const safe = token.replace(/[^A-Za-z0-9-]/g, "");
      return res.status(200).send(page("Unsubscribe",
        `<h1>Unsubscribe from Uncluttrd emails?</h1>
         <p>You'll stop receiving product and feature emails. Account and purchase
            emails will still reach you.</p>
         <form method="POST"><input type="hidden" name="token" value="${safe}">
         <button type="submit">Unsubscribe</button></form>`));
    }

    if (req.method !== "POST") {
      res.set("Allow", "GET, POST");
      return res.status(405).send("Method not allowed");
    }

    const snap = await db.collection("users").where("unsubscribeToken", "==", token).limit(1).get();
    if (snap.empty) return genericDone(); // unknown token - same response, no probe signal

    await snap.docs[0].ref.update({
      emailOptOut: true,
      emailOptOutAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[handleUnsubscribe] opted out uid=${snap.docs[0].id}`); // uid, never the token
    return genericDone();
  } catch (err) {
    console.error(`[handleUnsubscribe] ${err.message}`);
    // Still report success: someone who clicked unsubscribe must never be told
    // to try again. The retry path is a resend, and the error is in the log.
    return genericDone();
  }
});

// Marketing sends must consult this. Deliberately NOT applied to the welcome or
// Pro-purchase emails: those are transactional, CAN-SPAM does not require
// opt-out for them, and suppressing a purchase confirmation because someone
// declined feature announcements would be worse than the problem this solves.
async function isOptedOutOfMarketing(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists && snap.data().emailOptOut === true;
  } catch (e) {
    // Fail CLOSED - if opt-out state cannot be read, do not send.
    console.error(`[isOptedOutOfMarketing] ${uid}: ${e.message}`);
    return true;
  }
}
