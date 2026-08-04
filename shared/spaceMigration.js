// Pure, SDK-neutral migration logic for the Space shadow graph. No
// Firestore imports, no client/admin SDK dependency - mirrors the exact
// pattern already proven for evaluateSpaceShadowValidation
// (shared/spaceShadowValidation.js, Step 4): one implementation of the
// actual decision-making/payload-derivation logic, callable from both
// App.js (React Native client, via Metro/Babel's CommonJS interop) and a
// Node admin CLI/migration runner (via plain require()), so the two can
// never independently drift. Written as CommonJS (module.exports)
// specifically so require() works unmodified without any transform step.
//
// Every function here takes already-fetched plain data and returns plain
// data or plain decisions - none of them perform I/O. Each SDK-specific
// caller (App.js's forceFullReprojection/checkMigrationCompleteness, a
// CLI/runner's equivalents) is responsible for its own reads/writes and
// calls into these functions for the logic itself. One field is
// deliberately excluded from the derived write payload: `syncedAt`. The
// client and admin SDKs' server-timestamp sentinels are different,
// incompatible objects - a value produced by one SDK cannot be handed to
// the other's write call - so each caller adds its own SDK-appropriate
// `syncedAt` sentinel to every derived document just before writing it.
// Everything else about the payload is fully derived here.

const { evaluateSpaceShadowValidation } = require("./spaceShadowValidation");

const SHADOW_SCHEMA_VERSION = 1;
const MIGRATION_VERSION = 1;

// Batches completed more than this far apart are treated as separate,
// distinguishable Sessions - a defined, versioned heuristic (bump
// MIGRATION_VERSION if this threshold or the clustering logic ever
// changes), not an arbitrary guess applied silently.
const SESSION_GAP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Content-derived merge-candidate ID scheme (§12 Migration Part 3, Pass 1
// - MergeProposalDesign.md Section 10). Bump if the derivation itself
// changes (different hash, different normalization, different join
// delimiter) - lets an old document's ID be distinguished from one
// derived under a newer scheme without reverse-engineering the hash.
const CANDIDATE_KEY_VERSION = 1;

// Pure, dependency-free 53-bit string hash (public-domain "cyrb53"
// algorithm) - deterministic identically in the Node admin runner and the
// Expo/Metro-bundled client, unlike Node's `crypto` module, which is not
// available in the React Native bundle. Always hashes the full input
// string, never samples it - contrast debugHashBase64 (App.js), which
// samples every 37th character for a debug-only image fingerprint where
// occasional collisions are cheap. A merge-candidate document-ID
// collision would silently clobber one candidate's Firestore document
// with another's write - a correctness bug, not a debug inconvenience -
// so sampling is not acceptable here, even though the two functions are
// otherwise stylistically similar (lightweight, non-cryptographic).
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, "0");
}

// Pure. Content-derived, deterministic merge-candidate ID -
// MergeProposalDesign.md Section 10: candidateId =
// hash(normalizedSpaceType + "|" + sortedPlanIds.join("|")). The same
// spaceType + plan-set always produces the same ID; a different set
// always produces a different one (mod a 53-bit hash's negligible
// collision probability at the candidate counts a single user will ever
// have). No ledger, no revision counter - satisfies the Restartability
// Principle (SpaceMemoryModel.md §12) the same way computeShadowBatchId
// does. `normalizedSpaceType` currently applies no normalization - see
// the caller-facing note in MergeProposalDesign.md Section 10: this must
// stay in exact lockstep with whatever key detectMergeCandidates groups
// plans by, below.
function computeMergeCandidateId(spaceType, planIds) {
  const normalizedSpaceType = spaceType;
  const sortedPlanIds = [...new Set(planIds)].sort();
  const input = `${normalizedSpaceType}|${sortedPlanIds.join("|")}`;
  return `mc-${cyrb53(input)}`;
}

