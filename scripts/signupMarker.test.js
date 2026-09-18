/**
 * The isNewSignup race, and the durable marker that closes it.
 *
 *   node --test scripts/signupMarker.test.js
 *
 * users/{uid} has two creators. handleAuth's signup branch knows it is a
 * signup; onAuthStateChanged does not. createUserWithEmailAndPassword fires
 * the auth observer the moment it resolves, so both race, and whichever setDoc
 * lands first decides the document. sendWelcomeEmail is an onDocumentCreated
 * trigger gated on isNewSignup, so a lost race means the field is absent
 * permanently and no welcome email is ever sent. Confirmed on staging: three
 * signups on one build, two lost, one won, across both platforms.
 *
 * Two mechanisms are under test, and they cover different failures:
 *   pendingSignup        in process, closes the race
 *   pendingSignup:<uid>  on disk, survives the process dying between Auth
 *                        account creation and the Firestore write
 *
 * The marker block and handleAuth's signup branch are both LIFTED OUT OF
 * App.js AND EXECUTED here with their I/O injected, so this tests behaviour
 * rather than the shape of the source. Storage, Firestore and the clock are
 * all controllable, so every ordering below is forced rather than hoped for.
 *
 * No emulator, no network, no credentials.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
// APP_JS=<path> runs this suite against another copy of App.js, the same
// escape hatch appIntegrity.test.js has. It is how the sign-out wiring and
// current-auth mutations are proven against a real edited file without ever
// editing the one in the repository.
const APP_PATH = process.env.APP_JS || path.join(ROOT, "App.js");
const SRC = fs.readFileSync(APP_PATH, "utf8").replace(/\r\n/g, "\n");
const RULES = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8").replace(/\r\n/g, "\n");

function region(startMarker, endMarker, { from = 0 } = {}) {
  const a = SRC.indexOf(startMarker, from);
  assert.ok(a > 0, `not found in App.js: ${startMarker}`);
  const b = SRC.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after ${startMarker}: ${endMarker}`);
  return SRC.slice(a, b);
}

const MARKER_BLOCK = region("// ---- NEW-SIGNUP MARKING", "// Uncluttrd drawer icon");

// The auth callback's own uid bookkeeping and its signed-out branch, lifted
// and executed rather than described. Calling forgetSignupState directly from
// a test asserts the wiring in prose only: deleting the call from App.js would
// leave such a test passing while the defect came back.
const AUTH_BOOKKEEPING = region("const previousUid = currentUidRef.current;", "if (u) {");
const AUTH_SIGNED_OUT_BRANCH = region("      if (!u) {", "ensureUserDocument(u).catch(");

// ---- injectable I/O -------------------------------------------------------

/** AsyncStorage's contract, with an optional write delay to force orderings. */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  const reads = [];
  const s = {
    map, reads, setDelayMs: 0,
    getItem: async (k) => { reads.push(k); return map.has(k) ? map.get(k) : null; },
    setItem: async (k, v) => { if (s.setDelayMs) await new Promise((r) => setTimeout(r, s.setDelayMs)); map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
  };
  return s;
}

function makeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const ops = [];
  const f = {
    store, ops,
    gate: null,   // when set, setDoc suspends on it: lets a test freeze an
                  // in-flight operation and act while it is suspended
    doc: (_db, collection, id) => ({ path: `${collection}/${id}` }),
    getDoc: async (ref) => {
      ops.push(`get:${ref.path}`);
      const d = store.get(ref.path);
      return { exists: () => d !== undefined, data: () => d };
    },
    setDoc: async (ref, data) => {
      if (f.gate) await f.gate;
      ops.push(`set:${ref.path}`);
      store.set(ref.path, data);
    },
    serverTimestamp: () => ({ __serverTimestamp: true }),
    sets: () => ops.filter((o) => o.startsWith("set:")).length,
  };
  return f;
}

/** A clock whose pending timers fire only when this test says so. */
function makeClock() {
  const timers = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    fireAll: () => { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); },
    liveCount: () => timers.filter((t) => !t.cancelled).length,
  };
}

const TEST_EMAILS = ["dev@uncluttrd.test"];

/**
 * A fresh instance of the marker block. Module state (pendingSignup, the
 * resolved set) is per instance, so "the process restarted" is modelled by
 * building a new one over the SAME storage.
 */
function load({ storage = makeStorage(), fsdb = makeFirestore(), clock = makeClock(), platform = "ios", transform = (s) => s } = {}) {
  const logs = [];
  const api = new Function(
    "AsyncStorage", "doc", "db", "getDoc", "setDoc", "serverTimestamp",
    "Platform", "KNOWN_TEST_EMAILS", "console", "setTimeout", "clearTimeout",
    `${transform(MARKER_BLOCK)}
     return {
       ensureUserDocument, forgetSignupState, setAuthenticatedUid,
       beginPendingSignup, resolvePendingSignup, awaitPendingSignup,
       writeSignupMarker, readSignupMarker, clearSignupMarker, signupMarkerKey,
       SIGNUP_COORDINATION_TIMEOUT_MS,
       peek: () => ({
         pendingSignup, authenticatedUid,
         resolved: [...userDocumentResolved], creating: [...userDocumentCreations.keys()],
       }),
     };`
  )(
    storage, fsdb.doc, {}, fsdb.getDoc, fsdb.setDoc, fsdb.serverTimestamp,
    { OS: platform }, TEST_EMAILS, { log: (...a) => logs.push(a.join(" ")) },
    clock.setTimeout, clock.clearTimeout,
  );
  return { ...api, storage, fsdb, clock, logs };
}

