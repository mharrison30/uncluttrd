/**
 * Two defects reproduced on staging builds 30 (iOS) and 6 (Android).
 *
 *   node --test scripts/onboardingExpansion.test.js
 *
 * ONBOARDING was decided per DEVICE, not per account: one unkeyed
 * "skipOnboarding" AsyncStorage flag plus two state values that were never
 * reset when the signed-in account changed. Sign out, create a brand-new
 * account on the same device, and the tutorial was already "done" for someone
 * who had never seen it. Confirmed on iOS. Separately, only the "don't show
 * this again" path persisted anything, so simply finishing the tutorial left
 * nothing written.
 *
 * CALL 2 collapsed an expanded approach: the seeding effect re-ran on every
 * `results` object replacement, and `results` is replaced (not mutated) when
 * Call 2 lands. The user opened a card, read "Finishing the details...", and
 * watched it collapse at the moment the content arrived.
 *
 * The decision logic is LIFTED OUT OF App.js AND EXECUTED here with its I/O
 * injected, so these test behaviour rather than the shape of the source.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "App.js"), "utf8").replace(/\r\n/g, "\n");

function region(startMarker, endMarker, { from = 0 } = {}) {
  const a = SRC.indexOf(startMarker, from);
  assert.ok(a > 0, `not found in App.js: ${startMarker}`);
  const b = SRC.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after ${startMarker}: ${endMarker}`);
  return SRC.slice(a, b);
}

/** A stand-in AsyncStorage with the same async contract. */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
  };
}

const tutorialCacheKey = new Function(
  `${region("const tutorialCacheKey = (uid)", "\n")}\nreturn tutorialCacheKey;`,
)();

// ---- 1. the per-account tutorial decision, executed -----------------------

/** Runs the real resolution block against one account document. */
async function resolveFor({ uid, data, storage }) {
  const src = region(
    "const looksLikeExistingUser = (data.analysisCount || 0) > 0",
    "setNeedsOnboarding(!hasSeen);",
  ) + "setNeedsOnboarding(!hasSeen);";
  const state = { onboardingUid: undefined, needsOnboarding: undefined, backfilled: [] };
  const fn = new Function("deps", `
    return async function () {
      const { data, u, AsyncStorage, tutorialCacheKey, updateDoc, doc, db,
              setOnboardingUid, setNeedsOnboarding, console } = deps;
      ${src}
    };
  `)({
    data,
    u: { uid },
    AsyncStorage: storage,
    tutorialCacheKey,
    updateDoc: async (ref, patch) => { state.backfilled.push([ref, patch]); },
    doc: (_db, _c, id) => `users/${id}`,
    db: {},
    setOnboardingUid: (v) => { state.onboardingUid = v; },
    setNeedsOnboarding: (v) => { state.needsOnboarding = v; },
    console: { log: () => {} },
  });
  await fn();
  return state;
}

test("a brand-new account sees onboarding on a device another account already used", async () => {
  // THE CONFIRMED CROSS-ACCOUNT DEFECT. The device carries a completed record
  // for a previous account, and the legacy unkeyed flag too. Neither may
  // decide anything for this uid.
  const storage = makeStorage({
    "skipOnboarding": "true",                     // the legacy device-wide flag
    [tutorialCacheKey("previous-account")]: "true",
  });
  const r = await resolveFor({ uid: "brand-new-uid", data: {}, storage });
  assert.equal(r.needsOnboarding, true, "a fresh account must see the tutorial");
  assert.equal(r.onboardingUid, "brand-new-uid");
  assert.deepEqual(r.backfilled, [], "nothing to backfill for an account with no history");
});

test("a returning account with hasSeenTutorial true does not see onboarding", async () => {
  const storage = makeStorage();
  const r = await resolveFor({ uid: "returning-uid", data: { hasSeenTutorial: true }, storage });
  assert.equal(r.needsOnboarding, false);
  assert.equal(r.onboardingUid, "returning-uid");
  assert.equal(await storage.getItem(tutorialCacheKey("returning-uid")), "true", "cached for this uid");
  assert.deepEqual(r.backfilled, [], "already true, nothing to write");
});

