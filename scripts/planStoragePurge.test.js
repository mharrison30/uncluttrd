// Tests for functions/planStoragePurge.js - pass 3 of cleanupExpiredDeletions.
//
//   node --test scripts/planStoragePurge.test.js
//
// No emulator, no network, no credentials. Firestore and the Storage bucket are
// small in-memory fakes; the Storage deletion itself is the REAL
// deleteStoragePrefixesAdmin the hard-delete engine uses, so the prefix and
// folder-boundary behaviour under test is the production behaviour.
//
// Lives in the root scripts/ directory, not functions/, so it is never
// uploaded with a functions deploy.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  purgeExpiredDeletedPlanStorage,
  planStoragePrefixes,
  referencesPlanStorage,
} = require(path.join(__dirname, "..", "functions", "planStoragePurge.js"));
const { deleteStoragePrefixesAdmin } = require(path.join(__dirname, "..", "functions", "scripts", "runSpaceMigration.js"));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 13, 3, 0, 0);
const BUCKET = "cluttrd-3e335.firebasestorage.app";

// ---- fakes ---------------------------------------------------------------

const ts = (ms) => ({ toMillis: () => ms });
const fieldValue = {
  serverTimestamp: () => ({ __op: "serverTimestamp" }),
  delete: () => ({ __op: "delete" }),
};

function makeDb(initial) {
  const store = new Map(Object.entries(initial).map(([p, d]) => [p, structuredCloneWithTs(d)]));
  const ops = [];

  function structuredCloneWithTs(d) {
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v]));
  }

  function docRef(p) {
    const segs = p.split("/");
    return {
      path: p,
      id: segs[segs.length - 1],
      parent: { parent: { id: segs[segs.length - 3] } },
      async get() {
        const data = store.get(p);
        return { exists: data !== undefined, id: segs[segs.length - 1], ref: docRef(p), data: () => (data ? { ...data } : undefined) };
      },
      async update(patch) {
        if (!store.has(p)) throw new Error(`NOT_FOUND ${p}`);
        const next = { ...store.get(p) };
        for (const [k, v] of Object.entries(patch)) {
          if (v && v.__op === "delete") delete next[k];
          else if (v && v.__op === "serverTimestamp") next[k] = ts(NOW);
          else next[k] = v;
        }
        store.set(p, next);
        ops.push({ op: "update", path: p, fields: Object.keys(patch) });
      },
      collection(name) { return collectionRef(`${p}/${name}`); },
    };
  }

  function snapOf(paths) {
    return { docs: paths.map((p) => ({ id: p.split("/").pop(), ref: docRef(p), data: () => ({ ...store.get(p) }) })) };
  }

  function collectionRef(p) {
    const depth = p.split("/").length + 1;
    return {
      doc(id) { return docRef(`${p}/${id}`); },
      async get() {
        return snapOf([...store.keys()].filter((k) => k.startsWith(`${p}/`) && k.split("/").length === depth));
      },
    };
  }

  return {
    store,
    ops,
    collection(name) { return collectionRef(name); },
    collectionGroup(name) {
      return {
        where(field, opr, value) {
          assert.equal(field, "deletedAt");
          assert.equal(opr, "<=");
          return {
            async get() {
              const cutoff = value.toMillis();
              return snapOf([...store.keys()].filter((k) => {
                const segs = k.split("/");
                const d = store.get(k);
                return segs[segs.length - 2] === name && d.deletedAt && d.deletedAt.toMillis() <= cutoff;
              }));
            },
          };
        },
      };
    },
  };
}

function makeBucket(names, { failOn = new Set() } = {}) {
  const files = new Set(names);
  return {
    files,
    async getFiles({ prefix }) {
      return [[...files].filter((n) => n.startsWith(prefix)).map((name) => ({
        name,
        async delete() {
          if (failOn.has(name)) throw new Error(`storage delete refused for ${name}`);
          files.delete(name);
        },
      }))];
    },
  };
}

function makeLogger() {
  const lines = { log: [], error: [] };
  return { lines, log: (m) => lines.log.push(m), error: (m) => lines.error.push(m) };
}