// User-Managed Space Identity (§12 Migration Part 3).
//
// [Design principle] User naming defines Space identity. The AI's
// original classification (`spaceType`) is preserved as historical
// metadata - it is never overwritten by a rename. The user's
// `spaceName`, when set, is the canonical name for all product
// behavior: display, detection, comparison, and merge-candidate
// grouping. The AI label is never shown to the user as the "real" name
// once a user-chosen name exists.
//
// [Invariant] Merge-candidate detection must always operate on the same
// display value the user sees. Any function that groups, compares, or
// invalidates candidates must read the same computed name this function
// returns. These must never diverge - see detectMergeCandidates and
// evaluateCandidateInvalidation below, both of which call this function
// rather than reading `spaceType` directly, and every UI display site in
// App.js, which does the same.
//
// Pure. Named for what it returns (the name to display), not how it's
// computed, so callers reason about it as "the current name," not as a
// fallback mechanic.
function getSpaceDisplayName(planData) {
  const trimmed = typeof planData.spaceName === "string" ? planData.spaceName.trim() : "";
  return trimmed || planData.spaceType || null;
}

// §12 Migration Part 4 (MergeExecutionDesign.md §2). `plan` is optional and
// omittable at every call site that genuinely has no plan document in hand
// (e.g. a bare-planId existence probe before anything is known) - omitting
// it reproduces today's exact pre-merge behavior (spaceId === planId),
// which is also exactly what a never-merged plan's own canonicalSpaceId
// (absent/null) resolves to below. When a caller DOES have the plan
// document already (the overwhelming majority of call sites, since most
// shadow functions read the plan for other reasons anyway), it must be
// passed - this is the single line that makes every future sync, repair,
// and read target the correct canonical Space after a merge.
function computeShadowIds(planId, plan) {
  const spaceId = (plan && plan.canonicalSpaceId) || planId;
  return { spaceId, projectId: planId, sessionId: planId };
}

// The single shared batch-ID derivation (Batch Identity Alignment,
// 2026-08-02) - `${planId}-batch${batchIndex}`. A plan can have any
// number of batches (one per archived batchHistory entry, plus the
// current one), so there is no single correct "the" batch ID.
function computeShadowBatchId(planId, batchIndex) {
  return `${planId}-batch${batchIndex}`;
}

// Pure. Groups a plan's batchHistory (+ current batch, if present) into
// Session clusters by gaps between consecutive batches' timestamps. A
// plan with no gap exceeding the threshold collapses to exactly one
// cluster - a superset of syncPlanToSpaceGraph's single-Session
// behavior for the simple case, not a divergence from it.
function reconstructSessionClusters(plan) {
  const archivedBatches = Array.isArray(plan.batchHistory) ? [...plan.batchHistory].sort((a, b) => a.batchIndex - b.batchIndex) : [];
  const hasCurrentBatch = !!plan.currentBatch;
  const entries = archivedBatches.map((b) => ({
    batchIndex: b.batchIndex,
    items: b.items || [],
    completedAt: b.completedAt || null,
    suggestedAt: null,
    isCurrent: false,
    clusterTimestamp: b.completedAt || plan.createdAt,
  }));
  if (hasCurrentBatch) {
    const cb = plan.currentBatch;
    entries.push({
      batchIndex: cb.batchIndex,
      items: cb.items || [],
      completedAt: null,
      suggestedAt: cb.suggestedAt || null,
      isCurrent: true,
      clusterTimestamp: cb.suggestedAt || plan.createdAt,
    });
  }
  if (entries.length === 0) return [];

  const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : Date.parse(plan.createdAt)));
  const clusters = [[entries[0]]];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    const gap = toMillis(cur.clusterTimestamp) - toMillis(prev.clusterTimestamp);
    if (gap > SESSION_GAP_THRESHOLD_MS) clusters.push([cur]);
    else clusters[clusters.length - 1].push(cur);
  }
  return clusters;
}