const USER_A = { uid: "uid-alpha", email: "alpha@example.invalid", displayName: "Alpha Person" };
const USER_B = { uid: "uid-bravo", email: "bravo@example.invalid", displayName: "Bravo Person" };
const docOf = (m, u) => m.fsdb.store.get(`users/${u.uid}`);
const settle = () => new Promise((r) => setImmediate(r));

/**
 * The REAL auth callback: its uid bookkeeping and its signed-out branch,
 * lifted out of App.js and executed. resolve(user) is one authenticated
 * resolution; resolve(null) is one signed-out resolution, running the branch
 * that actually ships rather than a test's idea of it.
 */
function makeAuthResolution(m, { transform = (s) => s, forgetSignupState } = {}) {
  const currentUidRef = { current: null };
  const body = transform(`${AUTH_BOOKKEEPING}\n${AUTH_SIGNED_OUT_BRANCH}`);
  const resolve = new Function(
    "currentUidRef", "AsyncStorage", "forgetSignupState", "setAuthenticatedUid",
    `return async (u) => {\n${body}\n  return "authenticated";\n};`
  )(currentUidRef, m.storage, forgetSignupState || m.forgetSignupState, m.setAuthenticatedUid);
  return { resolve, currentUidRef };
}

/** Everything handleAuth does between createUser resolving and the observer being released. */
async function signupUpTo(m, user) {
  const coordination = m.beginPendingSignup();
  await m.writeSignupMarker(user.uid);
  m.resolvePendingSignup(coordination);
  return coordination;
}

// ---- the race ------------------------------------------------------------

test("the generic auth callback winning the race still produces isNewSignup: true", async () => {
  const m = load();
  await signupUpTo(m, USER_A);

  await m.ensureUserDocument(USER_A);                                              // callback wins
  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true }); // handleAuth, late

  assert.equal(docOf(m, USER_A).isNewSignup, true);
  assert.equal(m.fsdb.sets(), 1, "the document must be written exactly once");
});

test("handleAuth winning the race still produces isNewSignup: true", async () => {
  const m = load();
  await signupUpTo(m, USER_A);

  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true }); // handleAuth wins
  await m.ensureUserDocument(USER_A);                                              // callback, late

  const d = docOf(m, USER_A);
  assert.equal(d.isNewSignup, true);
  assert.ok(Object.prototype.hasOwnProperty.call(d, "referralSource"));
  assert.equal(m.fsdb.sets(), 1);
});

test("the callback firing before createUser resolves waits, and still writes isNewSignup: true", async () => {
  const m = load();
  const coordination = m.beginPendingSignup();   // established BEFORE the account exists

  const callback = m.ensureUserDocument(USER_A); // observer fires early
  await settle();
  assert.equal(m.fsdb.sets(), 0, "the callback must not create the document while a signup is in flight");

  await m.writeSignupMarker(USER_A.uid);
  m.resolvePendingSignup(coordination);
  await callback;

  assert.equal(docOf(m, USER_A).isNewSignup, true);
});

test("a slow marker write still cannot let the callback create an unmarked document", async () => {
  const m = load();
  m.storage.setDelayMs = 25;
  const coordination = m.beginPendingSignup();

  const callback = m.ensureUserDocument(USER_A);
  const writer = (async () => { await m.writeSignupMarker(USER_A.uid); m.resolvePendingSignup(coordination); })();

  await settle();
  assert.equal(m.fsdb.sets(), 0, "the callback ran ahead of the marker write");

  await writer;
  await callback;
  assert.equal(docOf(m, USER_A).isNewSignup, true);
});

// ---- returning users -----------------------------------------------------

test("a returning user signing in is never marked as a new signup", async () => {
  const m = load();
  await m.ensureUserDocument(USER_A);
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_A), "isNewSignup"), false);
});

test("a document recreated after deletion is not marked as a new signup", async () => {
  const m = load({ fsdb: makeFirestore({ "users/uid-alpha": { uid: USER_A.uid, isNewSignup: true } }) });
  await m.ensureUserDocument(USER_A);            // existing document, decision recorded
  m.fsdb.store.delete("users/uid-alpha");        // deleted out from under the app
  await m.forgetSignupState(USER_A.uid);         // as a sign-out would
  await m.ensureUserDocument(USER_A);            // recreated on the next resolution

  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_A), "isNewSignup"), false);
});

test("an older Auth account with a missing document is recreated without isNewSignup", async () => {
  const m = load();                              // no marker anywhere
  await m.ensureUserDocument(USER_A);
  const d = docOf(m, USER_A);
  assert.ok(d, "the document must still be created");
  assert.equal(Object.prototype.hasOwnProperty.call(d, "isNewSignup"), false);
});

test("a reinstall leaves no marker, so the welcome email is missed rather than duplicated", async () => {
  const first = load();
  await signupUpTo(first, USER_A);               // signed up on this device

  // Reinstall: same account, brand new storage.
  const reinstalled = load({ storage: makeStorage() });
  await reinstalled.ensureUserDocument(USER_A);

  const d = docOf(reinstalled, USER_A);
  assert.ok(d, "the document is still created - the user is not left without one");
  assert.equal(Object.prototype.hasOwnProperty.call(d, "isNewSignup"), false,
    "the deliberate trade: a missed welcome email, never a duplicate one");
});

