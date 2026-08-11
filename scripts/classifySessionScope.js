#!/usr/bin/env node
/**
 * Session Scope classification / backfill (SessionScopeDesign.md Q4,
 * SessionScopeImplementation.md).
 *
 * Stamps `sessionScope` on every existing plan document, so that scope is
 * carried by ONE authoritative field instead of being inferred from
 * ambiguous indirect signals. The investigation established that:
 *   - `areaId: null` means BOTH "intentionally whole-room" and "legacy,
 *     never established" (SessionScopeDesign.md Q2), and
 *   - `schemaVersion` tracks the AI payload shape only and carries no
 *     scope signal at all - 27 of 28 real staging plans are version 1,
 *     spanning every scope category (Q3).
 *
 * Classification is delegated entirely to resolveSessionScope
 * (shared/spaceMigration.js), the SAME pure function the live client now
 * calls in savePlanToHistory - so a backfilled plan and a brand-new plan
 * can never be classified by two different rules. Its priority order:
 *   a. areaId set               -> "area"
 *   b. areaScope "whole-room"   -> "room"
 *   c. areaScope "sub-area", no areaId -> "unresolved"
 *   d. no areaScope at all      -> "unresolved"
 *
 * ---- What this script deliberately does NOT do ----
 * It never creates a Space document for an orphan plan. The investigation
 * found 12 plans that resolve to no Space, whose `spaceType` values
 * ("Under-Sink Cabinet", "Bar/Whiskey Display", "Kitchen Counter
 * Workspace") are Areas that the pre-Room-First-Identity system stored in
 * the Room slot. Materialising Rooms from those strings would re-commit
 * the exact historical mistake this work exists to correct. They are left
 * with sessionScope "unresolved" and their existing (or absent)
 * canonicalSpaceId, for a future user-facing recovery flow to settle.
 * It also never writes areaId, areaScope, canonicalSpaceId, or anything
 * else - sessionScope is the only field it touches.
 *
 * ---- Restartability / idempotency ----
 * resolveSessionScope is pure and total: same inputs, same answer. A plan
 * is only written when its stored sessionScope differs from the freshly
 * computed one, so a second run over unchanged data performs zero writes.
 * A plan whose underlying data genuinely changed since the last run (e.g.
 * areaId was set in the meantime) is correctly re-classified - that is
 * re-convergence, not non-idempotency.
 *
 * ---- Project guard ----
 * Refuses any project other than cluttrd-staging without an explicit
 * --i-understand-this-is-not-staging flag.
 *
 * Usage:
 *   node scripts/classifySessionScope.js --project=cluttrd-staging --uid=<uid> [--dry-run]
 *     [--credentials=<path>]
 *   node scripts/classifySessionScope.js --project=cluttrd-staging --uid=<uid> --recovery-query
 */

const admin = require("firebase-admin");
const { resolveSessionScope, computeShadowIds } = require("../shared/spaceMigration.js");

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, "").split("=");
    args[k] = v === undefined ? true : v;
  }
  return args;
}

async function classifySessionScopeAdmin(db, uid, { dryRun = false } = {}) {
  const userRef = db.collection("users").doc(uid);
  const plansSnap = await userRef.collection("plans").get();
  const spacesSnap = await userRef.collection("spaces").get();
  const spaceIds = new Set(spacesSnap.docs.map((d) => d.id));

  const counts = { room: 0, area: 0, unresolved: 0 };
  const written = [], unchanged = [], details = [];

  for (const d of plansSnap.docs) {
    const p = d.data();
    const computed = resolveSessionScope(p);
    const stored = Object.prototype.hasOwnProperty.call(p, "sessionScope") ? p.sessionScope : undefined;
    counts[computed]++;

    // Orphan == this plan's canonical Space does not exist. Recorded for
    // reporting only; it never affects classification, and no Space is
    // ever created for it.
    const spaceId = computeShadowIds(d.id, p).spaceId;
    const isOrphan = !spaceIds.has(spaceId);

    details.push({
      planId: d.id, computed, storedBefore: stored === undefined ? "(absent)" : stored,
      isOrphan, spaceId,
      areaId: p.areaId ? "set" : (Object.prototype.hasOwnProperty.call(p, "areaId") ? "null" : "(absent)"),
      areaScope: Object.prototype.hasOwnProperty.call(p, "areaScope") ? JSON.stringify(p.areaScope) : "(absent)",
      createdAt: p.createdAt,
    });

    if (stored === computed) { unchanged.push(d.id); continue; }
    if (!dryRun) await d.ref.update({ sessionScope: computed });
    written.push({ planId: d.id, from: stored === undefined ? "(absent)" : stored, to: computed });
  }

  const orphanUnresolved = details.filter((x) => x.computed === "unresolved" && x.isOrphan);
  return {
    uid, dryRun, totalPlans: plansSnap.size, counts,
    written: written.length, unchanged: unchanged.length,
    orphanCount: details.filter((x) => x.isOrphan).length,
    orphanUnresolvedCount: orphanUnresolved.length,
    spacesBefore: spaceIds.size, writtenDetail: written, details,
  };
}

