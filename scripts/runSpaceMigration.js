#!/usr/bin/env node
/**
 * The Space migration runner (§12). Drives legacy plans to migration
 * completeness by calling checkMigrationCompleteness before
 * forceFullReprojection for every plan - never the reverse, and never
 * forceFullReprojection alone - so a plan already migrated is never
 * rewritten, and a migration attempt never has to guess whether a write
 * is about to happen.
 *
 * Migration contract (SpaceMemoryModel.md §12):
 *   - plans remains authoritative throughout - this script only ever
 *     reads plans and writes spaces/**, exactly like every other shadow
 *     write path in the codebase.
 *   - Each plan is evaluated and acted on completely independently. No
 *     ordering dependency between users or plans, no shared state across
 *     iterations.
 *   - Restartable at any arbitrary point without requiring knowledge of
 *     previous runs (Restartability Principle, SpaceMemoryModel.md §12).
 *     No resume-from-checkpoint tracking, no "last processed" state, no
 *     migration ledger - re-running this script, in whole or from any
 *     point, against any subset of plans, in any order, is always safe.
 *     That safety comes from checkMigrationCompleteness being a real,
 *     freshly-evaluated read of current Firestore state every time, not
 *     from anything this script remembers between runs.
 *
 * Per-plan sequence: validate -> project -> validate.
 *   1. checkMigrationCompleteness(uid, planId) - already complete? skip,
 *      zero writes.
 *   2. Not complete (or --dry-run stops here and reports it): call
 *      forceFullReprojection(uid, planId).
 *   3. Re-run checkMigrationCompleteness to confirm the plan is now
 *      actually complete - forceFullReprojection succeeding is not
 *      itself treated as sufficient; the same independent check that
 *      decided work was needed is what confirms it was done correctly.
 *
 * source-plan-missing is NOT a failure. syncPlanToSpaceGraph and
 * forceFullReprojection both already treat a plan deleted between being
 * read and being acted on as a normal, deliberate, zero-write terminal
 * outcome (see App.js) - a plan can legitimately be deleted between this
 * script listing it and actually reaching it in the loop. This script
 * must recognize that exact outcome value and report it as its own
 * "skipped-source-plan-missing" category, distinct from "failed", which
 * is reserved for actually-thrown exceptions (network errors, permission
 * errors, malformed data) that warrant investigation.
 *
 * One plan's failure never halts the run for others - each plan is
 * wrapped in its own try/catch; the loop always continues.
 *
 * Part 2: merge-candidate detection (§12) runs as a second, genuinely
 * separate phase after structural migration - not folded into
 * checkMigrationCompleteness/forceFullReprojection, which keep their
 * exact existing single-plan contract, untouched. Detection is
 * per-USER (Tier 1 clustering compares a user's plans against each
 * other), not per-plan, so it doesn't fit the same per-plan loop above.
 * It is wired to run automatically as part of the same top-level
 * invocation below (so an operator never has to remember a manual
 * second step), but is independently callable/re-runnable on its own
 * via --detect-only, and --structural-only skips it entirely, so the
 * two phases stay observably distinct - a plan can be structurally
 * complete with detection never having run for its user, and that must
 * always be visible in this script's own two separate summary lines,
 * never collapsed into one.
 *
 * Usage:
 *   node scripts/runSpaceMigration.js --uid=<uid> --planId=<planId> [--dry-run]
 *   node scripts/runSpaceMigration.js --uid=<uid> [--dry-run] [--structural-only|--detect-only]
 *   node scripts/runSpaceMigration.js --all [--dry-run] [--structural-only|--detect-only] [--project=<projectId>]
 *
 * Requires Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS
 * pointing at a service account with Firestore read/write access.
 */

const admin = require("firebase-admin");
const {
  computeShadowIds, computeShadowBatchId, deriveFullReprojectionDocs, computeRoomSummaryFields, computeAreaSummaryFields, evaluateMigrationCompleteness, MIGRATION_VERSION,
  detectMergeCandidates, evaluateCandidateInvalidation, DETECTION_VERSION,
  computeMergeCandidateId, CANDIDATE_KEY_VERSION, getSpaceDisplayName, SHADOW_SCHEMA_VERSION,
  validateTargetSpace, resolveRecognitionCandidates, resolveSessionScope,
} = require("../shared/spaceMigration");

// ---- My Rooms -> True Room Grouping, Phase A: Room summary maintenance
// (Admin-SDK mirror of App.js's updateSpaceRoomSummary - 1:1 same
// idempotency contract: recomputes every summary field fresh from the
// actual Project documents every call, never increments anything. See
// the client function's own comment for the full reasoning.) ----
// Mirrors App.js's updateSpaceRoomSummary 1:1, including the Phase C1
// retired-Area exclusion - see that function's own comment for the full
// reasoning.
async function updateSpaceRoomSummaryAdmin(db, uid, spaceId) {
  try {
    const [projectsSnap, areasSnap] = await Promise.all([
      db.collection("users").doc(uid).collection("spaces").doc(spaceId).collection("projects").get(),
      db.collection("users").doc(uid).collection("spaces").doc(spaceId).collection("areas").get(),
    ]);
    const retiredAreaIds = new Set(areasSnap.docs.filter((d) => d.data().retired).map((d) => d.id));
    const liveProjects = projectsSnap.docs.map((d) => d.data()).filter((p) => !p.areaId || !retiredAreaIds.has(p.areaId));
    const summary = computeRoomSummaryFields(liveProjects);
    await db.collection("users").doc(uid).collection("spaces").doc(spaceId).update(summary);
    return summary;
  } catch (e) {
    console.log(`[ROOM SUMMARY] update failed for space ${spaceId}: ${e.message}`);
    return null;
  }
}

// ---- Area Identity, Phase A (AreaIdentityDesign.md §2/§5/§11) - Admin-SDK
// mirrors of App.js's updateAreaSummary/createAreaForPlan/renameArea,
// 1:1 same contracts. See each client function's own comment for the
// full reasoning; not restated here. ----
async function updateAreaSummaryAdmin(db, uid, roomId, areaId) {
  try {
    const projectsSnap = await db.collection("users").doc(uid).collection("spaces").doc(roomId).collection("projects").get();
    const areaProjects = projectsSnap.docs.map((d) => d.data()).filter((p) => p.areaId === areaId);
    const summary = computeAreaSummaryFields(areaProjects);
    await db.collection("users").doc(uid).collection("spaces").doc(roomId).collection("areas").doc(areaId).update(summary);
    return summary;
  } catch (e) {
    console.log(`[AREA SUMMARY] update failed for area ${areaId} in room ${roomId}: ${e.message}`);
    return null;
  }
}

async function createAreaForPlanAdmin(db, uid, roomId, planId, areaName) {
  try {
    const planSnap = await db.collection("users").doc(uid).collection("plans").doc(planId).get();
    const photoUrl = planSnap.exists ? (planSnap.data().photoUrl || null) : null;
    const now = new Date().toISOString();
    const areaRef = await db.collection("users").doc(uid).collection("spaces").doc(roomId).collection("areas").add({
      roomId,
      displayName: areaName || "Unnamed Area",
      createdAt: now,
      originalPhotoUrl: photoUrl,
      latestPhotoUrl: photoUrl,
      lastOrganizedAt: now,
      visitCount: 1,
      retired: false,
      redirectTo: null,
    });
    // Real-staging test finding (mirrors App.js's createAreaForPlan 1:1):
    // this plan's shadow Project was already written before this Area
    // existed (at savePlanToHistoryAdmin/writeSpaceShadowStructure time),
    // with areaId: null - updating the plan document alone does not fix
    // it. Bump shadowSourceVersion and re-sync so syncPlanToSpaceGraphAdmin
    // re-derives the Project from the plan's now-current areaId.
    // sessionScope written in the SAME update as areaId - mirrors App.js's
    // createAreaForPlan 1:1. savePlanToHistory{Admin} necessarily stamped
    // this plan "unresolved" moments ago (its Area did not exist yet), and
    // the two fields must never be observable in disagreement.
    await db.collection("users").doc(uid).collection("plans").doc(planId).update({ areaId: areaRef.id, sessionScope: "area", shadowSourceVersion: admin.firestore.FieldValue.increment(1) });
    await syncPlanToSpaceGraphAdmin(db, uid, planId);
    return areaRef.id;
  } catch (e) {
    console.log(`[AREA CREATE] failed for plan ${planId} in room ${roomId}: ${e.message}`);
    return null;
  }
}

async function renameAreaAdmin(db, uid, roomId, areaId, newName) {
  await db.collection("users").doc(uid).collection("spaces").doc(roomId).collection("areas").doc(areaId).update({ displayName: newName });
}

// ---- My Rooms -> True Room Grouping, rollout closeout item 1: existing-
// Space summary backfill ----
// Restartable, idempotent, no ledger and no checkpoint (Restartability
// Principle, SpaceMemoryModel.md §12 - same principle this file's own
// structural migration already commits to) - every Space is visited via a
// plain collectionGroup query, every visit recomputes its summary fresh
// from the actual current Project set via the exact same
// updateSpaceRoomSummaryAdmin/computeRoomSummaryFields every live
// mutation already uses, not a separate one-off computation. Re-running
// this against an already-backfilled Space (or the whole project) is
// therefore guaranteed to reproduce identical values unless the
// underlying Project data genuinely changed in between - there is no
// increment, no "have I already processed this" flag, nothing that could
// make a second run behave differently from the first for unchanged data.
//
// Retired Spaces are skipped, not backfilled - they don't appear in My
// Rooms (see loadRooms, App.js) and their own summary fields are
// meaningless once redirected; touching them would just be wasted writes
// against documents nothing reads for this purpose.
async function backfillRoomSummariesAdmin(db) {
  const spacesSnap = await db.collectionGroup("spaces").get();
  const results = { totalSpaces: spacesSnap.size, processed: 0, skippedRetired: 0, failed: 0 };
  for (const spaceDoc of spacesSnap.docs) {
    if (spaceDoc.data().retired === true) { results.skippedRetired++; continue; }
    const uid = spaceDoc.ref.parent.parent.id;
    const spaceId = spaceDoc.id;
    const summary = await updateSpaceRoomSummaryAdmin(db, uid, spaceId);
    if (summary) results.processed++; else results.failed++;
  }
  return results;
}