// ---- explicit callers ----------------------------------------------------

test("an explicit isNewSignup wins, and the marker is not consulted at all", async () => {
  const m = load();
  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true });

  assert.equal(docOf(m, USER_A).isNewSignup, true);
  assert.equal(m.storage.reads.filter((k) => k === m.signupMarkerKey(USER_A.uid)).length, 0,
    "an explicit caller must not read the marker");
});

test("an explicit isNewSignup wins even with a marker present for another account", async () => {
  const m = load({ storage: makeStorage({ "pendingSignup:uid-bravo": "true" }) });
  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true });
  assert.equal(docOf(m, USER_A).isNewSignup, true);

  await m.ensureUserDocument(USER_B);
  assert.equal(docOf(m, USER_B).isNewSignup, true, "uid-keyed markers stay with their own account");
});

// ---- process interruption ------------------------------------------------

test("a signup interrupted after Auth creation is still a new signup on the next launch", async () => {
  const storage = makeStorage();

  // Launch 1: the account exists and the marker is written, then the process dies.
  const dying = load({ storage });
  const coordination = dying.beginPendingSignup();
  await dying.writeSignupMarker(USER_A.uid);
  dying.resolvePendingSignup(coordination);
  assert.equal(dying.fsdb.sets(), 0, "no document was ever written");

  // Launch 2: fresh process, same disk, only onAuthStateChanged runs.
  const relaunched = load({ storage });
  await relaunched.ensureUserDocument(USER_A);

  assert.equal(docOf(relaunched, USER_A).isNewSignup, true);
});

test("after an interrupted signup, a DIFFERENT account signing in on the same device is not marked", async () => {
  const storage = makeStorage();

  const dying = load({ storage });
  const coordination = dying.beginPendingSignup();
  await dying.writeSignupMarker(USER_A.uid);
  dying.resolvePendingSignup(coordination);

  const relaunched = load({ storage });
  await relaunched.forgetSignupState(USER_A.uid);      // the sign-out branch
  assert.equal(storage.map.has(relaunched.signupMarkerKey(USER_A.uid)), false, "sign-out must clear the marker");

  await relaunched.ensureUserDocument(USER_B);
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(relaunched, USER_B), "isNewSignup"), false);
});

test("a failed createUser leaves no marker and no pending coordination", async () => {
  const m = load();

  // handleAuth's own try/finally, with createUser throwing.
  const coordination = m.beginPendingSignup();
  try {
    throw Object.assign(new Error("email already in use"), { code: "auth/email-already-in-use" });
  } catch (e) { /* surfaced to the user by handleAuth */ } finally {
    m.resolvePendingSignup(coordination);
  }

  assert.equal(m.peek().pendingSignup, null);
  assert.equal(m.storage.map.size, 0, "a failed signup must leave nothing behind");

  await m.ensureUserDocument(USER_A);   // the ordinary sign-in that follows
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_A), "isNewSignup"), false);
});

// ---- the bound -----------------------------------------------------------

test("a signup that never settles does not hang the callback, and does not fabricate a marker", async () => {
  const m = load();
  m.beginPendingSignup();                    // never resolved

  const callback = m.ensureUserDocument(USER_A);
  await settle();
  assert.equal(m.fsdb.sets(), 0, "still waiting, correctly");

  m.clock.fireAll();                         // the 5s bound elapses
  await callback;

  const d = docOf(m, USER_A);
  assert.ok(d, "the user must end up with a document rather than a hang");
  assert.equal(Object.prototype.hasOwnProperty.call(d, "isNewSignup"), false,
    "the timeout must produce the missed-email direction, never a fabricated marker");
});

test("the timeout logs metadata only, with no uid and no email address", async () => {
  const m = load();
  m.beginPendingSignup();
  const callback = m.ensureUserDocument(USER_A);
  await settle();
  m.clock.fireAll();
  await callback;

  const warning = m.logs.find((l) => l.includes("[signup]"));
  assert.ok(warning, "the timeout must be recorded");
  assert.ok(warning.includes(String(m.SIGNUP_COORDINATION_TIMEOUT_MS)));
  assert.ok(!warning.includes(USER_A.uid), "no raw uid");
  assert.ok(!warning.includes(USER_A.email), "no email address");
  assert.ok(!warning.includes("@"), "no email address");
});

test("a signup settling AFTER the bound cannot modify the document or re-decide", async () => {
  const m = load();
  const { resolve } = makeAuthResolution(m);
  const coordination = m.beginPendingSignup();

  // The waiter IS the auth callback, so this account is the authenticated one
  // by the time it decides - exactly as App.js sequences it.
  await resolve(USER_A);
  const callback = m.ensureUserDocument(USER_A);
  await settle();
  m.clock.fireAll();
  await callback;

  const before = { ...docOf(m, USER_A) };
  const sets = m.fsdb.sets();
  const gets = m.fsdb.ops.length;

  // The signup finally finishes and does what it always does.
  await m.writeSignupMarker(USER_A.uid);
  m.resolvePendingSignup(coordination);
  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true });

  assert.deepEqual(docOf(m, USER_A), before, "the completed decision must stand");
  assert.equal(m.fsdb.sets(), sets, "no second write");
  assert.equal(m.fsdb.ops.length, gets,
    "and no second read either - the guard is the recorded decision, not snap.exists()");
});

