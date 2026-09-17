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

// ---- RevenueCat, stubbed -------------------------------------------------
// Every entitlement check is intercepted here, so no test reaches
// api.revenuecat.com: these run offline, deterministically, and cannot be
// affected by a real account's state. Only that host is intercepted - a
// provider stub elsewhere in this file still sees its own traffic.
//
// The DEFAULT, for any test that does not opt in, is a definitive "not
// entitled": a plain 200 with an empty entitlement list. That is the shape a
// free account really has, so a test that forgets to declare its entitlement
// fails closed rather than passing on an accident.
const PRO_ENTITLEMENT_ID = "entl16a5fcafc4"; // asserted against the source below

const jsonResponse = (body, status = 200) => new Response(
  typeof body === "string" ? body : JSON.stringify(body),
  { status, headers: { "content-type": "application/json" } },
);

const ENTITLED = () => jsonResponse({ items: [{ entitlement_id: PRO_ENTITLEMENT_ID }] });
const NOT_ENTITLED = () => jsonResponse({ items: [] });
const HTTP = (status) => () => jsonResponse({ message: "stub" }, status);
const NETWORK_FAILURE = () => { throw new Error("connect ECONNREFUSED 127.0.0.1:443"); };
const TIMEOUT = () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); };
const UNPARSEABLE = () => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } });

let entitlementResponder = NOT_ENTITLED;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes("api.revenuecat.com")) return entitlementResponder();
  return realFetch(input, init);
};

/** Runs `run` with RevenueCat answering however `responder` says. */
async function withEntitlement(responder, run) {
  const previous = entitlementResponder;
  entitlementResponder = responder;
  try {
    return await run();
  } finally {
    entitlementResponder = previous;
  }
}

/** Counters and replay documents, for proving a rejected call spent nothing. */
const guardDoc = (uid, id) => db.collection("users").doc(uid).collection("aiCallGuards").doc(id);
const safetyCount = async (uid, fnName) => {
  const snap = await guardDoc(uid, `limit_${fnName}`).get();
  return snap.exists ? (snap.data().calls || []).length : 0;
};
const nextActionHash = (uid, data) => guards.hashRequest(uid, [
  "generateNextAction", data.originalImageBase64, data.beforeImageBase64, data.afterImageBase64, data.prompt,
]);
const replayExists = async (uid, hash) => (await guardDoc(uid, `replay_${hash.slice(0, 48)}`).get()).exists;

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

  // Entitled, because the Pro gate now sits ahead of the replay lookup - a
  // free caller never reaches the cache at all (see section 11).
  await withEntitlement(ENTITLED, async () => {
    assert.deepEqual(await callAs(fns.generateNextAction, uid, data), stored);
    // A different prompt is a different request and must not replay.
    const changed = await errorFrom(callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} Also mention lighting.` })));
    assert.equal(changed.code, "internal");
  });
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
  const otherFn = await withEntitlement(ENTITLED, () => errorFrom(callAs(fns.generateNextAction, uid, nextActionData())));
  assert.equal(otherFn.code, "internal", "limits must be per-function");
});

test("the 31st unique next-action request in 24 hours is rejected", async () => {
  const uid = `user-${uniq()}`;
  for (let i = 0; i < guards.SAFETY_LIMIT_CALLS; i++) {
    await guards.consumeSafetyLimit(db, uid, "generateNextAction");
  }
  await withEntitlement(ENTITLED, () => expectCode(
    callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} ${uniq()}` })),
    "resource-exhausted",
    "31st next action",
  ));
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
  await withProvider(OK_RESPONSE, async () => {
    const res = await callAs(fns.analyzePhotoDetail, uid, { prompt, planId });
    assert.equal(res.stopReason, "end_turn", "a real-sized prompt must pass every guard");
  });
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