// ---- Phase C3 (DeletionDesign.md, "Recursive Storage cleanup"): the
// recursive Storage-prefix walk deletePlanAdmin now uses. ----
// GCS object keys are flat - there is no real directory hierarchy, so
// bucket.getFiles({prefix}) already returns EVERY object whose key starts
// with that prefix, at any nesting depth, in one call: original.jpg AND
// progress/{timestamp}.jpg under the same plans/{uid}/{planId}/ prefix
// both come back together, with no separate walk needed for the
// progress/ "subfolder". This is categorically different from the client
// Storage SDK's listAll(), which partitions a single level into .items
// (this level's files only) and .prefixes (subfolders), and requires
// recursing into .prefixes to reach nested content - App.js's own
// deletePlan calls listAll() and only ever reads .items (App.js:6890-6895),
// which is the literal, still-open bug this phase's spec names: progress
// photos are never actually deleted by the client path today. That
// client-side fix is out of scope for this Admin-SDK-only phase (see the
// implementation report) - this function closes the equivalent gap for
// every Admin-SDK deletion path (hard-delete included) by construction,
// not by literally recursing the same way the client would have to.
// Throws (does not swallow) on any listing or delete failure - Invariant 2
// requires deletePlanAdmin's caller to be able to tell Storage cleanup
// genuinely completed.
async function deleteStoragePrefixesAdmin(bucket, prefixes) {
  for (const prefix of prefixes) {
    // Trailing slash matters: without it, "plans/uid/abc" would also match
    // a sibling "plans/uid/abc123/..." object by bare string-prefix
    // collision. Astronomically unlikely with random plan IDs, but free to
    // guard against and matches the client SDK's own folder-ref semantics.
    const [files] = await bucket.getFiles({ prefix: `${prefix}/` });
    await Promise.all(files.map((f) => f.delete()));
  }
}

// ---- My Rooms -> True Room Grouping, rollout closeout item 2: deletePlan
// summary maintenance (Admin-SDK mirror) ----
// Mirrors App.js's deletePlan + deleteSpaceShadowGraph, with two Phase C3
// (DeletionDesign.md/hard-delete Invariant 2) revisions from the original
// 1:1 mirror:
//
// 1. Storage cleanup now runs FIRST, before the Firestore plan doc is
//    touched, and THROWS on failure (never swallowed). This is a
//    deliberate reversal of App.js's own deletePlan ordering (Firestore
//    first, Storage best-effort after, explicitly accepting an orphaned
//    image as a low-stakes failure mode for that single-tap "delete from
//    My Plans" flow - see its own comment). Hard-delete needs the opposite
//    tradeoff: the plan document itself is this function's own restart
//    marker for its Storage cleanup. As long as it still exists, a retried
//    hardDeleteAreaAdmin's own `where("areaId","==",areaId)` query will
//    find it again and retry Storage cleanup. Delete the Firestore doc
//    FIRST and a failed Storage cleanup becomes permanently unreachable on
//    retry - nothing durable is left to requery by (see
//    DeletionDesign.md's own Addendum on this exact Storage-orphan gap).
//    This new ordering/throw behavior applies to every caller, not just
//    hard-delete - "This applies to ALL plan deletions going forward."
// 2. `{ manageParentSpace = true }`: when false (hardDeleteAreaAdmin/
//    hardDeleteRoomAdmin's own usage), this function skips its own
//    "delete the Space if no sibling Projects remain" / summary-recompute
//    branch entirely. The Space (Room) document is the HARD-DELETE
//    ENGINE's own parent-last restart marker (Invariant 2) - it must be
//    removed exclusively by hardDeleteRoomAdmin's own explicit final step,
//    never as an incidental side effect of deleting whichever plan happens
//    to be a Room's last surviving Project mid-loop (which could delete
//    the Space early, before later Areas/plans in the same hard-delete run
//    have been processed - see the implementation report for the full
//    failure scenario this prevents). Every other caller (the original
//    single-plan "delete from My Plans" flow) keeps the original
//    auto-cleanup behavior, unchanged, as the default.
async function deletePlanAdmin(db, uid, planId, { manageParentSpace = true } = {}) {
  const userRef = db.collection("users").doc(uid);
  const planRef = userRef.collection("plans").doc(planId);
  const planSnap = await planRef.get();
  const canonicalSpaceId = planSnap.exists ? (planSnap.data().canonicalSpaceId || null) : null;
  // Area Identity, Phase A - mirrors App.js's deletePlan 1:1.
  const deletedPlanAreaId = planSnap.exists ? (planSnap.data().areaId || null) : null;

  // Requires the caller's admin.initializeApp() to have set storageBucket
  // (see scripts/seedMergeProposalTestData.js's own identical convention) -
  // admin.storage().bucket() with no args resolves to that configured
  // default bucket.
  const bucket = admin.storage().bucket();
  await deleteStoragePrefixesAdmin(bucket, [`plans/${uid}/${planId}`, `viz/${uid}/${planId}`]);

  await planRef.delete();

  const spaceId = canonicalSpaceId || planId;
  const spaceRef = userRef.collection("spaces").doc(spaceId);
  const projectRef = spaceRef.collection("projects").doc(planId);
  const sessionRef = projectRef.collection("sessions").doc(planId);
  const batchesSnap = await sessionRef.collection("batches").get();
  await Promise.all(batchesSnap.docs.map((d) => d.ref.delete()));
  await sessionRef.delete().catch(() => {});

  const siblingProjectsSnap = await spaceRef.collection("projects").get();
  const hasSiblingProjects = siblingProjectsSnap.docs.some((d) => d.id !== planId);
  await projectRef.delete().catch(() => {});

  let spaceDeleted = false;
  if (manageParentSpace) {
    if (!hasSiblingProjects) {
      await spaceRef.delete();
      spaceDeleted = true;
    } else {
      await updateSpaceRoomSummaryAdmin(db, uid, spaceId);
    }
    // Area Identity, Phase A - unconditional on spaceDeleted, mirrors
    // App.js's deletePlan 1:1 (see its own comment for why - the Area
    // document doesn't require its parent Space to still exist).
    if (deletedPlanAreaId) {
      await updateAreaSummaryAdmin(db, uid, spaceId, deletedPlanAreaId);
    }
  }
  return { outcome: "deleted", spaceDeleted, spaceId, areaId: deletedPlanAreaId };
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (raw === "--dry-run") { args.dryRun = true; continue; }
    if (raw === "--all") { args.all = true; continue; }
    if (raw === "--structural-only") { args.structuralOnly = true; continue; }
    if (raw === "--detect-only") { args.detectOnly = true; continue; }
    if (raw === "--backfill-room-summaries") { args.backfillRoomSummaries = true; continue; }
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

/** Read-only. Admin-SDK I/O shell around the shared evaluateMigrationCompleteness. */
async function checkMigrationCompletenessAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const planSnap = await userRef.collection("plans").doc(planId).get();
  if (!planSnap.exists) return { complete: false, reasons: ["source plan missing"] };
  const plan = planSnap.data();
  // §12 Migration Part 4: resolved from the plan just read, not bare
  // planId - see computeShadowIds, shared/spaceMigration.js.
  const { spaceId, projectId } = computeShadowIds(planId, plan);

  const spaceRef = userRef.collection("spaces").doc(spaceId);
  const projectRef = spaceRef.collection("projects").doc(projectId);
  const [spaceSnap, projectSnap] = await Promise.all([spaceRef.get(), projectRef.get()]);
  if (!spaceSnap.exists || !projectSnap.exists) {
    return { complete: false, reasons: ["Space or Project document missing"] };
  }

  const sessionsSnap = await projectRef.collection("sessions").get();
  const sessionsWithBatches = await Promise.all(sessionsSnap.docs.map(async (sDoc) => {
    const batchesSnap = await sDoc.ref.collection("batches").get();
    return { id: sDoc.id, data: sDoc.data(), batches: batchesSnap.docs.map((b) => ({ id: b.id, data: b.data() })) };
  }));

  return evaluateMigrationCompleteness(planId, plan, {
    space: spaceSnap.data(),
    project: projectSnap.data(),
    sessionsWithBatches,
  });
}

/**
 * Unconditional write. Admin-SDK I/O shell around the shared
 * deriveFullReprojectionDocs. Its only precondition is plan existence -
 * not a completeness judgment, the same as App.js's forceFullReprojection.
 * Returns { outcome: "source-plan-missing" } as a normal return value
 * when the plan is gone - never throws for that case.
 */
