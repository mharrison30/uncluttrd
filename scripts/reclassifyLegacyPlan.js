#!/usr/bin/env node
/**
 * Legacy Reclassification — Case B (Cross-Room Move).
 * Uncluttrd Core Documents/LegacyReclassificationDesign.md.
 *
 * Admin-SDK I/O shell around existing shared/spaceMigration.js primitives
 * and existing scripts/runSpaceMigration.js reprojection/completeness/
 * summary functions, mirroring scripts/executeMerge.js's own
 * Admin-SDK-shell-around-shared-pure-logic pattern exactly - this file is
 * structurally the same kind of operation (move a plan's canonical
 * identity, re-project its shadow, retire what's left behind, reconcile
 * merge candidates), just for one plan moving into an existing Room
 * instead of N plans consolidating into a survivor.
 *
 * Phases (LegacyReclassificationDesign.md §2), split into independently
 * callable, independently resumable functions:
 *
 *   1. claimReclassificationAdmin        - validate + idempotency + claim
 *      (one small, atomic transaction; captures oldSpaceId BEFORE any
 *      change).
 *   2. establishTargetProjectionAdmin    - write canonicalSpaceId/
 *      areaName/areaScope on the plan, then forceFullReprojectionAdmin to
 *      re-derive the shadow at the new (target) path. spaceType is never
 *      referenced by this write.
 *   3. validateTargetProjectionAdmin     - read-only gate before any old-
 *      Space mutation.
 *   4. cleanUpOldSpaceAdmin              - delete the old Project/Session/
 *      Batch subtree, then tombstone the old Space - UNLESS oldSpaceId
 *      === targetSpaceId (Case A: in-place reclassification), in which
 *      case this phase is a deliberate no-op. Never tombstones a Space or
 *      writes a self-redirect when source and target are identical.
 *   5. confirmSummariesAdmin             - re-confirm the target Room's
 *      summary (already recomputed as a side effect of Phase 2's
 *      forceFullReprojectionAdmin call - this phase makes that fact an
 *      independently-checked, explicitly-tracked completion rather than
 *      an assumed side effect).
 *   6. reconcileMergeCandidatesAdmin     - re-run evaluateCandidateInvalidation
 *      (unmodified) against every mergeCandidates doc referencing the
 *      moved plan. Never physically deletes a candidate.
 *   7. finalizeReclassificationAdmin     - status: "completed".
 *   reclassifyLegacyPlanAdmin            - orchestrator: runs whichever of
 *      the above hasn't happened yet, per reclassificationExecutions
 *      status. Safe to call repeatedly at any point (Restartability
 *      Principle, same as executeMergeAdmin).
 *
 * Requires Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS
 * pointing at a principal with Firestore read/write access to the target
 * project. Like executeMerge.js, --project= has NO default - refuses to
 * guess given the consequence of running against the wrong project.
 *
 * Usage:
 *   node scripts/reclassifyLegacyPlan.js --project=<projectId> --uid=<uid> --planId=<planId> \
 *     --targetSpaceId=<spaceId> --roomName="Living Room" --areaName="Entertainment Center" [--areaScope=sub-area]
 */

const admin = require("firebase-admin");
const {
  computeShadowIds, validateTargetSpace, evaluateCandidateInvalidation,
} = require("../shared/spaceMigration");
const { forceFullReprojectionAdmin, checkMigrationCompletenessAdmin, updateSpaceRoomSummaryAdmin } = require("./runSpaceMigration.js");

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

