/**
 * Security guards on the three AI callables, run against the real exported
 * handlers and the Firestore emulator.
 *
 *   npx firebase-tools emulators:exec --only firestore --project demo-uncluttrd-guards \
 *     "node --test scripts/callableGuards.test.js"
 *
 * Phase one of callable security containment (2026-09-15). Until then all
 * three functions accepted unauthenticated calls, and analyzePhoto skipped
 * the free-plan limit, the RevenueCat check and idempotency whenever
 * analysisId was absent.
 *
 * ANTHROPIC_KEY is deliberately set to an invalid value: every guard under
 * test must reject before any provider call, so a test that accidentally
 * reaches Anthropic fails with an "internal" error instead of quietly
 * passing - and spends nothing. Reaching "internal" is therefore the
 * signal that a request got PAST the guards, which several tests assert on
 * purpose (the canary exemption, the different-user limit).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const PROJECT_ID = "demo-uncluttrd-guards";
assert.ok(PROJECT_ID.startsWith("demo-"), "tests must never target a real project");
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set - run this suite through firebase emulators:exec");
}

const CANARY_UID = "canary-test-uid";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID });
process.env.ANTHROPIC_KEY = "invalid-key-guard-tests-must-not-reach-anthropic";
process.env.OPENAI_KEY = "invalid-key";
process.env.RESEND_API_KEY = "invalid-key";
process.env.REVENUECAT_SECRET_API_KEY = "invalid-key";
process.env.REVENUECAT_WEBHOOK_SECRET_IOS = "invalid-key";
process.env.REVENUECAT_WEBHOOK_SECRET_ANDROID = "invalid-key";
process.env.CANARY_TEST_UID = CANARY_UID;

const FUNCTIONS_DIR = path.join(__dirname, "..", "functions");
const fns = require(path.join(FUNCTIONS_DIR, "index.js"));
const guards = require(path.join(FUNCTIONS_DIR, "callableGuards.js"));
// The same module instance functions/index.js loaded, so this shares its
// initialized app and its emulator connection.
const admin = require(require.resolve("firebase-admin", { paths: [FUNCTIONS_DIR] }));
const db = admin.firestore();

// ---- helpers ---------------------------------------------------------------

const IMAGE = "aGVsbG8taW1hZ2UtYmFzZTY0";           // stand-in base64, never sent anywhere
const PROMPT = "Describe this space and suggest three approaches.";
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const callAs = (fn, uid, data) => fn.run({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} });

async function errorFrom(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
}

async function expectCode(promise, code, label) {
  const err = await errorFrom(promise);
  assert.ok(err, `${label}: expected a rejection, got success`);
  assert.equal(err.code, code, `${label}: ${err.code} - ${err.message}`);
  return err;
}

/** Captures everything the handler logs, so tests can assert on it. */
function captureLogs(run) {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ["log", "warn", "error"]) {
    console[level] = (...args) => lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  }
  return Promise.resolve()
    .then(run)
    .catch(() => {})
    .finally(() => Object.assign(console, original))
    .then(() => lines);
}

const analyzeData = (over = {}) => ({ imageBase64: IMAGE, prompt: PROMPT, analysisId: uniq(), ...over });
const compareData = (over = {}) => ({
  todayImageBase64: IMAGE,
  candidates: [{ areaId: "area-1", images: [IMAGE] }],
  ...over,
});
const nextActionData = (over = {}) => ({
  originalImageBase64: IMAGE,
  beforeImageBase64: IMAGE,
  afterImageBase64: `${IMAGE}-after`,
  prompt: PROMPT,
  ...over,
});

// ---- 1. authentication -----------------------------------------------------

