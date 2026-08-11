#!/usr/bin/env node
/**
 * Legacy Area Backfill - create durable Area documents for plans written
 * before Area Identity Phase A.
 *
 * The problem this closes: Area re-parenting (AreaReparentingImplementation.md)
 * operates on Area documents, but every plan created before Area Identity
 * Phase A carries only a flat `areaName` STRING and a null `areaId` - so
 * those visits have no Area to move, and Room Detail's AREAS IN THIS ROOM
 * section (which renders only Areas that at least one plan points at, via
 * `roomDetailPlans.some((p) => p.areaId === a.id)`) shows nothing for them.
 * Re-parenting exists precisely to fix misplaced areas in EXISTING data,
 * so it is unusable until those Area documents exist.
 *
 * What it does, for every plan with a non-empty `areaName` and a null
 * `areaId`:
 *   1. Resolve the plan's canonical Room - computeShadowIds(planId, plan)
 *      .spaceId, i.e. `canonicalSpaceId || planId`, the same resolution
 *      every other consumer in this codebase uses. Never a guess.
 *   2. Group by (canonical Room, areaName) so N plans naming the same Area
 *      in the same Room share ONE Area document, not one each.
 *   3. Create spaces/{roomId}/areas/{newAreaId} with displayName from
 *      areaName, originalPhotoUrl/latestPhotoUrl from the group's plans.
 *   4. Repoint every plan in the group: areaId = the new Area, and
 *      shadowSourceVersion bumped so the shadow Project is re-derived.
 *   5. syncPlanToSpaceGraphAdmin per plan, so Project.areaId catches up -
 *      updating the plan document alone does NOT fix the Project (the
 *      same real finding createAreaForPlanAdmin already documents).
 *   6. updateAreaSummaryAdmin, which recomputes visitCount /
 *      lastOrganizedAt / latestPhotoUrl from the Area's actual Projects -
 *      never trusting a copied count.
 *
 * ---- Grouping is EXACT-match on areaName, deliberately ----
 * "Corner shelf" and "Corner Shelf" become two Areas, not one. This
 * codebase never auto-merges same-named Areas (establishTargetArea,
 * App.js:1855-1860; AreaReparentingDesign.md §7) and there is no un-merge
 * tool anywhere - so collapsing two names that only a human can confirm
 * are the same physical spot is a guess this script must not make on the
 * user's behalf. Near-duplicates are REPORTED loudly instead (see the
 * "near-duplicate" warnings in the summary) so the decision stays with
 * the user. Case-insensitive grouping is available via
 * --group-case-insensitive for anyone who has looked at the report and
 * decided that is what they want.
 *
 * ---- Restartability / idempotency ----
 * Two independent guards, so any interruption is safe to re-run through:
 *   - A plan that already has an areaId is not a target at all, so a
 *     completed plan is never reprocessed.
 *   - Before creating anything, an existing non-retired Area in the same
 *     Room with the same displayName is REUSED. This is what makes a
 *     crash between "Area created" and "plans repointed" converge instead
 *     of duplicating: the re-run finds the Area from the previous attempt
 *     and finishes the repoint. Areas this script creates are stamped
 *     `backfillSource: "legacy-areaName"` and are preferred when matching,
 *     so repeated runs always converge on the same document.
 * Re-running after a complete run therefore finds zero targets and writes
 * nothing.
 *
 * ---- Project guard ----
 * Refuses to run against anything other than cluttrd-staging unless
 * --i-understand-this-is-not-staging is passed explicitly. This is a bulk
 * mutation across a user's whole plan set; the default must not be able
 * to touch production by a typo'd flag.
 *
 * Usage:
 *   node scripts/backfillLegacyAreas.js --project=cluttrd-staging --uid=<uid> [--dry-run]
 *     [--credentials=<path to service account json>] [--group-case-insensitive]
 */