async function forceFullReprojectionAdmin(db, uid, planId) {
  const planRef = db.collection("users").doc(uid).collection("plans").doc(planId);
  const result = await db.runTransaction(async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) {
      return { outcome: "source-plan-missing" };
    }
    const plan = planSnap.data();
    const derived = deriveFullReprojectionDocs(planId, plan);
    const { spaceId, projectId } = derived.ids;
    const userRef = db.collection("users").doc(uid);
    const spaceRef = userRef.collection("spaces").doc(spaceId);
    const projectRef = spaceRef.collection("projects").doc(projectId);

    // Canonical Space Preservation - mirrors App.js's forceFullReprojection
    // 1:1: read before write (required inside a transaction), whether the
    // Space already exists decides which payload gets written.
    const spaceSnap = await tx.get(spaceRef);

    // Retirement guard (DeletionDesign.md Addendum/Phase C1) - mirrors
    // App.js's forceFullReprojection 1:1: a retired Space (merge tombstone
    // or soft-deleted) must never receive a fresh projection write.
    if (spaceSnap.exists && spaceSnap.data().retired === true) {
      console.log(`[FULL REPROJECTION ADMIN] refusing to write under retired Space ${spaceId} for plan ${planId}`);
      return { outcome: "target-retired", spaceId };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    if (spaceSnap.exists) {
      tx.set(spaceRef, { ...derived.spaceProjectionUpdate, syncedAt: now }, { merge: true });
    } else {
      tx.set(spaceRef, { ...derived.space, syncedAt: now });
    }
    tx.set(projectRef, { ...derived.project, syncedAt: now });
    let batchCount = 0;
    derived.sessions.forEach((session) => {
      const sessionRef = projectRef.collection("sessions").doc(session.id);
      tx.set(sessionRef, { ...session.data, syncedAt: now });
      session.batches.forEach((b) => {
        const batchRef = sessionRef.collection("batches").doc(b.id);
        tx.set(batchRef, { ...b.data, syncedAt: now });
        batchCount++;
      });
    });
    return { outcome: "written", sourceVersion: derived.sourceVersion, migrationVersion: MIGRATION_VERSION, sessionCount: derived.sessions.length, batchCount, spaceId, areaId: derived.project.areaId ?? null };
  });
  // My Rooms -> True Room Grouping, Phase A - mirrors App.js's own hook on
  // forceFullReprojection/syncPlanToSpaceGraph 1:1.
  if (result.outcome === "written") {
    await updateSpaceRoomSummaryAdmin(db, uid, result.spaceId);
    // Area Identity, Phase A - same hook, one level down.
    if (result.areaId) {
      await updateAreaSummaryAdmin(db, uid, result.spaceId, result.areaId);
    }
  }
  return result;
}

/**
 * Admin-SDK mirror of App.js's syncPlanToSpaceGraph (the live-mutation-sync
 * path every real app mutation - pause/completion/rename/next-batch/
 * retroactive-save - actually fires) - 1:1 same logic, not a stand-in.
 * Distinct from forceFullReprojectionAdmin above: this is the
 * VERSION-GUARDED incremental sync (collapses to exactly one Session,
 * no-ops if an already-current or newer shadow exists), not the
 * unconditional full-reprojection migration engine. Needed as its own
 * real mirror - not substituted with forceFullReprojectionAdmin - because
 * some staging tests (§12 Migration Part 4/5 full-lifecycle passes)
 * specifically need to exercise the exact live-sync path renameSpace and
 * every real Companion mutation actually use.
 */
async function syncPlanToSpaceGraphAdmin(db, uid, planId) {
  const planRef = db.collection("users").doc(uid).collection("plans").doc(planId);
  const result = await db.runTransaction(async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) return { outcome: "source-plan-missing" };
    const plan = planSnap.data();
    const planVersion = typeof plan.shadowSourceVersion === "number" ? plan.shadowSourceVersion : 1;

    // Migration/Live-Sync Projection Alignment (MigrationSyncAlignmentDesign.md):
    // mirrors App.js's real syncPlanToSpaceGraph 1:1 - the full graph
    // (multi-Session reconstruction, migrationVersion) is derived by the
    // same shared deriveFullReprojectionDocs forceFullReprojectionAdmin
    // uses, not a separate inline single-Session projection.
    const derived = deriveFullReprojectionDocs(planId, plan);
    const { spaceId, projectId } = derived.ids;
    const userRef = db.collection("users").doc(uid);
    const spaceRef = userRef.collection("spaces").doc(spaceId);
    const projectRef = spaceRef.collection("projects").doc(projectId);

    // Canonical Space Preservation - mirrors App.js's syncPlanToSpaceGraph
    // 1:1: both reads happen before any write, as every transaction
    // requires.
    const [spaceSnap, projectSnap] = await Promise.all([tx.get(spaceRef), tx.get(projectRef)]);

    // Retirement guard (DeletionDesign.md Addendum/Phase C1) - mirrors
    // App.js's syncPlanToSpaceGraph 1:1.
    if (spaceSnap.exists && spaceSnap.data().retired === true) {
      console.log(`[SPACE SHADOW SYNC ADMIN] refusing to write under retired Space ${spaceId} for plan ${planId}`);
      return { outcome: "target-retired", spaceId };
    }

    const existingVersion = projectSnap.exists && typeof projectSnap.data().sourceVersion === "number" ? projectSnap.data().sourceVersion : -1;
    if (existingVersion > planVersion) {
      return { outcome: "no-op", reason: "existing shadow already at or ahead of this plan version", existingVersion, planVersion };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    if (spaceSnap.exists) {
      tx.set(spaceRef, { ...derived.spaceProjectionUpdate, syncedAt: now }, { merge: true });
    } else {
      tx.set(spaceRef, { ...derived.space, syncedAt: now });
    }
    tx.set(projectRef, { ...derived.project, syncedAt: now });

    let batchCount = 0;
    derived.sessions.forEach((session) => {
      const sessionRef = projectRef.collection("sessions").doc(session.id);
      tx.set(sessionRef, { ...session.data, syncedAt: now });
      session.batches.forEach((batch) => {
        const batchRef = sessionRef.collection("batches").doc(batch.id);
        tx.set(batchRef, { ...batch.data, syncedAt: now });
        batchCount++;
      });
    });

    return { outcome: "written", sourceVersion: derived.sourceVersion, migrationVersion: MIGRATION_VERSION, sessionCount: derived.sessions.length, batchCount, spaceId, areaId: derived.project.areaId ?? null };
  });
  // My Rooms -> True Room Grouping, Phase A - mirrors App.js's own hook.
  if (result.outcome === "written") {
    await updateSpaceRoomSummaryAdmin(db, uid, result.spaceId);
    // Area Identity, Phase A - same hook, one level down.
    if (result.areaId) {
      await updateAreaSummaryAdmin(db, uid, result.spaceId, result.areaId);
    }
  }
  return result;
}

/**
 * Admin-SDK mirror of App.js's renameSpace - the authoritative
 * User-Managed Space Identity mutation (§12 Migration Part 3). Rollout
 * closeout item 3: mirrors App.js's renameSpace 1:1 - rename touches ONLY
 * Space.displayName now, never the plan's own spaceName (historical
 * metadata under the Phase A source-of-truth contract, including the
 * plan used to initiate the rename). shadowSourceVersion is still bumped
 * on the plan so syncPlanToSpaceGraphAdmin below performs a genuine
 * re-sync (not a no-op), which also keeps this Room's summary fields
 * current via the same updateSpaceRoomSummaryAdmin hook every other
 * mutation already uses.
 */
async function renameSpaceAdmin(db, uid, planId, newName) {
  const userRef = db.collection("users").doc(uid);
  const planRef = userRef.collection("plans").doc(planId);
  // Canonical Space Preservation - mirrors App.js's renameSpace 1:1: read
  // first to resolve canonicalSpaceId, write displayName directly on the
  // Space (user-owned, never through generic projection sync - see
  // deriveFullReprojectionDocs), then sync the Project layer separately.
  const planSnap = await planRef.get();
  const canonicalSpaceId = planSnap.exists ? planSnap.data().canonicalSpaceId : null;
  await planRef.update({ shadowSourceVersion: admin.firestore.FieldValue.increment(1) });
  const { spaceId } = computeShadowIds(planId, { canonicalSpaceId });
  await userRef.collection("spaces").doc(spaceId).update({ displayName: newName });
  const syncResult = await syncPlanToSpaceGraphAdmin(db, uid, planId);
  return { outcome: "renamed", planId, spaceName: newName, syncResult };
}

/**
 * Admin-SDK mirror of App.js's savePlanToHistory + buildShadowDocs +
 * writeSpaceShadowStructure (RememberedHomeDesign.md §3 / Implementation
 * Step 1) - 1:1 same logic, not a stand-in: same entry-field shape, same
 * validateTargetSpace check before any write, same display-name
 * inheritance, same "Space document write omitted entirely for a
 * returning visit" behavior. buildShadowDocs/writeSpaceShadowStructure are
 * App.js-local (not in shared/spaceMigration.js), so this mirrors their
 * bodies directly rather than importing them, same reasoning as
 * syncPlanToSpaceGraphAdmin above mirroring syncPlanToSpaceGraph. No photo
 * upload here (Storage upload is a client-SDK-only concern with no
 * Admin-SDK equivalent needed for these tests - photoUrl is accepted as an
 * already-known value instead, exactly like every other Admin-SDK test
 * harness this session has used).
 */
