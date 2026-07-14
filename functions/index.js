const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { toFile } = require("openai/uploads");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ANTHROPIC_KEY = defineSecret("ANTHROPIC_KEY");
const OPENAI_KEY = defineSecret("OPENAI_KEY");

const FREE_MONTHLY_LIMIT = 3;
const IDEMPOTENCY_TTL_DAYS = 60; // within the requested 30-90 day range; requires a Firestore TTL policy on expiresAt (console/gcloud config, not code)
const DELETION_AUDIT_TTL_DAYS = 30; // requires a Firestore TTL policy on expiresAt, same as above
const DELETION_CHECK_GRACE_MINUTES = 10; // give the client's Auth deletion call time to land before flagging

// "Calendar month" is defined in UTC server-side - the simplest, most
// tamper-resistant definition, though it means a user right at a month
// boundary could see rollover at a different local-clock moment than
// midnight-their-timezone. Flagged as a deliberate choice, not an oversight.
const currentMonthUTC = () => new Date().toISOString().slice(0, 7); // "YYYY-MM"

exports.analyzePhoto = onCall(
  { secrets: [ANTHROPIC_KEY], maxInstances: 10 },
  async (request) => {
    const { imageBase64, prompt, analysisId } = request.data || {};

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    if (!imageBase64 || !prompt || !analysisId) {
      throw new HttpsError("invalid-argument", "Missing image, prompt, or analysisId.");
    }

    const uid = request.auth.uid;
    const userRef = db.collection("users").doc(uid);
    // Structured as a subcollection under the user's own doc so ownership is
    // enforced by path, not a separate uid-match check in code or rules.
    const idemRef = userRef.collection("analysisIdempotency").doc(analysisId);

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
    const month = currentMonthUTC();

    if (userData.isPro !== true) {
      const effectiveCount = userData.analysisCountMonth === month ? (userData.analysisCount || 0) : 0;
      if (effectiveCount >= FREE_MONTHLY_LIMIT) {
        throw new HttpsError("resource-exhausted", "Free plan limit reached for this month.");
      }
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY.value() });
    let text;
    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: imageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      text = message.content.find((b) => b.type === "text")?.text || "";
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
    let analysesRemaining = null;
    try {
      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(userRef);
        const freshData = freshSnap.exists ? freshSnap.data() : {};
        const expiresAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000
        );

        if (freshData.isPro === true) {
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

    return { text, analysesRemaining };
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
        // Bumped from 500: every call now also returns a completion judgment,
        // not just occasionally.
        max_tokens: 650,
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

exports.generateVisualization = onCall(
  { secrets: [OPENAI_KEY], maxInstances: 10, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const { imageBase64, prompt } = request.data || {};

    if (!imageBase64 || !prompt) {
      throw new HttpsError("invalid-argument", "Missing image or prompt.");
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