const downloadUrl = (objectPath) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=abc`;

function run(db, bucket, logger = makeLogger(), overrides = {}) {
  return purgeExpiredDeletedPlanStorage({
    db,
    bucket,
    deleteStoragePrefixes: deleteStoragePrefixesAdmin,
    fieldValue,
    timestampFromMillis: ts,
    retentionDays: 30,
    now: NOW,
    logger,
    ...overrides,
  });
}

// A realistic account: one expired soft-deleted plan (p1) with every kind of
// plan file, plus everything that must survive.
function scenario() {
  const db = makeDb({
    "users/u1/plans/p1": {
      retired: true, deletedAt: ts(NOW - 31 * DAY), title: "Hall closet",
      photoUrl: downloadUrl("plans/u1/p1/original.jpg"),
      progressPhotos: [{ url: downloadUrl("plans/u1/p1/progress/1700000000000.jpg") }],
      vizImages: { simple: downloadUrl("viz/u1/p1/simple_1700000000001.jpg") },
      areaId: "a1", canonicalSpaceId: "s1",
    },
    "users/u1/plans/p2": { retired: false, title: "Garage", photoUrl: downloadUrl("plans/u1/p2/original.jpg") },
    "users/u1/plans/p10": { retired: true, deletedAt: ts(NOW - 29 * DAY), photoUrl: downloadUrl("plans/u1/p10/original.jpg") },
    "users/u1/spaces/s1": { displayName: "Hall", latestPhotoUrl: downloadUrl("plans/u1/p1/original.jpg") },
    "users/u1/spaces/s1/areas/a1": {
      displayName: "Closet",
      originalPhotoUrl: downloadUrl("plans/u1/p1/original.jpg"),
      latestPhotoUrl: downloadUrl("plans/u1/p2/original.jpg"),
    },
    "users/u2/plans/p1": { retired: false, photoUrl: downloadUrl("plans/u2/p1/original.jpg") },
    "users/u2/spaces/s9/areas/a9": { originalPhotoUrl: downloadUrl("plans/u2/p1/original.jpg") },
  });
  const bucket = makeBucket([
    // p1 - every plan-specific path; all must go
    "plans/u1/p1/original.jpg",
    "plans/u1/p1/progress/1700000000000.jpg",
    "plans/u1/p1/progress/1700000000500.jpg",
    "viz/u1/p1/simple_1700000000001.jpg",
    "viz/u1/p1/polished_1700000000002.jpg",
    // must survive
    "plans/u1/p10/original.jpg",            // prefix collision with p1, and not yet expired
    "viz/u1/p10/simple_1700000000003.jpg",
    "plans/u1/p2/original.jpg",             // live plan
    "plans/u2/p1/original.jpg",             // same planId, different user
    "viz/u1/unsaved/simple_1700000000004.jpg", // not attributable to a plan
  ]);
  return { db, bucket };
}

// ---- tests ---------------------------------------------------------------

test("deletes every Storage object belonging to the expired plan", async () => {
  const { db, bucket } = scenario();
  const summary = await run(db, bucket);
  for (const gone of [
    "plans/u1/p1/original.jpg",
    "plans/u1/p1/progress/1700000000000.jpg",
    "plans/u1/p1/progress/1700000000500.jpg",
    "viz/u1/p1/simple_1700000000001.jpg",
    "viz/u1/p1/polished_1700000000002.jpg",
  ]) assert.equal(bucket.files.has(gone), false, `${gone} should be deleted`);
  assert.equal(summary.purged, 1);
  assert.equal(summary.failed, 0);
});

test("leaves every other Storage object untouched", async () => {
  const { db, bucket } = scenario();
  await run(db, bucket);
  assert.deepEqual([...bucket.files].sort(), [
    "plans/u1/p10/original.jpg",
    "plans/u1/p2/original.jpg",
    "plans/u2/p1/original.jpg",
    "viz/u1/p10/simple_1700000000003.jpg",
    "viz/u1/unsaved/simple_1700000000004.jpg",
  ]);
});

test("keeps the plan document as a tombstone without dangling photo fields", async () => {
  const { db, bucket } = scenario();
  await run(db, bucket);
  const p1 = db.store.get("users/u1/plans/p1");
  assert.ok(p1, "plan document must still exist");
  assert.equal(p1.retired, true);
  assert.ok(p1.deletedAt, "deletedAt preserved");
  assert.ok(p1.storagePurgedAt, "storagePurgedAt marked");
  assert.equal(p1.title, "Hall closet", "non-photo fields preserved");
  assert.equal(p1.areaId, "a1");
  for (const f of ["photoUrl", "progressPhotos", "vizImages"]) assert.equal(f in p1, false, `${f} removed`);
});

test("nulls Room and Area photo fields that point at the purged files, and nothing else", async () => {
  const { db, bucket } = scenario();
  const summary = await run(db, bucket);
  const room = db.store.get("users/u1/spaces/s1");
  const area = db.store.get("users/u1/spaces/s1/areas/a1");
  assert.equal(room.latestPhotoUrl, null);
  assert.equal(area.originalPhotoUrl, null);
  assert.equal(area.latestPhotoUrl, downloadUrl("plans/u1/p2/original.jpg"), "reference to a live plan kept");
  assert.equal(db.store.get("users/u2/spaces/s9/areas/a9").originalPhotoUrl, downloadUrl("plans/u2/p1/original.jpg"), "other user untouched");
  assert.equal(summary.referencesCleared, 2);
});

test("does not purge a plan still inside its 30-day restore window", async () => {
  const { db, bucket } = scenario();
  await run(db, bucket);
  assert.ok(bucket.files.has("plans/u1/p10/original.jpg"));
  assert.equal(db.store.get("users/u1/plans/p10").storagePurgedAt, undefined);
  assert.ok(db.store.get("users/u1/plans/p10").photoUrl);
});

test("a restore between the query and the purge wins", async () => {
  const { db, bucket } = scenario();
  const realGroup = db.collectionGroup.bind(db);
  db.collectionGroup = (name) => ({
    where: (...args) => ({
      async get() {
        const snap = await realGroup(name).where(...args).get();
        // restorePlan: retired false, deletedAt removed - after the query ran
        const restored = { ...db.store.get("users/u1/plans/p1"), retired: false };
        delete restored.deletedAt;
        db.store.set("users/u1/plans/p1", restored);
        return snap;
      },
    }),
  });
  const summary = await run(db, bucket);
  assert.equal(summary.purged, 0);
  assert.equal(summary.skipped, 1);
  assert.ok(bucket.files.has("plans/u1/p1/original.jpg"), "restored plan keeps its photo");
  assert.ok(bucket.files.has("plans/u1/p1/progress/1700000000000.jpg"));
  assert.ok(bucket.files.has("viz/u1/p1/simple_1700000000001.jpg"));
});

test("a failure is logged, leaves no purge marker, and succeeds on the next run", async () => {
  const { db } = scenario();
  const failing = makeBucket(
    ["plans/u1/p1/original.jpg", "plans/u1/p1/progress/1700000000000.jpg", "viz/u1/p1/simple_1700000000001.jpg"],
    { failOn: new Set(["plans/u1/p1/progress/1700000000000.jpg"]) },
  );
  const logger = makeLogger();
  const first = await run(db, failing, logger);
  assert.equal(first.failed, 1);
  assert.equal(first.purged, 0);
  assert.equal(db.store.get("users/u1/plans/p1").storagePurgedAt, undefined, "no marker after failure");
  assert.ok(db.store.get("users/u1/plans/p1").photoUrl, "photo fields kept until the purge completes");
  assert.equal(logger.lines.error.length, 1);
  assert.match(logger.lines.error[0], /uid=u1 planId=p1 outcome=failed error=storage delete refused/);

  // Next day: the storage problem is gone.
  const healthy = makeBucket([...failing.files]);
  const second = await run(db, healthy);
  assert.equal(second.purged, 1);
  assert.equal(healthy.files.size, 0);
  assert.ok(db.store.get("users/u1/plans/p1").storagePurgedAt);
});

test("running again is a no-op for an already-purged plan", async () => {
  const { db, bucket } = scenario();
  await run(db, bucket);
  const opsAfterFirst = db.ops.length;
  const second = await run(db, bucket);
  assert.equal(second.purged, 0);
  assert.equal(second.alreadyPurged, 1);
  assert.equal(db.ops.length, opsAfterFirst, "no further writes");
});

test("ignores documents in collections named plans that are not users/{uid}/plans", async () => {
  const db = makeDb({ "archive/x/plans/p1": { retired: true, deletedAt: ts(NOW - 60 * DAY) } });
  const bucket = makeBucket(["plans/x/p1/original.jpg"]);
  const summary = await run(db, bucket);
  assert.equal(summary.skipped, 1);
  assert.ok(bucket.files.has("plans/x/p1/original.jpg"));
});

test("planStoragePrefixes names exactly the two plan folders", () => {
  assert.deepEqual(planStoragePrefixes("u1", "p1"), ["plans/u1/p1", "viz/u1/p1"]);
});

test("referencesPlanStorage recognises this plan's files and nothing else", () => {
  assert.equal(referencesPlanStorage(downloadUrl("plans/u1/p1/original.jpg"), "u1", "p1"), true);
  assert.equal(referencesPlanStorage(downloadUrl("plans/u1/p1/progress/1.jpg"), "u1", "p1"), true);
  assert.equal(referencesPlanStorage(downloadUrl("viz/u1/p1/simple_1.jpg"), "u1", "p1"), true);
  assert.equal(referencesPlanStorage(`gs://${BUCKET}/plans/u1/p1/original.jpg`, "u1", "p1"), true);
  assert.equal(referencesPlanStorage(downloadUrl("plans/u1/p10/original.jpg"), "u1", "p1"), false, "folder boundary");
  assert.equal(referencesPlanStorage(downloadUrl("plans/u2/p1/original.jpg"), "u1", "p1"), false, "other user");
  assert.equal(referencesPlanStorage(downloadUrl("viz/u1/unsaved/simple_1.jpg"), "u1", "p1"), false);
  assert.equal(referencesPlanStorage("https://example.com/%E0%A4%A", "u1", "p1"), false, "malformed escape");
  assert.equal(referencesPlanStorage(null, "u1", "p1"), false);
  assert.equal(referencesPlanStorage("", "u1", "p1"), false);
});