async function savePlanToHistoryAdmin(db, uid, plan, { canonicalSpaceId = null, photoUrl = null } = {}) {
  const userRef = db.collection("users").doc(uid);

  let inheritedSpaceName = null;
  if (canonicalSpaceId) {
    const targetSpaceSnap = await userRef.collection("spaces").doc(canonicalSpaceId).get();
    const validation = validateTargetSpace(targetSpaceSnap.exists ? targetSpaceSnap.data() : null);
    if (!validation.valid) {
      return { outcome: "invalid-target-space", planId: null, reason: validation.reason };
    }
    inheritedSpaceName = targetSpaceSnap.data().displayName || null;
  }

  const now = new Date().toISOString();
  const entry = {
    schemaVersion: 1,
    shadowSourceVersion: 1,
    createdAt: now,
    date: new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    // Room-First Identity Phase A/C - mirrors App.js's savePlanToHistory
    // 1:1: spaceType sourced from suggestedRoomName (the AI no longer
    // returns a flat spaceType field), areaName/areaScope from the
    // CONFIRMED result (Phase C's confirmedPlan construction), spaceName
    // written directly for a new Room too (not just inherited on a
    // returning visit) when the caller explicitly provides it.
    spaceType: plan.suggestedRoomName,
    areaName: plan.areaName !== undefined ? plan.areaName : (plan.suggestedAreaName ?? null),
    areaScope: plan.areaScope ?? null,
    // Area Identity, Phase A - mirrors App.js's savePlanToHistory 1:1:
    // always written, null (not absent) unless the caller explicitly
    // supplies a real Area id.
    areaId: plan.areaId !== undefined ? plan.areaId : null,
    // Session Scope - mirrors App.js's savePlanToHistory 1:1. Derived from
    // exactly the two values written immediately above, via the same
    // shared pure resolveSessionScope the client calls, so a plan created
    // here and a plan created in the app can never be classified by two
    // different rules.
    sessionScope: resolveSessionScope({
      areaId: plan.areaId !== undefined ? plan.areaId : null,
      areaScope: plan.areaScope ?? null,
    }),
    ...(canonicalSpaceId
      ? { canonicalSpaceId, spaceName: inheritedSpaceName }
      : (plan.spaceName ? { spaceName: plan.spaceName } : {})),
    overview: plan.overview || "test",
    itemsFound: plan.itemsFound || [],
    tiers: plan.tiers || [],
    proTip: plan.proTip || "test",
    vizImages: {},
    currentBatch: Array.isArray(plan.firstActionBatch) && plan.firstActionBatch.length ? {
      batchIndex: 1,
      suggestedAt: now,
      items: plan.firstActionBatch.filter((t) => typeof t === "string" && t.trim()).map((text, i) => ({ id: `seed-item-${i}`, text, status: "pending" })),
    } : null,
    batchHistory: [],
    progressPhotos: [],
    ...(photoUrl ? { photoUrl } : {}),
  };

  const planRef = await userRef.collection("plans").add(entry);
  const planId = planRef.id;

  // ---- buildShadowDocs, mirrored ----
  // Delegates to deriveFullReprojectionDocs, the same shared derivation
  // forceFullReprojectionAdmin/syncPlanToSpaceGraphAdmin already use -
  // see App.js's buildShadowDocs (same fix, same reasoning) for why this
  // replaced this function's own former inline single-Session shape.
  const derived = deriveFullReprojectionDocs(planId, { ...entry, photoUrl: photoUrl || entry.photoUrl || null });
  const isReturningVisit = !!entry.canonicalSpaceId;
  const shadow = {
    ids: derived.ids,
    space: isReturningVisit ? null : derived.space,
    project: derived.project,
    sessions: derived.sessions,
  };

  // ---- writeSpaceShadowStructure, mirrored ----
  const { spaceId, projectId } = shadow.ids;
  const batch = db.batch();
  if (shadow.space) {
    batch.set(userRef.collection("spaces").doc(spaceId), shadow.space);
  }
  const projectRef = userRef.collection("spaces").doc(spaceId).collection("projects").doc(projectId);
  batch.set(projectRef, shadow.project);
  for (const session of shadow.sessions) {
    const sessionRef = projectRef.collection("sessions").doc(session.id);
    batch.set(sessionRef, session.data);
    for (const b of session.batches) {
      batch.set(sessionRef.collection("batches").doc(b.id), b.data);
    }
  }
  await batch.commit();

  // My Rooms -> True Room Grouping, Phase A - mirrors App.js's own hook on
  // writeSpaceShadowStructure.
  await updateSpaceRoomSummaryAdmin(db, uid, spaceId);
  // Area Identity, Phase A - same hook, one level down.
  if (entry.areaId) {
    await updateAreaSummaryAdmin(db, uid, spaceId, entry.areaId);
  }

  return { outcome: "created", planId, spaceId, canonicalSpaceId: entry.canonicalSpaceId || null, areaId: entry.areaId || null };
}

/**
 * Admin-SDK mirror of App.js's findRecognitionCandidates - 1:1 same logic:
 * cache-first (a caller-supplied plain array standing in for the client's
 * `history` state), targeted two-query fallback only on a cache miss, both
 * calls delegating the actual resolve/dedupe/cap/sort work to the shared
 * pure resolveRecognitionCandidates - not a second implementation of it.
 */
async function findRecognitionCandidatesAdmin(db, uid, freshLabel, cachedPlans) {
  if (!freshLabel) return [];
  const cacheCandidates = resolveRecognitionCandidates(freshLabel, cachedPlans || []);
  if (cacheCandidates.length) return cacheCandidates;

  const plansRef = db.collection("users").doc(uid).collection("plans");
  const [byType, byName] = await Promise.all([
    plansRef.where("spaceType", "==", freshLabel).get(),
    plansRef.where("spaceName", "==", freshLabel).get(),
  ]);
  const merged = new Map();
  [...byType.docs, ...byName.docs].forEach((d) => {
    if (!merged.has(d.id)) merged.set(d.id, { id: d.id, data: d.data() });
  });
  return resolveRecognitionCandidates(freshLabel, [...merged.values()]);
}

/**
 * Admin-SDK mirror of App.js's carryForwardUnresolvedItems - 1:1 same
 * logic: literal text carry-over onto the new plan's own currentBatch,
 * placed first, ahead of the AI's fresh suggestions.
 */
async function carryForwardUnresolvedItemsAdmin(db, uid, planId, unresolvedItemTexts) {
  if (!unresolvedItemTexts || !unresolvedItemTexts.length) return { outcome: "no-op" };
  const planRef = db.collection("users").doc(uid).collection("plans").doc(planId);
  const snap = await planRef.get();
  if (!snap.exists || !snap.data().currentBatch) return { outcome: "no-op" };
  const carriedItems = unresolvedItemTexts.map((text, i) => ({ id: `carried-${i}-${planId}`, text, status: "carried" }));
  const updatedItems = [...carriedItems, ...(snap.data().currentBatch.items || [])];
  await planRef.update({ "currentBatch.items": updatedItems });
  return { outcome: "carried", itemCount: updatedItems.length };
}

/**
 * The per-plan migration contract: validate -> project -> validate.
 * Never throws - every failure path (thrown exception, or still-
 * incomplete after a real write) is caught and returned as its own
 * outcome, so the caller's loop never needs its own try/catch to keep
 * going.
 */
async function migratePlan(db, uid, planId, { dryRun }) {
  try {
    const before = await checkMigrationCompletenessAdmin(db, uid, planId);
    if (before.complete) {
      return { uid, planId, outcome: "skipped-already-complete" };
    }
    if (before.reasons.includes("source plan missing")) {
      // The plan doesn't exist at all - nothing to migrate, not a failure.
      return { uid, planId, outcome: "skipped-source-plan-missing" };
    }
    if (dryRun) {
      return { uid, planId, outcome: "would-migrate", reasons: before.reasons };
    }

    const result = await forceFullReprojectionAdmin(db, uid, planId);
    if (result.outcome === "source-plan-missing") {
      // The plan was deleted between the completeness check above and
      // this write attempt (a real race this script must tolerate, not
      // just the a-priori missing case caught earlier). syncPlanToSpaceGraph/
      // forceFullReprojection already treat this as a deliberate,
      // zero-write terminal outcome (see App.js) - reported here as its
      // own distinct category, never conflated with "failed".
      return { uid, planId, outcome: "skipped-source-plan-missing" };
    }

    const after = await checkMigrationCompletenessAdmin(db, uid, planId);
    if (!after.complete) {
      return { uid, planId, outcome: "failed", error: `still incomplete after forceFullReprojection: ${JSON.stringify(after.reasons)}` };
    }
    return { uid, planId, outcome: "migrated", sessionCount: result.sessionCount, batchCount: result.batchCount };
  } catch (e) {
    // A genuine failure - a thrown exception (network, permission,
    // malformed data). Never conflated with source-plan-missing above,
    // which is a normal return value, not a thrown error.
    return { uid, planId, outcome: "failed", error: e.message };
  }
}

