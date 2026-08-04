// Pure, SDK-neutral validation logic for the Space shadow graph. No
// Firestore imports, no client/admin SDK dependency - takes plain data
// already extracted from whichever SDK read it (client snap.data() or
// admin snap.data()), so the exact same function is callable from both
// App.js (React Native client, imported via Metro/Babel's CommonJS
// interop) and scripts/validateSpaceMigration.js (Node admin CLI, via
// plain require()). Written as CommonJS (module.exports) specifically so
// require() works unmodified in the CLI without any transform step.
//
// Freshness (this file) is deliberately kept separate from structural
// correctness (ownership chain, one-project-per-plan, batch content
// match, etc.), which stays in each caller's own validate function. A
// shadow graph can be structurally perfect and STALE at the same time
// (an older sync already succeeded, a newer mutation hasn't synced yet),
// or structurally broken and current. Callers must concatenate this
// function's findings with their own - never let one axis suppress the
// other in the returned array. STATUS_PRECEDENCE exists only for
// callers that need to collapse findings into a single aggregate status
// for display/exit-code purposes; it never removes any individual
// finding from the underlying array.

const STATUS_PRECEDENCE = ["MISSING", "MISMATCH", "STALE", "OK"];

function computeAggregateStatus(findings) {
  for (const status of STATUS_PRECEDENCE) {
    if (findings.some((f) => f.status === status)) return status;
  }
  return "OK";
}

// planData: plain plan document data (must be read by the caller first).
// shadowData: { project: <plain project document data, or null/undefined
//   if the project document doesn't exist>. }
//
// A missing project (shadowData.project falsy) produces no findings here
// - the shadow-presence MISSING condition is already reported separately
// by each caller's own structural check, and freshness has nothing
// meaningful to compare against when there's no project doc at all.
//
// A present project with no sourceVersion field (pre-dates this version
// tracking, or otherwise corrupted) is NOT silently treated as current:
// projectVersion defaults to -1, which is lower than any real
// planVersion (>=0), so it always resolves to STALE, never OK. This is a
// deliberate judgment call (STALE, not MISMATCH): a missing sourceVersion
// means "we cannot confirm this shadow reflects the current plan
// version," which is exactly what STALE signals and self-heals the next
// time syncPlanToSpaceGraph runs for that plan - it is not evidence that
// the write logic itself is broken (which is what MISMATCH means
// elsewhere in these validators), since every Project shadow written
// before this field existed will legitimately lack it.
function evaluateSpaceShadowValidation(planData, shadowData) {
  const findings = [];
  const plan = planData || {};
  const project = shadowData && shadowData.project;
  if (!project) return findings;

  const planVersion = Number.isInteger(plan.shadowSourceVersion) ? plan.shadowSourceVersion : 0;
  const projectVersion = Number.isInteger(project.sourceVersion) ? project.sourceVersion : -1;

  if (planVersion > projectVersion) {
    findings.push({ invariant: "shadow_freshness", status: "STALE", expected: planVersion, found: projectVersion });
  }

  return findings;
}

module.exports = { evaluateSpaceShadowValidation, computeAggregateStatus, STATUS_PRECEDENCE };