test("the per-plan cap rejects the 7th SUCCESSFUL call for that plan", async () => {
  // Rewritten for the counting fix: only billed responses consume the budget,
  // so reaching the cap now requires six successes rather than six attempts.
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  await withProvider(OK_RESPONSE, async () => {
    for (let i = 0; i < guards.MAX_DETAIL_CALLS_PER_PLAN; i++) {
      await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    }
    await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }), "resource-exhausted", "7th");

    // A different plan for the same user is unaffected by that plan's counter.
    const other = await givenPlan(uid, `plan-${uniq()}`);
    const res = await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: other });
    assert.equal(res.stopReason, "end_turn", "per-plan counters must be per plan");
  });
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
  await withProvider(OK_RESPONSE, async () => {
    const res = await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    assert.equal(res.stopReason, "end_turn");
  });

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

// ---- 10. per-plan counting follows the bill --------------------------------

// Anthropic does not charge for error responses, so a count consumed by a 429,
// a 529 or a timeout protects no spend - it only burns a plan's lifetime
// budget. The launch sweep and the auto-resume effect retry summary-ready
// plans automatically, so an outage plus a few launches could otherwise leave
// a plan's details permanently unreachable.

/**
 * Stands in for Anthropic by replacing Messages.prototype.create, which every
 * client instance shares - including the one the handler constructs per
 * request. Patching the SDK's fetch is not enough: the client captures it at
 * construction, and the SDK's own retry logic would fire on 429/529 anyway.
 *
 * respond() returns a message object for a billed response, or throws to stand
 * for an error status, a connection failure or a timeout - the cases where
 * Anthropic never billed us.
 */
const AnthropicSdk = require(require.resolve("@anthropic-ai/sdk", { paths: [FUNCTIONS_DIR] }));
const AnthropicCtor = AnthropicSdk.default || AnthropicSdk;
const MESSAGES_PROTO = Object.getPrototypeOf(new AnthropicCtor({ apiKey: "stub-never-used" }).messages);

async function withProvider(respond, run) {
  const realCreate = MESSAGES_PROTO.create;
  MESSAGES_PROTO.create = async () => respond();
  try {
    await run();
  } finally {
    MESSAGES_PROTO.create = realCreate;
  }
}

const OK_RESPONSE = () => ({
  content: [{ type: "text", text: "{}" }],
  stop_reason: "end_turn",
  usage: { output_tokens: 10 },
});

const planCount = async (uid, planId) => {
  const snap = await db.collection("users").doc(uid).collection("aiCallGuards").doc(`detail_${planId}`).get();
  return snap.exists ? (snap.data().calls ?? 0) : 0;
};
const dailyCount = async (uid) => {
  const snap = await db.collection("users").doc(uid).collection("aiCallGuards").doc("daily_analyzePhotoDetail").get();
  return snap.exists ? (snap.data().calls ?? 0) : 0;
};

test("a provider error status releases the per-plan count but keeps the daily count", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);

  // The invalid ANTHROPIC_KEY makes every real call fail with an API error,
  // which is exactly the shape this path exists for.
  const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
  assert.equal(err.code, "internal", "the provider call must have been attempted");

  assert.equal(await planCount(uid, planId), 0, "per-plan count released");
  assert.equal(await dailyCount(uid), 1, "daily count stands - it is the abuse bound");
});

test("a 529 overloaded and a timeout both release the per-plan count", async () => {
  for (const [label, thrown] of [
    ["529 overloaded", Object.assign(new Error("Overloaded"), { status: 529 })],
    ["429 rate limited", Object.assign(new Error("Rate limited"), { status: 429 })],
    ["timeout", Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" })],
  ]) {
    const uid = `user-${uniq()}`;
    const planId = await givenPlan(uid, `plan-${uniq()}`);
    await withProvider(() => { throw thrown; }, async () => {
      const err = await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
      assert.equal(err.code, "internal", label);
    });
    assert.equal(await planCount(uid, planId), 0, `${label}: per-plan released`);
    assert.equal(await dailyCount(uid), 1, `${label}: daily kept`);
  }
});

test("a billed response that comes back truncated keeps the per-plan count", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  await withProvider(() => ({
    content: [{ type: "text", text: '{"approaches":{"simple"' }], // truncated mid-JSON
    stop_reason: "max_tokens",
    usage: { output_tokens: 6000 },
  }), async () => {
    const res = await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    assert.equal(res.stopReason, "max_tokens");
  });
  assert.equal(await planCount(uid, planId), 1, "Anthropic billed this response, so the attempt stands");
  assert.equal(await dailyCount(uid), 1);
});