test("the timeout clears the coordination, so a later ordinary sign-in never waits on it", async () => {
  const m = load();
  m.beginPendingSignup();

  const callback = m.ensureUserDocument(USER_A);
  await settle();
  m.clock.fireAll();
  await callback;

  assert.equal(m.peek().pendingSignup, null, "stale coordination must be dropped");
  assert.equal(m.clock.liveCount(), 0, "the timer must be cleared, not left running");

  await m.ensureUserDocument(USER_B);        // resolves with no timer at all
  assert.equal(m.clock.liveCount(), 0, "a later sign-in must not start a new wait");
  assert.ok(docOf(m, USER_B));
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_B), "isNewSignup"), false);
});

test("the bound is 5 seconds", () => {
  assert.equal(load().SIGNUP_COORDINATION_TIMEOUT_MS, 5000);
});

// ---- the hardened create rule --------------------------------------------

test("the created document satisfies production's users/{userId} create rule exactly", async () => {
  // The allowlist is read from firestore.rules, so this test tracks the real
  // rule rather than a copy of it that can drift.
  const listed = RULES.match(/keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(listed, "could not find the create rule's allowlist in firestore.rules");
  const allowed = new Set(listed[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean));

  for (const extra of [{}, { referralSource: null, isNewSignup: true }, { referralSource: "instagram", isNewSignup: true }]) {
    const m = load();
    if (!Object.prototype.hasOwnProperty.call(extra, "isNewSignup")) await signupUpTo(m, USER_A);
    await m.ensureUserDocument(USER_A, extra);
    const d = docOf(m, USER_A);

    for (const k of Object.keys(d)) assert.ok(allowed.has(k), `field outside the create-rule allowlist: ${k}`);
    assert.equal(d.uid, USER_A.uid, "uid must equal the path id");
    assert.equal(d.email, USER_A.email, "email must equal the token claim");
    assert.deepEqual(d.createdAt, { __serverTimestamp: true }, "createdAt must be the server timestamp");
    assert.ok(Object.prototype.hasOwnProperty.call(d, "isPro"));
    assert.equal(d.isPro, false, "isPro must be present and exactly false");
    assert.equal(Object.prototype.hasOwnProperty.call(d, "analysisCountMonth"), false);
    assert.ok(!Object.prototype.hasOwnProperty.call(d, "analysisCount") || d.analysisCount === 0);
    assert.equal(d.isNewSignup === false, false, "isNewSignup must never be written as false");
  }
});

test("isTestAccount and platform still come from the same sources", async () => {
  const m = load({ platform: "android" });
  await m.ensureUserDocument({ uid: "uid-test", email: "DEV@uncluttrd.test", displayName: "Dev" });
  const d = m.fsdb.store.get("users/uid-test");
  assert.equal(d.platform, "android");
  assert.equal(d.isTestAccount, true, "matched case-insensitively against KNOWN_TEST_EMAILS");
});

// ---- handleAuth's own sequence -------------------------------------------

test("handleAuth's signup sequence is unchanged, with coordination claimed before the account exists", async () => {
  const body = region("const fullName = [firstName, lastName, suffix]", "      } else {");
  const calls = [];
  const rec = (name, result) => (...args) => { calls.push(name); return result === undefined ? Promise.resolve() : Promise.resolve(result); };
  const credUser = { uid: USER_A.uid, email: USER_A.email, displayName: "" };

  const run = new Function(
    "firstName", "lastName", "suffix", "auth", "trimmedEmail", "trimmedPassword", "referralSource",
    "createUserWithEmailAndPassword", "updateProfile", "ensureUserDocument", "signOut", "signInWithEmailAndPassword",
    "beginPendingSignup", "writeSignupMarker", "resolvePendingSignup",
    `return (async () => { ${body} })();`
  )(
    "Alpha", "Person", "", {}, "alpha@example.invalid", "pw123456", "instagram",
    rec("createUser", { user: credUser }), rec("updateProfile"), rec("ensureUserDocument"),
    rec("signOut"), rec("signIn"),
    () => { calls.push("beginPendingSignup"); return { token: true }; },
    rec("writeSignupMarker"),
    () => { calls.push("resolvePendingSignup"); },
  );
  await run;

  assert.deepEqual(calls, [
    "beginPendingSignup",      // BEFORE the Auth account exists
    "createUser",
    "writeSignupMarker",       // durable, before anyone is released
    "resolvePendingSignup",
    "updateProfile",
    "ensureUserDocument",
    "signOut",                 // the pre-existing re-auth, untouched
    "signIn",
  ]);
});

// ---- the marker payload: referralSource and displayName -------------------
//
// The marker used to be the literal "true". That was enough while isNewSignup
// was the only thing the observer could not reconstruct, and it stopped being
// enough the moment the observer started winning: referralSource is collected
// on the signup form and passed only by handleAuth, so documents arrived with
// isNewSignup: true and no referral answer at all. Confirmed on two staging
// iOS accounts, against a pre-fix Android control that still has the field.

const SIGNUP = { referralSource: "instagram", displayName: "Alpha Person" };
const keysOf = (d) => Object.keys(d).sort();

test("the observer winning now persists isNewSignup, referralSource AND the submitted name", async () => {
  const m = load();
  const coordination = m.beginPendingSignup();
  await m.writeSignupMarker(USER_A.uid, SIGNUP);
  m.resolvePendingSignup(coordination);

  await m.ensureUserDocument({ ...USER_A, displayName: "" });   // observer, no extra

  const d = docOf(m, USER_A);
  assert.equal(d.isNewSignup, true);
  assert.equal(d.referralSource, "instagram");
  assert.equal(d.displayName, "Alpha Person");
});

test("handleAuth winning persists the same three values", async () => {
  const m = load();
  const coordination = m.beginPendingSignup();
  await m.writeSignupMarker(USER_A.uid, SIGNUP);
  m.resolvePendingSignup(coordination);

  await m.ensureUserDocument({ ...USER_A, displayName: "Alpha Person" },
    { referralSource: "instagram", isNewSignup: true });

  const d = docOf(m, USER_A);
  assert.equal(d.isNewSignup, true);
  assert.equal(d.referralSource, "instagram");
  assert.equal(d.displayName, "Alpha Person");
});

test("both writers produce an identical document key set and identical values", async () => {
  const viaObserver = load();
  let c = viaObserver.beginPendingSignup();
  await viaObserver.writeSignupMarker(USER_A.uid, SIGNUP);
  viaObserver.resolvePendingSignup(c);
  await viaObserver.ensureUserDocument({ ...USER_A, displayName: "" });

  const viaHandleAuth = load();
  c = viaHandleAuth.beginPendingSignup();
  await viaHandleAuth.writeSignupMarker(USER_A.uid, SIGNUP);
  viaHandleAuth.resolvePendingSignup(c);
  await viaHandleAuth.ensureUserDocument({ ...USER_A, displayName: "Alpha Person" },
    { referralSource: "instagram", isNewSignup: true });

  assert.deepEqual(keysOf(docOf(viaObserver, USER_A)), keysOf(docOf(viaHandleAuth, USER_A)));
  assert.deepEqual(docOf(viaObserver, USER_A), docOf(viaHandleAuth, USER_A));
});

test("no referral selection stores referralSource: null on both new-marker paths", async () => {
  for (const extra of [undefined, { referralSource: null, isNewSignup: true }]) {
    const m = load();
    const c = m.beginPendingSignup();
    await m.writeSignupMarker(USER_A.uid, { referralSource: null, displayName: "Alpha Person" });
    m.resolvePendingSignup(c);

    await m.ensureUserDocument({ ...USER_A, displayName: "Alpha Person" }, extra);

    const d = docOf(m, USER_A);
    assert.equal(Object.prototype.hasOwnProperty.call(d, "referralSource"), true,
      "the key must be present, because null is a real answer");
    assert.equal(d.referralSource, null);
    assert.equal(d.isNewSignup, true);
  }
});

test("an interrupted signup recovers referralSource and the name after a process restart", async () => {
  const storage = makeStorage();

  const dying = load({ storage });
  const c = dying.beginPendingSignup();
  await dying.writeSignupMarker(USER_A.uid, SIGNUP);
  dying.resolvePendingSignup(c);
  assert.equal(dying.fsdb.sets(), 0, "no document was written before the process ended");

  const relaunched = load({ storage });
  await relaunched.ensureUserDocument({ ...USER_A, displayName: "" });

  const d = docOf(relaunched, USER_A);
  assert.equal(d.isNewSignup, true);
  assert.equal(d.referralSource, "instagram");
  assert.equal(d.displayName, "Alpha Person");
});

test("the observer winning before updateProfile propagates still writes the submitted name", async () => {
  const m = load();
  const c = m.beginPendingSignup();
  await m.writeSignupMarker(USER_A.uid, SIGNUP);
  m.resolvePendingSignup(c);

  // u.displayName is still empty: updateProfile has not landed yet. This is the
  // window that would otherwise leave an empty name on the document forever.
  await m.ensureUserDocument({ uid: USER_A.uid, email: USER_A.email, displayName: "" });

  assert.equal(docOf(m, USER_A).displayName, "Alpha Person",
    "the marker's submitted name must win over an unpropagated u.displayName");
});

// ---- legacy and corrupt markers ------------------------------------------

test("a legacy \"true\" marker still means isNewSignup, and invents nothing", async () => {
  const m = load({ storage: makeStorage({ "pendingSignup:uid-alpha": "true" }) });
  await m.ensureUserDocument({ ...USER_A, displayName: "Alpha Person" });

  const d = docOf(m, USER_A);
  assert.equal(d.isNewSignup, true);
  assert.equal(Object.prototype.hasOwnProperty.call(d, "referralSource"), false,
    "a legacy marker must not invent a referral answer");
  assert.equal(d.displayName, "Alpha Person", "and falls back to u.displayName unchanged");
});

test("a legacy \"true\" marker with no u.displayName keeps the original empty-string fallback", async () => {
  const m = load({ storage: makeStorage({ "pendingSignup:uid-alpha": "true" }) });
  await m.ensureUserDocument({ uid: USER_A.uid, email: USER_A.email });   // no displayName at all

  assert.equal(docOf(m, USER_A).displayName, "", "unchanged from the pre-payload behaviour");
  assert.equal(docOf(m, USER_A).isNewSignup, true);
});

test("a corrupt marker does not throw, does not block creation, and yields no signup fields", async () => {
  for (const junk of ["{not json", "[]", "null", '{"isNewSignup":false}', '{"referralSource":"x"}', "42", '{"isNewSignup":true,"evil":1}']) {
    const m = load({ storage: makeStorage({ "pendingSignup:uid-alpha": junk }) });
    await m.ensureUserDocument({ ...USER_A, displayName: "Alpha Person" });

    const d = docOf(m, USER_A);
    assert.ok(d, `the document must still be created for ${junk}`);
    if (junk === '{"isNewSignup":true,"evil":1}') {
      // A well-formed marker with an extra property: usable, but only the
      // three allowed keys may ever be drawn from it.
      assert.equal(d.isNewSignup, true);
      assert.equal(Object.prototype.hasOwnProperty.call(d, "evil"), false, "no marker metadata may reach Firestore");
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(d, "isNewSignup"), false, `isNewSignup invented from ${junk}`);
      assert.equal(Object.prototype.hasOwnProperty.call(d, "referralSource"), false, `referralSource invented from ${junk}`);
      assert.equal(d.displayName, "Alpha Person", `displayName invented from ${junk}`);
    }
  }
});

