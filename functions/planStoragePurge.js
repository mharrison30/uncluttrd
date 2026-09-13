"use strict";

// ---------------------------------------------------------------------------
// PLAN STORAGE PURGE - pass 3 of cleanupExpiredDeletions
// ---------------------------------------------------------------------------
// Deleting a plan in the app is a SOFT delete (App.js softDeletePlan): the plan
// document is marked retired + deletedAt, and every Storage object is left in
// place so the plan can be restored. Rooms and Areas have always been purged
// after their 30-day window by passes 1 and 2 of the sweep; individually
// deleted plans never were, so their photos were kept forever.
//
// This pass closes that gap on the SAME 30-day schedule, rather than deleting
// at tap time, because a restore experience exists: "Delete session" puts the
// plan in Recently Deleted, restorable for 30 days via restorePlan, and the
// "Delete visit" confirmation tells the user the same thing. Deleting the files
// immediately would break a restore the app has promised.
//
// For each soft-deleted plan older than the window:
//   1. Delete every Storage object under plans/{uid}/{planId}/ and
//      viz/{uid}/{planId}/, recursively - the saved original, Companion
//      progress photos (progress/ subfolder) and visualization images. Uses
//      the same deleteStoragePrefixesAdmin the hard-delete engine uses.
//   2. Null any Room or Area photo field still pointing at those files. An
//      Area's originalPhotoUrl is set once, from its first visit, and is never
//      recomputed - it is shown as a thumbnail fallback and downloaded as an
//      AI reference photo, so leaving it would point live data at a deleted
//      file.
//   3. Keep the plan document as a TOMBSTONE, marked storagePurgedAt, with its
//      now-dangling photoUrl / progressPhotos / vizImages fields removed.
//
// Why the document is kept rather than deleted: deletePlanAdmin (the hard
// delete) also tears down the parent Space when no sibling Projects remain.
// softDeletePlan has already removed this plan's Project, so running it here
// could delete a real, live Room because one of its sessions was deleted.
//
// FAILURES ARE RECOVERABLE: nothing is marked until all three steps succeed.
// A failure is logged and the plan is picked up again on the next daily run;
// every step is idempotent (a second Storage listing is simply empty).
//
// Not covered, because the file is not attributable to any plan:
// viz/{uid}/unsaved/, used when a visualization is generated before its plan
// has an id. Account deletion removes those with the rest of viz/{uid}/.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO_REFERENCE_FIELDS = ["originalPhotoUrl", "latestPhotoUrl"];

function planStoragePrefixes(uid, planId) {
  return [`plans/${uid}/${planId}`, `viz/${uid}/${planId}`];
}

// True when a stored URL points inside one of this plan's Storage folders.
// Handles Firebase download URLs (path percent-encoded after /o/) and gs://
// paths. The trailing slash is the folder boundary, so plan "abc" never
// matches plan "abc123".
function referencesPlanStorage(url, uid, planId) {
  if (typeof url !== "string" || url.length === 0) return false;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch (e) {
    // Malformed escape sequence: fall back to the raw string.
  }
  return planStoragePrefixes(uid, planId).some((prefix) => decoded.includes(`/${prefix}/`));
}

function millisOf(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  const parsed = typeof ts === "string" ? Date.parse(ts) : Number(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

async function clearPhotoReferences(db, uid, planId) {
  const cleared = [];
  const patchFor = (data) => {
    const patch = {};
    for (const field of PHOTO_REFERENCE_FIELDS) {
      if (referencesPlanStorage(data[field], uid, planId)) patch[field] = null;
    }
    return Object.keys(patch).length ? patch : null;
  };

  const spacesSnap = await db.collection("users").doc(uid).collection("spaces").get();
  for (const spaceDoc of spacesSnap.docs) {
    const spacePatch = patchFor(spaceDoc.data());
    if (spacePatch) {
      await spaceDoc.ref.update(spacePatch);
      cleared.push(`spaces/${spaceDoc.id}:${Object.keys(spacePatch).join(",")}`);
    }
    const areasSnap = await spaceDoc.ref.collection("areas").get();
    for (const areaDoc of areasSnap.docs) {
      const areaPatch = patchFor(areaDoc.data());
      if (areaPatch) {
        await areaDoc.ref.update(areaPatch);
        cleared.push(`spaces/${spaceDoc.id}/areas/${areaDoc.id}:${Object.keys(areaPatch).join(",")}`);
      }
    }
  }
  return cleared;
}

async function purgeExpiredDeletedPlanStorage({
  db,
  bucket,
  deleteStoragePrefixes,
  fieldValue,
  timestampFromMillis,
  retentionDays = 30,
  now = Date.now(),
  logger = console,
}) {
  const cutoffMs = now - retentionDays * DAY_MS;
  const summary = {
    discovered: 0,
    purged: 0,
    alreadyPurged: 0,
    skipped: 0,
    failed: 0,
    referencesCleared: 0,
  };
  const tag = "[cleanupExpiredDeletions]";

  const snap = await db.collectionGroup("plans").where("deletedAt", "<=", timestampFromMillis(cutoffMs)).get();
  for (const planDoc of snap.docs) {
    summary.discovered++;
    const segments = planDoc.ref.path.split("/");
    // Only users/{uid}/plans/{planId}. Anything else named "plans" is not ours.
    if (segments.length !== 4 || segments[0] !== "users" || segments[2] !== "plans") {
      summary.skipped++;
      logger.log(`${tag} Plan path=${planDoc.ref.path} outcome=skipped-unexpected-path`);
      continue;
    }
    const uid = segments[1];
    const planId = segments[3];

    try {
      // Re-read immediately before destroying anything: the query result can
      // be stale, and a restore in that window must win.
      const fresh = await planDoc.ref.get();
      const data = fresh.exists ? fresh.data() : null;
      const deletedAtMs = data ? millisOf(data.deletedAt) : null;
      if (!data || data.retired !== true || deletedAtMs === null || deletedAtMs > cutoffMs) {
        summary.skipped++;
        logger.log(`${tag} Plan uid=${uid} planId=${planId} outcome=skipped-not-expired-or-restored`);
        continue;
      }
      if (data.storagePurgedAt) {
        summary.alreadyPurged++;
        continue;
      }

      await deleteStoragePrefixes(bucket, planStoragePrefixes(uid, planId));
      const cleared = await clearPhotoReferences(db, uid, planId);
      await planDoc.ref.update({
        storagePurgedAt: fieldValue.serverTimestamp(),
        photoUrl: fieldValue.delete(),
        progressPhotos: fieldValue.delete(),
        vizImages: fieldValue.delete(),
      });

      summary.purged++;
      summary.referencesCleared += cleared.length;
      logger.log(`${tag} Plan uid=${uid} planId=${planId} outcome=storage-purged referencesCleared=${cleared.length}`);
    } catch (e) {
      summary.failed++;
      logger.error(`${tag} Plan uid=${uid} planId=${planId} outcome=failed error=${e.message}`);
    }
  }
  return summary;
}

module.exports = {
  purgeExpiredDeletedPlanStorage,
  planStoragePrefixes,
  referencesPlanStorage,
  clearPhotoReferences,
};