// ---- Phase 1: claim (validate target, idempotency, capture oldSpaceId) ----
async function claimReclassificationAdmin(db, uid, planId, request) {
  const { targetSpaceId, requestedRoomName, requestedAreaName, requestedAreaScope = "sub-area" } = request;
  const userRef = db.collection("users").doc(uid);
  const planRef = userRef.collection("plans").doc(planId);
  const targetSpaceRef = userRef.collection("spaces").doc(targetSpaceId);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);

  return db.runTransaction(async (tx) => {
    // All reads happen before any write, as every transaction requires.
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists) return { outcome: "plan-missing", planId };
    const plan = planSnap.data();

    const targetSpaceSnap = await tx.get(targetSpaceRef);
    const validation = validateTargetSpace(targetSpaceSnap.exists ? targetSpaceSnap.data() : null);
    if (!validation.valid) return { outcome: "invalid-target-space", planId, targetSpaceId, reason: validation.reason };

    const executionSnap = await tx.get(executionRef);

    const requestTuple = { targetSpaceId, requestedRoomName, requestedAreaName, requestedAreaScope };
    if (executionSnap.exists) {
      const execution = executionSnap.data();
      const tupleMatches = execution.targetSpaceId === targetSpaceId
        && execution.requestedRoomName === requestedRoomName
        && execution.requestedAreaName === requestedAreaName
        && execution.requestedAreaScope === requestedAreaScope;

      if (execution.status !== "completed" && execution.status !== "blocked") {
        if (tupleMatches) return { outcome: "resumed", planId, status: execution.status };
        return { outcome: "conflict", planId, reason: "a different reclassification is already in progress for this plan", inProgress: { targetSpaceId: execution.targetSpaceId, requestedRoomName: execution.requestedRoomName } };
      }
      if (execution.status === "completed" && tupleMatches) {
        return { outcome: "already-completed", planId, status: execution.status };
      }
      // blocked+matches (retry), blocked+differs (fresh), or completed+differs
      // (fresh, later correction) - all fall through to a fresh claim below.
    }

    // oldSpaceId is captured HERE, before anything changes it - the plan's
    // shadow location as it exists right now, whatever that is (self-owned
    // today; a previous reclassification's target, on a later re-run).
    const oldSpaceId = computeShadowIds(planId, plan).spaceId;
    const oldSpaceSnap = oldSpaceId === targetSpaceId ? targetSpaceSnap : await tx.get(userRef.collection("spaces").doc(oldSpaceId));
    const oldSpaceDisplayNameAtClaim = oldSpaceSnap.exists ? (oldSpaceSnap.data().displayName || null) : null;
    const targetSpaceDisplayNameAtClaim = targetSpaceSnap.data().displayName || null;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const attempt = executionSnap.exists ? (executionSnap.data().attempt || 1) + 1 : 1;

    tx.set(executionRef, {
      planId, oldSpaceId, targetSpaceId,
      requestedRoomName, requestedAreaName, requestedAreaScope,
      oldSpaceDisplayNameAtClaim, targetSpaceDisplayNameAtClaim,
      status: "claimed",
      blockedReasons: null,
      reconciledCandidateIds: [],
      attempt,
      claimedAt: now,
      completedAt: null,
    });

    return { outcome: "claimed", planId, oldSpaceId, targetSpaceId, attempt };
  });
}