// Pure. Derives the exact document set a full reprojection should write,
// given a plan's data. Returns:
//   { ids, sourceVersion, space, spaceProjectionUpdate, project, sessions: [{ id, data, batches: [{ id, data }] }] }
// `space` is the full Space document shape, written verbatim only when no
// Space document exists yet (creation). `spaceProjectionUpdate` is the
// narrow subset of Space fields projection may write against an
// ALREADY-EXISTING Space (currently just activeProjectId) - see the field
// ownership discussion just above `spaceProjectionUpdate`'s own
// definition below. The caller decides which one to write based on
// whether it read an existing Space document.
// `space`/`spaceProjectionUpdate`/`project`/each session's/batch's `data`
// do NOT include `syncedAt` - see the file header. The caller adds it
// before writing.
function deriveFullReprojectionDocs(planId, plan) {
  const ids = computeShadowIds(planId, plan);
  const planVersion = typeof plan.shadowSourceVersion === "number" ? plan.shadowSourceVersion : 1;
  const isComplete = !!plan.companionComplete;
  const latestProgressPhoto = Array.isArray(plan.progressPhotos) && plan.progressPhotos.length
    ? plan.progressPhotos[plan.progressPhotos.length - 1].url
    : null;
  const currentEvidencePhotoUrl = latestProgressPhoto || plan.photoUrl || null;
  const provenance = { sourcePlanId: planId, shadowSchemaVersion: SHADOW_SCHEMA_VERSION, sourceVersion: planVersion };

  const space = { ...provenance, createdAt: plan.createdAt, displayName: getSpaceDisplayName(plan), activeProjectId: ids.projectId };
  // Canonical Space Preservation (CanonicalSpacePreservationDesign.md /
  // Remembered Home v1 Step 1 follow-up). `space` above is the FULL
  // document shape - correct only when the Space does not exist yet; a
  // caller writes it verbatim exactly once, at creation. For every
  // subsequent sync/repair of an ALREADY-EXISTING Space, only the field(s)
  // below may ever be touched:
  //   - creation-owned (createdAt, sourcePlanId, sourceVersion,
  //     shadowSchemaVersion - the identity/schema-version of the Space's
  //     own founding write, not of whichever Project happens to sync
  //     next; never read back by any consumer, and semantically undefined
  //     once a Space aggregates multiple Projects each with their own
  //     independent version counters)
  //   - user-owned (displayName - updated only through the explicit
  //     rename path, see renameSpace/renameSpaceAdmin, never through
  //     ordinary projection sync - an unrelated Project syncing later
  //     with its own stale spaceType/spaceName must never silently revert
  //     a rename)
  //   - merge-owned (retired, redirectTo, retiredAt, mergeExecutionId -
  //     written once by merge execution's retirement phase,
  //     scripts/executeMerge.js's retireLosingSpacesAdmin)
  // are all excluded here, so a caller that writes this object against an
  // existing Space document with set(..., {merge:true}) structurally
  // cannot alter any of them - there is no field left in the payload that
  // could. activeProjectId is the one field genuinely owned by
  // projection: "the Project that synced most recently" has no other
  // authoritative source by design (this field is write-only/diagnostic
  // today, read by no live UI), so most-recent-write-wins is the correct,
  // deliberate semantics for it, not a gap.
  const spaceProjectionUpdate = { activeProjectId: ids.projectId };
  const project = {
    ...provenance,
    migrationVersion: MIGRATION_VERSION,
    scopeType: "Space",
    scopeId: ids.spaceId,
    status: isComplete ? "completed" : "active",
    startingEvidence: { photoUrl: plan.photoUrl || null, capturedAt: plan.createdAt },
    currentEvidence: { photoUrl: currentEvidencePhotoUrl, capturedAt: plan.createdAt },
    createdAt: plan.createdAt,
    completedAt: plan.companionComplete?.completedAt || null,
    abandonedAt: null,
    supersededAt: null,
  };

  const clusters = reconstructSessionClusters(plan);
  const sessions = clusters.map((cluster, sessionIndex) => {
    const sessionId = `${planId}-session${sessionIndex + 1}`;
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    const sessionHasCurrent = cluster.some((e) => e.isCurrent);
    const sessionData = {
      ...provenance,
      projectId: ids.projectId,
      startedAt: first.completedAt || first.suggestedAt || plan.createdAt,
      endedAt: sessionHasCurrent ? null : (last.completedAt || null),
      status: sessionHasCurrent ? "active" : "ended",
    };
    const batches = cluster.map((entry) => ({
      id: computeShadowBatchId(planId, entry.batchIndex),
      data: {
        ...provenance,
        batchIndex: entry.batchIndex,
        items: entry.items,
        suggestedAt: entry.suggestedAt,
        completedAt: entry.completedAt,
        originalPhotoUrl: entry.isCurrent ? (plan.photoUrl || null) : null,
        progressPhotoUrl: entry.isCurrent ? latestProgressPhoto : null,
      },
    }));
    return { id: sessionId, data: sessionData, batches };
  });

  return { ids, sourceVersion: planVersion, space, spaceProjectionUpdate, project, sessions };
}

