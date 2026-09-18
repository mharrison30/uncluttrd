// Tests for hardDeleteAccountAdmin - Phase C5 account deletion, and
// specifically Phase 2(d), the "every OTHER direct subcollection under
// users/{uid}" sweep.
//
//   npx firebase-tools emulators:exec --config scripts/hardDelete.emulator.json \
//     --only firestore,auth,storage --project demo-uncluttrd-harddelete \
//     "node --test scripts/accountHardDelete.test.js"
//
// Real Firestore, real Auth and real Storage emulators - not fakes. The
// behaviour under test IS recursiveDelete's own semantics (what it removes,
// what it leaves behind when it fails partway, and what it refuses to touch),
// so a hand-written fake would only be able to confirm this file's own
// assumptions about Firestore. The suite refuses to run without all three
// emulator hosts set, and only ever uses a demo- project, so it cannot reach
// production or staging. No credentials are used.
//
// Lives in the root scripts/ directory, not functions/, so it is never
// uploaded with a functions deploy.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const CANONICAL_SRC = path.join(ROOT, "scripts", "runSpaceMigration.js");
const DEPLOYED_SRC = path.join(ROOT, "functions", "scripts", "runSpaceMigration.js");

const PROJECT_ID = "demo-uncluttrd-harddelete";
const BUCKET = `${PROJECT_ID}.appspot.com`;

for (const v of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  if (!process.env[v]) {
    throw new Error(`${v} is not set - run this suite through firebase emulators:exec with --config scripts/hardDelete.emulator.json --only firestore,auth,storage.`);
  }
}
assert.ok(PROJECT_ID.startsWith("demo-"), "this suite must use a demo- project");

// The SAME firebase-admin instance the module under test requires - resolved
// from functions/, where its own require("firebase-admin") resolves to. Node
// caches by resolved filename, so admin.initializeApp() here configures the
// very admin.storage()/admin.auth() the module calls internally.
const admin = require(require.resolve("firebase-admin", { paths: [path.join(ROOT, "functions")] }));
admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket();

// Exercise the copy that actually deploys (functions/scripts/), the same
// choice scripts/planStoragePurge.test.js makes. The first test below proves
// it is still a faithful copy of the canonical source.
const { hardDeleteAccountAdmin } = require(DEPLOYED_SRC);

// ---- seeding -------------------------------------------------------------

// One account, seeded across every shape Phase 1, 2(a)-(e) and 3 have to
// handle - including the two the flat per-document delete got wrong: a real
// nested subcollection (mergeCandidates/{id}/history, which exists in
// production data today) and a synthetic future one nested two levels deep,
// standing in for the "anything a future phase adds" case that
// listCollections() discovery exists to cover in the first place.
async function seedAccount(uid) {
  const userRef = db.collection("users").doc(uid);
  await userRef.set({ uid, email: `${uid}@example.invalid`, createdAt: new Date() });

  // A Room with an Area and a plan that genuinely resolves to both, plus the
  // Space shadow graph deletePlanAdmin walks (projects/sessions/batches).
  await userRef.collection("spaces").doc("room-a").set({ name: "Room A", retired: false });
  await userRef.collection("spaces").doc("room-a").collection("areas").doc("area-a").set({ name: "Area A" });
  await userRef.collection("plans").doc("plan-a").set({ canonicalSpaceId: "room-a", areaId: "area-a", title: "Plan A" });
  const projectRef = userRef.collection("spaces").doc("room-a").collection("projects").doc("plan-a");
  await projectRef.set({ planId: "plan-a" });
  await projectRef.collection("sessions").doc("plan-a").set({ planId: "plan-a" });
  await projectRef.collection("sessions").doc("plan-a").collection("batches").doc("plan-a-batch0").set({ batchIndex: 0 });

  // An orphan plan with no Space at all - Phase 2(b).
  await userRef.collection("plans").doc("plan-orphan").set({ title: "Orphan" });

  // Phase 2(d), the collection under test. mergeCandidates/{id}/history is
  // real: it exists in both staging and production data.
  const candRef = userRef.collection("mergeCandidates").doc("cand-1");
  await candRef.set({ spaceType: "kitchen", status: "pending" });
  await candRef.collection("history").doc("ev-1").set({ event: "detected" });
  await candRef.collection("history").doc("ev-2").set({ event: "dismissed" });

  // Phase 2(d), the future case: a subcollection nobody has written a
  // deletion path for, nested two levels deep.
  const futureRef = userRef.collection("futurePhaseWidgets").doc("widget-1");
  await futureRef.set({ kind: "synthetic" });
  const lvl1 = futureRef.collection("level1").doc("l1-1");
  await lvl1.set({ depth: 1 });
  await lvl1.collection("level2").doc("l2-1").set({ depth: 2 });
  await lvl1.collection("level2").doc("l2-2").set({ depth: 2 });

  // Phase 2(d), the flat case that already worked - must keep working.
  await userRef.collection("analysisIdempotency").doc("idem-1").set({ hash: "abc" });

  // Storage, under BOTH prefixes Phase 2(e) sweeps.
  await bucket.file(`plans/${uid}/plan-a/original.jpg`).save(Buffer.from("a"));
  await bucket.file(`plans/${uid}/plan-a/progress/p1.jpg`).save(Buffer.from("b"));
  await bucket.file(`plans/${uid}/plan-orphan/original.jpg`).save(Buffer.from("c"));
  await bucket.file(`viz/${uid}/plan-a/render.png`).save(Buffer.from("d"));

  await admin.auth().createUser({ uid, email: `${uid}@example.invalid`, password: "emulator-only-pw" });
}

