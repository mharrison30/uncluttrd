/**
 * Two defects reproduced on staging builds 30 (iOS) and 6 (Android), plus the
 * account-scoped onboarding model they led to.
 *
 *   node --test scripts/onboardingExpansion.test.js
 *
 * ONBOARDING is decided per ACCOUNT, and hasSeenTutorial is three-state:
 *
 *   true    the user ticked "Don't show this again". Permanent.
 *   false   on the account-scoped model, and has NOT made that choice.
 *           Dismissing without the checkbox leaves it false, so the tutorial
 *           returns on the next cold launch or sign-in.
 *   absent  unclassified. createdAt decides which side of
 *           TUTORIAL_ACCOUNT_SCOPING_CUTOFF the account falls on.
 *
 * The cutoff is 2026-07-18T00:00:00Z, hours before f189c5e introduced the
 * field, so no build in anyone's hands could have carried it earlier. Accounts
 * created before it may still be legacy-migrated from analysisCount/isPro;
 * accounts created after it never can be. That asymmetry is the point: reading
 * a genuinely new account as legacy would suppress its tutorial permanently
 * from one analysis onwards, against a choice the user never made.
 *
 * CALL 2 collapsed an expanded approach because the seeding effect re-ran on
 * every `results` replacement, and Call 2 landing replaces `results`.
 *
 * The decision function, the dismissal handler, the gate expression and the
 * seeding guard are all LIFTED OUT OF App.js AND EXECUTED here with their I/O
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

// ---- the real decision logic, lifted and executed -------------------------

const model = new Function(`
  ${region("const tutorialCacheKey = (uid)", "\n// \u2500\u2500 ROOT")}
  return { tutorialCacheKey, tutorialCreatedAtMs, resolveTutorialDecision, TUTORIAL_ACCOUNT_SCOPING_CUTOFF };
`)();
const { tutorialCacheKey, tutorialCreatedAtMs, resolveTutorialDecision, TUTORIAL_ACCOUNT_SCOPING_CUTOFF } = model;

const BEFORE_CUTOFF = new Date("2026-07-01T00:00:00.000Z");
const AFTER_CUTOFF = new Date("2026-08-01T00:00:00.000Z");
const ts = (d) => ({ toMillis: () => d.getTime() });   // a Firestore Timestamp
const decide = (over = {}) => resolveTutorialDecision({
  hasSeenTutorial: undefined, analysisCount: undefined, isPro: undefined,
  createdAtMs: tutorialCreatedAtMs(ts(AFTER_CUTOFF)),
  localPermanentChoice: false, sessionDismissed: false, ...over,
});

// ---- 1. the cutoff itself -------------------------------------------------

test("the cutoff is the approved instant, hours before the field could exist", () => {
  assert.equal(TUTORIAL_ACCOUNT_SCOPING_CUTOFF, Date.parse("2026-07-18T00:00:00.000Z"));
  assert.ok(SRC.includes('Date.parse("2026-07-18T00:00:00.000Z")'), "stated once, literally");
});

test("createdAt is read from every shape the data actually holds", () => {
  assert.equal(tutorialCreatedAtMs(ts(AFTER_CUTOFF)), AFTER_CUTOFF.getTime(), "Firestore Timestamp");
  assert.equal(tutorialCreatedAtMs(AFTER_CUTOFF), AFTER_CUTOFF.getTime(), "Date");
  assert.equal(tutorialCreatedAtMs("2026-08-01T00:00:00.000Z"), AFTER_CUTOFF.getTime(), "ISO string");
  for (const bad of [undefined, null, "", "not a date", 12345, {}, NaN]) {
    assert.equal(tutorialCreatedAtMs(bad), null, `unusable: ${String(bad)}`);
  }
});

// ---- 2. the three field states -------------------------------------------

test("hasSeenTutorial TRUE: never shown, nothing rewritten", () => {
  const d = decide({ hasSeenTutorial: true });
  assert.deepEqual(d, { show: false, write: null, state: "permanent" });
  // And not even a pile of legacy signals changes it.
  assert.equal(decide({ hasSeenTutorial: true, analysisCount: 99, isPro: true }).show, false);
});

test("hasSeenTutorial FALSE: shown, and nothing is written", () => {
  const d = decide({ hasSeenTutorial: false });
  assert.deepEqual(d, { show: true, write: null, state: "new-model" });
});

test("hasSeenTutorial ABSENT after the cutoff: shown, and classified to false", () => {
  const d = decide({ hasSeenTutorial: undefined });
  assert.deepEqual(d, { show: true, write: false, state: "post-cutoff" });
});

// ---- 3. an explicit false can never be overridden -------------------------

test("analysisCount and isPro CANNOT turn an explicit false into a true", () => {
  // The whole point of the checkbox. A user who declined permanence keeps
  // seeing the tutorial no matter how much they use the app.
  for (const [label, over] of [
    ["one analysis", { analysisCount: 1 }],
    ["many analyses", { analysisCount: 250 }],
    ["subscribed", { isPro: true }],
    ["both", { analysisCount: 12, isPro: true }],
  ]) {
    const d = decide({ hasSeenTutorial: false, ...over });
    assert.equal(d.show, true, `${label}: must still be shown`);
    assert.equal(d.write, null, `${label}: must write nothing`);
    assert.equal(d.state, "new-model", label);
  }
});

test("a post-cutoff account whose classification write FAILED stays new-model", () => {
  // The write is best effort. Because the branch is chosen by createdAt and
  // not by the field, a failure cannot leave the account exposed to legacy
  // migration later.
  for (const [label, over] of [
    ["then ran an analysis", { analysisCount: 3 }],
    ["then subscribed", { isPro: true }],
    ["then did both", { analysisCount: 3, isPro: true }],
  ]) {
    const d = decide({ hasSeenTutorial: undefined, ...over });
    assert.equal(d.state, "post-cutoff", `${label}: classified by createdAt, not by usage`);
    assert.equal(d.show, true, label);
    assert.equal(d.write, false, `${label}: and the classification is retried`);
  }
});

test("the retry writes false again on a later resolution", () => {
  const first = decide({ hasSeenTutorial: undefined });
  assert.equal(first.write, false);
  const retry = decide({ hasSeenTutorial: undefined });   // the write failed, field still absent
  assert.equal(retry.write, false, "retried until it lands");
  const landed = decide({ hasSeenTutorial: false });
  assert.equal(landed.write, null, "and stops once it has");
});

// ---- 4. the legacy migration, bounded by the cutoff -----------------------

test("a pre-cutoff established account is still migrated to true", () => {
  for (const [label, over] of [
    ["has run analyses", { analysisCount: 4 }],
    ["is Pro", { isPro: true }],
  ]) {
    const d = resolveTutorialDecision({
      hasSeenTutorial: undefined, createdAtMs: tutorialCreatedAtMs(ts(BEFORE_CUTOFF)),
      localPermanentChoice: false, sessionDismissed: false, ...over,
    });
    assert.deepEqual(d, { show: false, write: true, state: "legacy-migrated" }, label);
  }
});

test("a pre-cutoff account with no legacy signal is shown once and brought onto the new model", () => {
  const d = resolveTutorialDecision({
    hasSeenTutorial: undefined, analysisCount: 0, isPro: false,
    createdAtMs: tutorialCreatedAtMs(ts(BEFORE_CUTOFF)),
    localPermanentChoice: false, sessionDismissed: false,
  });
  assert.deepEqual(d, { show: true, write: false, state: "legacy-unclassified" });
});

test("the migration does NOT reach an account created after the cutoff", () => {
  // The conflict this cutoff exists to remove: without it, one analysis would
  // permanently suppress the tutorial for a brand-new account.
  const legacy = resolveTutorialDecision({
    hasSeenTutorial: undefined, analysisCount: 1,
    createdAtMs: tutorialCreatedAtMs(ts(BEFORE_CUTOFF)),
    localPermanentChoice: false, sessionDismissed: false,
  });
  const modern = decide({ hasSeenTutorial: undefined, analysisCount: 1 });
  assert.equal(legacy.write, true, "pre-cutoff: migrated");
  assert.equal(modern.write, false, "post-cutoff: classified, never migrated");
  assert.equal(modern.show, true);
});

test("the boundary is inclusive of the cutoff instant itself", () => {
  const at = resolveTutorialDecision({
    hasSeenTutorial: undefined, analysisCount: 5, createdAtMs: TUTORIAL_ACCOUNT_SCOPING_CUTOFF,
    localPermanentChoice: false, sessionDismissed: false,
  });
  const justBefore = resolveTutorialDecision({
    hasSeenTutorial: undefined, analysisCount: 5, createdAtMs: TUTORIAL_ACCOUNT_SCOPING_CUTOFF - 1,
    localPermanentChoice: false, sessionDismissed: false,
  });
  assert.equal(at.state, "post-cutoff", "created AT the cutoff is new-model");
  assert.equal(justBefore.state, "legacy-migrated", "a millisecond earlier is legacy");
});

// ---- 5. unclassifiable accounts ------------------------------------------

test("an absent or unparseable createdAt fails toward SHOWING, never toward suppression", () => {
  // Live in staging today: one account carries no createdAt at all.
  for (const [label, over] of [
    ["no signals", {}],
    ["has analyses", { analysisCount: 9 }],
    ["is Pro", { isPro: true }],
  ]) {
    const d = decide({ hasSeenTutorial: undefined, createdAtMs: null, ...over });
    assert.equal(d.show, true, `${label}: show it`);
    assert.equal(d.write, null, `${label}: and never backfill true on a guess`);
    assert.equal(d.state, "unclassifiable", label);
  }
});

test("the unclassifiable log line carries no account data", () => {
  const line = region("if (decision.state === \"unclassifiable\") {", "}\n\n        if (decision.write");
  assert.match(line, /createdAt present=/);
  assert.match(line, /type=\$\{typeof data\.createdAt\}/);
  assert.ok(!/u\.uid|data\.email|displayName/.test(line), "no identifier may be logged");
});

// ---- 6. the permanent choice, and a failed true write ---------------------

test("a local permanent choice suppresses the tutorial and retries the write", () => {
  const d = decide({ hasSeenTutorial: undefined, localPermanentChoice: true });
  assert.deepEqual(d, { show: false, write: true, state: "permanent-retry" });
});

test("a local permanent choice BLOCKS legacy migration and outranks every signal", () => {
  for (const [label, over] of [
    ["pre-cutoff with analyses", { createdAtMs: tutorialCreatedAtMs(ts(BEFORE_CUTOFF)), analysisCount: 7 }],
    ["field still false", { hasSeenTutorial: false }],
    ["unclassifiable", { createdAtMs: null }],
  ]) {
    const d = decide({ hasSeenTutorial: undefined, localPermanentChoice: true, ...over });
    assert.equal(d.show, false, `${label}: the user's choice stands`);
    assert.equal(d.state, "permanent-retry", label);
  }
});

test("once the true write lands, the retry stops", () => {
  const d = decide({ hasSeenTutorial: true, localPermanentChoice: true });
  assert.equal(d.write, null);
  assert.equal(d.state, "permanent");
});

// ---- 7. session-only dismissal -------------------------------------------

test("a session dismissal suppresses only while the session says so", () => {
  assert.equal(decide({ hasSeenTutorial: false, sessionDismissed: true }).show, false, "dismissed now");
  assert.equal(decide({ hasSeenTutorial: false, sessionDismissed: false }).show, true, "back on a later launch");
  // And it never writes anything, so it cannot outlive the session.
  assert.equal(decide({ hasSeenTutorial: false, sessionDismissed: true }).write, null);
});

test("a session dismissal never turns into a permanent one", () => {
  const d = decide({ hasSeenTutorial: undefined, sessionDismissed: true });
  assert.equal(d.write, false, "still only classified, never true");
});

// ---- 8. the dismissal handler, executed -----------------------------------

async function runOnDone({ skip, uid, storage, sessionRef = { current: null } }) {
  const body = region("onDone={async (skip) => {", "\n    }} />;");
  const src = body.slice(body.indexOf("{", body.indexOf("=> ")) + 1);
  const state = { needsOnboarding: undefined, updates: [] };
  const fn = new Function("deps", `
    return async function (skip) {
      const { user, AsyncStorage, tutorialCacheKey, updateDoc, doc, db,
              setNeedsOnboarding, sessionDismissedUidRef, console } = deps;
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
    sessionDismissedUidRef: sessionRef,
    console: { log: () => {} },
  });
  await fn(skip);
  return { ...state, sessionRef };
}

test("dismissing WITHOUT the checkbox writes nothing at all", () => {
  return (async () => {
    const storage = makeStorage();
    const r = await runOnDone({ skip: false, uid: "u1", storage });
    assert.equal(r.needsOnboarding, false, "dismissed for this session");
    assert.deepEqual(r.updates, [], "no Firestore write");
    assert.equal(await storage.getItem(tutorialCacheKey("u1")), null, "no local record");
    assert.equal(storage.map.size, 0, "nothing persisted anywhere");
    assert.equal(r.sessionRef.current, "u1", "and the session marker is set");
  })();
});

test("dismissing WITH the checkbox persists both, for that uid only", async () => {
  const storage = makeStorage();
  const r = await runOnDone({ skip: true, uid: "u2", storage });
  assert.equal(r.needsOnboarding, false);
  assert.equal(await storage.getItem(tutorialCacheKey("u2")), "true", "local record");
  assert.deepEqual(r.updates, [["users/u2", { hasSeenTutorial: true }]], "and Firestore");
  assert.equal(await storage.getItem(tutorialCacheKey("other-uid")), null, "no other account touched");
  assert.equal(r.sessionRef.current, null, "no session marker needed - it is permanent");
});

test("the checkbox writes true even when the field is still ABSENT", async () => {
  // The classification write may have failed, leaving no field at all. The
  // checkbox must not depend on it.
  const storage = makeStorage();
  const r = await runOnDone({ skip: true, uid: "u3", storage });
  assert.deepEqual(r.updates.map((u) => u[1]), [{ hasSeenTutorial: true }]);
});

test("the local record is written BEFORE the Firestore call, so a failure cannot lose it", () => {
  const body = region("onDone={async (skip) => {", "\n    }} />;");
  const cache = body.indexOf("AsyncStorage.setItem(tutorialCacheKey(uid)");
  const remote = body.indexOf("updateDoc(doc(db,");
  assert.ok(cache > 0 && remote > cache, "cache first, then Firestore");
});

test("a failed true write leaves the choice in the local record, which then suppresses", async () => {
  // End to end: the checkbox writes the record, the Firestore call fails, and
  // the next resolution honours the record and retries.
  const storage = makeStorage();
  const body = region("onDone={async (skip) => {", "\n    }} />;");
  const src = body.slice(body.indexOf("{", body.indexOf("=> ")) + 1);
  const fn = new Function("deps", `
    return async function (skip) {
      const { user, AsyncStorage, tutorialCacheKey, updateDoc, doc, db,
              setNeedsOnboarding, sessionDismissedUidRef, console } = deps;
      ${src}
    };
  `)({
    user: { uid: "u4" }, AsyncStorage: storage, tutorialCacheKey,
    updateDoc: async () => { throw new Error("offline"); },   // the write fails
    doc: () => "users/u4", db: {},
    setNeedsOnboarding: () => {}, sessionDismissedUidRef: { current: null },
    console: { log: () => {} },
  });
  await fn(true);

  assert.equal(await storage.getItem(tutorialCacheKey("u4")), "true", "the choice survived");
  const next = decide({ hasSeenTutorial: undefined, localPermanentChoice: true, analysisCount: 5 });
  assert.equal(next.show, false, "suppressed on this device");
  assert.equal(next.write, true, "and the write is retried");
  assert.equal(next.state, "permanent-retry");
});

// ---- 9. account isolation and the retired device-wide flag ----------------

test("one account's permanent choice does not suppress another account", async () => {
  const storage = makeStorage();
  await runOnDone({ skip: true, uid: "account-A", storage });
  assert.equal(await storage.getItem(tutorialCacheKey("account-A")), "true");

  // account-B, brand new, on the same device.
  const bHasRecord = (await storage.getItem(tutorialCacheKey("account-B"))) === "true";
  assert.equal(bHasRecord, false, "no record for the other account");
  const d = decide({ hasSeenTutorial: undefined, localPermanentChoice: bHasRecord });
  assert.equal(d.show, true, "so it still sees the tutorial");
});

test("the cache key is per uid, and the unkeyed device flag is gone for good", () => {
  assert.equal(tutorialCacheKey("a"), "hasSeenTutorial:a");
  assert.notEqual(tutorialCacheKey("a"), tutorialCacheKey("b"));
  assert.ok(!/AsyncStorage\.getItem\("skipOnboarding"\)/.test(SRC), "never read");
  assert.ok(!/AsyncStorage\.setItem\("skipOnboarding"/.test(SRC), "never written");
});

// ---- 10. uid change, ordering and the gate --------------------------------

test("a uid change resets the onboarding answer before anything async runs", () => {
  const cb = region("const unsub = onAuthStateChanged(auth, async (u) => {", "setUser(u);");
  const resetUid = cb.indexOf("setOnboardingUid(null)");
  const resetNeeds = cb.indexOf("setNeedsOnboarding(null)");
  const resetSession = cb.indexOf("sessionDismissedUidRef.current = null");
  const firstAwait = cb.indexOf("await ");
  assert.ok(resetUid > 0 && resetNeeds > 0 && resetSession > 0, "all three are cleared");
  assert.ok(resetUid < firstAwait && resetNeeds < firstAwait && resetSession < firstAwait,
    "before the first await, or a frame can leak");
});

test("signing out clears the session dismissal; the same session does not", () => {
  const line = region("if (!u || sessionDismissedUidRef.current !== u.uid)", ";");
  const clear = new Function("u", "sessionDismissedUidRef", `${line};
return sessionDismissedUidRef.current;`);
  assert.equal(clear(null, { current: "A" }), null, "sign-out clears it");
  assert.equal(clear({ uid: "B" }, { current: "A" }), null, "another account clears it");
  assert.equal(clear({ uid: "A" }, { current: "A" }), "A", "the same session keeps it");
});

test("the gate refuses to render a tutorial until this uid's answer is in", () => {
  const line = region("const onboardingResolved =", ";");
  const resolved = new Function("user", "onboardingUid", "needsOnboarding",
    `${line};
return onboardingResolved;`);
  assert.equal(resolved({ uid: "a" }, null, null), false, "unresolved");
  assert.equal(resolved({ uid: "a" }, "a", null), false, "uid known but no answer yet");
  assert.equal(resolved({ uid: "a" }, "b", true), false, "answer belongs to a previous account");
  assert.equal(resolved({ uid: "a" }, "a", true), true, "resolved: show");
  assert.equal(resolved({ uid: "a" }, "a", false), true, "resolved: hide");
  assert.equal(resolved(null, "a", true), false, "signed out");
  assert.ok(SRC.includes("if (!startupReady || holdForTracking || (!!user && !onboardingResolved)) {"));
  assert.ok(SRC.includes("} else if (needsOnboarding) {"));
});

test("the tutorial is dismissed only by an explicit control, never by itself", () => {
  // OnboardingScreen has no effect and no timer: onDone is reachable from the
  // three onPress handlers and nowhere else.
  const screen = region("function OnboardingScreen({ onDone }) {", "\n// \u2500\u2500 AUTH SCREEN");
  assert.ok(!/useEffect|setTimeout|setInterval/.test(screen), "nothing can fire on its own");
  assert.equal((screen.match(/onDone\(/g) || []).length, 3, "skip, next-at-last-slide, get-started");
  for (const handler of ["handleSkip", "handleNext", "handleGetStarted"]) {
    assert.ok(screen.includes(handler), handler);
  }
  // And the checkbox is still there, still driving what onDone is given.
  assert.match(screen, /onPress=\{\(\) => setSkipNext\(!skipNext\)\}/);
  assert.match(screen, /Don't show this again/);
});

test("ATT still holds the gate ahead of onboarding and Home", () => {
  // scripts/attMetaFlow.test.js owns the executing ATT coverage; this is the
  // one crossover that the onboarding gate could break.
  assert.match(SRC, /if \(!startupReady \|\| holdForTracking/, "holdForTracking leads the fallback branch");
  assert.match(SRC, /const holdForTracking = !!user && !metaGateReady;/);
  assert.ok(SRC.indexOf("holdForTracking") < SRC.indexOf("} else if (needsOnboarding) {"),
    "the hold is evaluated before the onboarding branch");
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
