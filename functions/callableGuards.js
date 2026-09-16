/**
 * Guards shared by the three AI callables - analyzePhoto,
 * compareAreaCandidates and generateNextAction.
 *
 * Phase one of callable security containment (2026-09-15). Until this
 * module existed, all three functions were callable with no Firebase auth
 * at all, and analyzePhoto skipped the free-plan limit, the RevenueCat
 * entitlement check and idempotency entirely whenever analysisId was
 * absent (the `enforceLimit` shim added by 0d401f6 on 2026-07-15 for the
 * pre-Companion "build 15" client shape, which stopped being the live App
 * Store version at 2.0.0 on 2026-08-18). Every released client since then
 * calls these from inside MainApp, which renders only for a signed-in user,
 * so requiring auth breaks no shipped build.
 *
 * Everything here runs BEFORE any provider call, so a rejected request
 * costs nothing with Anthropic.
 *
 * State lives under users/{uid}/aiCallGuards/. No Firestore rule matches
 * that path, so it is deny-by-default for clients and writable only by the
 * Admin SDK - the same posture as analysisIdempotency, without needing a
 * rules change. Account deletion already sweeps every subcollection under
 * users/{uid} (hardDeleteAccountAdmin), so these documents are removed with
 * the account.
 *
 * App Check is deliberately NOT enforced here: no released client sends a
 * token (production logs show app:"MISSING" on 100% of calls), so enforcing
 * would reject all real traffic. Adding the App Check SDK to the client and
 * then enforcing it on these callables is required work for the next native
 * release - see BACKLOG.md's App Check item.
 */
const crypto = require("crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// A base64 image this size is ~6 MB of binary. The client sends ~1-2 MB
// (resize to 768-1568px, compress 0.5), so this is a generous abuse ceiling,
// not a product limit.
const MAX_IMAGE_B64_CHARS = 8 * 1024 * 1024;
// Client prompts run ~2-6k characters.
const MAX_PROMPT_CHARS = 20000;
// The client narrows to at most 3 candidate Areas (App.js:477) with at most
// 2 distinct reference photos each, plus today's photo.
const MAX_CANDIDATES = 4;
const MAX_TOTAL_IMAGES = 8;
// Abuse protection, NOT a user-facing product entitlement: no paywall, no
// messaging, and no marketing claim depends on it. A real user reaches a
// handful of these per day because each one is an internal step of a single
// "take a photo" action. Revisit if a legitimate workflow ever approaches it.
const SAFETY_LIMIT_CALLS = 30;
const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000;
// Replay cache lifetime. Long enough to absorb retries and double-taps,
// short enough that a genuinely new comparison is never served a stale
// answer. expiresAt is written so a Firestore TTL policy can be enabled on
// this collection later (console/gcloud config, not code).
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

/** One-way, stable, non-reversible. Groups a user's calls in logs without
 * putting a raw uid in them. */
const uidTag = (uid) => crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 12);

/** Auth gate. Nothing billable may happen before this returns. */
function requireUid(request) {
  const uid = request?.auth?.uid;
  if (typeof uid !== "string" || uid.length === 0) {
    throw new HttpsError("unauthenticated", "Please sign in and try again.");
  }
  return uid;
}

function requireString(value, field, maxChars) {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpsError("invalid-argument", `Missing ${field}.`);
  }
  if (value.length > maxChars) {
    throw new HttpsError("invalid-argument", `${field} is too large.`);
  }
  return value;
}

function requireImage(value, field) {
  return requireString(value, field, MAX_IMAGE_B64_CHARS);
}

function requirePrompt(value) {
  return requireString(value, "prompt", MAX_PROMPT_CHARS);
}

/**
 * analysisId is the free-plan idempotency key and a Firestore document id,
 * so it has to be present, bounded and path-safe. Every supported released
 * client supplies it (App.js:7509, and the canary at functions/index.js:781),
 * which is why a missing one is now rejected outright rather than silently
 * skipping enforcement.
 */
function requireAnalysisId(value) {
  requireString(value, "analysisId", 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value) || value === "." || value === "..") {
    throw new HttpsError("invalid-argument", "analysisId is malformed.");
  }
  return value;
}

/** Deterministic request fingerprint: same user, same inputs, same hash.
 * Hashing is streamed, so multi-MB images cost no extra memory. */
function hashRequest(uid, parts) {
  const h = crypto.createHash("sha256").update(String(uid));
  for (const part of parts) {
    h.update("\0").update(typeof part === "string" ? part : JSON.stringify(part ?? null));
  }
  return h.digest("hex");
}

const guardsCollection = (db, uid) => db.collection("users").doc(uid).collection("aiCallGuards");

/**
 * Replay protection. A byte-identical repeat of a request this user already
 * paid for returns the stored result instead of calling the provider again -
 * so a double-tap, a client retry or a replayed payload cannot buy a second
 * Anthropic call. Returns null on a miss, and on any Firestore error: a
 * cache that is down must not take the feature down with it.
 */
async function lookupReplay(db, uid, hash) {
  try {
    const snap = await guardsCollection(db, uid).doc(`replay_${hash.slice(0, 48)}`).get();
    if (!snap.exists) return null;
    const data = snap.data();
    const storedAt = data.storedAtMs || 0;
    if (Date.now() - storedAt > REPLAY_TTL_MS) return null;
    return data.result ?? null;
  } catch (err) {
    console.warn(`[aiCallGuards] replay lookup failed: ${err.message}`);
    return null;
  }
}

async function storeReplay(db, uid, hash, result) {
  try {
    await guardsCollection(db, uid).doc(`replay_${hash.slice(0, 48)}`).set({
      result,
      storedAtMs: Date.now(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + REPLAY_TTL_MS),
    });
  } catch (err) {
    console.warn(`[aiCallGuards] replay store failed: ${err.message}`);
  }
}

/**
 * Per-uid rolling 24-hour ceiling on BILLABLE calls (a replay hit never
 * reaches here). Counted in one transaction so concurrent requests cannot
 * both pass the last slot. Each function keeps its own counter, and each
 * user their own document, so one user's activity can never exhaust
 * another's.
 *
 * A Firestore failure here is allowed through rather than failing the
 * request: this is a ceiling on abuse, and auth plus the per-call caps are
 * the primary controls.
 */
async function consumeSafetyLimit(db, uid, fnName) {
  const ref = guardsCollection(db, uid).doc(`limit_${fnName}`);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const previous = (snap.exists && Array.isArray(snap.data().calls) ? snap.data().calls : [])
        .filter((ms) => typeof ms === "number" && now - ms < SAFETY_WINDOW_MS);
      if (previous.length >= SAFETY_LIMIT_CALLS) {
        throw new HttpsError("resource-exhausted", "Too many requests today. Please try again later.");
      }
      previous.push(now);
      tx.set(ref, {
        calls: previous.slice(-SAFETY_LIMIT_CALLS),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.warn(`[aiCallGuards] safety limit check failed for ${fnName}: ${err.message}`);
  }
}

module.exports = {
  MAX_IMAGE_B64_CHARS,
  MAX_PROMPT_CHARS,
  MAX_CANDIDATES,
  MAX_TOTAL_IMAGES,
  SAFETY_LIMIT_CALLS,
  SAFETY_WINDOW_MS,
  REPLAY_TTL_MS,
  uidTag,
  requireUid,
  requireString,
  requireImage,
  requirePrompt,
  requireAnalysisId,
  hashRequest,
  lookupReplay,
  storeReplay,
  consumeSafetyLimit,
};