test("unauthenticated requests are rejected by all three functions, before any provider call", async () => {
  for (const [name, fn, data] of [
    ["analyzePhoto", fns.analyzePhoto, analyzeData()],
    ["compareAreaCandidates", fns.compareAreaCandidates, compareData()],
    ["generateNextAction", fns.generateNextAction, nextActionData()],
  ]) {
    const err = await expectCode(callAs(fn, null, data), "unauthenticated", name);
    // "internal" is what an actual Anthropic call with the invalid test key
    // produces, so its absence is the proof nothing billable ran.
    assert.notEqual(err.code, "internal", `${name} must reject before calling the provider`);
  }
});

// ---- 2. analyzePhoto: analysisId is mandatory again ------------------------

test("analyzePhoto rejects a missing, empty or malformed analysisId", async () => {
  const uid = `user-${uniq()}`;
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ analysisId: undefined })), "invalid-argument", "missing");
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ analysisId: "" })), "invalid-argument", "empty");
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ analysisId: "a/b" })), "invalid-argument", "path separator");
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ analysisId: "x".repeat(129) })), "invalid-argument", "overlong");
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ analysisId: 12345 })), "invalid-argument", "non-string");
});

test("the shapes every released client sends are accepted by the guards", () => {
  // App.js:7509 mints `${Date.now()}-${random}`; the canary mints `canary-${Date.now()}`.
  assert.doesNotThrow(() => guards.requireAnalysisId(`${Date.now()}-a1b2c3d4`));
  assert.doesNotThrow(() => guards.requireAnalysisId(`canary-${Date.now()}`));
});

// ---- 3. analyzePhoto: quota, idempotency, canary ---------------------------

test("analyzePhoto still replays a cached analysisId without a provider call", async () => {
  const uid = `user-${uniq()}`;
  const analysisId = uniq();
  await db.collection("users").doc(uid).collection("analysisIdempotency").doc(analysisId)
    .set({ text: "cached-plan-text", analysesRemaining: 1 });

  const result = await callAs(fns.analyzePhoto, uid, analyzeData({ analysisId }));
  assert.deepEqual(result, { text: "cached-plan-text", analysesRemaining: 1 });
});

test("analyzePhoto still enforces the free monthly limit for a non-entitled user", async () => {
  const uid = `user-${uniq()}`;
  const month = new Date().toISOString().slice(0, 7);
  await db.collection("users").doc(uid).set({ analysisCount: 3, analysisCountMonth: month, isPro: false });

  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData()), "resource-exhausted", "free limit");
});

test("analyzePhoto enforces the limit even when the client omits analysisId - the closed bypass", async () => {
  const uid = `user-${uniq()}`;
  const month = new Date().toISOString().slice(0, 7);
  await db.collection("users").doc(uid).set({ analysisCount: 3, analysisCountMonth: month, isPro: false });

  // Before this change the same call skipped the limit entirely and went
  // straight to Anthropic. Now it cannot get that far.
  const err = await expectCode(
    callAs(fns.analyzePhoto, uid, analyzeData({ analysisId: undefined })),
    "invalid-argument",
    "no analysisId",
  );
  assert.notEqual(err.code, "internal");
});

test("the canary is still exempt from the free limit", async () => {
  const month = new Date().toISOString().slice(0, 7);
  await db.collection("users").doc(CANARY_UID).set({ analysisCount: 99, analysisCountMonth: month, isPro: false });

  const err = await errorFrom(callAs(fns.analyzePhoto, CANARY_UID, analyzeData({ analysisId: `canary-${Date.now()}` })));
  assert.ok(err, "expected the invalid Anthropic key to fail the call");
  assert.equal(err.code, "internal", "canary must pass the guards and reach the provider");
});

// ---- 4. size caps ----------------------------------------------------------

test("oversized images and prompts are rejected", async () => {
  const uid = `user-${uniq()}`;
  const hugeImage = "A".repeat(guards.MAX_IMAGE_B64_CHARS + 1);
  const hugePrompt = "p".repeat(guards.MAX_PROMPT_CHARS + 1);

  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ imageBase64: hugeImage })), "invalid-argument", "image");
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ priorPhotoBase64: hugeImage })), "invalid-argument", "prior photo");
  await expectCode(callAs(fns.analyzePhoto, uid, analyzeData({ prompt: hugePrompt })), "invalid-argument", "prompt");
  await expectCode(callAs(fns.generateNextAction, uid, nextActionData({ afterImageBase64: hugeImage })), "invalid-argument", "after photo");
  await expectCode(callAs(fns.compareAreaCandidates, uid, compareData({ todayImageBase64: hugeImage })), "invalid-argument", "today photo");
});