// ---- census --------------------------------------------------------------

// Everything a "did this account actually go away" assertion needs, read back
// from the live emulators. Descendants are counted directly at their own
// paths, never inferred from the parent being gone - the entire defect being
// fixed is that a missing parent says nothing about its descendants.
async function census(uid) {
  const userRef = db.collection("users").doc(uid);
  const count = async (ref) => (await ref.get()).size;
  const lvl1 = userRef.collection("futurePhaseWidgets").doc("widget-1").collection("level1");

  const [plansFiles] = await bucket.getFiles({ prefix: `plans/${uid}/` });
  const [vizFiles] = await bucket.getFiles({ prefix: `viz/${uid}/` });

  let level2 = 0;
  for (const ref of await lvl1.listDocuments()) {
    level2 += (await ref.collection("level2").get()).size;
  }

  return {
    profileDoc: (await userRef.get()).exists,
    subcollections: (await userRef.listCollections()).map((c) => c.id).sort(),
    spaces: await count(userRef.collection("spaces")),
    areas: await count(userRef.collection("spaces").doc("room-a").collection("areas")),
    batches: await count(userRef.collection("spaces").doc("room-a").collection("projects").doc("plan-a")
      .collection("sessions").doc("plan-a").collection("batches")),
    plans: await count(userRef.collection("plans")),
    mergeCandidates: await count(userRef.collection("mergeCandidates")),
    // The gap. Counted at its own path, parent or no parent.
    mergeCandidateHistory: await count(userRef.collection("mergeCandidates").doc("cand-1").collection("history")),
    futureWidgets: await count(userRef.collection("futurePhaseWidgets")),
    futureLevel1: await count(lvl1),
    futureLevel2: level2,
    analysisIdempotency: await count(userRef.collection("analysisIdempotency")),
    storagePlansObjects: plansFiles.length,
    storageVizObjects: vizFiles.length,
    authExists: await admin.auth().getUser(uid).then(() => true).catch(() => false),
  };
}

const NOTHING_LEFT = {
  profileDoc: false, subcollections: [], spaces: 0, areas: 0, batches: 0, plans: 0,
  mergeCandidates: 0, mergeCandidateHistory: 0, futureWidgets: 0, futureLevel1: 0,
  futureLevel2: 0, analysisIdempotency: 0, storagePlansObjects: 0, storageVizObjects: 0,
  authExists: false,
};