test("the existing-user migration still applies, and backfills exactly once", async () => {
  // Accounts that predate hasSeenTutorial have no field. analysisCount and
  // isPro are the signals that they are established, and both are impossible
  // for a genuinely new account at its first auth resolution.
  for (const [label, data] of [
    ["has run an analysis", { analysisCount: 3 }],
    ["is Pro", { isPro: true }],
  ]) {
    const storage = makeStorage();
    const r = await resolveFor({ uid: `legacy-${label}`, data, storage });
    assert.equal(r.needsOnboarding, false, `${label}: must not be forced through onboarding`);
    assert.equal(r.backfilled.length, 1, `${label}: backfilled`);
    assert.deepEqual(r.backfilled[0][1], { hasSeenTutorial: true });
  }
});

test("zero analyses and not Pro is NOT an existing-user signal", async () => {
  const storage = makeStorage();
  const r = await resolveFor({ uid: "fresh", data: { analysisCount: 0, isPro: false }, storage });
  assert.equal(r.needsOnboarding, true);
});

test("the local cache is keyed by uid, never shared between accounts", () => {
  assert.equal(tutorialCacheKey("a"), "hasSeenTutorial:a");
  assert.notEqual(tutorialCacheKey("a"), tutorialCacheKey("b"));
  // The unkeyed predecessor must not be read anywhere any more.
  assert.ok(!/AsyncStorage\.getItem\("skipOnboarding"\)/.test(SRC),
    "the device-wide flag must no longer be read");
  assert.ok(!/AsyncStorage\.setItem\("skipOnboarding"/.test(SRC),
    "the device-wide flag must no longer be written");
});

// ---- 2. dismissal persists on BOTH paths ---------------------------------

/** Runs the real onDone handler. */
async function runOnDone({ skip, uid, storage }) {
  const body = region("onDone={async (skip) => {", "\n    }} />;");
  const src = body.slice(body.indexOf("{", body.indexOf("=> ")) + 1);
  const state = { needsOnboarding: undefined, updates: [] };
  const fn = new Function("deps", `
    return async function (skip) {
      const { user, AsyncStorage, tutorialCacheKey, updateDoc, doc, db, setNeedsOnboarding, console } = deps;
      ${src}
    };
  `)({
    user: { uid },
    AsyncStorage: storage,
    tutorialCacheKey,
    updateDoc: async (ref, patch) => { state.updates.push([ref, patch]); },
    doc: (_db, _c, id) => `users/${id}`,
    db: {},
    setNeedsOnboarding: (v) => { state.needsOnboarding = v; },
    console: { log: () => {} },
  });
  await fn(skip);
  return state;
}

test("finishing the tutorial normally persists hasSeenTutorial and dismisses it", async () => {
  // This is the half that used to persist NOTHING: only the ticked
  // "don't show this again" path wrote anything, so a completed tutorial
  // came straight back on the next launch.
  const storage = makeStorage();
  const r = await runOnDone({ skip: false, uid: "u1", storage });
  assert.equal(r.needsOnboarding, false, "dismissed");
  assert.equal(await storage.getItem(tutorialCacheKey("u1")), "true", "cached for this uid");
  assert.equal(r.updates.length, 1, "written to Firestore");
  assert.deepEqual(r.updates[0][1], { hasSeenTutorial: true });
  assert.equal(r.updates[0][0], "users/u1", "written for the signed-in account");
});

test("explicitly skipping the tutorial persists the same thing", async () => {
  const storage = makeStorage();
  const r = await runOnDone({ skip: true, uid: "u2", storage });
  assert.equal(r.needsOnboarding, false);
  assert.equal(await storage.getItem(tutorialCacheKey("u2")), "true");
  assert.deepEqual(r.updates.map((u) => u[1]), [{ hasSeenTutorial: true }]);
});

test("a completed account signing back in is not shown the tutorial again", async () => {
  // End to end across the two halves: dismiss, then resolve the same uid from
  // the document that dismissal wrote.
  const storage = makeStorage();
  await runOnDone({ skip: false, uid: "u3", storage });
  const r = await resolveFor({ uid: "u3", data: { hasSeenTutorial: true }, storage });
  assert.equal(r.needsOnboarding, false);
});

test("hasSeenTutorial is written by update, never in the create payload", () => {
  // firestore.rules' create allowlist excludes it; its update rule permits
  // exactly this one field.
  const create = region("const ensureUserDocument = async (u, extra = {})", "\n};");
  assert.ok(!/hasSeenTutorial/.test(create), "must not be part of document creation");
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['hasSeenTutorial'\]\)/,
    "the update path this relies on must still be permitted");
});