// ---- 5. compare: shape caps ------------------------------------------------

test("compareAreaCandidates rejects too many candidates or images", async () => {
  const uid = `user-${uniq()}`;
  const candidate = (n) => ({ areaId: `area-${n}`, images: [IMAGE] });

  await expectCode(
    callAs(fns.compareAreaCandidates, uid, compareData({ candidates: [1, 2, 3, 4, 5].map(candidate) })),
    "invalid-argument",
    "5 candidates",
  );
  await expectCode(
    callAs(fns.compareAreaCandidates, uid, compareData({
      candidates: [1, 2, 3].map((n) => ({ areaId: `area-${n}`, images: [IMAGE, IMAGE, IMAGE] })),
    })),
    "invalid-argument",
    "9 images",
  );
  await expectCode(callAs(fns.compareAreaCandidates, uid, compareData({ candidates: [] })), "invalid-argument", "no candidates");
  await expectCode(
    callAs(fns.compareAreaCandidates, uid, compareData({ candidates: [{ areaId: "a", images: [] }] })),
    "invalid-argument",
    "candidate with no images",
  );

  // The real client's maximum - 3 areas x 2 images + today's photo - passes
  // the guards and is only stopped by the invalid provider key.
  const err = await errorFrom(callAs(fns.compareAreaCandidates, uid, compareData({
    candidates: [1, 2, 3].map((n) => ({ areaId: `area-${n}`, images: [IMAGE, `${IMAGE}-${n}`] })),
  })));
  assert.equal(err.code, "internal", "the client's own maximum must not be rejected");
});

// ---- 6. replay protection --------------------------------------------------

test("an identical compare request replays the stored result without a second provider call", async () => {
  const uid = `user-${uniq()}`;
  const data = compareData({ candidates: [{ areaId: "area-b", images: [IMAGE] }, { areaId: "area-a", images: [IMAGE] }] });
  const stored = { text: "MATCH_FOUND area-a", usage: { input_tokens: 1, output_tokens: 1 } };

  // Hash exactly as the handler does: sorted by areaId, so array order cannot
  // change the fingerprint.
  const hash = guards.hashRequest(uid, [
    "compareAreaCandidates",
    data.todayImageBase64,
    ...[...data.candidates].sort((a, b) => a.areaId.localeCompare(b.areaId)).flatMap((c) => [c.areaId, ...c.images]),
  ]);
  await guards.storeReplay(db, uid, hash, stored);

  assert.deepEqual(await callAs(fns.compareAreaCandidates, uid, data), stored);
  // Reversed candidate order is the same logical request.
  const reversed = { ...data, candidates: [...data.candidates].reverse() };
  assert.deepEqual(await callAs(fns.compareAreaCandidates, uid, reversed), stored);
  // Another user's identical request is not served from this user's cache.
  const other = await errorFrom(callAs(fns.compareAreaCandidates, `user-${uniq()}`, data));
  assert.equal(other.code, "internal", "replay cache must be per-user");
});