// Every count this suite later asserts is zero must have been nonzero first -
// an empty prefix proves nothing on its own.
function assertSeedIsNonEmpty(c, label) {
  assert.equal(c.profileDoc, true, `${label}: profile doc`);
  assert.equal(c.authExists, true, `${label}: auth account`);
  for (const k of ["spaces", "areas", "batches", "plans", "mergeCandidates", "mergeCandidateHistory",
    "futureWidgets", "futureLevel1", "futureLevel2", "analysisIdempotency",
    "storagePlansObjects", "storageVizObjects"]) {
    assert.ok(c[k] > 0, `${label}: expected a nonzero seeded ${k}, got ${c[k]}`);
  }
  assert.ok(c.subcollections.length > 0, `${label}: expected seeded subcollections`);
}

async function wipe(uid) {
  await db.recursiveDelete(db.collection("users").doc(uid));
  const [files] = await bucket.getFiles({ prefix: `plans/${uid}/` });
  const [files2] = await bucket.getFiles({ prefix: `viz/${uid}/` });
  await Promise.all([...files, ...files2].map((f) => f.delete()));
  await admin.auth().deleteUser(uid).catch(() => {});
}

// ---- source variants -----------------------------------------------------

// Compiles an edited copy of the deployed module in memory, at a filename
// inside functions/scripts/ so its own relative requires resolve unchanged.
// Nothing is written to disk.
function loadVariant(transform, tag) {
  const filename = path.join(ROOT, "functions", "scripts", `runSpaceMigration.${tag}.js`);
  const m = new Module(filename, null);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(transform(fs.readFileSync(DEPLOYED_SRC, "utf8")), filename);
  return m.exports;
}

// ---- tests ---------------------------------------------------------------

test("functions/scripts/runSpaceMigration.js is still a faithful copy of the canonical source", () => {
  const strip = (s) => s.replace(/\r\n/g, "\n").split("\n")
    .filter((l) => !l.startsWith("// GENERATED FILE - do not hand-edit")
      && !l.startsWith("// (also runs automatically before every")
      && !l.startsWith("// Canonical source:")).join("\n");
  assert.equal(strip(fs.readFileSync(DEPLOYED_SRC, "utf8")), strip(fs.readFileSync(CANONICAL_SRC, "utf8")),
    "the deployed copy has drifted from scripts/runSpaceMigration.js - edit the canonical source and rerun scripts/prepareFunctionsDeploy.js");
});

test("deletes the whole account, including nested descendants of miscellaneous subcollections", async (t) => {
  const uid = "hd-success-uid";
  const bystander = "hd-bystander-uid";
  t.after(async () => { await wipe(uid); await wipe(bystander); });

  await seedAccount(uid);
  await seedAccount(bystander);

  const before = await census(uid);
  const bystanderBefore = await census(bystander);
  assertSeedIsNonEmpty(before, "target before");
  assertSeedIsNonEmpty(bystanderBefore, "bystander before");

  const result = await hardDeleteAccountAdmin(db, uid);
  assert.equal(result.outcome, "hard-deleted", `outcome was ${result.outcome}: ${JSON.stringify(result)}`);
  assert.equal(result.otherSubcollections.failed, 0);
  assert.ok(result.otherSubcollections.documentsDeleted > 0);
  assert.equal(result.profileDocDeleted, true);
  assert.equal(result.authDeleted, true);

  const after = await census(uid);
  assert.deepEqual(after, NOTHING_LEFT, `something survived: ${JSON.stringify(after)}`);

  // Scope: the identically-shaped account next door is untouched.
  assert.deepEqual(await census(bystander), bystanderBefore, "a different user's data was affected");
});