// ---- Phase 2: establish the target projection ----
async function establishTargetProjectionAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);
  const executionSnap = await executionRef.get();
  if (!executionSnap.exists) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status !== "claimed") {
    // Idempotent: already past this point - return the already-recorded
    // status rather than recomputing, same pattern
    // selectSurvivorAndWriteCanonicalMappingAdmin uses.
    return { outcome: "already-established", planId, status: execution.status };
  }

  const planRef = userRef.collection("plans").doc(planId);
  const targetSpaceSnap = await userRef.collection("spaces").doc(execution.targetSpaceId).get();
  // spaceName is INHERITED from the target Space's current displayName,
  // not the raw requestedRoomName string - mirrors savePlanToHistory's
  // existing-visit inheritance rule exactly. spaceType is never referenced
  // here at all - not in this payload, so it cannot regress.
  const inheritedSpaceName = targetSpaceSnap.exists ? (targetSpaceSnap.data().displayName || null) : execution.requestedRoomName;

  await planRef.update({
    canonicalSpaceId: execution.targetSpaceId,
    spaceName: inheritedSpaceName,
    areaName: execution.requestedAreaName,
    areaScope: execution.requestedAreaScope,
    shadowSourceVersion: admin.firestore.FieldValue.increment(1),
  });

  // Reuses forceFullReprojectionAdmin unmodified - now resolves to the
  // target path since canonicalSpaceId was just updated. Also triggers
  // the existing updateSpaceRoomSummaryAdmin hook for the target Space -
  // that Room's summary is correct as a side effect, not a separate step.
  const reprojectResult = await forceFullReprojectionAdmin(db, uid, planId);
  if (reprojectResult.outcome === "source-plan-missing") {
    await executionRef.update({ status: "blocked", blockedReasons: ["source plan disappeared during reprojection"] });
    return { outcome: "blocked", planId, reason: "source plan disappeared during reprojection" };
  }
  // Retirement guard, narrow race window - mirrors App.js's
  // establishTargetProjection 1:1 (see its own comment for why this is a
  // race, not a normal path: claimReclassificationAdmin already rejects a
  // retired target at claim time).
  if (reprojectResult.outcome === "target-retired") {
    await executionRef.update({ status: "blocked", blockedReasons: ["target Space was retired during reprojection"] });
    return { outcome: "blocked", planId, reason: "target Space was retired during reprojection" };
  }

  await executionRef.update({ status: "target-established" });
  return { outcome: "established", planId, targetSpaceId: execution.targetSpaceId, reprojectResult };
}

// ---- Phase 3: validate the target projection (read-only) ----
async function validateTargetProjectionAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);
  const executionSnap = await executionRef.get();
  if (!executionSnap.exists) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status === "claimed") return { outcome: "target-not-yet-established", planId };
  if (execution.status !== "target-established") {
    return { outcome: "already-validated-or-later", planId, status: execution.status };
  }

  const completeness = await checkMigrationCompletenessAdmin(db, uid, planId);
  const projectSnap = await userRef.collection("spaces").doc(execution.targetSpaceId).collection("projects").doc(planId).get();
  const scopedCorrectly = projectSnap.exists && projectSnap.data().scopeId === execution.targetSpaceId;
  const reasons = [...completeness.reasons];
  if (!scopedCorrectly) reasons.push(`Project.scopeId does not equal target Space ${execution.targetSpaceId}`);

  if (reasons.length) {
    await executionRef.update({ status: "blocked", blockedReasons: reasons });
    return { outcome: "invalid", planId, reasons };
  }
  await executionRef.update({ status: "target-validated" });
  return { outcome: "valid", planId };
}

// ---- Phase 4: clean up the old Space (Case A guard lives here) ----
async function cleanUpOldSpaceAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);
  const executionSnap = await executionRef.get();
  if (!executionSnap.exists) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status === "claimed" || execution.status === "target-established") {
    return { outcome: "not-yet-validated", planId, status: execution.status };
  }
  if (execution.status !== "target-validated") {
    return { outcome: "already-cleaned-up-or-later", planId, status: execution.status };
  }

  // CASE A GUARD: source and target are the same Space - this is an
  // in-place reclassification (no existing different Room to move into).
  // Nothing is retired, no self-redirect is ever written. Checked BEFORE
  // any Space mutation below - this is the one explicit constraint the
  // implementation instruction called out by name.
  if (execution.oldSpaceId === execution.targetSpaceId) {
    await executionRef.update({ status: "old-space-cleaned-up" });
    return { outcome: "case-a-no-op", planId, reason: "oldSpaceId === targetSpaceId, nothing to retire" };
  }

  const oldSpaceRef = userRef.collection("spaces").doc(execution.oldSpaceId);
  const oldProjectRef = oldSpaceRef.collection("projects").doc(planId);

  async function delRec(ref) {
    const snap = await ref.get();
    for (const d of snap.docs) {
      for (const sub of await d.ref.listCollections()) await delRec(sub);
      await d.ref.delete();
    }
  }
  for (const sub of await oldProjectRef.listCollections()) await delRec(sub);
  await oldProjectRef.delete().catch(() => {});

  const siblingProjectsSnap = await oldSpaceRef.collection("projects").get();
  const hasSiblingProjects = siblingProjectsSnap.docs.some((d) => d.id !== planId);

  let spaceRetired = false;
  if (!hasSiblingProjects) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    // Tombstone, not hard-delete - same shape retireLosingSpacesAdmin
    // already writes. Preserves the old Space's own original displayName
    // forever (merge, not overwrite) for lineage.
    await oldSpaceRef.set({
      retired: true,
      redirectTo: execution.targetSpaceId,
      retiredAt: now,
      reclassificationExecutionId: planId,
    }, { merge: true });
    spaceRetired = true;
  } else {
    // Defensive - should not happen for a genuinely self-owned legacy
    // plan, but handled rather than assumed away.
    await updateSpaceRoomSummaryAdmin(db, uid, execution.oldSpaceId);
  }

  await executionRef.update({ status: "old-space-cleaned-up" });
  return { outcome: "cleaned-up", planId, oldSpaceId: execution.oldSpaceId, spaceRetired };
}