test("six provider failures leave the plan fully usable, and the next success is counted", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);

  for (let i = 0; i < 6; i++) {
    await withProvider(() => { throw Object.assign(new Error("Overloaded"), { status: 529 }); }, async () => {
      await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }));
    });
  }
  assert.equal(await planCount(uid, planId), 0, "an outage must not exhaust the plan");

  await withProvider(() => ({
    content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { output_tokens: 10 },
  }), async () => {
    const res = await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    assert.equal(res.stopReason, "end_turn");
  });
  assert.equal(await planCount(uid, planId), 1, "the successful call is the first that counts");
});

test("six successes exhaust the plan and the seventh is refused", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const ok = () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { output_tokens: 10 } });

  await withProvider(ok, async () => {
    for (let i = 0; i < guards.MAX_DETAIL_CALLS_PER_PLAN; i++) {
      await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    }
    await expectCode(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId }), "resource-exhausted", "7th");
  });
  assert.equal(await planCount(uid, planId), guards.MAX_DETAIL_CALLS_PER_PLAN, "stops at the cap, never above");
});

test("a release never drives the counter below zero, and never fires twice", async () => {
  const uid = `user-${uniq()}`;
  const planId = `plan-${uniq()}`;

  // No counter document at all: releasing must be a no-op, not a negative.
  await guards.releaseDetailPlanLimit(db, uid, planId);
  assert.equal(await planCount(uid, planId), 0);

  // One consumed, released three times.
  await guards.consumeDetailPlanLimit(db, uid, planId);
  assert.equal(await planCount(uid, planId), 1);
  await guards.releaseDetailPlanLimit(db, uid, planId);
  await guards.releaseDetailPlanLimit(db, uid, planId);
  await guards.releaseDetailPlanLimit(db, uid, planId);
  assert.equal(await planCount(uid, planId), 0, "clamped at zero");

  // And the handler itself releases at most once per attempt.
  const planId2 = await givenPlan(uid, `plan-${uniq()}`);
  await withProvider(() => { throw Object.assign(new Error("Overloaded"), { status: 529 }); }, async () => {
    await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: planId2 }));
  });
  assert.equal(await planCount(uid, planId2), 0);
});

test("each outcome is logged by name, without prompt content", async () => {
  const uid = `user-${uniq()}`;
  const planId = await givenPlan(uid, `plan-${uniq()}`);
  const marker = "MARKER-PROMPT-TEXT-MUST-NOT-APPEAR";

  const failLines = await captureLogs(async () => {
    await withProvider(() => { throw Object.assign(new Error("Overloaded"), { status: 529 }); }, async () => {
      await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: marker + DETAIL_PROMPT, planId }));
    });
  });
  assert.match(failLines.join("\n"), /outcome=released-provider-failure/);
  assert.ok(!failLines.join("\n").includes(marker), "prompt content must never be logged");

  const okLines = await captureLogs(async () => {
    await withProvider(() => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: {} }), async () => {
      await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    });
  });
  assert.match(okLines.join("\n"), /outcome=counted-success/);

  const truncLines = await captureLogs(async () => {
    await withProvider(() => ({ content: [{ type: "text", text: "{" }], stop_reason: "max_tokens", usage: {} }), async () => {
      await callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId });
    });
  });
  assert.match(truncLines.join("\n"), /outcome=counted-parse-failure/);
});

// ---- 11. generateNextAction: the Pro gate ----------------------------------