// Pure. Given a plan and already-fetched shadow data, decides migration
// completeness. Never reads anything itself - the caller supplies:
//   space: plain Space doc data, or null/undefined if missing
//   project: plain Project doc data, or null/undefined if missing
//   sessionsWithBatches: [{ id, data, batches: [{ id, data }] }] - every
//     Session document actually present, each with its actual Batch
//     documents. An empty array means no Sessions exist.
// Checks: Space/Project presence; migrationVersion match; source-version
// freshness (delegates to evaluateSpaceShadowValidation, not a second
// copy of that comparison); ownership (Project.scopeId -> Space,
// Session.projectId -> Project); §12 Session-reconstruction correctness
// (every expected Session/Batch, per reconstructSessionClusters, is
// present, and no unexpected ones are).
function evaluateMigrationCompleteness(planId, plan, { space, project, sessionsWithBatches } = {}) {
  const reasons = [];
  if (!plan) return { complete: false, reasons: ["source plan missing"] };
  if (!space || !project) {
    reasons.push("Space or Project document missing");
    return { complete: false, reasons };
  }
  const ids = computeShadowIds(planId, plan);

  if (project.migrationVersion !== MIGRATION_VERSION) {
    reasons.push(`migrationVersion mismatch: expected ${MIGRATION_VERSION}, found ${project.migrationVersion ?? "(absent)"}`);
  }

  const freshnessFindings = evaluateSpaceShadowValidation(plan, { project });
  if (freshnessFindings.some((f) => f.status === "STALE")) {
    reasons.push(`source version mismatch: ${JSON.stringify(freshnessFindings)}`);
  }

  if (project.scopeId !== ids.spaceId) reasons.push(`Project.scopeId (${project.scopeId}) does not point at Space (${ids.spaceId})`);

  const expectedClusters = reconstructSessionClusters(plan);
  const sessionsById = new Map((sessionsWithBatches || []).map((s) => [s.id, s]));
  for (let i = 0; i < expectedClusters.length; i++) {
    const sessionId = `${planId}-session${i + 1}`;
    const session = sessionsById.get(sessionId);
    if (!session) { reasons.push(`expected Session ${sessionId} missing`); continue; }
    if (session.data.projectId !== ids.projectId) reasons.push(`Session ${sessionId}.projectId does not point at Project ${ids.projectId}`);
    const batchesById = new Map((session.batches || []).map((b) => [b.id, b]));
    for (const entry of expectedClusters[i]) {
      const batchId = computeShadowBatchId(planId, entry.batchIndex);
      if (!batchesById.has(batchId)) reasons.push(`expected Batch ${batchId} missing under Session ${sessionId}`);
    }
  }
  const expectedSessionIds = new Set(expectedClusters.map((_, i) => `${planId}-session${i + 1}`));
  const unexpectedSessions = (sessionsWithBatches || []).filter((s) => !expectedSessionIds.has(s.id));
  if (unexpectedSessions.length) reasons.push(`unexpected Session document(s) present: ${unexpectedSessions.map((s) => s.id).join(", ")}`);

  return { complete: reasons.length === 0, reasons };
}

// ---- §12 Migration, Part 2: merge-candidate detection ----
// Bump if the clustering criteria (currently: exact spaceType match, 2+
// plans) ever change - lets a future stricter/looser ruleset be
// distinguished from candidates detected under an older one, the same
// purpose MIGRATION_VERSION serves for structural projection.
const DETECTION_VERSION = 1;