// ---- 3. uid change and ordering ------------------------------------------

test("a uid change resets the onboarding answer before anything async runs", () => {
  const cb = region("const unsub = onAuthStateChanged(auth, async (u) => {", "setUser(u);");
  const resetUid = cb.indexOf("setOnboardingUid(null)");
  const resetNeeds = cb.indexOf("setNeedsOnboarding(null)");
  const firstAwait = cb.indexOf("await ");
  assert.ok(resetUid > 0 && resetNeeds > 0, "both must be cleared on every auth change");
  assert.ok(resetUid < firstAwait, "the reset must precede the first await, or a frame can leak");
  assert.ok(resetNeeds < firstAwait, "same");
});

test("the gate refuses to render a tutorial until this uid's answer is in", () => {
  const line = region("const onboardingResolved =", ";");
  const resolved = new Function("user", "onboardingUid", "needsOnboarding",
    `${line};\nreturn onboardingResolved;`);

  assert.equal(resolved({ uid: "a" }, null, null), false, "unresolved");
  assert.equal(resolved({ uid: "a" }, "a", null), false, "uid known but no answer yet");
  assert.equal(resolved({ uid: "a" }, "b", true), false, "answer belongs to a previous account");
  assert.equal(resolved({ uid: "a" }, "a", true), true, "resolved: show");
  assert.equal(resolved({ uid: "a" }, "a", false), true, "resolved: hide");
  assert.equal(resolved(null, "a", true), false, "signed out");

  // And the gate actually uses it, so an unresolved signed-in user gets the
  // startup fallback rather than a tutorial that may vanish.
  assert.ok(SRC.includes("if (!startupReady || holdForTracking || (!!user && !onboardingResolved)) {"));
  assert.ok(SRC.includes("} else if (needsOnboarding) {"));
});

// ---- 4. the expanded approach through Call 2 ------------------------------

/** Runs the real seeding guard. */
function makeSeeder() {
  const src = region("const planForSeeding = currentPlanIdRef.current || null;", "setStartingPlan(false);");
  const state = { previewApproach: null, seededRef: { current: null }, planIdRef: { current: null } };
  const step = new Function("deps", `
    return function (results) {
      const { currentPlanIdRef, seededPreviewPlanRef, setPreviewApproach } = deps;
      ${src}
    };
  `)({
    currentPlanIdRef: state.planIdRef,
    seededPreviewPlanRef: state.seededRef,
    setPreviewApproach: (v) => { state.previewApproach = v; },
  });
  return {
    state,
    openPlan(planId, results) { state.planIdRef.current = planId; step(results); },
    resultsChanged(results) { step(results); },
    expand(id) { state.previewApproach = id; },
    leave() { state.seededRef.current = null; state.previewApproach = null; state.planIdRef.current = null; },
  };
}

const summaryPlan = () => ({ selectedApproach: null, analysisStage: "summary-ready", approaches: { simple: {} } });
const completePlan = () => ({ selectedApproach: null, analysisStage: "complete", approaches: { simple: { organizingGuidance: ["g"] } } });