/**
 * Part 2: admin-SDK I/O shell for one user's merge-candidate detection.
 * Reads all of that user's plans once, calls the pure detectMergeCandidates
 * for the current true Tier 1 clusters, then reconciles against whatever
 * mergeCandidates documents already exist - the same "compare fresh
 * reality against current stored state, no ledger" pattern migratePlan
 * already uses for structural completeness.
 *
 * RESTRUCTURED for content-derived keying (§12 Migration Part 3, Pass 1
 * - MergeProposalDesign.md Section 10). Candidate documents are no
 * longer keyed by `spaceType` alone - a single spaceType can now have
 * multiple, independently-addressed candidate documents coexisting (a
 * confirmed {A,B} and a pending {C,D} for the same "Kitchen" label are
 * two different documents, not one). Reconciliation therefore happens
 * per spaceType via a `.where("spaceType", "==", spaceType)` query, not
 * a single fixed-key `.get()`.
 *
 * RESTRUCTURED AGAIN for terminal supersession (§12 Migration Part 3,
 * Pass 2 - MergeProposalDesign.md's revised prerequisite). A candidate
 * document that ever had durable history is never physically deleted by
 * this reconciliation - all three former `.delete()` sites now write
 * `resolutionStatus: "superseded"`, `supersededAt`, and `supersededBy`
 * (the content-derived ID(s) of whatever document now represents this
 * spaceType's current reality, or `[]` if nothing currently does)
 * instead, preserving the document (and its history subcollection, if
 * any) in place at its original ID, forever queryable. "superseded" is
 * terminal, structurally identical in this loop to "stale-confirmed":
 * once superseded, always superseded, never re-evaluated by
 * evaluateCandidateInvalidation again.
 *
 * Corrected reconciliation algorithm, per spaceType (fixes a real gap in
 * the original design - see MergeProposalDesign.md Section 10's
 * "Correction" subsection):
 *   1. Compute the full raw cluster (detectMergeCandidates, unchanged).
 *   2. Query every existing candidate document for that spaceType.
 *   3. Run evaluateCandidateInvalidation (unchanged) against every
 *      "dismissed"/"confirmed-merge" document independently, against
 *      their OWN frozen planIds - exactly as before. "stale-confirmed"
 *      and "superseded" stay untouched (terminal); "pending" documents
 *      are handled in step 5 below, not here.
 *   4. Only a still-valid ("kept") "confirmed-merge" document's planIds
 *      are excluded from future pending eligibility - permanently, since
 *      that specific group is committed. A still-valid "dismissed"
 *      document's planIds are NOT excluded - dismissal means "this exact
 *      combination is not all the same," not "these plans are retired,"
 *      so its members remain eligible to be proposed again as part of a
 *      different combination (MergeProposalDesign.md Section 9's
 *      "pairwise, not global" requirement).
 *   5. The pending-eligible set = raw cluster minus excluded
 *      confirmed-merge members. If that set, taken exactly as-is,
 *      matches an existing "dismissed" document's planIds exactly (the
 *      identical combination), no new pending document is created for
 *      it - that exact question was already answered. Otherwise, if 2+
 *      plans remain, a pending document is upserted keyed by
 *      computeMergeCandidateId(spaceType, pendingEligibleSet); any
 *      existing pending document(s) whose ID no longer matches (because
 *      membership changed) are superseded, supersededBy the new ID. If
 *      fewer than 2 remain, any existing pending document for that
 *      spaceType is superseded with supersededBy: [] (the shrink-below-2
 *      case, unchanged in spirit from the original design, deletion-free
 *      now).
 *   6. Any "dismissed" document superseded in step 3 (its own frozen
 *      combination no longer entirely valid) is linked, via
 *      supersededBy, to whatever new pending document this same run
 *      produced for that spaceType, if any - not because that document
 *      is literally a "split" of the dismissed one, but because it is
 *      whatever now accurately represents this spaceType going forward.
 *      supersededBy is [] when nothing currently does.
 *
 * Never throws for an individual reconciliation decision - only for a
 * genuine Firestore I/O failure, which the caller (main()) catches per
 * user, exactly mirroring migratePlan's per-plan isolation.
 */