// Pure. Groups a user's plans into Tier 1 merge-candidate clusters:
// plans sharing the same display name (getSpaceDisplayName - the user's
// spaceName if set, else the AI's spaceType), where 2 or more plans
// share it. A name only one plan has never forms a cluster. Tier 2
// (everything else) is deliberately not computed here - by design it is
// never detected or stored proactively, only derived on demand at
// display time (see SpaceMemoryModel.md §12 scoping). Never reads
// Firestore - `plans` is the caller's already-fetched list.
//
// Reads getSpaceDisplayName, not plan.data.spaceType directly - this is
// the Invariant declared above getSpaceDisplayName's definition:
// detection must group on the exact same name the user sees, or a
// rename could leave stale, contradictory clustering behind.
function detectMergeCandidates(plans) {
  const bySpaceType = new Map();
  for (const plan of plans) {
    // §12 Migration Part 4 (MergeExecutionDesign.md §12, "confirmed-cluster
    // growing" case, resolved): a plan that already LOST a prior merge -
    // canonicalSpaceId points at a DIFFERENT Space than its own id - has
    // its identity question permanently answered. Proposing it again
    // (e.g. against a new same-labeled plan) would ask the user to
    // re-answer something its own earlier merge already settled, and
    // re-detection would otherwise recreate a redundant candidate for an
    // already-merged group forever. A plan that IS a merge survivor
    // (canonicalSpaceId absent, or equal to its own id) is unaffected -
    // it's still a real, independent plan with its own real label, fully
    // eligible to be proposed against a genuinely new same-labeled plan.
    if (plan.data && plan.data.canonicalSpaceId && plan.data.canonicalSpaceId !== plan.id) continue;
    const spaceType = plan.data && getSpaceDisplayName(plan.data);
    if (!spaceType) continue;
    if (!bySpaceType.has(spaceType)) bySpaceType.set(spaceType, []);
    bySpaceType.get(spaceType).push(plan.id);
  }
  const clusters = [];
  for (const [spaceType, planIds] of bySpaceType.entries()) {
    if (planIds.length < 2) continue;
    clusters.push({ spaceType, planIds: [...planIds].sort() });
  }
  return clusters;
}

// Pure. Given an existing mergeCandidates document's data and the
// current state of every plan referenced in its (frozen) planIds -
// currentPlansById: { [planId]: planData | undefined/null if that plan
// no longer exists } - decides what should happen to it on this
// detection run.
//
// Only ever meant to be called for documents whose resolutionStatus is
// "dismissed" or "confirmed-merge" - these are frozen: their planIds are
// never refreshed from current reality, only checked for continued
// validity, so a cluster growing a new same-labeled plan never silently
// alters an already-decided document (the "growing cluster" question is
// explicitly out of scope for this pass - see SpaceMemoryModel.md §12).
// "pending" documents are handled separately by the caller, by direct
// comparison against detectMergeCandidates' fresh output, since pending
// clusters ARE fully re-derived each run. "stale-confirmed" and
// "superseded" documents should never be passed here at all - both are
// terminal, no further reprocessing.
//
// "supersede" (renamed from "delete", §12 Migration Part 3 Pass 2 -
// MergeProposalDesign.md's terminal-supersession prerequisite): the
// caller must mark the document superseded, not physically delete it -
// this pure function only decides WHAT should happen, never how the
// caller records it, so the rename only affects the vocabulary of the
// decision, not this function's logic.
function evaluateCandidateInvalidation(candidateDoc, currentPlansById) {
  let invalidReason = null;
  let validCount = 0;
  for (const planId of candidateDoc.planIds) {
    const plan = currentPlansById[planId];
    if (!plan) {
      if (!invalidReason) invalidReason = `plan ${planId} no longer exists`;
      continue;
    }
    if (getSpaceDisplayName(plan) !== candidateDoc.spaceType) {
      if (!invalidReason) invalidReason = `plan ${planId} display name changed to ${JSON.stringify(getSpaceDisplayName(plan))}`;
      continue;
    }
    validCount++;
  }
  if (validCount >= 2) return { action: "keep" };
  if (candidateDoc.resolutionStatus === "confirmed-merge") {
    return { action: "mark-stale", staleReason: invalidReason || "fewer than 2 valid members remain" };
  }
  return { action: "supersede" };
}

// ---- §12 Migration, Part 4: merge execution ----
// MergeExecutionDesign.md §2/§3/§7/§8. Pure decision logic only - every
// function here takes already-fetched plain data (never reads Firestore
// itself) and returns a plain decision, matching every other function in
// this file. Admin-SDK and client-SDK I/O shells call into these and are
// responsible for their own reads/writes.