test("a returning user with no marker gets no signup-only fields and no welcome-email eligibility", async () => {
  const m = load();
  await m.ensureUserDocument({ ...USER_A, displayName: "Alpha Person" });

  const d = docOf(m, USER_A);
  assert.equal(Object.prototype.hasOwnProperty.call(d, "isNewSignup"), false,
    "sendWelcomeEmail is gated on isNewSignup === true, so its absence is the protection");
  assert.equal(Object.prototype.hasOwnProperty.call(d, "referralSource"), false);
});

test("sign-out clears the whole payload, through the real lifted branch", async () => {
  const m = load();
  const { resolve } = makeAuthResolution(m);

  const c = m.beginPendingSignup();
  await m.writeSignupMarker(USER_A.uid, SIGNUP);
  m.resolvePendingSignup(c);
  assert.ok(m.storage.map.get(m.signupMarkerKey(USER_A.uid)).includes("instagram"), "payload is on disk");

  await resolve(USER_A);
  await resolve(null);                       // THE REAL SIGN-OUT BRANCH

  assert.equal(m.storage.map.has(m.signupMarkerKey(USER_A.uid)), false,
    "the whole payload goes, not just an isNewSignup flag");
});

test("the stored payload contains only the three permitted keys", async () => {
  const m = load();
  await m.writeSignupMarker(USER_A.uid, SIGNUP);
  const stored = JSON.parse(m.storage.map.get(m.signupMarkerKey(USER_A.uid)));
  assert.deepEqual(Object.keys(stored).sort(), ["displayName", "isNewSignup", "referralSource"]);
  assert.deepEqual(stored, { isNewSignup: true, referralSource: "instagram", displayName: "Alpha Person" });
});