const admin = require("firebase-admin");
const { computeShadowIds } = require("../shared/spaceMigration.js");
const {
  syncPlanToSpaceGraphAdmin, updateAreaSummaryAdmin, updateSpaceRoomSummaryAdmin,
} = require("./runSpaceMigration.js");

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    args[k] = v === undefined ? true : v;
  }
  return args;
}

/**
 * Pure. Given every plan doc for a user, returns the backfill work list:
 * one entry per (canonical Room, areaName) group, each with its member
 * plans sorted oldest-first. Split out from all I/O so the grouping rule
 * - the one piece of real judgment in this script - is inspectable and
 * testable on its own.
 */
function buildBackfillGroups(planDocs, { caseInsensitive = false } = {}) {
  const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : 0));
  const groups = new Map();
  const skipped = { alreadyHasAreaId: 0, noAreaName: 0 };

  for (const { id, data } of planDocs) {
    if (data.areaId) { skipped.alreadyHasAreaId++; continue; }
    const areaName = typeof data.areaName === "string" ? data.areaName.trim() : "";
    if (!areaName) { skipped.noAreaName++; continue; }

    const roomId = computeShadowIds(id, data).spaceId;
    // NUL can never occur in a Firestore document id or in a user-typed
    // Area name, so it is a collision-proof composite-key separator - a
    // plain delimiter like "|" would let an Area actually named "a|b"
    // collide with a different (Room, name) pair.
    const key = `${roomId}\u0000${caseInsensitive ? areaName.toLowerCase() : areaName}`;
    if (!groups.has(key)) groups.set(key, { roomId, areaName, plans: [] });
    groups.get(key).plans.push({ planId: id, data, createdAtMs: toMillis(data.createdAt) });
  }

  for (const g of groups.values()) {
    g.plans.sort((a, b) => a.createdAtMs - b.createdAtMs);
    // With case-insensitive grouping the members can disagree on casing;
    // the oldest plan's spelling wins, so the choice is deterministic
    // rather than dependent on document iteration order.
    g.areaName = g.plans[0].data.areaName.trim();
  }
  return { groups: [...groups.values()], skipped };
}

/**
 * Pure. Flags groups whose areaName differs from another group's in the
 * same Room only by case/whitespace, or which closely resemble an Area
 * already in that Room. Reported, never acted on.
 */
function findNearDuplicates(groups, existingAreasByRoom) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const warnings = [];
  const byRoom = new Map();
  for (const g of groups) {
    if (!byRoom.has(g.roomId)) byRoom.set(g.roomId, []);
    byRoom.get(g.roomId).push(g);
  }
  for (const [roomId, roomGroups] of byRoom.entries()) {
    for (let i = 0; i < roomGroups.length; i++) {
      for (let j = i + 1; j < roomGroups.length; j++) {
        if (roomGroups[i].areaName !== roomGroups[j].areaName && norm(roomGroups[i].areaName) === norm(roomGroups[j].areaName)) {
          warnings.push({ roomId, kind: "case-only-difference-between-new-areas", names: [roomGroups[i].areaName, roomGroups[j].areaName] });
        }
      }
      for (const existing of existingAreasByRoom.get(roomId) || []) {
        if (existing.retired) continue;
        if (existing.displayName !== roomGroups[i].areaName && norm(existing.displayName) === norm(roomGroups[i].areaName)) {
          warnings.push({ roomId, kind: "case-only-difference-with-existing-area", names: [roomGroups[i].areaName, existing.displayName], existingAreaId: existing.id });
        }
      }
    }
  }
  return warnings;
}