// Pure. MergeExecutionDesign.md §7's explicit acceptable-drift/staleness
// split, evaluated fresh - never a precomputed "eligible" bit persisted
// anywhere (MergeProposalDesign.md §1's governing principle, carried
// forward unchanged into execution).
//
//   candidateDoc: { resolutionStatus, confirmedPlanIds, expectedSpaceState }
//   plansById: { [planId]: planData | null }        - null/undefined = doesn't exist
//   projectsById: { [planId]: projectData | null }  - each plan's OWN
//     current Project doc, already read at ITS current canonical path
//     (i.e. the caller already resolved computeShadowIds(planId, plan)
//     before fetching it) - null/undefined = no Project yet.
//
// Returns { eligible, terminalReasons, retryableReasons }. eligible is
// true iff both reason arrays are empty. Terminal reasons route into the
// existing stale-confirmed flow (no new UI); retryable reasons (today:
// only a migrationVersion mismatch) self-heal via forceFullReprojection
// and are never shown to the user.
function evaluateMergeExecutionEligibility(candidateDoc, plansById, projectsById) {
  const terminalReasons = [];
  const retryableReasons = [];

  if (candidateDoc.resolutionStatus !== "confirmed-merge") {
    terminalReasons.push(`candidate resolutionStatus is "${candidateDoc.resolutionStatus}", not "confirmed-merge" - the user's own later action already supersedes this execution attempt`);
    // No further checks are meaningful once the confirmation itself is no
    // longer current - every other check below assumes confirmedPlanIds
    // still reflects a live decision.
    return { eligible: false, terminalReasons, retryableReasons };
  }

  const confirmedPlanIds = candidateDoc.confirmedPlanIds || [];
  const confirmedSet = new Set(confirmedPlanIds);
  const expectedSpaceState = candidateDoc.expectedSpaceState || {};

  for (const planId of confirmedPlanIds) {
    const plan = plansById[planId];
    if (!plan) {
      terminalReasons.push(`plan ${planId} no longer exists`);
      continue;
    }

    // A plan already canonically pointed at a Space outside this exact
    // confirmed group is a genuine conflict (already merged elsewhere by a
    // separate execution since confirmation). Pointed at itself, or at
    // another member of THIS group (e.g. a prior partial/idempotent
    // execution attempt), is not a conflict - see MergeExecutionDesign.md
    // §7.
    if (plan.canonicalSpaceId && plan.canonicalSpaceId !== planId && !confirmedSet.has(plan.canonicalSpaceId)) {
      terminalReasons.push(`plan ${planId} was already merged into a different Space (${plan.canonicalSpaceId}) since this was confirmed`);
      continue;
    }

    const project = projectsById[planId];
    const expected = expectedSpaceState[planId];

    if (project && expected && typeof expected.migrationVersion === "number" && project.migrationVersion !== expected.migrationVersion) {
      retryableReasons.push(`plan ${planId}: migrationVersion mismatch (expected ${expected.migrationVersion}, found ${project.migrationVersion}) - self-heals via forceFullReprojection`);
    }

    // Acceptable drift, explicitly NOT checked here (MergeExecutionDesign.md
    // §7): display-name changes, and sourceVersion increasing due to
    // ordinary continued use. Only a REGRESSION (current < snapshotted) is
    // ever flagged, and only as a terminal anomaly - versions must only
    // ever increase under normal operation.
    if (project && expected && typeof expected.sourceVersion === "number" && typeof project.sourceVersion === "number" && project.sourceVersion < expected.sourceVersion) {
      terminalReasons.push(`plan ${planId}: sourceVersion regressed (expected at least ${expected.sourceVersion}, found ${project.sourceVersion}) - anomalous, not ordinary drift`);
    }
  }

  return { eligible: terminalReasons.length === 0 && retryableReasons.length === 0, terminalReasons, retryableReasons };
}