// ---- Phase 5: confirm summaries ----
async function confirmSummariesAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);
  const executionSnap = await executionRef.get();
  if (!executionSnap.exists) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (["claimed", "target-established", "target-validated"].includes(execution.status)) {
    return { outcome: "not-yet-cleaned-up", planId, status: execution.status };
  }
  if (execution.status !== "old-space-cleaned-up") {
    return { outcome: "already-confirmed-or-later", planId, status: execution.status };
  }

  // Largely already satisfied: the target Room's summary was already
  // recomputed as a side effect of Phase 2's forceFullReprojectionAdmin
  // call. Re-confirmed directly here anyway so this phase's completion is
  // an independently-checked fact, not an assumption about a side effect
  // from two phases ago.
  await updateSpaceRoomSummaryAdmin(db, uid, execution.targetSpaceId);

  await executionRef.update({ status: "summaries-confirmed" });
  return { outcome: "confirmed", planId };
}

// ---- Phase 6: reconcile merge candidates ----
async function reconcileMergeCandidatesAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);
  const executionSnap = await executionRef.get();
  if (!executionSnap.exists) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (["claimed", "target-established", "target-validated", "old-space-cleaned-up"].includes(execution.status)) {
    return { outcome: "not-yet-ready", planId, status: execution.status };
  }
  if (execution.status !== "summaries-confirmed") {
    return { outcome: "already-reconciled-or-later", planId, status: execution.status };
  }

  const candidatesSnap = await userRef.collection("mergeCandidates").where("planIds", "array-contains", planId).get();
  const reconciled = [];
  for (const candDoc of candidatesSnap.docs) {
    const candidateDoc = candDoc.data();
    // Terminal states are never re-evaluated - matches
    // evaluateCandidateInvalidation's own documented contract.
    if (candidateDoc.resolutionStatus === "superseded" || candidateDoc.resolutionStatus === "stale-confirmed" || candidateDoc.resolutionStatus === "merged") {
      reconciled.push({ candidateId: candDoc.id, action: "skip-terminal", resolutionStatus: candidateDoc.resolutionStatus });
      continue;
    }
    const currentPlansById = {};
    for (const pid of candidateDoc.planIds || []) {
      const pSnap = await userRef.collection("plans").doc(pid).get();
      currentPlansById[pid] = pSnap.exists ? pSnap.data() : null;
    }
    const decision = evaluateCandidateInvalidation(candidateDoc, currentPlansById);
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (decision.action === "keep") {
      reconciled.push({ candidateId: candDoc.id, action: "keep" });
      continue;
    }
    if (decision.action === "mark-stale") {
      await candDoc.ref.update({ resolutionStatus: "stale-confirmed", staleReason: decision.staleReason, staleDetectedAt: now });
      reconciled.push({ candidateId: candDoc.id, action: "mark-stale", staleReason: decision.staleReason });
      continue;
    }
    // supersede - never a physical delete.
    await candDoc.ref.update({ resolutionStatus: "superseded", supersededAt: now, supersededBy: [] });
    reconciled.push({ candidateId: candDoc.id, action: "supersede" });
  }

  await executionRef.update({ status: "candidates-reconciled", reconciledCandidateIds: reconciled.map((r) => r.candidateId) });
  return { outcome: "reconciled", planId, reconciled };
}