test("an identical next-action request replays the stored result without a second provider call", async () => {
  const uid = `user-${uniq()}`;
  const data = nextActionData();
  const stored = { text: "Fold the blankets on the left shelf." };
  const hash = guards.hashRequest(uid, [
    "generateNextAction",
    data.originalImageBase64,
    data.beforeImageBase64,
    data.afterImageBase64,
    data.prompt,
  ]);
  await guards.storeReplay(db, uid, hash, stored);

  assert.deepEqual(await callAs(fns.generateNextAction, uid, data), stored);
  // A different prompt is a different request and must not replay.
  const changed = await errorFrom(callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} Also mention lighting.` })));
  assert.equal(changed.code, "internal");
});

// ---- 7. per-uid safety limit ----------------------------------------------

test("the 31st unique compare request in 24 hours is rejected, per user", async () => {
  const uid = `user-${uniq()}`;
  const other = `user-${uniq()}`;

  for (let i = 0; i < guards.SAFETY_LIMIT_CALLS; i++) {
    await guards.consumeSafetyLimit(db, uid, "compareAreaCandidates");
  }
  await expectCode(
    callAs(fns.compareAreaCandidates, uid, compareData({ candidates: [{ areaId: `area-${uniq()}`, images: [IMAGE] }] })),
    "resource-exhausted",
    "31st compare",
  );

  // Separate counters: a different user is unaffected, and the same user's
  // other function is unaffected.
  const otherUser = await errorFrom(callAs(fns.compareAreaCandidates, other, compareData()));
  assert.equal(otherUser.code, "internal", "limits must be per-user");
  const otherFn = await errorFrom(callAs(fns.generateNextAction, uid, nextActionData()));
  assert.equal(otherFn.code, "internal", "limits must be per-function");
});

test("the 31st unique next-action request in 24 hours is rejected", async () => {
  const uid = `user-${uniq()}`;
  for (let i = 0; i < guards.SAFETY_LIMIT_CALLS; i++) {
    await guards.consumeSafetyLimit(db, uid, "generateNextAction");
  }
  await expectCode(
    callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} ${uniq()}` })),
    "resource-exhausted",
    "31st next action",
  );
});

test("calls outside the rolling 24-hour window do not count", async () => {
  const uid = `user-${uniq()}`;
  const stale = Date.now() - guards.SAFETY_WINDOW_MS - 60_000;
  await db.collection("users").doc(uid).collection("aiCallGuards").doc("limit_compareAreaCandidates")
    .set({ calls: new Array(guards.SAFETY_LIMIT_CALLS).fill(stale) });

  const err = await errorFrom(callAs(fns.compareAreaCandidates, uid, compareData()));
  assert.equal(err.code, "internal", "expired entries must not block a new request");
});

// ---- 8. logging hygiene ----------------------------------------------------

test("logs carry a hashed uid and metadata only - never a raw uid, prompt or image", async () => {
  const uid = "raw-uid-must-not-appear-in-logs";
  const secretPrompt = "PROMPT-CANARY-do-not-log-this-text";
  const secretImage = "IMAGE-CANARY-do-not-log-this-payload";

  const lines = await captureLogs(async () => {
    await errorFrom(callAs(fns.analyzePhoto, uid, { imageBase64: secretImage, prompt: secretPrompt, analysisId: uniq() }));
    await errorFrom(callAs(fns.compareAreaCandidates, uid, { todayImageBase64: secretImage, candidates: [{ areaId: "area-1", images: [secretImage] }] }));
    await errorFrom(callAs(fns.generateNextAction, uid, {
      originalImageBase64: secretImage, beforeImageBase64: secretImage, afterImageBase64: secretImage, prompt: secretPrompt,
    }));
  });

  const joined = lines.join("\n");
  assert.ok(lines.length > 0, "the guarded functions must log something");
  assert.ok(!joined.includes(uid), "raw uid appeared in logs");
  assert.ok(!joined.includes(secretPrompt), "prompt text appeared in logs");
  assert.ok(!joined.includes(secretImage), "image payload appeared in logs");
  assert.ok(joined.includes(guards.uidTag(uid)), "expected the hashed uid tag in logs");
});