// Pure. MergeExecutionDesign.md §3, canonical Space identity: the plan
// with the earliest createdAt among confirmedPlanIds; ties (identical
// createdAt) broken by lexicographically smallest planId, matching
// computeMergeCandidateId's own sort convention elsewhere in this file.
// plansById: { [planId]: planData }, every confirmedPlanId already known
// to exist (callers run this only after evaluateMergeExecutionEligibility
// reports eligible: true).
function selectMergeSurvivor(confirmedPlanIds, plansById) {
  const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : Number.POSITIVE_INFINITY));
  const sorted = [...confirmedPlanIds].sort((a, b) => {
    const diff = toMillis(plansById[a].createdAt) - toMillis(plansById[b].createdAt);
    if (diff !== 0) return diff;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted[0];
}

// Pure. MergeExecutionDesign.md §3, canonical display name: prefer the
// survivor's own effective name; otherwise, among the OTHER confirmed
// plans, prefer the most-recently-created plan's effective name. Not
// necessarily the survivor's own name, and not necessarily computed from
// the same plan selectMergeSurvivor chose for identity - deliberately, per
// the design doc's "don't assume one source wins every field" instruction.
function resolveCanonicalDisplayNameForMerge(survivorPlanId, confirmedPlanIds, plansById) {
  const survivorName = getSpaceDisplayName(plansById[survivorPlanId]);
  if (survivorName) return survivorName;

  const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : 0));
  const others = confirmedPlanIds.filter((id) => id !== survivorPlanId)
    .map((id) => plansById[id])
    .filter((plan) => !!getSpaceDisplayName(plan))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)); // most recent first

  return others.length ? getSpaceDisplayName(others[0]) : null;
}

// Pure. MergeExecutionDesign.md §3, canonical starting evidence: the
// EARLIEST-created plan among confirmed plans that actually has a
// non-null photoUrl - may not be the same plan selectMergeSurvivor chose.
// Returns { photoUrl, capturedAt, sourcePlanId } or null if no confirmed
// plan has a photo at all.
function resolveCanonicalStartingEvidenceForMerge(confirmedPlanIds, plansById) {
  const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : Number.POSITIVE_INFINITY));
  const withPhotos = confirmedPlanIds
    .map((id) => ({ id, plan: plansById[id] }))
    .filter((entry) => !!entry.plan.photoUrl)
    .sort((a, b) => toMillis(a.plan.createdAt) - toMillis(b.plan.createdAt));

  if (!withPhotos.length) return null;
  const chosen = withPhotos[0];
  return { photoUrl: chosen.plan.photoUrl, capturedAt: chosen.plan.createdAt, sourcePlanId: chosen.id };
}

// ---- Remembered Home v1: target-Space validation ----
// Pure. RememberedHomeDesign.md §3 Point 2 / Implementation Step 1 Point 2:
// a returning visit must never silently create a plan/Project under a
// Space that no longer canonically exists - e.g. one retired by a merge
// that happened between the user navigating to it and tapping "Organize
// Again". Takes already-fetched Space document data (or null/undefined if
// the doc doesn't exist) and returns a decision, never reads Firestore
// itself - the caller (savePlanToHistory) does its own read and passes the
// result in, same pattern as every other pure decision function in this
// file. "The user has access to it" is not a separate check here: this
// function is only ever called with a Space doc read from
// users/{uid}/spaces/{spaceId} under the authenticated user's own uid, so
// access is already enforced by that path scoping (and by Firestore rules)
// before this function ever sees the data - there is no cross-user access
// path for it to validate.
function validateTargetSpace(spaceData) {
  if (!spaceData) return { valid: false, reason: "space-not-found" };
  if (spaceData.retired === true) return { valid: false, reason: "space-retired" };
  return { valid: true, reason: null };
}