async function detectAndPersistMergeCandidatesForUser(db, uid, scopeSpaceTypes = null) {
  const userRef = db.collection("users").doc(uid);
  const plansSnap = await userRef.collection("plans").get();
  const allPlans = plansSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  // Phase C1 (DeletionDesign.md item 5): detectMergeCandidates is pure and
  // plan-only - it has no way to know a plan's canonical Space is
  // soft-deleted, since soft-delete deliberately never touches plans.
  // Exclude any plan whose canonical Space is currently retired (merge
  // tombstone OR soft-delete - either way, not a real candidate for a NEW
  // detection pass) before clustering, so a deleted Room's leftover plans
  // can never surface a proposal to merge them into (or with) a Room the
  // user just deleted.
  const spacesSnap = await userRef.collection("spaces").get();
  const retiredSpaceIds = new Set(spacesSnap.docs.filter((d) => d.data().retired).map((d) => d.id));
  const plans = allPlans.filter((p) => !retiredSpaceIds.has(computeShadowIds(p.id, p.data).spaceId));
  const currentPlansById = {};
  plans.forEach((p) => { currentPlansById[p.id] = p.data; });

  const currentClusters = detectMergeCandidates(plans);
  const currentBySpaceType = new Map(currentClusters.map((c) => [c.spaceType, c]));

  const candidatesRef = userRef.collection("mergeCandidates");

  // The full set of spaceTypes to reconcile: anything with a current raw
  // cluster, plus anything with any existing candidate document at all
  // (covers the shrink-below-2 / all-members-relabeled case, where the
  // raw cluster has disappeared but a stale document still needs
  // reconciling).
  const existingSnap = await candidatesRef.get();
  let spaceTypesToReconcile = new Set(currentBySpaceType.keys());
  existingSnap.docs.forEach((d) => spaceTypesToReconcile.add(d.data().spaceType));
  // Phase C3 (hard-delete Invariant 3): a caller that already knows exactly
  // which spaceTypes are affected - captured from a pre-deletion snapshot
  // of the merge-candidate documents that referenced the plans about to be
  // destroyed, via snapshotAffectedMergeCandidates below - can pass that
  // set here to restrict reconciliation to just those, instead of the
  // account's full spaceType set. Every full-account caller (main() below,
  // hardDeleteAreaAdmin/hardDeleteRoomAdmin's own callers if they ever want
  // a full sweep) passes nothing and is completely unaffected - default
  // behavior, unchanged.
  if (scopeSpaceTypes) {
    spaceTypesToReconcile = new Set([...spaceTypesToReconcile].filter((st) => scopeSpaceTypes.has(st)));
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const actions = [];

  for (const spaceType of spaceTypesToReconcile) {
    const existingForTypeSnap = await candidatesRef.where("spaceType", "==", spaceType).get();
    const existingForType = existingForTypeSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

    const rawCluster = currentBySpaceType.get(spaceType);
    const rawPlanIds = rawCluster ? rawCluster.planIds : [];

    const confirmedExcluded = new Set();
    const dismissedSets = [];
    const existingPending = [];
    const toSupersedeNoImmediateSuccessor = [];

    for (const { id, data } of existingForType) {
      if (data.resolutionStatus === "stale-confirmed" || data.resolutionStatus === "superseded") {
        actions.push({ spaceType, candidateId: id, action: data.resolutionStatus === "stale-confirmed" ? "kept-stale" : "kept-superseded" });
        continue;
      }
      if (data.resolutionStatus === "pending") {
        existingPending.push({ id, data });
        continue;
      }
      // "dismissed" or "confirmed-merge": checked for continued validity
      // against their OWN frozen planIds, not the freshly detected
      // cluster.
      const decision = evaluateCandidateInvalidation(data, currentPlansById);
      if (decision.action === "keep") {
        actions.push({ spaceType, candidateId: id, action: "kept-frozen-valid", resolutionStatus: data.resolutionStatus });
        if (data.resolutionStatus === "confirmed-merge") {
          data.planIds.forEach((pid) => confirmedExcluded.add(pid));
        } else if (data.resolutionStatus === "dismissed") {
          dismissedSets.push(new Set(data.planIds));
        }
      } else if (decision.action === "supersede") {
        // Resolved after pendingEligible/newPendingId are known below -
        // supersededBy depends on whether this run produces a successor.
        toSupersedeNoImmediateSuccessor.push(id);
        actions.push({ spaceType, candidateId: id, action: "pending-supersession", resolutionStatus: data.resolutionStatus });
      } else if (decision.action === "mark-stale") {
        await candidatesRef.doc(id).update({
          resolutionStatus: "stale-confirmed",
          staleReason: decision.staleReason,
          staleDetectedAt: now,
        });
        actions.push({ spaceType, candidateId: id, action: "marked-stale", staleReason: decision.staleReason });
      }
    }

    const pendingEligible = rawPlanIds.filter((pid) => !confirmedExcluded.has(pid)).sort();
    const exactlyDismissed = dismissedSets.some(
      (s) => s.size === pendingEligible.length && pendingEligible.every((pid) => s.has(pid))
    );

    let newPendingId = null;
    if (pendingEligible.length >= 2 && !exactlyDismissed) {
      newPendingId = computeMergeCandidateId(spaceType, pendingEligible);
      const alreadyCurrent = existingPending.find((p) => p.id === newPendingId);
      for (const p of existingPending) {
        if (p.id !== newPendingId) {
          await candidatesRef.doc(p.id).update({
            resolutionStatus: "superseded",
            supersededBy: [newPendingId],
            supersededAt: now,
          });
          actions.push({ spaceType, candidateId: p.id, action: "superseded-pending-replaced", supersededBy: [newPendingId] });
        }
      }
      if (!alreadyCurrent) {
        await candidatesRef.doc(newPendingId).set({
          tier: "1",
          spaceType,
          planIds: pendingEligible,
          candidateKeyVersion: CANDIDATE_KEY_VERSION,
          detectionVersion: DETECTION_VERSION,
          detectedAt: now,
          resolutionStatus: "pending",
          resolvedAt: null,
          staleReason: null,
          staleDetectedAt: null,
          supersededBy: null,
          supersededAt: null,
          splitFrom: null,
        });
        actions.push({ spaceType, candidateId: newPendingId, action: "created" });
      } else {
        actions.push({ spaceType, candidateId: newPendingId, action: "unchanged" });
      }
    } else {
      for (const p of existingPending) {
        await candidatesRef.doc(p.id).update({
          resolutionStatus: "superseded",
          supersededBy: [],
          supersededAt: now,
        });
        actions.push({ spaceType, candidateId: p.id, action: "superseded-pending-invalidated" });
      }
    }

    for (const id of toSupersedeNoImmediateSuccessor) {
      const supersededBy = newPendingId ? [newPendingId] : [];
      await candidatesRef.doc(id).update({
        resolutionStatus: "superseded",
        supersededBy,
        supersededAt: now,
      });
      actions.push({ spaceType, candidateId: id, action: "superseded-invalidated", supersededBy });
    }
  }

  return actions;
}

// ---- Phase C3: hard-delete engine (DeletionDesign.md's original Sections
// 1-3, now the background-cleanup/account-deletion implementation - see
// that doc's "Soft-Delete Revision" section). Admin-SDK only - never
// called from user-facing UI. Both functions are unconditional destroy
// primitives: neither checks/requires `retired`/`deletedAt` itself, since
// by the time either is invoked (the retention sweep's own cutoff query,
// or account deletion bypassing retention entirely) that decision has
// already been made by the caller - these two only ever answer "make it
// actually gone," never "should it be gone." ----

// Invariant 3 (snapshot before delete): given the exact set of plan IDs
// about to be hard-deleted, finds every mergeCandidates document that
// references at least one of them, captured BEFORE any deletion happens -
// so post-deletion reconciliation (detectAndPersistMergeCandidatesForUser's
// own scopeSpaceTypes param, above) never has to rediscover this join from
// plan/Area/Space data this same operation is about to destroy. Returns
// { candidateIds, spaceTypes } - candidateIds purely for
// logging/introspection/tests; spaceTypes is what reconciliation actually
// consumes, since candidates are reconciled per-spaceType, not per-id.
async function snapshotAffectedMergeCandidates(db, uid, planIds) {
  const candidateIds = [];
  const spaceTypes = new Set();
  if (!planIds || !planIds.length) return { candidateIds, spaceTypes };
  const planIdSet = new Set(planIds);
  const candidatesSnap = await db.collection("users").doc(uid).collection("mergeCandidates").get();
  candidatesSnap.docs.forEach((d) => {
    const data = d.data();
    if ((data.planIds || []).some((pid) => planIdSet.has(pid))) {
      candidateIds.push(d.id);
      spaceTypes.add(data.spaceType);
    }
  });
  return { candidateIds, spaceTypes };
}

/**
 * hardDeleteAreaAdmin(db, uid, roomId, areaId) - DeletionDesign.md Section
 * 1/2 "Delete Area", steps 3-5 (steps 1-2, establishing `retired`/
 * `deletionStatus`, belong to the soft-delete/sweep-selection layer, not
 * this primitive).
 *
 * Restartable/idempotent by construction, not by any stored checkpoint
 * (Restartability Principle, SpaceMemoryModel.md §12, same discipline this
 * whole file already commits to elsewhere): every call re-derives "what's
 * left" from a live query. An Area doc that's already gone (prior run
 * completed) is a no-op. An Area doc that's still present because a prior
 * run aborted partway through its plan loop (Invariant 2) is safe to
 * re-enter - step (a)'s own query naturally only finds whatever plans are
 * still actually there.
 */
async function hardDeleteAreaAdmin(db, uid, roomId, areaId) {
  const areaRef = db.collection("users").doc(uid).collection("spaces").doc(roomId).collection("areas").doc(areaId);
  const areaSnap = await areaRef.get();
  if (!areaSnap.exists) return { outcome: "already-deleted" };

  // a. Snapshot candidate plans by areaId, then verify Room ownership
  // (Invariant 1) - areaId alone is not sufficient authorization for
  // permanent deletion. A candidate plan whose OWN canonical Space
  // (computeShadowIds, the same resolution every other shadow function in
  // this file uses) doesn't actually resolve to roomId is left completely
  // untouched, not just skipped-with-a-warning.
  const candidateSnap = await db.collection("users").doc(uid).collection("plans").where("areaId", "==", areaId).get();
  const verifiedPlanIds = [];
  const skippedWrongRoomPlanIds = [];
  candidateSnap.docs.forEach((d) => {
    const plan = d.data();
    if (computeShadowIds(d.id, plan).spaceId === roomId) verifiedPlanIds.push(d.id);
    else skippedWrongRoomPlanIds.push(d.id);
  });

  // Invariant 3: captured now, from the verified set, before any plan is
  // touched.
  const { candidateIds: affectedCandidateIds, spaceTypes: affectedSpaceTypes } = await snapshotAffectedMergeCandidates(db, uid, verifiedPlanIds);

  // b/c. Delete each verified plan (Storage-first, throws on failure - see
  // deletePlanAdmin's own comment); abort immediately at the first failure
  // (Invariant 2) - the Area document remains exactly as-is, the restart
  // marker for a future retry. manageParentSpace:false - the parent Room
  // is hardDeleteRoomAdmin's own concern, never an incidental side effect
  // of an Area-level plan deletion (see deletePlanAdmin's own comment for
  // the specific failure scenario this avoids).
  let deletedPlanCount = 0;
  for (const planId of verifiedPlanIds) {
    try {
      await deletePlanAdmin(db, uid, planId, { manageParentSpace: false });
      deletedPlanCount++;
    } catch (e) {
      return { outcome: "failed", reason: "plan-delete-failed", planId, error: e.message, deletedPlanCount, areaId, roomId };
    }
  }

  // d. Reconcile from the Invariant-3 snapshot, not by rediscovering
  // references from data this function just destroyed.
  if (affectedSpaceTypes.size) {
    await detectAndPersistMergeCandidatesForUser(db, uid, affectedSpaceTypes);
  }

  // e. Recompute the parent Room's summary, if it still exists.
  // updateSpaceRoomSummaryAdmin already no-ops safely on its own (catches
  // internally, logs, returns null) against a Room that's mid-hard-delete
  // of its own or already gone - no existence check needed first.
  await updateSpaceRoomSummaryAdmin(db, uid, roomId);

  // f. Only now - every verified plan confirmed gone - remove the Area
  // document itself. Sole step that removes the restart marker.
  await areaRef.delete();
  return { outcome: "hard-deleted", deletedPlanCount, skippedWrongRoomPlanIds, affectedCandidateIds, roomId, areaId };
}

/**
 * hardDeleteRoomAdmin(db, uid, roomId) - DeletionDesign.md Section 1/2
 * "Delete Room", steps 3-6 (steps 1-2/7-8 - establishing `retired`/
 * `deletionStatus`, and the no-op confirmation that reclassification/merge
 * lineage is untouched - belong to the sweep-selection layer/are asserted
 * by Invariant 4 below, not implemented as code here).
 *
 * Same Restartability Principle as hardDeleteAreaAdmin above: a Space doc
 * that's already gone (prior run completed) is a no-op; one still present
 * because a prior run aborted mid-Area-loop resumes correctly, since every
 * enumeration step (Areas, whole-Room plans) is a live query against
 * whatever actually remains.
 *
 * Invariant 4 (inbound tombstone policy), stated explicitly per the task
 * spec: this function does NOT query for, walk, or touch any OTHER
 * Space/Area elsewhere whose `redirectTo` happens to point at this roomId
 * (or at an Area under it). Those are historical lineage from a PRIOR
 * merge/reclassification into this now-being-deleted Room - already
 * hidden from every user-facing surface via the existing `retired` filter,
 * regardless of whether their redirect target still exists (matches
 * DeletionDesign.md Section 4's "leave orphaned redirects as-is" decision
 * and this codebase's established "never physically delete audit trail"
 * convention for mergeCandidates/reclassificationExecutions). They remain,
 * with a now-dangling historical redirectTo, until account deletion (which
 * hard-deletes every Room the account owns, tombstones included, by
 * iterating every Space document directly rather than by following
 * redirects).
 */
async function hardDeleteRoomAdmin(db, uid, roomId) {
  const spaceRef = db.collection("users").doc(uid).collection("spaces").doc(roomId);
  const spaceSnap = await spaceRef.get();
  if (!spaceSnap.exists) return { outcome: "already-deleted" };

  // a. Load ALL Areas under this Room, including already-retired ones from
  // prior merges - they still have their own shadow data (Projects/
  // Sessions/Batches under whatever plans point at them) that needs the
  // same cleanup as any live Area's.
  const areasSnap = await spaceRef.collection("areas").get();
  const areaIds = areasSnap.docs.map((d) => d.id);

  // b. Snapshot every plan genuinely belonging to this Room - its own
  // founding plan (doc id === roomId, the computeShadowIds default when no
  // canonicalSpaceId is set) OR any plan whose canonicalSpaceId === roomId
  // - captured BEFORE any deletion, per Invariant 3, so post-deletion
  // merge-candidate reconciliation never has to rediscover this join from
  // data this very function is about to destroy.
  const [byCanonicalSnap, ownPlanSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("plans").where("canonicalSpaceId", "==", roomId).get(),
    db.collection("users").doc(uid).collection("plans").doc(roomId).get(),
  ]);
  const roomPlanDataById = new Map();
  byCanonicalSnap.docs.forEach((d) => roomPlanDataById.set(d.id, d.data()));
  if (ownPlanSnap.exists) roomPlanDataById.set(ownPlanSnap.id, ownPlanSnap.data());
  const allRoomPlanIds = [...roomPlanDataById.keys()];
  // Whole-Room visits (areaId: null) and legacy plans (areaId absent) -
  // the ones NOT covered by the per-Area loop below, since
  // hardDeleteAreaAdmin only ever queries plans by areaId.
  const wholeRoomPlanIds = allRoomPlanIds.filter((id) => !roomPlanDataById.get(id).areaId);

  const { candidateIds: affectedCandidateIds, spaceTypes: affectedSpaceTypes } = await snapshotAffectedMergeCandidates(db, uid, allRoomPlanIds);

  // c. Hard-delete every Area, via hardDeleteAreaAdmin as a sub-routine -
  // single source of truth for Area-deletion semantics, not reimplemented
  // inline. Abort immediately on the first failure - the Space document
  // (and any not-yet-processed Area) remains as the restart marker,
  // Invariant 2's parent-last rule one level up.
  for (const areaId of areaIds) {
    const areaResult = await hardDeleteAreaAdmin(db, uid, roomId, areaId);
    if (areaResult.outcome !== "hard-deleted" && areaResult.outcome !== "already-deleted") {
      return { outcome: "failed", reason: "area-delete-failed", areaId, areaResult, roomId };
    }
  }

  // d. Delete whatever plans remain directly under this Room - whole-Room
  // visits and legacy areaId-less plans, never touched by the per-Area
  // loop above. Same manageParentSpace:false reasoning as hardDeleteAreaAdmin.
  let deletedWholeRoomPlanCount = 0;
  for (const planId of wholeRoomPlanIds) {
    try {
      await deletePlanAdmin(db, uid, planId, { manageParentSpace: false });
      deletedWholeRoomPlanCount++;
    } catch (e) {
      return { outcome: "failed", reason: "plan-delete-failed", planId, error: e.message, deletedWholeRoomPlanCount, roomId };
    }
  }

  // e. Reconcile merge candidates from the Invariant-3 snapshot - this
  // pass specifically matters for candidates referencing whole-Room-visit
  // plans, which no per-Area reconciliation pass above would ever have
  // seen (each of those only scans plans by areaId). Also a harmless,
  // idempotent second pass over any spaceType an Area-level call already
  // reconciled.
  if (affectedSpaceTypes.size) {
    await detectAndPersistMergeCandidatesForUser(db, uid, affectedSpaceTypes);
  }

  // f. Only now - every child Area and every remaining plan confirmed
  // gone - remove the Space document itself. Sole step that removes the
  // restart marker. Tolerant of not-found: deletePlanAdmin's own
  // manageParentSpace:false calls above never touch this doc, but a
  // hypothetical stray external delete between step (a) and here is still
  // handled gracefully by Firestore's own delete-of-nonexistent-doc no-op.
  await spaceRef.delete();
  return { outcome: "hard-deleted", areaCount: areaIds.length, deletedWholeRoomPlanCount, affectedCandidateIds, roomId };
}