test("no log line inside the three guarded callables interpolates a raw uid", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(FUNCTIONS_DIR, "index.js"), "utf8");
  // Scoped to these three functions. Other functions in this file still log
  // raw uids (analyzePhotoDetail, generateVisualization, the RevenueCat
  // webhook, the deletion sweeps); that is pre-existing and out of scope for
  // this change, which must not alter their behaviour.
  const offenders = [];
  for (const name of ["analyzePhoto", "compareAreaCandidates", "generateNextAction"]) {
    const start = src.indexOf(`exports.${name} = onCall(`);
    assert.ok(start > 0, `${name} not found`);
    const end = src.indexOf("\nexports.", start + 1);
    const body = src.slice(start, end === -1 ? src.length : end);
    const offset = src.slice(0, start).split("\n").length;
    body.split("\n").forEach((line, i) => {
      if (/console\.(log|warn|error)/.test(line) && /\$\{uid\}/.test(line)) {
        offenders.push([offset + i, line.trim()]);
      }
    });
  }
  assert.deepEqual(offenders, [], "these log lines interpolate a raw uid; use guards.uidTag(uid)");
});

// ---- 9. analyzePhotoDetail hardening ---------------------------------------

// Before this, analyzePhotoDetail required auth and nothing else: no prompt
// cap, no quota, no rate limit, and an ownership check that only ran when the
// caller chose to send planId. Any signed-in account could send unlimited
// arbitrary prompts at max_tokens 6000 through the Anthropic key.

const DETAIL_PROMPT = "Write the detail for each approach. ".repeat(600); // ~23k chars, a real-sized Call 2 prompt
const detailData = (over = {}) => ({ prompt: DETAIL_PROMPT, planId: `plan-${uniq()}`, ...over });

/** Creates the plan document analyzePhotoDetail checks ownership against. */
async function givenPlan(uid, planId) {
  await db.collection("users").doc(uid).collection("plans").doc(planId).set({ analysisStage: "summary-ready" });
  return planId;
}

test("analyzePhotoDetail rejects an unauthenticated call before any provider work", async () => {
  const err = await expectCode(callAs(fns.analyzePhotoDetail, null, detailData()), "unauthenticated", "no auth");
  assert.notEqual(err.code, "internal");
});

test("analyzePhotoDetail requires planId - the hole that skipped ownership entirely", async () => {
  const uid = `user-${uniq()}`;
  await expectCode(callAs(fns.analyzePhotoDetail, uid, detailData({ planId: undefined })), "invalid-argument", "missing");
  await expectCode(callAs(fns.analyzePhotoDetail, uid, detailData({ planId: "" })), "invalid-argument", "empty");
  await expectCode(callAs(fns.analyzePhotoDetail, uid, detailData({ planId: "a/b" })), "invalid-argument", "path separator");
});

test("analyzePhotoDetail rejects a plan owned by someone else", async () => {
  const owner = `user-${uniq()}`;
  const planId = await givenPlan(owner, `plan-${uniq()}`);
  const attacker = `user-${uniq()}`;
  await expectCode(callAs(fns.analyzePhotoDetail, attacker, detailData({ planId })), "permission-denied", "other owner");
});

test("analyzePhotoDetail rejects a planId that does not exist", async () => {
  const uid = `user-${uniq()}`;
  await expectCode(callAs(fns.analyzePhotoDetail, uid, detailData()), "permission-denied", "nonexistent");
});

test("a real-sized 23,222-character detail prompt is accepted", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const prompt = "x".repeat(23222); // the largest prompt measured across staging and production
  const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt, planId }));
  assert.equal(err.code, "internal", "must pass the guards and fail only at the invalid provider key");
});

test("a detail prompt over 40,000 characters is rejected", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const prompt = "x".repeat(guards.MAX_DETAIL_PROMPT_CHARS + 1);
  await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt, planId }), "invalid-argument", "over detail cap");
});

test("REGRESSION: analyzePhoto still rejects a prompt over 20,000 characters", async () => {
  const uid = `user-${uniq()}`;
  await expectCode(
    callAs(fns.analyzePhoto, uid, analyzeData({ prompt: "p".repeat(guards.MAX_PROMPT_CHARS + 1) })),
    "invalid-argument",
    "analyzePhoto cap unchanged",
  );
  assert.equal(guards.MAX_PROMPT_CHARS, 20000, "the deployed Call 1 cap must not move");
});