// The progress check-in is the one paid thing in Companion - the checklist,
// ticking items off, carrying work forward, switching approach and finishing a
// plan are all free. Until this change the only thing standing between a free
// account and the Anthropic bill was `if (!isPro)` in App.js, which stops a tap
// and not a request.
//
// The load-bearing distinction: RevenueCat saying NO is not the same as
// RevenueCat not answering. 76cb682 is the worked example of getting that
// wrong - an undeclared secret produced an empty credential, RevenueCat
// answered 401, the old code read it as a definite "not entitled", and every
// paying subscriber was quietly demoted.

test("the stub matches the entitlement id the shipping code looks for", () => {
  // Guards against the stub drifting away from the source and making every
  // "entitled" test below vacuous.
  const src = require("node:fs").readFileSync(path.join(FUNCTIONS_DIR, "index.js"), "utf8");
  assert.ok(src.includes(`PRO_ENTITLEMENT_ID = "${PRO_ENTITLEMENT_ID}"`), "stub entitlement id is stale");
});

test("an unauthenticated next-action call is refused before the entitlement check", async () => {
  // Still unauthenticated, not permission-denied: requireUid runs first, and
  // an anonymous caller must not even cost us a RevenueCat round trip.
  let revenueCatCalls = 0;
  await withEntitlement(() => { revenueCatCalls++; return ENTITLED(); }, async () => {
    await expectCode(callAs(fns.generateNextAction, null, nextActionData()), "unauthenticated", "no auth");
  });
  assert.equal(revenueCatCalls, 0, "entitlement must not be resolved for an anonymous caller");
});

test("a verified free account is refused with permission-denied", async () => {
  const uid = `user-${uniq()}`;
  await withEntitlement(NOT_ENTITLED, async () => {
    const err = await errorFrom(callAs(fns.generateNextAction, uid, nextActionData()));
    assert.equal(err.code, "permission-denied", err.message);
    // Distinguishable from every other failure the client can see:
    // unauthenticated, invalid-argument, resource-exhausted, internal.
    assert.match(err.message, /Pro/);
  });
});

test("a refused caller spends nothing: no safety count, no replay entry, no provider call", async () => {
  const uid = `user-${uniq()}`;
  const data = nextActionData();
  const hash = nextActionHash(uid, data);

  await withEntitlement(NOT_ENTITLED, async () => {
    await expectCode(callAs(fns.generateNextAction, uid, data), "permission-denied", "free account");
  });

  assert.equal(await safetyCount(uid, "generateNextAction"), 0, "a refused call must not consume the ceiling");
  assert.equal(await replayExists(uid, hash), false, "a refused call must not write replay state");
  // Reaching Anthropic would surface as "internal" (the key is invalid), never
  // as permission-denied, so the code above already proves the call was not made.
});

test("a refused caller cannot be served a cached answer from when they WERE entitled", async () => {
  // Entitlement lapses between two identical requests. The gate sits ahead of
  // the replay lookup precisely so the cache cannot outlive the subscription.
  const uid = `user-${uniq()}`;
  const data = nextActionData();
  const stored = { text: "Fold the blankets on the left shelf." };
  await guards.storeReplay(db, uid, nextActionHash(uid, data), stored);

  await withEntitlement(ENTITLED, async () => {
    assert.deepEqual(await callAs(fns.generateNextAction, uid, data), stored, "entitled: served from cache");
  });
  await withEntitlement(NOT_ENTITLED, async () => {
    await expectCode(callAs(fns.generateNextAction, uid, data), "permission-denied", "lapsed");
  });
});