test("a marker-driven document also satisfies the real firestore.rules create allowlist", async () => {
  const listed = RULES.match(/keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(listed, "could not find the create rule's allowlist in firestore.rules");
  const allowed = new Set(listed[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean));

  for (const payload of [SIGNUP, { referralSource: null, displayName: "Alpha Person" }, {}]) {
    const m = load();
    const c = m.beginPendingSignup();
    await m.writeSignupMarker(USER_A.uid, payload);
    m.resolvePendingSignup(c);
    await m.ensureUserDocument({ ...USER_A, displayName: "" });

    const d = docOf(m, USER_A);
    for (const k of Object.keys(d)) assert.ok(allowed.has(k), `field outside the allowlist: ${k}`);
    assert.equal(d.uid, USER_A.uid);
    assert.equal(d.email, USER_A.email);
    assert.deepEqual(d.createdAt, { __serverTimestamp: true });
    assert.equal(d.isPro, false);
    assert.equal(Object.prototype.hasOwnProperty.call(d, "analysisCountMonth"), false);
    assert.equal(d.isNewSignup === false, false);
  }
});

test("readSignupMarker normalizes every shape without throwing", async () => {
  const m = load();
  const read = async (value) => {
    m.storage.map.set(m.signupMarkerKey(USER_A.uid), value);
    return m.readSignupMarker(USER_A.uid);
  };
  assert.deepEqual(await read("true"), { isNewSignup: true });
  assert.deepEqual(await read(JSON.stringify({ isNewSignup: true, referralSource: "tiktok", displayName: "N" })),
    { isNewSignup: true, referralSource: "tiktok", displayName: "N" });
  assert.deepEqual(await read(JSON.stringify({ isNewSignup: true, referralSource: null, displayName: "" })),
    { isNewSignup: true, referralSource: null }, "an empty name is dropped, so the u.displayName fallback applies");
  assert.deepEqual(await read(JSON.stringify({ isNewSignup: true, referralSource: 7, displayName: 9 })),
    { isNewSignup: true, referralSource: null }, "non-string values are coerced to the safe answer, never passed through");
  for (const junk of ["{not json", "[]", "null", "42", '{"isNewSignup":false}']) {
    assert.equal(await read(junk), null, `must normalize to absent: ${junk}`);
  }
  m.storage.map.delete(m.signupMarkerKey(USER_A.uid));
  assert.equal(await m.readSignupMarker(USER_A.uid), null);
});

// ---- the real sign-out branch --------------------------------------------

test("a signed-out resolution runs the real branch and forgets the PREVIOUS uid", async () => {
  const m = load();
  const forgotten = [];
  const spy = async (uid) => { forgotten.push(uid); await m.forgetSignupState(uid); };
  const { resolve, currentUidRef } = makeAuthResolution(m, { forgetSignupState: spy });

  await resolve(USER_A);
  assert.equal(currentUidRef.current, USER_A.uid);
  assert.equal(m.peek().authenticatedUid, USER_A.uid);

  await resolve(null);
  assert.deepEqual(forgotten, [USER_A.uid], "the branch must forget the account that just left");
  assert.equal(currentUidRef.current, null);
  assert.equal(m.peek().authenticatedUid, null);
});

test("the real sign-out branch lets a document deleted afterwards be repaired on the next sign-in", async () => {
  const m = load();
  const { resolve } = makeAuthResolution(m);

  await resolve(USER_A);
  await m.ensureUserDocument(USER_A);
  assert.ok(docOf(m, USER_A), "created on first resolution");
  assert.ok(m.peek().resolved.includes(USER_A.uid), "and the decision is recorded");

  await resolve(null);                          // THE REAL SIGN-OUT BRANCH
  assert.equal(m.peek().resolved.includes(USER_A.uid), false, "sign-out must drop the record");

  m.fsdb.store.delete(`users/${USER_A.uid}`);   // deleted by some other means

  await resolve(USER_A);                        // same process, signs back in
  const readsBefore = m.fsdb.ops.length;
  await m.ensureUserDocument(USER_A);

  assert.ok(m.fsdb.ops.length > readsBefore, "Firestore must actually be read again");
  assert.ok(docOf(m, USER_A), "the missing document must be recreated");
});

test("signing out of A does not disturb B's own resolution", async () => {
  const m = load();
  const { resolve } = makeAuthResolution(m);

  await resolve(USER_A);
  await m.ensureUserDocument(USER_A);
  await resolve(null);
  await resolve(USER_B);
  await m.ensureUserDocument(USER_B);

  assert.ok(docOf(m, USER_B));
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_B), "isNewSignup"), false);
});