/**
 * The global recovery query (SessionScopeDesign.md Q9 / task item 5).
 *
 * Proves every unresolved session is discoverable regardless of the
 * client History screen's 20-plan cap (App.js loadHistory,
 * `limit(20)`) and regardless of whether a Space document exists for it.
 *
 * Runs BOTH forms, because they are not interchangeable:
 *   - collectionGroup("plans") + sessionScope equality, scoped to one
 *     uid's subtree by a document-path range (the standard Firestore
 *     technique, already used for collectionGroup("areas") in
 *     runSpaceMigration.js's hardDeleteAccountAdmin). This is the
 *     admin/global form.
 *   - the plain uid-scoped subcollection query with NO limit. This is
 *     what a client can actually run: Firestore rules here are
 *     user-scoped, so a client-side collectionGroup("plans") would span
 *     other users' documents and be denied. Any future recovery UI must
 *     use this form.
 * Both must return the identical set, or the "global recoverability"
 * claim is only true for admin tooling and not for the app.
 */
async function verifyGlobalRecoveryQuery(db, uid) {
  const result = { collectionGroup: null, subcollection: null, agree: false, collectionGroupError: null };

  try {
    const cgSnap = await db.collectionGroup("plans")
      .where("sessionScope", "==", "unresolved")
      .get();
    // Scope to this uid in memory rather than combining an equality filter
    // with a documentId() range - that combination needs a composite
    // collection-group index, which would have to be deployed first.
    result.collectionGroup = cgSnap.docs
      .filter((d) => d.ref.parent.parent.id === uid)
      .map((d) => d.id).sort();
    result.collectionGroupTotalAcrossUsers = cgSnap.size;
  } catch (e) {
    result.collectionGroupError = e.message;
  }

  const subSnap = await db.collection("users").doc(uid).collection("plans")
    .where("sessionScope", "==", "unresolved").get();
  result.subcollection = subSnap.docs.map((d) => d.id).sort();

  result.agree = !!result.collectionGroup
    && JSON.stringify(result.collectionGroup) === JSON.stringify(result.subcollection);
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.project || !args.uid) {
    console.error("Usage: node scripts/classifySessionScope.js --project=cluttrd-staging --uid=<uid> [--dry-run] [--credentials=<path>] [--recovery-query]");
    process.exitCode = 1;
    return;
  }
  if (args.project !== "cluttrd-staging" && !args["i-understand-this-is-not-staging"]) {
    console.error(`Refusing to run against project "${args.project}". This is a staging-only classification pass.`);
    process.exitCode = 1;
    return;
  }

  admin.initializeApp(args.credentials
    ? { credential: admin.credential.cert(require(args.credentials)), projectId: args.project }
    : { projectId: args.project });
  const db = admin.firestore();

  if (args["recovery-query"]) {
    console.log(`\n=== Global recovery query ===\nproject: ${args.project}   uid: ${args.uid}\n`);
    const v = await verifyGlobalRecoveryQuery(db, args.uid);
    if (v.collectionGroupError) console.log(`  collectionGroup("plans") FAILED: ${v.collectionGroupError}`);
    else console.log(`  collectionGroup("plans").where(sessionScope=="unresolved") -> ${v.collectionGroup.length} for this uid (${v.collectionGroupTotalAcrossUsers} across all users)`);
    console.log(`  users/${args.uid}/plans.where(sessionScope=="unresolved")        -> ${v.subcollection.length} (no limit applied)`);
    console.log(`  both queries return the identical set: ${v.agree}`);
    console.log(`  planIds: ${v.subcollection.join(", ")}\n`);
    return;
  }

  const dryRun = !!args["dry-run"];
  console.log(`\n=== Session Scope classification${dryRun ? " (DRY RUN - no writes)" : ""} ===`);
  console.log(`project: ${args.project}   uid: ${args.uid}\n`);

  const r = await classifySessionScopeAdmin(db, args.uid, { dryRun });

  console.log(`plans scanned : ${r.totalPlans}`);
  console.log(`  "room"      : ${r.counts.room}`);
  console.log(`  "area"      : ${r.counts.area}`);
  console.log(`  "unresolved": ${r.counts.unresolved}   (of which orphans, no Space: ${r.orphanUnresolvedCount})`);
  console.log(`writes        : ${r.written}`);
  console.log(`unchanged     : ${r.unchanged}\n`);

  for (const w of r.writtenDetail) console.log(`  SET  ${w.planId}  ${w.from} -> ${w.to}`);

  const spacesAfter = (await db.collection("users").doc(args.uid).collection("spaces").get()).size;
  console.log(`\nSpace documents before: ${r.spacesBefore}   after: ${spacesAfter}   (must be equal - no Spaces are ever created here)`);
  console.log("");
}

if (require.main === module) {
  main().catch((e) => { console.error("Script crashed:", e); process.exitCode = 1; });
} else {
  module.exports = { classifySessionScopeAdmin, verifyGlobalRecoveryQuery };
}