// ---- Remembered Home v1 Step 3: Generic Camera Recognition ----
// Pure. RememberedHomeDesign.md §2 / Implementation Step 3. Given a fresh
// AI label and a list of plain plan entries ({ id, data }) - the caller's
// already-loaded history cache, targeted-query results, or both, merged -
// finds every plan whose getSpaceDisplayName exactly matches freshLabel
// (the only v1 signal, deliberately not fuzzy - see RememberedHomeDesign.md
// §2a), resolves each match to its canonical Space id via computeShadowIds
// (so a plan that already lost a prior merge resolves to the surviving
// Space, never its own retired one - §12 Migration Part 4's resolution
// rule, reused unchanged here), dedupes by that resolved id (two matching
// plans that both belong to the same already-merged Space collapse into
// ONE candidate, keeping whichever matching plan is itself most recently
// created as that candidate's representative evidence - photo/date/work
// summary), sorts most-recently-organized first, and caps at 3
// (RememberedHomeDesign.md §2b's "cap at recognize, not review" anti-goal,
// given a concrete number here). Never reads Firestore itself - the
// caller (findRecognitionCandidates, App.js) does its own reads.
//
// Returns [] when nothing matches - the caller's signal for "no proposal,
// straight to fresh-start, zero added friction," never a special case
// this function itself has to represent differently.
function resolveRecognitionCandidates(freshLabel, plans) {
  if (!freshLabel) return [];
  const matches = (plans || []).filter((p) => p && p.data && getSpaceDisplayName(p.data) === freshLabel);

  const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : 0));
  const byCanonicalId = new Map();
  for (const p of matches) {
    const canonicalSpaceId = computeShadowIds(p.id, p.data).spaceId;
    const createdAtMs = toMillis(p.data.createdAt);
    const existing = byCanonicalId.get(canonicalSpaceId);
    if (!existing || createdAtMs > existing.createdAtMs) {
      byCanonicalId.set(canonicalSpaceId, { canonicalSpaceId, planId: p.id, data: p.data, createdAtMs });
    }
  }

  return [...byCanonicalId.values()]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 3)
    .map(({ canonicalSpaceId, planId, data }) => ({
      canonicalSpaceId,
      representativePlanId: planId,
      displayName: getSpaceDisplayName(data),
      lastOrganizedAt: data.createdAt,
      priorPhotoUrl: (Array.isArray(data.progressPhotos) && data.progressPhotos.length
        ? data.progressPhotos[data.progressPhotos.length - 1].url
        : null) || data.photoUrl || null,
      workSummary: summarizeRecognitionCandidateWork(data),
      // Raw unresolved item text ("carried"/"pending", same two-value
      // definition as Step 2's prompt-context filter) - not just the
      // narrated summary. Exists so a confirming caller can literally
      // carry these items forward onto the new plan's own first checklist
      // (see App.js's carryForwardUnresolvedItems) - the mechanism Step 3
      // actually uses for prior-context hand-off, since (unlike Step 2)
      // the target Room here is only known AFTER the AI call already
      // returned, so there is no point at which this data could instead
      // enrich that call's own prompt the way Step 2's does.
      unresolvedItems: ((data.currentBatch && data.currentBatch.items) || [])
        .filter((i) => i.status === "carried" || i.status === "pending")
        .map((i) => i.text)
        .filter(Boolean),
    }));
}

// Pure. One-line, data-driven summary of a candidate's prior work, from
// fields already on the plan document - no new data, just narration.
// RememberedHomeDesign.md §2b's "one-line summary of prior work," made
// concrete. "carried"/"pending" (unresolved) is counted separately from
// "checked" (done) and "skipped" (explicitly declined) - the same
// three-way status vocabulary already established for prior-context
// prompting (Step 2's unresolved-items filter), reused here for narration
// instead of AI context.
function summarizeRecognitionCandidateWork(data) {
  const items = (data.currentBatch && data.currentBatch.items) || [];
  if (!items.length) {
    return data.companionComplete ? "You completed this room." : null;
  }
  const total = items.length;
  const checkedCount = items.filter((i) => i.status === "checked").length;
  if (checkedCount === 0) return `You had ${total} item${total === 1 ? "" : "s"} left to do.`;
  if (checkedCount === total) return `You'd cleared all ${total} item${total === 1 ? "" : "s"}.`;
  return `You'd cleared ${checkedCount} of ${total} items and left the rest for next time.`;
}

module.exports = {
  SHADOW_SCHEMA_VERSION,
  MIGRATION_VERSION,
  SESSION_GAP_THRESHOLD_MS,
  DETECTION_VERSION,
  CANDIDATE_KEY_VERSION,
  computeMergeCandidateId,
  getSpaceDisplayName,
  computeShadowIds,
  computeShadowBatchId,
  reconstructSessionClusters,
  deriveFullReprojectionDocs,
  evaluateMigrationCompleteness,
  detectMergeCandidates,
  evaluateCandidateInvalidation,
  evaluateMergeExecutionEligibility,
  selectMergeSurvivor,
  resolveCanonicalDisplayNameForMerge,
  resolveCanonicalStartingEvidenceForMerge,
  validateTargetSpace,
  resolveRecognitionCandidates,
  summarizeRecognitionCandidateWork,
};