test("an approach expanded during Call 2 survives Call 2 landing", async () => {
  const s = makeSeeder();
  s.openPlan("plan-1", summaryPlan());
  assert.equal(s.state.previewApproach, null, "a fresh plan opens collapsed");

  s.expand("polished");                    // user taps "See full details"
  s.resultsChanged(completePlan());        // Call 2 lands: results REPLACED
  assert.equal(s.state.previewApproach, "polished", "the card must stay open");
});

test("the loading state is replaced in place, not collapsed and re-opened", () => {
  // The render branch is chosen by analysisStage alone, so with the card
  // still expanded the swap happens underneath it.
  const s = makeSeeder();
  s.openPlan("plan-1", summaryPlan());
  s.expand("simple");
  s.resultsChanged(completePlan());
  assert.equal(s.state.previewApproach, "simple");
  assert.ok(SRC.includes('{expanded && stage === "summary-ready" && ('), "loading branch");
  assert.ok(SRC.includes('{expanded && stage !== "summary-ready" && ('), "content branch");
  assert.ok(SRC.includes("Finishing the details..."));
});

test("every other same-plan results replacement leaves the card open too", () => {
  // The photo URL arriving and a rename both replace `results`.
  const s = makeSeeder();
  s.openPlan("plan-1", summaryPlan());
  s.expand("elevated");
  s.resultsChanged({ ...summaryPlan(), photoUrl: "https://example/x.jpg" });
  s.resultsChanged({ ...summaryPlan(), spaceName: "Renamed Room" });
  assert.equal(s.state.previewApproach, "elevated");
});

test("reopening a saved plan still expands its committed approach", () => {
  const s = makeSeeder();
  s.openPlan("plan-9", { selectedApproach: "polished", analysisStage: "complete", approaches: {} });
  assert.equal(s.state.previewApproach, "polished");
});

test("opening a genuinely different plan resets the expansion", () => {
  const s = makeSeeder();
  s.openPlan("plan-1", summaryPlan());
  s.expand("simple");
  s.openPlan("plan-2", summaryPlan());
  assert.equal(s.state.previewApproach, null, "a different plan must not inherit the last one's card");

  s.expand("simple");
  s.openPlan("plan-3", { selectedApproach: "elevated", analysisStage: "complete", approaches: {} });
  assert.equal(s.state.previewApproach, "elevated", "and seeds from its own committed approach");
});

test("leaving Results clears the seed marker so the next plan seeds", () => {
  const s = makeSeeder();
  s.openPlan("plan-1", summaryPlan());
  s.expand("simple");
  s.leave();
  s.openPlan("plan-1", summaryPlan());
  assert.equal(s.state.previewApproach, null, "reopening the same plan seeds again");
  assert.ok(SRC.includes("if (!results) { seededPreviewPlanRef.current = null; return; }"));
});

// ---- 5. staging banner ----------------------------------------------------

test("the staging banner leaves room for the trailing letter-spacing", () => {
  const style = region("stagingBannerText: {", "\n  },");
  const letterSpacing = Number(style.match(/letterSpacing:\s*([\d.]+)/)[1]);
  const horizontal = Number(style.match(/paddingHorizontal:\s*([\d.]+)/)[1]);
  const right = Number(style.match(/paddingRight:\s*([\d.]+)/)[1]);
  assert.ok(style.indexOf("paddingHorizontal") < style.indexOf("paddingRight"),
    "paddingRight must come after paddingHorizontal or it is overridden");
  assert.ok(right >= horizontal + letterSpacing,
    `right padding ${right} must absorb the ${letterSpacing} trailing advance on top of ${horizontal}`);
  assert.ok(SRC.includes("<Text style={s.stagingBannerText}>STAGING</Text>"), "wording unchanged");
});

test("the banner is still staging-only and cannot reach production", () => {
  assert.match(SRC, /const IS_STAGING = !IS_PRODUCTION;/);
  assert.ok(SRC.includes("IS_STAGING && ("), "rendered behind the staging gate");
});
