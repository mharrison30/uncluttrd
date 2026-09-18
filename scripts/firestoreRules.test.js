// Firestore security rules tests for users/{userId}.
//
// Runs firestore.rules in the LOCAL Firestore emulator only:
//
//   npx firebase-tools emulators:exec --only firestore --project demo-uncluttrd-rules "node --test scripts/firestoreRules.test.js"
//
// emulators:exec sets FIRESTORE_EMULATOR_HOST. The suite refuses to run without
// it, and only ever uses a demo- project ID, so it cannot reach production or
// staging. No credentials are used.

const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-uncluttrd-rules";
const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const ALICE = "alice-uid";
const BOB = "bob-uid";
// The email claim Firebase Auth puts in each user's ID token. The app signs in
// with email/password only, so every real token carries one.
const EMAILS = { [ALICE]: "alice@example.invalid", [BOB]: "bob@example.invalid" };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set - run this suite through `firebase emulators:exec`.");
}
assert.ok(PROJECT_ID.startsWith("demo-"), "rules tests must use a demo- project");

let env;

// The exact shape App.js ensureUserDocument writes at signup
// (uid, email, displayName, createdAt, platform, isPro, isTestAccount, ...extra
// where extra = { referralSource, isNewSignup }).
const signupPayload = (uid, overrides = {}) => ({
  uid,
  email: EMAILS[ALICE],
  displayName: "Alice",
  createdAt: serverTimestamp(),
  platform: "ios",
  isPro: false,
  isTestAccount: false,
  referralSource: "instagram",
  isNewSignup: true,
  ...overrides,
});

// What ensureUserDocument writes on a later auth resolution: no extra fields.
const minimalPayload = (uid) => {
  const p = signupPayload(uid);
  delete p.referralSource;
  delete p.isNewSignup;
  return p;
};

// A document as it exists after signup plus server-side writes.
const existingProfile = {
  uid: ALICE,
  email: "alice@example.invalid",
  displayName: "Alice",
  platform: "ios",
  isPro: false,
  isTestAccount: false,
  analysisCount: 2,
  analysisCountMonth: "2026-09",
  hasSeenTutorial: false,
};

// Signed in the way the app signs in: an ID token whose email claim is the
// account's own email.
const as = (uid) => env.authenticatedContext(uid, { email: EMAILS[uid] }).firestore();
const aliceDoc = (db) => doc(db, "users", ALICE);

async function seed(data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", ALICE), data);
  });
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// ---- create ----------------------------------------------------------------

test("a. valid signup with all normal fields and isPro false: ALLOW", async () => {
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE)));
});

test("a2. referralSource null, as the app writes when none was chosen: ALLOW", async () => {
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { referralSource: null })));
});

test("b. valid profile with optional fields absent (auth-resolution path): ALLOW", async () => {
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), minimalPayload(ALICE)));
});

test("b2. analysisCount present and exactly 0: ALLOW", async () => {
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { analysisCount: 0 })));
});

test("c. isPro true: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { isPro: true })));
});

test("c2. isPro a non-boolean falsy value: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { isPro: "false" })));
});

test("d. isPro absent: DENY", async () => {
  const p = signupPayload(ALICE);
  delete p.isPro;
  await assertFails(setDoc(aliceDoc(as(ALICE)), p));
});

test("e. stored uid does not match the authenticated user: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(BOB)));
});

test("e2. document path is another user's id: DENY", async () => {
  await assertFails(setDoc(doc(as(ALICE), "users", BOB), signupPayload(BOB)));
});

test("e3. stored uid absent: DENY", async () => {
  const p = signupPayload(ALICE);
  delete p.uid;
  await assertFails(setDoc(aliceDoc(as(ALICE)), p));
});

test("f. additional arbitrary field: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { role: "admin" })));
});

test("f2. hasSeenTutorial on create (update-only field): DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { hasSeenTutorial: true })));
});

test("f3. adMeasurementOptOut on create: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { adMeasurementOptOut: false })));
});

test("g. nonzero analysisCount: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { analysisCount: 3 })));
});

test("h. analysisCountMonth present: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { analysisCountMonth: "2026-09" })));
});

test("i. unauthenticated create: DENY", async () => {
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), "users", ALICE), signupPayload(ALICE)));
});

// ---- create: identity and timestamp pins ------------------------------------

test("s1. valid signup with matching authenticated email and server timestamp: ALLOW", async () => {
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { email: EMAILS[ALICE], createdAt: serverTimestamp() })));
});

test("s2. stored email different from request.auth.token.email: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { email: "someone-else@example.invalid" })));
});

test("s3. auth token without an email claim: DENY", async () => {
  const noEmailClaim = env.authenticatedContext(ALICE).firestore();
  await assertFails(setDoc(doc(noEmailClaim, "users", ALICE), signupPayload(ALICE)));
});