test("mutation proof: the flat per-document delete this fix replaces leaves nested descendants behind", async (t) => {
  const uid = "hd-mutant-uid";
  t.after(async () => { await wipe(uid); });

  // The exact pre-fix line, restored.
  const mutant = loadVariant((src) => {
    const from = "await db.recursiveDelete(docRef);";
    assert.ok(src.includes(from), "the fixed call is missing from the source - this proof no longer proves anything");
    return src.replace(from, "await docRef.delete();");
  }, "__flat_delete_mutant__");

  await seedAccount(uid);
  const before = await census(uid);
  assertSeedIsNonEmpty(before, "mutant before");

  const result = await mutant.hardDeleteAccountAdmin(db, uid);

  // The defect exactly: it reports complete success...
  assert.equal(result.outcome, "hard-deleted");
  assert.equal(result.otherSubcollections.failed, 0);
  assert.equal(result.authDeleted, true);

  // ...while the descendants are still there.
  const after = await census(uid);
  assert.equal(after.profileDoc, false, "the mutant should still delete the profile doc");
  assert.equal(after.mergeCandidateHistory, before.mergeCandidateHistory,
    "mergeCandidates/{id}/history should have survived the flat delete");
  assert.equal(after.futureLevel1, before.futureLevel1, "the nested future collection should have survived");
  assert.equal(after.futureLevel2, before.futureLevel2, "the doubly-nested future collection should have survived");
  assert.notDeepEqual(after, NOTHING_LEFT);
});

test("a failed recursive delete is a content failure: no profile doc, no Auth deletion, and the retry still finds the wreckage", async (t) => {
  const uid = "hd-failure-uid";
  t.after(async () => { await wipe(uid); });

  await seedAccount(uid);
  const before = await census(uid);
  assertSeedIsNonEmpty(before, "failure before");

  // Reproduces recursiveDelete's own documented partial-failure semantics:
  // "the provided reference is deleted regardless of whether all deletes
  // succeeded", then the promise rejects. Injected through the db parameter
  // the function already takes, so nothing about the function changes.
  const failingDb = new Proxy(db, {
    get(target, prop) {
      if (prop === "recursiveDelete") {
        return async (ref) => {
          if (ref.path.includes("/mergeCandidates/")) {
            await ref.delete();                                      // parent gone
            throw new Error("simulated descendant delete failure");   // history survives
          }
          return db.recursiveDelete(ref);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  const failed = await hardDeleteAccountAdmin(failingDb, uid);
  assert.equal(failed.outcome, "content-incomplete", `outcome was ${failed.outcome}`);
  assert.ok(failed.otherSubcollections.failed > 0, "the failure was not counted");
  assert.equal(failed.profileDocDeleted, false);
  assert.equal(failed.authDeleted, false);

  const mid = await census(uid);
  assert.equal(mid.profileDoc, true, "users/{uid} must survive a content failure - it is the retry handle");
  assert.equal(mid.authExists, true, "the Auth account must survive a content failure - Auth is deleted last");
  assert.equal(mid.mergeCandidateHistory, before.mergeCandidateHistory, "the descendants should have survived");

  // Why the sweep enumerates with listDocuments() and not get(): the parent
  // document is gone, so a get()-based sweep sees an empty collection and
  // would report success over surviving data.
  const candidates = db.collection("users").doc(uid).collection("mergeCandidates");
  assert.equal((await candidates.get()).size, 0, "the parent document should be gone");
  assert.ok((await candidates.listDocuments()).length > 0, "listDocuments must still surface the phantom parent");

  // The retry, unmodified, against exactly that state.
  const retried = await hardDeleteAccountAdmin(db, uid);
  assert.equal(retried.outcome, "hard-deleted", `retry outcome was ${retried.outcome}: ${JSON.stringify(retried)}`);
  assert.deepEqual(await census(uid), NOTHING_LEFT, "the retry did not finish the job");
});

test("re-running against an already-deleted uid is a no-op", async (t) => {
  const uid = "hd-idempotent-uid";
  t.after(async () => { await wipe(uid); });

  await seedAccount(uid);
  assertSeedIsNonEmpty(await census(uid), "idempotence before");

  assert.equal((await hardDeleteAccountAdmin(db, uid)).outcome, "hard-deleted");
  const second = await hardDeleteAccountAdmin(db, uid);
  assert.equal(second.outcome, "hard-deleted");
  assert.equal(second.otherSubcollections.documentsDeleted, 0);
  assert.equal(second.profileDocDeleted, false, "there was no profile doc left to delete");
  assert.deepEqual(await census(uid), NOTHING_LEFT);
});