// ---- Phase 7: finalize ----
async function finalizeReclassificationAdmin(db, uid, planId) {
  const userRef = db.collection("users").doc(uid);
  const executionRef = userRef.collection("reclassificationExecutions").doc(planId);
  const executionSnap = await executionRef.get();
  if (!executionSnap.exists) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status === "completed") return { outcome: "already-completed", planId };
  if (execution.status !== "candidates-reconciled") return { outcome: "not-yet-reconciled", planId, status: execution.status };

  const now = admin.firestore.FieldValue.serverTimestamp();
  await executionRef.update({ status: "completed", completedAt: now });
  return { outcome: "completed", planId };
}

// ---- Orchestrator: resumable, safe to call repeatedly ----
async function reclassifyLegacyPlanAdmin(db, uid, planId, request) {
  const executionRef = db.collection("users").doc(uid).collection("reclassificationExecutions").doc(planId);

  const claim = await claimReclassificationAdmin(db, uid, planId, request);
  if (claim.outcome === "plan-missing" || claim.outcome === "invalid-target-space" || claim.outcome === "conflict") {
    return { outcome: "blocked-at-claim", detail: claim };
  }
  if (claim.outcome === "already-completed") {
    const executionSnap = await executionRef.get();
    return { outcome: "completed", planId, alreadyCompleted: true, execution: executionSnap.data() };
  }

  // Defensive top-level short-circuit, same fix executeMergeAdmin's own
  // comment documents needing: without this, re-invoking an
  // already-completed operation could re-run later read-only checks that
  // spuriously fail against ordinary subsequent activity on the plan.
  const executionSnap = await executionRef.get();
  if (executionSnap.exists && executionSnap.data().status === "completed") {
    return { outcome: "completed", planId, alreadyCompleted: true, execution: executionSnap.data() };
  }

  const established = await establishTargetProjectionAdmin(db, uid, planId);
  if (established.outcome === "blocked") return { outcome: "blocked-at-establish", detail: established };

  const validated = await validateTargetProjectionAdmin(db, uid, planId);
  if (validated.outcome === "invalid") return { outcome: "blocked-at-validation", detail: validated };

  const cleanedUp = await cleanUpOldSpaceAdmin(db, uid, planId);
  const confirmed = await confirmSummariesAdmin(db, uid, planId);
  const reconciled = await reconcileMergeCandidatesAdmin(db, uid, planId);
  const finalized = await finalizeReclassificationAdmin(db, uid, planId);

  return { outcome: "completed", planId, claim, established, validated, cleanedUp, confirmed, reconciled, finalized };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.project || !args.uid || !args.planId || !args.targetSpaceId || !args.roomName || !args.areaName) {
    console.error("Usage: node scripts/reclassifyLegacyPlan.js --project=<projectId> --uid=<uid> --planId=<planId> --targetSpaceId=<spaceId> --roomName=<name> --areaName=<name> [--areaScope=sub-area]");
    process.exitCode = 1;
    return;
  }
  admin.initializeApp({ projectId: args.project });
  const db = admin.firestore();
  const result = await reclassifyLegacyPlanAdmin(db, args.uid, args.planId, {
    targetSpaceId: args.targetSpaceId,
    requestedRoomName: args.roomName,
    requestedAreaName: args.areaName,
    requestedAreaScope: args.areaScope || "sub-area",
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.outcome === "completed" ? 0 : 1;
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Script crashed:", e);
    process.exitCode = 1;
  });
} else {
  module.exports = {
    claimReclassificationAdmin,
    establishTargetProjectionAdmin,
    validateTargetProjectionAdmin,
    cleanUpOldSpaceAdmin,
    confirmSummariesAdmin,
    reconcileMergeCandidatesAdmin,
    finalizeReclassificationAdmin,
    reclassifyLegacyPlanAdmin,
  };
}