async function backfillLegacyAreasAdmin(db, uid, { dryRun = false, caseInsensitive = false } = {}) {
  const userRef = db.collection("users").doc(uid);
  const plansSnap = await userRef.collection("plans").get();
  const planDocs = plansSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  const { groups, skipped } = buildBackfillGroups(planDocs, { caseInsensitive });

  // Load every referenced Room's Areas once, for both the reuse check and
  // the near-duplicate report.
  const existingAreasByRoom = new Map();
  const roomDataById = new Map();
  for (const roomId of new Set(groups.map((g) => g.roomId))) {
    const roomSnap = await userRef.collection("spaces").doc(roomId).get();
    roomDataById.set(roomId, roomSnap.exists ? roomSnap.data() : null);
    const areasSnap = await userRef.collection("spaces").doc(roomId).collection("areas").get();
    existingAreasByRoom.set(roomId, areasSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  const warnings = findNearDuplicates(groups, existingAreasByRoom);
  const created = [], reused = [], skippedGroups = [], repointed = [];

  for (const group of groups) {
    const room = roomDataById.get(group.roomId);
    if (!room) {
      skippedGroups.push({ ...groupSummary(group), reason: "canonical Room document does not exist" });
      continue;
    }
    if (room.retired === true) {
      // A retired Room is either merge-tombstoned or soft-deleted. Writing
      // a live Area under it would create something the UI can never show
      // (loadRooms filters retired Rooms out entirely) and would resurrect
      // nothing useful - the same guard establishTargetArea already applies.
      skippedGroups.push({ ...groupSummary(group), reason: `canonical Room "${room.displayName}" is retired` });
      continue;
    }

    const candidates = (existingAreasByRoom.get(group.roomId) || []).filter((a) => !a.retired && a.displayName === group.areaName);
    // Prefer a document this script created, so repeated runs converge on
    // one Area even if a same-named Area also exists for other reasons.
    const match = candidates.find((a) => a.backfillSource === "legacy-areaName") || candidates[0] || null;

    const oldest = group.plans[0];
    const newest = group.plans[group.plans.length - 1];
    const firstPhoto = group.plans.find((p) => p.data.photoUrl)?.data.photoUrl ?? null;
    const lastPhoto = [...group.plans].reverse().find((p) => p.data.photoUrl)?.data.photoUrl ?? null;

    let areaId;
    if (match) {
      areaId = match.id;
      reused.push({ ...groupSummary(group), areaId, displayName: match.displayName });
    } else if (dryRun) {
      areaId = "(dry-run - would create)";
      created.push({ ...groupSummary(group), areaId, originalPhotoUrl: firstPhoto, createdAt: oldest.data.createdAt ?? null });
    } else {
      // createdAt is the OLDEST member plan's own createdAt, not the time
      // of this backfill: createdAt means "when the user first organized
      // this physical spot" everywhere else in this data model, and a
      // backfill is an administrative correction, not a new organizing
      // event - the same reasoning establishTargetArea states for its own
      // createdAt preservation. visitCount/lastOrganizedAt/latestPhotoUrl
      // are seeded but immediately recomputed below; never trusted.
      const ref = await userRef.collection("spaces").doc(group.roomId).collection("areas").add({
        roomId: group.roomId,
        displayName: group.areaName,
        createdAt: oldest.data.createdAt ?? new Date().toISOString(),
        originalPhotoUrl: firstPhoto,
        latestPhotoUrl: lastPhoto,
        lastOrganizedAt: newest.data.createdAt ?? null,
        visitCount: 0,
        retired: false,
        redirectTo: null,
        backfillSource: "legacy-areaName",
        backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      areaId = ref.id;
      existingAreasByRoom.get(group.roomId).push({ id: areaId, displayName: group.areaName, retired: false, backfillSource: "legacy-areaName" });
      created.push({ ...groupSummary(group), areaId, originalPhotoUrl: firstPhoto, createdAt: oldest.data.createdAt ?? null });
    }

    for (const p of group.plans) {
      if (dryRun) { repointed.push({ planId: p.planId, areaId, roomId: group.roomId, areaName: group.areaName }); continue; }
      await userRef.collection("plans").doc(p.planId).update({
        areaId,
        shadowSourceVersion: admin.firestore.FieldValue.increment(1),
      });
      // Updating the plan alone leaves the shadow Project still carrying
      // areaId: null - computeAreaSummaryFields filters Projects by that
      // field, so without this re-sync the Area's summary would be 0
      // visits forever.
      await syncPlanToSpaceGraphAdmin(db, uid, p.planId);
      repointed.push({ planId: p.planId, areaId, roomId: group.roomId, areaName: group.areaName });
    }

    if (!dryRun) await updateAreaSummaryAdmin(db, uid, group.roomId, areaId);
  }

  if (!dryRun) {
    for (const roomId of new Set(groups.map((g) => g.roomId))) {
      if (roomDataById.get(roomId) && roomDataById.get(roomId).retired !== true) {
        await updateSpaceRoomSummaryAdmin(db, uid, roomId);
      }
    }
  }

  return {
    uid, dryRun, caseInsensitive,
    totalPlans: planDocs.length,
    skippedPlans: skipped,
    groupCount: groups.length,
    areasCreated: created.length, areasReused: reused.length, groupsSkipped: skippedGroups.length,
    plansBackfilled: repointed.length,
    created, reused, skippedGroups, repointed, warnings,
  };
}

function groupSummary(group) {
  return { roomId: group.roomId, areaName: group.areaName, planCount: group.plans.length, planIds: group.plans.map((p) => p.planId) };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.project || !args.uid) {
    console.error("Usage: node scripts/backfillLegacyAreas.js --project=cluttrd-staging --uid=<uid> [--dry-run] [--credentials=<path>] [--group-case-insensitive]");
    process.exitCode = 1;
    return;
  }
  if (args.project !== "cluttrd-staging" && !args["i-understand-this-is-not-staging"]) {
    console.error(`Refusing to run against project "${args.project}". This is a staging-only backfill.`);
    console.error(`If you genuinely intend to run it elsewhere, re-run with --i-understand-this-is-not-staging.`);
    process.exitCode = 1;
    return;
  }

  admin.initializeApp(args.credentials
    ? { credential: admin.credential.cert(require(args.credentials)), projectId: args.project }
    : { projectId: args.project });
  const db = admin.firestore();

  const dryRun = !!args["dry-run"];
  console.log(`\n=== Legacy Area Backfill${dryRun ? " (DRY RUN - no writes)" : ""} ===`);
  console.log(`project: ${args.project}   uid: ${args.uid}\n`);

  const r = await backfillLegacyAreasAdmin(db, args.uid, { dryRun, caseInsensitive: !!args["group-case-insensitive"] });

  console.log(`plans scanned                 : ${r.totalPlans}`);
  console.log(`  skipped (already has areaId): ${r.skippedPlans.alreadyHasAreaId}`);
  console.log(`  skipped (no areaName)       : ${r.skippedPlans.noAreaName}`);
  console.log(`(Room, areaName) groups       : ${r.groupCount}`);
  console.log(`Areas created                 : ${r.areasCreated}`);
  console.log(`Areas reused (already existed): ${r.areasReused}`);
  console.log(`groups skipped                : ${r.groupsSkipped}`);
  console.log(`plans backfilled              : ${r.plansBackfilled}\n`);

  for (const c of r.created) console.log(`  CREATE  "${c.areaName}" in ${c.roomId} -> ${c.areaId}  (${c.planCount} plan(s): ${c.planIds.join(", ")})`);
  for (const c of r.reused) console.log(`  REUSE   "${c.areaName}" in ${c.roomId} -> ${c.areaId}  (${c.planCount} plan(s): ${c.planIds.join(", ")})`);
  for (const c of r.skippedGroups) console.log(`  SKIP    "${c.areaName}" in ${c.roomId} - ${c.reason}`);

  if (r.warnings.length) {
    console.log(`\n!! ${r.warnings.length} near-duplicate name warning(s) - NOT acted on, review these:`);
    for (const w of r.warnings) console.log(`   [${w.kind}] in Room ${w.roomId}: ${JSON.stringify(w.names)}${w.existingAreaId ? ` (existing Area ${w.existingAreaId})` : ""}`);
  }
  console.log("");
}

if (require.main === module) {
  main().catch((e) => { console.error("Script crashed:", e); process.exitCode = 1; });
} else {
  module.exports = { backfillLegacyAreasAdmin, buildBackfillGroups, findNearDuplicates };
}