test("a verified Pro account passes the gate and reaches the provider", async () => {
  const uid = `user-${uniq()}`;
  await withEntitlement(ENTITLED, async () => {
    const err = await errorFrom(callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} ${uniq()}` })));
    // "internal" is the invalid test key failing at Anthropic, which is the
    // signal the request got all the way past every guard.
    assert.equal(err.code, "internal", "an entitled caller must reach the provider");
  });
});

test("replay caching still works for an entitled caller", async () => {
  const uid = `user-${uniq()}`;
  const data = nextActionData({ prompt: `${PROMPT} ${uniq()}` });
  const stored = { text: "Clear the top shelf next." };
  await guards.storeReplay(db, uid, nextActionHash(uid, data), stored);
  await withEntitlement(ENTITLED, async () => {
    assert.deepEqual(await callAs(fns.generateNextAction, uid, data), stored);
  });
  assert.equal(await safetyCount(uid, "generateNextAction"), 0, "a replayed call consumes no ceiling");
});

// Each of these is RevenueCat failing to answer, not answering "no". None of
// them may be read as a confirmed free account.
const UNVERIFIABLE_CASES = [
  ["HTTP 401 (missing or misbound key)", HTTP(401)],
  ["HTTP 403 (revoked key)", HTTP(403)],
  ["HTTP 429 (we are rate limited)", HTTP(429)],
  ["HTTP 500", HTTP(500)],
  ["HTTP 503", HTTP(503)],
  ["network failure", NETWORK_FAILURE],
  ["timeout", TIMEOUT],
  ["unparseable body", UNPARSEABLE],
];

test("every unverifiable case falls back to the mirror, and allows a cached Pro user", async () => {
  for (const [label, responder] of UNVERIFIABLE_CASES) {
    const uid = `user-${uniq()}`;
    // Server-owned mirror: firestore.rules restricts client updates on this
    // document to hasOnly(['hasSeenTutorial']), so only revenueCatWebhook
    // writes isPro. Written here with the Admin SDK, as the webhook does.
    await db.collection("users").doc(uid).set({ isPro: true });
    await withEntitlement(responder, async () => {
      const err = await errorFrom(callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} ${uniq()}` })));
      assert.equal(err.code, "internal", `${label}: a paying user must not be locked out by our own outage`);
    });
  }
});

test("every unverifiable case is REFUSED when there is no trusted mirror", async () => {
  for (const [label, responder] of UNVERIFIABLE_CASES) {
    for (const [mirrorLabel, seed] of [
      ["no user document", null],
      ["isPro false", { isPro: false }],
      ["isPro absent", { email: "x" }],
    ]) {
      const uid = `user-${uniq()}`;
      if (seed) await db.collection("users").doc(uid).set(seed);
      await withEntitlement(responder, async () => {
        await expectCode(
          callAs(fns.generateNextAction, uid, nextActionData({ prompt: `${PROMPT} ${uniq()}` })),
          "permission-denied",
          `${label} / ${mirrorLabel}`,
        );
      });
    }
  }
});

test("an unverifiable REJECTION still spends nothing", async () => {
  const uid = `user-${uniq()}`;
  const data = nextActionData();
  await withEntitlement(HTTP(401), async () => {
    await expectCode(callAs(fns.generateNextAction, uid, data), "permission-denied", "401 with no mirror");
  });
  assert.equal(await safetyCount(uid, "generateNextAction"), 0);
  assert.equal(await replayExists(uid, nextActionHash(uid, data)), false);
});

test("404 stays a definite NO, and is not softened into an outage", async () => {
  // A customer RevenueCat has never seen has definitively never purchased.
  // Collapsing that into "unverifiable" would route it through the mirror,
  // which is exactly the hole an earlier test caught. It must be refused even
  // WITH a mirror saying otherwise.
  const uid = `user-${uniq()}`;
  await db.collection("users").doc(uid).set({ isPro: true });
  await withEntitlement(HTTP(404), async () => {
    await expectCode(callAs(fns.generateNextAction, uid, nextActionData()), "permission-denied", "unknown customer");
  });
});