// ---- a late resume must not record a signed-out uid -----------------------

test("an operation resuming after sign-out does not record the uid, so the next sign-in still repairs", async () => {
  const m = load();
  const { resolve } = makeAuthResolution(m);
  await resolve(USER_A);

  let release;
  m.fsdb.gate = new Promise((r) => { release = r; });   // freeze it mid-write
  const op = m.ensureUserDocument(USER_A);
  await settle();

  await resolve(null);        // the real sign-out branch, while the op is suspended
  m.fsdb.gate = null;
  release();
  await op;                   // the write lands for an account that already left

  assert.equal(m.peek().resolved.includes(USER_A.uid), false,
    "a completed decision must not be cached for a uid that is no longer current");

  m.fsdb.store.delete(`users/${USER_A.uid}`);
  await resolve(USER_A);
  const readsBefore = m.fsdb.ops.length;
  await m.ensureUserDocument(USER_A);

  assert.ok(m.fsdb.ops.length > readsBefore, "Firestore must be read on the next sign-in");
  assert.ok(docOf(m, USER_A), "and the missing document recreated");
});

test("the signup sequence's own signOut and signIn still leave the uid recorded", async () => {
  const m = load();
  const { resolve } = makeAuthResolution(m);

  // createUserWithEmailAndPassword resolves and fires the observer.
  const coordination = m.beginPendingSignup();
  await resolve(USER_A);
  await m.writeSignupMarker(USER_A.uid);
  m.resolvePendingSignup(coordination);
  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true });
  assert.ok(m.peek().resolved.includes(USER_A.uid), "recorded while A is the current account");

  // The sequence's own re-auth, which the fix must not mistake for leaving.
  await resolve(null);
  await resolve(USER_A);
  await m.ensureUserDocument(USER_A);

  assert.ok(m.peek().resolved.includes(USER_A.uid),
    "still recorded after signOut then signIn - otherwise the late-settle guard is silently off");
  assert.equal(docOf(m, USER_A).isNewSignup, true);
  assert.equal(m.fsdb.sets(), 1, "and the document was written exactly once");
});

// ---- mutation proofs -----------------------------------------------------
//
// Each one restores a piece of the pre-fix behaviour in a lifted copy and
// asserts the defect comes back. Without these, a test that passes proves only
// that it passes.

const mutate = (from, to) => (src) => {
  assert.ok(src.includes(from), `the mutation target is gone from App.js, so this proof proves nothing: ${from}`);
  return src.split(from).join(to);
};

test("MUTATION: removing the coordination wait brings the original race straight back", async () => {
  const m = load({ transform: mutate("if (!explicitSignup) await awaitPendingSignup();", "if (!explicitSignup) { /* raced */ }") });
  m.beginPendingSignup();                    // a signup is in flight, marker not written yet

  await m.ensureUserDocument(USER_A);        // the observer, no longer waiting

  assert.equal(m.fsdb.sets(), 1, "the unfixed code creates the document immediately");
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_A), "isNewSignup"), false,
    "and this is the defect: the field is absent permanently, so no welcome email is ever sent");
});