/**
 * hardDeleteAccountAdmin(db, uid) - Phase C5 (DeletionImplementation.md).
 * The final, top-level orchestration: deletes EVERYTHING for a uid,
 * bypassing soft-delete and retention entirely - an account deletion has
 * no retention window (DeletionDesign.md's own "Soft-Delete Revision" §4:
 * "there's no My Rooms left to show a Recently Deleted section in").
 * Reuses the Phase C3 engine (hardDeleteRoomAdmin/hardDeleteAreaAdmin/
 * deletePlanAdmin/deleteStoragePrefixesAdmin) for every actual deletion -
 * this function only orchestrates discovery/ordering/retry-safety around
 * calling them, exactly like Phase C4's runExpiredDeletionSweep one level
 * down.
 *
 * uid alone is sufficient identity - never assumes users/{uid} exists.
 * Firestore subcollections are never physically dependent on their parent
 * document existing, so every query below works identically for a genuine
 * "parentless" account (plans with no profile doc) - the real production
 * case this phase exists to close.
 *
 * Identity-last, content-gated: the same "parent-last with a gate"
 * principle Phase C3's Invariant 2 established for a single Room/Area,
 * applied one level up to the whole account. The users/{uid} profile doc
 * and the Firebase Auth account are removed ONLY after every content
 * phase (1 and 2) reports zero failures - if anything failed, this
 * function returns `{outcome: "content-incomplete", ...}` BEFORE touching
 * either, so uid remains a valid, rediscoverable retry point. A partial
 * failure can never strand content with no identity left to find it by.
 *
 * Restartable/idempotent by construction, not a stored checkpoint (the
 * same Restartability Principle this whole file already commits to
 * elsewhere): every phase re-derives "what's left" from a live query on
 * every call. Re-running against an already-fully-deleted uid is a
 * genuine no-op - every discovery query returns empty, and Phase 3's own
 * profile-doc-missing / Auth-account-missing cases are both already-
 * handled, non-error outcomes (the AUTH-LAST RETRY case: if content is
 * gone but a prior run's Auth deletion itself failed, re-running finds
 * zero content work left and retries just that one step).
 */