test("s4. stored email absent: DENY", async () => {
  const p = signupPayload(ALICE);
  delete p.email;
  await assertFails(setDoc(aliceDoc(as(ALICE)), p));
});

test("s5. stored email empty string: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { email: "" })));
});

test("s6. client-supplied createdAt (current client clock) instead of request.time: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { createdAt: Timestamp.now() })));
});

test("s7. client-supplied createdAt in the re-engagement window (27h ago): DENY", async () => {
  const backdated = Timestamp.fromMillis(Date.now() - 27 * 60 * 60 * 1000);
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { createdAt: backdated })));
});

test("s8. createdAt as a plain string: DENY", async () => {
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { createdAt: new Date().toISOString() })));
});

test("s9. createdAt absent: DENY", async () => {
  const p = signupPayload(ALICE);
  delete p.createdAt;
  await assertFails(setDoc(aliceDoc(as(ALICE)), p));
});

test("s10. serverTimestamp() resolves to request.time and is stored as a timestamp: ALLOW", async () => {
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), minimalPayload(ALICE)));
  let stored;
  await env.withSecurityRulesDisabled(async (ctx) => {
    stored = (await getDoc(doc(ctx.firestore(), "users", ALICE))).data();
  });
  assert.ok(stored.createdAt instanceof Timestamp, "createdAt is a Firestore Timestamp");
  assert.ok(Math.abs(stored.createdAt.toMillis() - Date.now()) < 60 * 1000, "createdAt is the server's current time");
  assert.equal(stored.email, EMAILS[ALICE]);
});

test("delete then recreate cannot forge isPro, but a valid recreate is allowed", async () => {
  await seed({ ...existingProfile, isPro: false });
  await assertSucceeds(deleteDoc(aliceDoc(as(ALICE))));
  await assertFails(setDoc(aliceDoc(as(ALICE)), signupPayload(ALICE, { isPro: true })));
  await assertSucceeds(setDoc(aliceDoc(as(ALICE)), minimalPayload(ALICE)));
});

// ---- update ----------------------------------------------------------------

test("j. hasSeenTutorial only: ALLOW", async () => {
  await seed(existingProfile);
  await assertSucceeds(updateDoc(aliceDoc(as(ALICE)), { hasSeenTutorial: true }));
});

test("j2. hasSeenTutorial accepts FALSE as well as true, and moves between them", async () => {
  // The account-scoped model needs all three states, and false is the one that
  // carries meaning: it says this account is classified and has NOT chosen
  // permanent dismissal. The rule constrains which key may change, never its
  // value, so both directions must be writable by the owner.
  // Seeded with the field ABSENT, the state an unclassified account is in.
  const { hasSeenTutorial, ...withoutField } = existingProfile;
  await seed(withoutField);
  await assertSucceeds(updateDoc(aliceDoc(as(ALICE)), { hasSeenTutorial: false }));
  await assertSucceeds(updateDoc(aliceDoc(as(ALICE)), { hasSeenTutorial: true }));
  await assertSucceeds(updateDoc(aliceDoc(as(ALICE)), { hasSeenTutorial: false }));

  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "users", ALICE));
    assert.equal(snap.data().hasSeenTutorial, false);
  });
});

test("k. isPro true: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { isPro: true }));
});

test("l. isPro false (writing the field at all): DENY", async () => {
  await seed({ ...existingProfile, isPro: true });
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { isPro: false }));
});

test("m. arbitrary field: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { role: "admin" }));
});

test("m2. analysisCount: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { analysisCount: 0 }));
});

test("m3. analysisCountMonth: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { analysisCountMonth: "2026-10" }));
});

test("m4. uid: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { uid: BOB }));
});

test("n. hasSeenTutorial combined with isPro: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { hasSeenTutorial: true, isPro: true }));
});

test("n2. hasSeenTutorial combined with an arbitrary field: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(ALICE)), { hasSeenTutorial: true, role: "admin" }));
});

test("o. another user's document update: DENY", async () => {
  await seed(existingProfile);
  await assertFails(updateDoc(aliceDoc(as(BOB)), { hasSeenTutorial: true }));
});

// ---- delete and access -----------------------------------------------------

test("p. owner delete (temporary legacy 1.0.x compatibility): ALLOW", async () => {
  await seed(existingProfile);
  await assertSucceeds(deleteDoc(aliceDoc(as(ALICE))));
});

test("q. another user's delete: DENY", async () => {
  await seed(existingProfile);
  await assertFails(deleteDoc(aliceDoc(as(BOB))));
});

test("r. another user's read: DENY", async () => {
  await seed(existingProfile);
  await assertFails(getDoc(aliceDoc(as(BOB))));
});

test("r2. owner read: ALLOW", async () => {
  await seed(existingProfile);
  await assertSucceeds(getDoc(aliceDoc(as(ALICE))));
});