test("MUTATION: ignoring the durable marker loses an interrupted signup", async () => {
  const storage = makeStorage();
  const dying = load({ storage });
  const coordination = dying.beginPendingSignup();
  await dying.writeSignupMarker(USER_A.uid);
  dying.resolvePendingSignup(coordination);

  // Target literal follows the reader's rename to readSignupMarker; the
  // assertion below is unchanged.
  const relaunched = load({ storage, transform: mutate(": await readSignupMarker(u.uid);", ": null;") });
  await relaunched.ensureUserDocument(USER_A);

  assert.equal(Object.prototype.hasOwnProperty.call(docOf(relaunched, USER_A), "isNewSignup"), false,
    "without the marker consultation, a restarted signup is indistinguishable from a returning user");
});

test("MUTATION: dropping the recorded decision makes the late-settle guard fall back to snap.exists()", async () => {
  const m = load({ transform: mutate("if (userDocumentResolved.has(u.uid)) return;", "if (false) return;") });
  const { resolve } = makeAuthResolution(m);
  const coordination = m.beginPendingSignup();

  await resolve(USER_A);
  const callback = m.ensureUserDocument(USER_A);
  await settle();
  m.clock.fireAll();
  await callback;

  const reads = m.fsdb.ops.length;
  await m.writeSignupMarker(USER_A.uid);
  m.resolvePendingSignup(coordination);
  await m.ensureUserDocument(USER_A, { referralSource: null, isNewSignup: true });

  // The document still survives, but only because the re-read happened to say
  // it exists. That is the same no-op that produced the original race, which
  // is exactly why the real guard is the recorded decision instead.
  assert.ok(m.fsdb.ops.length > reads,
    "the late signup went back to Firestore to re-decide, rather than being stopped outright");
  assert.equal(Object.prototype.hasOwnProperty.call(docOf(m, USER_A), "isNewSignup"), false);
});

test("MUTATION: a bare \"true\" marker loses the referral answer and the submitted name", async () => {
  // The pre-fix marker, restored: a payload write that stores only "true".
  const m = load({ transform: mutate("const payload = JSON.stringify({", "const payload = \"true\" || JSON.stringify({") });
  const c = m.beginPendingSignup();
  await m.writeSignupMarker(USER_A.uid, SIGNUP);
  m.resolvePendingSignup(c);

  await m.ensureUserDocument({ ...USER_A, displayName: "" });

  const d = docOf(m, USER_A);
  assert.equal(d.isNewSignup, true, "the welcome email still works, which is what made this quiet");
  assert.equal(Object.prototype.hasOwnProperty.call(d, "referralSource"), false,
    "and this is the defect: the referral answer is gone");
  assert.equal(d.displayName, "", "along with the submitted name");
});

test("MUTATION: deleting the sign-out branch's forgetSignupState call strands the record", async () => {
  const dropCall = mutate("await forgetSignupState(previousUid);", "/* removed */");
  const m = load();
  const forgotten = [];
  const spy = async (uid) => { forgotten.push(uid); await m.forgetSignupState(uid); };
  const { resolve } = makeAuthResolution(m, { transform: dropCall, forgetSignupState: spy });

  await resolve(USER_A);
  await m.ensureUserDocument(USER_A);
  await resolve(null);

  assert.deepEqual(forgotten, [], "the wiring is gone, which the previous prose-only tests could not see");
  assert.ok(m.peek().resolved.includes(USER_A.uid), "and the record survives sign-out");

  // Which is the defect: the next sign-in never looks at Firestore.
  m.fsdb.store.delete(`users/${USER_A.uid}`);
  await resolve(USER_A);
  const readsBefore = m.fsdb.ops.length;
  await m.ensureUserDocument(USER_A);

  assert.equal(m.fsdb.ops.length, readsBefore, "it returns at the first line with no read");
  assert.equal(docOf(m, USER_A), undefined, "so the missing document is never repaired");
});

test("MUTATION: removing the current-auth check re-records a signed-out uid", async () => {
  const m = load({ transform: mutate("if (authenticatedUid === u.uid) userDocumentResolved.add(u.uid);", "userDocumentResolved.add(u.uid);") });
  const { resolve } = makeAuthResolution(m);
  await resolve(USER_A);

  let release;
  m.fsdb.gate = new Promise((r) => { release = r; });
  const op = m.ensureUserDocument(USER_A);
  await settle();
  await resolve(null);
  m.fsdb.gate = null;
  release();
  await op;

  assert.ok(m.peek().resolved.includes(USER_A.uid),
    "without the check, the late resume caches a decision for an account that already left");

  m.fsdb.store.delete(`users/${USER_A.uid}`);
  await resolve(USER_A);
  const readsBefore = m.fsdb.ops.length;
  await m.ensureUserDocument(USER_A);

  assert.equal(m.fsdb.ops.length, readsBefore, "and the next sign-in skips Firestore entirely");
  assert.equal(docOf(m, USER_A), undefined, "leaving the document unrepaired");
});

test("the createUser to signOut to signIn sequence is still exactly three auth calls in order", () => {
  const body = region("const fullName = [firstName, lastName, suffix]", "      } else {");
  const order = [...body.matchAll(/(createUserWithEmailAndPassword|signOut|signInWithEmailAndPassword)\(/g)].map((x) => x[1]);
  assert.deepEqual(order, ["createUserWithEmailAndPassword", "signOut", "signInWithEmailAndPassword"]);
});