async function hardDeleteAccountAdmin(db, uid) {
  const userRef = db.collection("users").doc(uid);
  const bucket = admin.storage().bucket();
  const summary = {
    rooms: { discovered: 0, deleted: 0, failed: 0 },
    orphanPlans: { discovered: 0, deleted: 0, failed: 0 },
    orphanSpaces: { discovered: 0, deleted: 0, failed: 0 },
    orphanAreas: { discovered: 0, deleted: 0, failed: 0 },
    otherSubcollections: { collectionsProcessed: 0, documentsDeleted: 0, failed: 0 },
    storage: { failed: false },
    profileDocDeleted: false,
    authDeleted: false,
  };

  // ---- Phase 1: every known Room, retired or not. Soft-deleted Rooms
  // still inside their 30-day retention window, and merge/reclassification
  // tombstones, are BOTH included and BOTH permanently removed here -
  // account deletion bypasses the soft-delete/retention path entirely
  // (this phase's own explicit "BYPASS SOFT DELETE" rule; the user wants
  // everything gone, not retained for a restore that can no longer
  // happen once the account itself is gone).
  const spacesSnap = await userRef.collection("spaces").get();
  for (const spaceDoc of spacesSnap.docs) {
    summary.rooms.discovered++;
    try {
      const result = await hardDeleteRoomAdmin(db, uid, spaceDoc.id);
      if (result.outcome === "hard-deleted" || result.outcome === "already-deleted") summary.rooms.deleted++;
      else { summary.rooms.failed++; console.error(`[hardDeleteAccountAdmin] Room ${spaceDoc.id} (uid=${uid}) outcome=${result.outcome}: ${JSON.stringify(result)}`); }
    } catch (e) {
      summary.rooms.failed++;
      console.error(`[hardDeleteAccountAdmin] Room ${spaceDoc.id} (uid=${uid}) threw: ${e.message}`);
    }
  }

  // ---- Phase 2: uid-scoped orphan sweep - anything not reachable
  // through the Room graph (legacy data shapes, data created before the
  // current graph structure, or anything Phase 1 above failed to reach).

  // (a) Any plans not already cleaned up as part of a Room above - an
  // orphan with no matching Space/Project at all, the exact production
  // shape this phase exists to close. users/{uid}/plans is the ONLY place
  // a plan document has ever lived in this codebase's entire write path
  // (verified directly, not assumed - every savePlanToHistory{Admin} call
  // site writes there and nowhere else). A plain uid-scoped subcollection
  // query already catches every real orphan case; a collectionGroup("plans")
  // scan across every OTHER user's plans too would cost real read volume
  // for zero additional correctness in this schema - deliberately not
  // used here, unlike (c) below where a collection-group query is
  // genuinely necessary. Also correctly finds a parentless user's plans
  // regardless - Firestore subcollection queries never require the parent
  // document to exist.
  const remainingPlansSnap = await userRef.collection("plans").get();
  for (const planDoc of remainingPlansSnap.docs) {
    summary.orphanPlans.discovered++;
    try {
      await deletePlanAdmin(db, uid, planDoc.id, { manageParentSpace: false });
      summary.orphanPlans.deleted++;
    } catch (e) {
      summary.orphanPlans.failed++;
      console.error(`[hardDeleteAccountAdmin] orphan plan ${planDoc.id} (uid=${uid}) failed: ${e.message}`);
    }
  }

  // (b) Any Spaces Phase 1 missed or failed on - the identical query,
  // re-run; naturally empty in the common (fully-successful Phase 1) case.
  const remainingSpacesSnap = await userRef.collection("spaces").get();
  for (const spaceDoc of remainingSpacesSnap.docs) {
    summary.orphanSpaces.discovered++;
    try {
      const result = await hardDeleteRoomAdmin(db, uid, spaceDoc.id);
      if (result.outcome === "hard-deleted" || result.outcome === "already-deleted") summary.orphanSpaces.deleted++;
      else summary.orphanSpaces.failed++;
    } catch (e) {
      summary.orphanSpaces.failed++;
      console.error(`[hardDeleteAccountAdmin] orphan Space ${spaceDoc.id} (uid=${uid}) failed: ${e.message}`);
    }
  }

  // (c) Any Areas with no reachable parent Space at all - Phase 1 and (b)
  // above both iterate Spaces first, so an Area whose OWN parent Space is
  // somehow already gone (a genuine orphan) would never be visited by
  // either. Needs collectionGroup here (unlike (a) above) since Areas
  // don't have a single-level direct subcollection off users/{uid} to
  // query directly - scoped to this uid's own subtree via a document-path
  // range query (the standard Firestore technique for bounding a
  // collection-group query to one ancestor's descendants), not a
  // filtered full-project scan across every other user's Areas.
  const areasPathStart = `users/${uid}/spaces/\u0000`;
  const areasPathEnd = `users/${uid}/spaces/\uf8ff`;
  const remainingAreasSnap = await db.collectionGroup("areas")
    .where(admin.firestore.FieldPath.documentId(), ">=", areasPathStart)
    .where(admin.firestore.FieldPath.documentId(), "<", areasPathEnd)
    .get();
  for (const areaDoc of remainingAreasSnap.docs) {
    summary.orphanAreas.discovered++;
    const roomId = areaDoc.ref.parent.parent.id;
    try {
      const result = await hardDeleteAreaAdmin(db, uid, roomId, areaDoc.id);
      if (result.outcome === "hard-deleted" || result.outcome === "already-deleted") summary.orphanAreas.deleted++;
      else summary.orphanAreas.failed++;
    } catch (e) {
      summary.orphanAreas.failed++;
      console.error(`[hardDeleteAccountAdmin] orphan Area ${areaDoc.id} (room=${roomId}, uid=${uid}) failed: ${e.message}`);
    }
  }

  // (d) Every OTHER direct subcollection under users/{uid} - mergeCandidates,
  // reclassificationExecutions, mergeExecutions, analysisIdempotency,
  // revenueCatWebhookEvents (all confirmed real, existing subcollections
  // by direct code search - not a guess), and anything a future phase
  // adds. Generalized via listCollections() rather than a hardcoded name
  // list, deliberately: this phase's own test (a) requires "zero
  // documents in ANY subcollection," and a hardcoded list is exactly the
  // kind of thing that silently rots the next time a phase adds a new
  // one. "plans" and "spaces" are excluded here - already handled above
  // with their own real recursive cleanup; a flat per-document delete
  // here would leave a Space's own projects/areas/sessions/batches behind.
  try {
    const allCollections = await userRef.listCollections();
    for (const coll of allCollections) {
      if (coll.id === "plans" || coll.id === "spaces") continue;
      summary.otherSubcollections.collectionsProcessed++;
      const snap = await coll.get();
      for (const doc of snap.docs) {
        try {
          await doc.ref.delete();
          summary.otherSubcollections.documentsDeleted++;
        } catch (e) {
          summary.otherSubcollections.failed++;
          console.error(`[hardDeleteAccountAdmin] ${coll.id}/${doc.id} (uid=${uid}) failed: ${e.message}`);
        }
      }
    }
  } catch (e) {
    summary.otherSubcollections.failed++;
    console.error(`[hardDeleteAccountAdmin] listCollections (uid=${uid}) failed: ${e.message}`);
  }

  // (e) Storage: plans/{uid}/ and viz/{uid}/, a defensive backstop beyond
  // the per-plan cleanup already performed above - catches anything left
  // with a real Storage object but no Firestore doc left to drive
  // per-plan cleanup. Reuses the exact Phase C3 recursive-cleanup
  // primitive, not a second Storage walk.
  try {
    await deleteStoragePrefixesAdmin(bucket, [`plans/${uid}`, `viz/${uid}`]);
  } catch (e) {
    summary.storage.failed = true;
    console.error(`[hardDeleteAccountAdmin] Storage cleanup (uid=${uid}) failed: ${e.message}`);
  }

  const contentCleanupFailed = summary.rooms.failed > 0 || summary.orphanPlans.failed > 0 ||
    summary.orphanSpaces.failed > 0 || summary.orphanAreas.failed > 0 ||
    summary.otherSubcollections.failed > 0 || summary.storage.failed;

  if (contentCleanupFailed) {
    console.error(`[hardDeleteAccountAdmin] uid=${uid} content cleanup incomplete - profile doc and Auth account NOT touched. summary=${JSON.stringify(summary)}`);
    return { outcome: "content-incomplete", ...summary };
  }

  // ---- Phase 3: identity, last - only reached once every content phase
  // above reports zero failures. ----
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    await userRef.delete();
    summary.profileDocDeleted = true;
  }

  try {
    await admin.auth().deleteUser(uid);
    summary.authDeleted = true;
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      // Already gone - a prior run's Auth deletion already succeeded (the
      // AUTH-LAST RETRY case), or this uid never had a real Auth account.
      // Not a failure.
      summary.authDeleted = true;
    } else {
      console.error(`[hardDeleteAccountAdmin] uid=${uid} Auth deletion failed: ${e.message}`);
      return { outcome: "auth-delete-failed", ...summary };
    }
  }

  console.log(`[hardDeleteAccountAdmin] uid=${uid} COMPLETE. summary=${JSON.stringify(summary)}`);
  return { outcome: "hard-deleted", ...summary };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = args.project || "cluttrd-3e335";
  const dryRun = !!args.dryRun;
  const structuralOnly = !!args.structuralOnly;
  const detectOnly = !!args.detectOnly;

  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // Genuinely separate mode - operates over Spaces, not the plan/target
  // loop below, so it's handled before targets are even resolved.
  if (args.backfillRoomSummaries) {
    console.log(`Backfilling Room summary fields for every non-retired Space in ${projectId}...\n`);
    const result = await backfillRoomSummariesAdmin(db);
    console.log(`Total Spaces found: ${result.totalSpaces}`);
    console.log(`Processed: ${result.processed}`);
    console.log(`Skipped (retired): ${result.skippedRetired}`);
    console.log(`Failed: ${result.failed}`);
    process.exitCode = result.failed > 0 ? 1 : 0;
    return;
  }

  let targets = [];
  if (args.uid && args.planId) {
    targets = [{ uid: args.uid, planId: args.planId }];
  } else if (args.uid) {
    const plansSnap = await db.collection("users").doc(args.uid).collection("plans").get();
    targets = plansSnap.docs.map((d) => ({ uid: args.uid, planId: d.id }));
  } else if (args.all) {
    const plansSnap = await db.collectionGroup("plans").get();
    targets = plansSnap.docs.map((d) => ({ uid: d.ref.path.split("/")[1], planId: d.id }));
  } else {
    console.error("Usage: node runSpaceMigration.js --uid=<uid> [--planId=<planId>] [--dry-run] [--structural-only|--detect-only] | --all [--dry-run] [--structural-only|--detect-only] [--project=<projectId>]");
    process.exitCode = 1;
    return;
  }

  const distinctUids = [...new Set(targets.map((t) => t.uid))];
  let structuralFailures = 0;
  let detectionFailures = 0;

  // Phase 1: structural migration (validate -> project -> validate),
  // per plan. Sequential, not parallel - same "stay gentle on Firestore
  // quota" reasoning as repairSpaceShadowBatch (App.js) and the existing
  // validateSpaceMigration.js CLI. Each plan is fully independent, so
  // sequential execution is a pacing choice, not a correctness
  // requirement - restartability holds regardless of order or how many
  // plans are processed in a given run.
  if (!detectOnly) {
    console.log(`${dryRun ? "[DRY RUN] " : ""}Structural migration: processing ${targets.length} plan(s)...\n`);
    const structuralResults = [];
    for (const { uid, planId } of targets) {
      const r = await migratePlan(db, uid, planId, { dryRun });
      structuralResults.push(r);
      const extra = r.error ? ` - ${r.error}` : r.reasons ? ` - ${JSON.stringify(r.reasons)}` : "";
      console.log(`${r.outcome.toUpperCase().padEnd(28)} ${uid}/${planId}${extra}`);
    }
    const counts = structuralResults.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] || 0) + 1; return acc; }, {});
    structuralFailures = counts.failed || 0;
    const structuralComplete = structuralResults.filter((r) => r.outcome === "migrated" || r.outcome === "skipped-already-complete").length;
    console.log(`\nStructural: ${structuralComplete}/${structuralResults.length} complete. ${JSON.stringify(counts)}`);
  }

  // Phase 2: merge-candidate detection, per user - genuinely separate
  // from phase 1 (see the file header). Never skipped by default; only
  // --structural-only omits it, and --detect-only runs it alone.
  if (!structuralOnly) {
    console.log(`\nCandidate detection: processing ${distinctUids.length} user(s)...\n`);
    let usersCurrent = 0;
    for (const uid of distinctUids) {
      try {
        const actions = await detectAndPersistMergeCandidatesForUser(db, uid);
        usersCurrent++;
        console.log(`DETECTION-OK${" ".repeat(18)} ${uid} - ${JSON.stringify(actions)}`);
      } catch (e) {
        detectionFailures++;
        console.log(`DETECTION-FAILED${" ".repeat(14)} ${uid} - ${e.message}`);
      }
    }
    console.log(`\nCandidate detection: ${usersCurrent}/${distinctUids.length} users current.`);
  }

  process.exitCode = (structuralFailures > 0 || detectionFailures > 0) ? 1 : 0;
}

// Only run as a CLI when executed directly - when required as a module
// (real-staging tests), export the real functions for direct, precisely-
// orchestrated testing instead, without triggering main()'s own
// argv-parsing/process.exitCode side effects.
if (require.main === module) {
  main().catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 1;
  });
} else {
  module.exports = {
    checkMigrationCompletenessAdmin, forceFullReprojectionAdmin, migratePlan, detectAndPersistMergeCandidatesForUser,
    syncPlanToSpaceGraphAdmin, renameSpaceAdmin, savePlanToHistoryAdmin, findRecognitionCandidatesAdmin,
    carryForwardUnresolvedItemsAdmin, updateSpaceRoomSummaryAdmin, backfillRoomSummariesAdmin, deletePlanAdmin,
    updateAreaSummaryAdmin, createAreaForPlanAdmin, renameAreaAdmin,
    deleteStoragePrefixesAdmin, snapshotAffectedMergeCandidates, hardDeleteAreaAdmin, hardDeleteRoomAdmin,
    hardDeleteAccountAdmin,
  };
}