test("the per-plan cap rejects the 7th call for that plan", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  for (let i = 0; i < guards.MAX_DETAIL_CALLS_PER_PLAN; i++) {
    const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
    assert.equal(err.code, "internal", `call ${i + 1} should reach the provider`);
  }
  await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }), "resource-exhausted", "7th");

  // A different plan for the same user is unaffected by that plan's counter.
  const other = await givenPlan(uid, `plan-${uniq()}`);
  const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: other }));
  assert.equal(err.code, "internal", "per-plan counters must be per plan");
});

test("a non-entitled user is cut off on the 11th call of the UTC day", async () => {
  const uid = `user-${uniq()}`;
  // Spread across plans so the per-plan cap of 6 is never the limiter.
  for (let i = 0; i < guards.MAX_DETAIL_CALLS_PER_DAY_FREE; i++) {
    const planId = await givenPlan(uid, `plan-${uniq()}`);
    const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
    assert.equal(err.code, "internal", `call ${i + 1} of 10 should be allowed`);
  }
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }), "resource-exhausted", "11th");
});

test("an entitled user passes 10 and is cut off on the 51st", async () => {
  // CANARY_TEST_UID takes the entitled branch without reaching RevenueCat,
  // which is the same short-circuit analyzePhoto uses.
  const uid = CANARY_UID;
  await db.collection("users").doc(uid).collection("aiCallGuards").doc("daily_analyzePhotoDetail").delete();
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  // Seed the daily counter just under the entitled cap; per-plan is separate.
  await db.collection("users").doc(uid).collection("aiCallGuards").doc("daily_analyzePhotoDetail")
    .set({ day: guards.utcDayKey(), calls: guards.MAX_DETAIL_CALLS_PER_DAY_FREE + 5 });
  const allowed = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
  assert.equal(allowed.code, "internal", "an entitled user is not stopped at the free ceiling");

  await db.collection("users").doc(uid).collection("aiCallGuards").doc("daily_analyzePhotoDetail")
    .set({ day: guards.utcDayKey(), calls: guards.MAX_DETAIL_CALLS_PER_DAY_ENTITLED });
  const planId2 = await givenPlan(uid, `plan-${uniq()}`);
  await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: planId2 }), "resource-exhausted", "51st");
});

test("a call that fails validation consumes no count", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const counters = db.collection("users").doc(uid).collection("aiCallGuards");

  await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: "", planId }), "invalid-argument", "empty prompt");
  await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: "nope" }), "permission-denied", "bad plan");
  await expectCode(callAs(fns.analyzePhotoDetail, null, { prompt: DETAIL_PROMPT, planId }), "unauthenticated", "no auth");

  assert.equal((await counters.doc(`detail_${planId}`).get()).exists, false, "no per-plan count written");
  assert.equal((await counters.doc("daily_analyzePhotoDetail").get()).exists, false, "no daily count written");
});

test("the normal success path passes every guard and counts exactly once", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
  // The invalid test key is the only thing between the guards and a real call.
  assert.equal(err.code, "internal");

  const counters = db.collection("users").doc(uid).collection("aiCallGuards");
  assert.equal((await counters.doc(`detail_${planId}`).get()).data().calls, 1);
  const daily = (await counters.doc("daily_analyzePhotoDetail").get()).data();
  assert.equal(daily.calls, 1);
  assert.equal(daily.day, guards.utcDayKey(), "counted against the UTC day");
});

test("an accepted call logs prompt size and cap, and warns past 80% of the cap", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const lines = await captureLogs(async () => {
    await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: "x".repeat(35000), planId }));
  });
  const joined = lines.join("\n");
  assert.match(joined, /promptChars=35000/);
  assert.match(joined, /cap=40000/);
  assert.match(joined, /APPROACHING_PROMPT_CAP/, "88% of the cap must warn");
  assert.ok(!joined.includes("xxxxxxxxxx"), "prompt content must never be logged");
});