test("payload caps are unchanged, and still reject before the entitlement check", async () => {
  const uid = `user-${uniq()}`;
  const huge = "A".repeat(guards.MAX_IMAGE_B64_CHARS + 1);
  let revenueCatCalls = 0;
  await withEntitlement(() => { revenueCatCalls++; return ENTITLED(); }, async () => {
    await expectCode(callAs(fns.generateNextAction, uid, nextActionData({ originalImageBase64: huge })), "invalid-argument", "original");
    await expectCode(callAs(fns.generateNextAction, uid, nextActionData({ beforeImageBase64: huge })), "invalid-argument", "before");
    await expectCode(callAs(fns.generateNextAction, uid, nextActionData({ afterImageBase64: huge })), "invalid-argument", "after");
    await expectCode(callAs(fns.generateNextAction, uid, nextActionData({ prompt: "p".repeat(guards.MAX_PROMPT_CHARS + 1) })), "invalid-argument", "prompt");
    await expectCode(callAs(fns.generateNextAction, uid, nextActionData({ prompt: "" })), "invalid-argument", "empty prompt");
  });
  assert.equal(revenueCatCalls, 0, "validation must reject before any entitlement round trip");
});

test("each entitlement outcome is logged by name, with a hashed uid and no prompt", async () => {
  const uid = "gate-raw-uid-must-not-appear";
  const marker = "GATE-PROMPT-CANARY-must-not-be-logged";

  const casesUnderTest = [
    ["verified-entitled", ENTITLED, null],
    ["rejected-not-entitled", NOT_ENTITLED, null],
    ["unverifiable-rejected", HTTP(401), null],
    ["cached-fallback", HTTP(503), { isPro: true }],
  ];

  for (const [expected, responder, seed] of casesUnderTest) {
    const caseUid = `${uid}-${uniq()}`;
    if (seed) await db.collection("users").doc(caseUid).set(seed);
    const lines = await captureLogs(async () => {
      await withEntitlement(responder, async () => {
        await errorFrom(callAs(fns.generateNextAction, caseUid, nextActionData({ prompt: `${marker} ${uniq()}` })));
      });
    });
    const joined = lines.join("\n");
    assert.match(joined, new RegExp(`entitlement=${expected}`), `${expected}: outcome line missing`);
    assert.ok(!joined.includes(caseUid), `${expected}: raw uid appeared in logs`);
    assert.ok(!joined.includes(marker), `${expected}: prompt text appeared in logs`);
    assert.ok(joined.includes(guards.uidTag(caseUid)), `${expected}: expected the hashed tag`);
  }
});

test("the other entitlement callers are unchanged by the structured result", async () => {
  // verifyProEntitlement is now a wrapper over resolveProEntitlement, and it
  // must still map a non-404 4xx to FALSE - the reading the three shipped
  // callers were written against. Only the new gate treats that as
  // unverifiable. analyzePhotoDetail is the observable one: it picks the daily
  // cap from the same answer.
  const uid = `user-${uniq()}`;
  await db.collection("users").doc(uid).collection("plans").doc("plan-x").set({ analysisStage: "summary-ready" });

  const lines = await captureLogs(async () => {
    await withEntitlement(HTTP(401), async () => {
      await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: "plan-x" }));
    });
  });
  const joined = lines.join("\n");
  assert.match(joined, /accepted entitled=false/, "a 401 must still read as not-entitled for this caller");
  assert.ok(!/RevenueCat unreachable/.test(joined), "a 401 must not take the outage branch here either");
});

test("a 5xx still reads as an outage for the older callers, as it always did", async () => {
  const uid = `user-${uniq()}`;
  await db.collection("users").doc(uid).set({ isPro: true });
  await db.collection("users").doc(uid).collection("plans").doc("plan-y").set({ analysisStage: "summary-ready" });

  const lines = await captureLogs(async () => {
    await withEntitlement(HTTP(503), async () => {
      await errorFrom(callAs(fns.analyzePhotoDetail, uid, { prompt: DETAIL_PROMPT, planId: "plan-y" }));
    });
  });
  const joined = lines.join("\n");
  assert.match(joined, /RevenueCat unreachable, falling back to cached isPro=true/);
  assert.match(joined, /accepted entitled=true/);
});
