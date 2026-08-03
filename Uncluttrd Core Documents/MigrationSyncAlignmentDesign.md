# Migration and Live-Sync Projection Alignment — Scoping Pass

Status: Draft
Version: 0.1 (2026-08-03)
Audience: Everyone implementing the projection-alignment fix, and anyone relying on `checkMigrationCompleteness` as a trustworthy signal
Purpose: Explains why `forceFullReprojection` and `syncPlanToSpaceGraph` write different shadow-graph shapes for the same plan, designs a single canonical projection both should use, and defines the regression bar required before this is safe to rely on in production.
Depends on: `App.js`'s Shadow Synchronization block, `shared/spaceMigration.js`, `shared/spaceShadowValidation.js`, SpaceMemoryModel.md §12 (Migration Invariant), MergeExecutionDesign.md (canonicalSpaceId)

This document does not implement anything. Following the established notation: `[Observation]` (directly verified against real source, read fresh for this pass, not recalled), `[Inference]` (reasoning drawn from observations), `[Decision]` (a choice made).

**No production migration should run until this is resolved** — a plan that appears migration-complete today can silently stop being so after its very next ordinary use.

---

## 0. Where this was already partially confirmed

[Observation] A real staging repro, run earlier in this same investigation with zero merge/canonicalSpaceId involvement, already demonstrated the core symptom directly: a plan structurally migrated via `forceFullReprojection` (`migrationVersion: 1`, `checkMigrationCompleteness: complete`) then given one ordinary live sync (simulating a Pause) came back with `migrationVersion: (absent)` and `"unexpected Session document(s) present: {planId}"`. Task 1 below explains precisely why.

---

## 1. The exact divergence

[Observation] Read directly from `App.js` (`syncPlanToSpaceGraph`, lines 540-652; `forceFullReprojection`, lines 786-820) and `shared/spaceMigration.js` (`deriveFullReprojectionDocs`, lines 179-233; `reconstructSessionClusters`, lines 138-172) — current source, this pass, not recalled from any earlier report.

### Space document

| Field | `forceFullReprojection` | `syncPlanToSpaceGraph` | Diverges? |
|---|---|---|---|
| `sourcePlanId`, `shadowSchemaVersion`, `sourceVersion` | from `plan` | from `plan` | No |
| `createdAt` | `plan.createdAt` | `plan.createdAt` | No |
| `displayName` | `getSpaceDisplayName(plan)` | `getSpaceDisplayName(plan)` | No |
| `activeProjectId` | `ids.projectId` | `projectId` | No |
| `syncedAt` | SDK-specific sentinel, added by caller | same | No (mechanically identical) |

**No divergence.** Worth stating plainly since the table must cover everything, not just the broken parts.

### Project document

| Field | `forceFullReprojection` | `syncPlanToSpaceGraph` | Diverges? |
|---|---|---|---|
| `sourcePlanId`, `shadowSchemaVersion`, `sourceVersion` | from `plan` | from `plan` | No |
| **`migrationVersion`** | **`MIGRATION_VERSION` (1)** | **absent — field is never written** | **YES** |
| `scopeType`, `scopeId` | `"Space"`, `ids.spaceId` | `"Space"`, `spaceId` | No |
| `status`, `startingEvidence`, `currentEvidence`, `createdAt`, `completedAt`, `abandonedAt`, `supersededAt` | derived from `plan` | identically derived from `plan` | No |

**One divergence, but the important one.** `syncPlanToSpaceGraph` builds its Project object as a plain literal with no `migrationVersion` key at all, then writes it with `tx.set()` — a full overwrite, not a merge. Any `migrationVersion` a prior `forceFullReprojection` wrote is not preserved; it is erased.

### Session document(s)

| | `forceFullReprojection` | `syncPlanToSpaceGraph` | Diverges? |
|---|---|---|---|
| Count | `reconstructSessionClusters(plan).length` — one per gap-separated cluster of batch activity | always exactly 1 | **YES** |
| ID scheme | `${planId}-session${i+1}` | bare `planId` (from `computeShadowIds`) | **YES** |
| `startedAt`/`endedAt`/`status` | per-cluster first/last activity timestamps | collapsed across the plan's *entire* history | **YES (semantically — same field names, different meaning)** |

This is the largest divergence, and it compounds: because the two functions write to **different document IDs**, neither overwrites the other. A plan that has been through both at different times ends up with *both* sets of Session documents live simultaneously — the reconstructed set from the last `forceFullReprojection`, now orphaned, and a new bare-`planId` one from the most recent live sync.

### Batch documents

| | `forceFullReprojection` | `syncPlanToSpaceGraph` | Diverges? |
|---|---|---|---|
| ID scheme | `computeShadowBatchId(planId, batchIndex)` = `${planId}-batch${n}` | identical | **No** |
| Count | one per `batchHistory` entry + current | identical | **No** |
| Data fields (`items`, `suggestedAt`, `completedAt`, `originalPhotoUrl`, `progressPhotoUrl`) | derived per-entry, current-batch gets photo fields, archived batches don't | **identical derivation, field-for-field** | **No** |
| Parent (which Session it nests under) | whichever reconstructed cluster it belongs to | the single bare-`planId` session | **YES (indirectly — same ID, different path)** |

[Inference] Batch *content* derivation was never the problem — it's identical in both functions. The divergence is entirely about which Session a batch is filed under, which is a direct consequence of the Session-count/ID divergence above, not a separate bug.

### Net effect once both have run against the same plan

[Observation] Because Session IDs differ, nothing is ever overwritten or reconciled between the two schemes — old and new coexist. `evaluateMigrationCompleteness` (`shared/spaceMigration.js:248-286`) computes its *expected* Session set from `reconstructSessionClusters(currentPlan)` and compares it against whatever Session documents are actually present. The extra bare-`planId` session from any live sync is never in that expected set, so it is flagged: `"unexpected Session document(s) present: {planId}"`. Combined with the missing `migrationVersion`, a plan that was genuinely complete moments ago now fails both checks — exactly the repro in §0.

---

## 2. Which projection is canonically correct

[Decision] `forceFullReprojection`'s shape — multi-Session reconstruction from `batchHistory` timestamps, `migrationVersion` present — is the target. This isn't a judgment call; it's already settled: SpaceMemoryModel.md's Migration Invariant states migration "SHALL further reconstruct Session boundaries from the legacy plan's existing batchHistory timestamps wherever they are distinguishable, rather than collapsing all historical activity into one undifferentiated record."

**Does `syncPlanToSpaceGraph` currently produce this shape? No.** It collapses every batch, archived or current, into one Session, and never writes `migrationVersion` at all.

**Why was it built that way?** [Observation] The source's own comments answer this directly, not by inference. `syncPlanToSpaceGraph`'s header (`App.js:525-539`) calls itself "the single owner of 'derive shadow state from the current plan'" — written as the general live-projection function. `forceFullReprojection`'s header (`App.js` above line 786) is explicit about the relationship, quoted verbatim:

> "Deliberately distinct from `syncPlanToSpaceGraph`, not a thin variant of it. ... It also differs from `syncPlanToSpaceGraph` on the merits, not just by dropping a guard: per SpaceMemoryModel.md §12's committed Migration Invariant, migration must 'reconstruct Session boundaries...' `syncPlanToSpaceGraph` always writes exactly one Session (sessionId = planId) — correct for its own job (projecting live current state) but not compliant with §12 for a first-time migration. `forceFullReprojection` does real Session reconstruction instead."

[Inference] This means the divergence was known and deliberate *at the time `forceFullReprojection` was written* — the author recognized `syncPlanToSpaceGraph` didn't do Session reconstruction and built a second function specifically because of that gap. What the comment does not address, and what this scoping pass exists to close, is the downstream consequence: once a plan has been migrated by the newer, correct function, every subsequent live mutation runs through the older, simpler one and silently regresses it. The gap was scoped at the moment of divergence, not at the moment of reconvergence.

---

## 3. Designing one canonical projection

### Evaluating the design review's four points

**"Extract the migrated Session reconstruction into shared projection logic."** [Observation] This is already done — `reconstructSessionClusters` is already a pure, shared function in `shared/spaceMigration.js`, already used by both `deriveFullReprojectionDocs` and `evaluateMigrationCompleteness`. The gap isn't that it needs extracting; it's that `syncPlanToSpaceGraph` has its own separate inline single-Session derivation in `App.js` instead of calling the function that already exists. [Decision] The actual fix is narrower than "extract": make `syncPlanToSpaceGraph` call `deriveFullReprojectionDocs` for its payload, the same function `forceFullReprojection` already calls.

**"Store enough durable Session metadata that live sync does not need to rediscover old boundaries."** [Decision] Evaluated and **rejected as unnecessary**, for a concrete reason, not by default. `reconstructSessionClusters` clusters by comparing each entry only to its immediate predecessor in a single left-to-right pass. [Observation] Every real mutation call site that grows `batchHistory` (the "next batch" flow, `App.js:2745-2762`) does so via `arrayUnion`, always appending the newest activity — never reordering or backdating existing entries. [Inference] Given append-only growth, a new batch can only ever affect the clustering decision for *itself* (does it extend the current trailing cluster, or start a new one) — it can never retroactively change where earlier boundaries fall, because the algorithm never revisits earlier comparisons. This means `reconstructSessionClusters` is **stable under the actual way this data changes**: recomputing it fresh, live, on every sync produces the same IDs for every session that existed before, and only ever appends to the last one or adds a new trailing one. No durable "remembered" boundary state is needed — the plan's own current `batchHistory` is already sufficient input, and live sync already reads the whole plan document, so nothing new needs to be stored. [Decision] If a future trigger is ever added that could reorder or backdate `batchHistory` (none exists today, per the six real call sites read for this pass), this stability property would need to be re-verified before relying on it — flagged as a standing precondition, not a currently open risk.

**"Have both `forceFullReprojection` and `syncPlanToSpaceGraph` call the same graph builder."** [Decision] Feasible, and the correct fix. `deriveFullReprojectionDocs` already *is* "the same graph builder" — it takes a plan and returns the full derived Space/Project/Sessions/Batches payload with no I/O. `syncPlanToSpaceGraph` should replace its own inline derivation with a call to it. Concretely: `syncPlanToSpaceGraph` keeps its existing transaction shape (read plan, read Project for the version guard, decide skip-or-write) but, once it decides to write, uses `deriveFullReprojectionDocs(planId, plan)`'s output instead of hand-building a single Space/Project/Session/Batch set. This closes both remaining divergences at once: `migrationVersion` is included because `deriveFullReprojectionDocs` already writes it, and Session count/IDs match because both functions now derive them the same way.

**"Reserve `forceFullReprojection` for bypassing version/completeness skips, not for producing a different schema."** [Decision] This becomes true automatically once the point above is done. The only remaining difference between the two functions becomes *when* they write — `syncPlanToSpaceGraph` checks `existingVersion > planVersion` and skips if a newer shadow already exists; `forceFullReprojection` writes unconditionally (its own documented job: "unconditional, no internal completeness/staleness decision beyond ... plan-existence"). Both would produce byte-identical payloads for the same plan state. The version guard is a pure "read one field, compare, decide" check on the Project document, completely orthogonal to what gets derived — unifying the payload doesn't complicate it.

### A residual risk, named rather than assumed away

[Decision] `tx.set()` only *writes* the documents in the current derived set — it never deletes a Session/Batch that existed under a previous derivation but isn't part of the current one. The stability argument above means this shouldn't be reachable in practice (earlier Sessions never change identity), but it is worth stating precisely: this design does not defend against non-monotonic `batchHistory` mutation. It defends against the one way this data actually changes today.

### Sub-question: unmigrated plans during the transition

[Inference] This is where unification produces a genuinely good emergent property, not just a fix. Today, an unmigrated plan's first live sync produces the *wrong* (single-Session) shape, and only an explicit `forceFullReprojection` run produces the *right* one. After unification, both functions produce the identical shape — so a plan that has *never* been through `forceFullReprojection` at all becomes fully §12-compliant, multi-Session-reconstructed, `migrationVersion`-correct the very first time *any* ordinary mutation fires `syncPlanToSpaceGraph`. [Decision] `forceFullReprojection` stops being architecturally required for correctness and becomes purely an operator tool — for bulk-migrating plans that are dormant (no live activity happening naturally) or backfilling ahead of a deadline. The "unmigrated vs. migrated" distinction changes from a *shape* difference (today) to a pure *timing* difference (after this fix) — simpler, not more complex, to reason about during a mixed-population rollout.

### Sub-question: merged plans (`canonicalSpaceId`)

[Observation] Both functions already resolve `computeShadowIds(planId, plan)` identically (`App.js:565`, `shared/spaceMigration.js:180`) — this was already threaded through both in the §12 Migration Part 4 pass. Unification doesn't touch this at all. [Inference] It is a strict improvement for merged plans specifically: today, a post-merge live mutation on a non-survivor plan writes a single collapsed Session under the correct (survivor) path — correct parent, wrong internal shape. After unification, that same mutation reconstructs the plan's *own* full multi-Session history under the correct survivor path — correct parent *and* correct shape. This is exactly the gap the full end-to-end lifecycle pass surfaced in its Phase 7a/7b/7d findings.

### What actually needs to change

- `App.js`: `syncPlanToSpaceGraph`'s derivation body (currently duplicating single-Session logic inline) replaced with a call to `deriveFullReprojectionDocs`, keeping its existing transaction/version-guard structure around that call.
- No changes needed to `forceFullReprojection`, `deriveFullReprojectionDocs`, `reconstructSessionClusters`, `evaluateMigrationCompleteness`, or `computeShadowIds` — they already embody the target shape and already share `reconstructSessionClusters`.
- No new shared infrastructure needs to be *built* — `deriveFullReprojectionDocs` already is the shared graph builder Task 3 asks for. The work is deleting duplicated logic, not adding new logic.
- The Admin-SDK mirror (`scripts/runSpaceMigration.js`'s `syncPlanToSpaceGraphAdmin`, added for staging testability) needs the identical change, so it keeps matching the real client function it mirrors.

---

## 4. What "migration-complete" means after live use

**Must be preserved by every ordinary mutation:**
- `Project.migrationVersion === MIGRATION_VERSION` (now written by both paths).
- `Project.scopeId` pointing at the correct canonical Space.
- Every Session document `reconstructSessionClusters(currentPlan)` expects — matching ID, matching parent — present, with no others.
- Every Batch document present under its currently-expected Session parent.

**May legitimately change, and must not be treated as incompleteness:**
- `sourceVersion` increasing on every mutation (already handled correctly, separately, by `evaluateSpaceShadowValidation`'s freshness/STALE axis — not conflated with structural completeness).
- `status`/`completedAt`/`abandonedAt` reflecting real lifecycle transitions.
- The most recent Session's `endedAt`/`status` shifting between active and ended.
- Batch `items`/`completedAt` content changing as items are worked through.
- **A new trailing Session appearing** when a new batch's timestamp exceeds the gap threshold from the previous one — this is expected structural growth, not drift, and must be distinguished from an *unexpected* Session (one that doesn't match any current cluster at all).

**New invariant, in effect rather than in code:** the existing "unexpected Session document(s) present" check (`shared/spaceMigration.js:281-283`) was *already* the right check — it just couldn't be trusted, because the divergence itself guaranteed a false positive on any plan that had ever been live-synced after migration. Once both writers agree on ID scheme, this check becomes a genuine signal again rather than permanent noise. No new check needs to be invented; an existing one needs to start meaning what it always claimed to mean.

**A related, separate concern for rollout, not for this design:** any plan that has *already* been through this divergence in production (migrated, then live-synced at least once) will already be carrying orphaned bare-`planId` Session/Batch documents. [Decision] Fixing the projection going forward does not retroactively clean these up — a one-time backfill/cleanup pass is a distinct piece of work, sequenced after this fix ships, not part of it.

---

## 5. Required regression bar

[Decision] Ten cases, covering every real trigger call site read directly from source this pass, plus the three non-mutation-trigger scenarios Task 5 names. For each: seed or reuse a **multi-batch** plan (so Session reconstruction is actually exercised, not vacuously single-cluster), run `forceFullReprojection` once, then the case, then assert.

| # | Case | Real trigger (source) | Plan mutation |
|---|---|---|---|
| 1 | Pause | `App.js:2460-2463` | `currentBatch.items` updated, `shadowSourceVersion` incremented |
| 2 | Wrap-up resolve | `App.js:2496-2499` | same shape as Pause |
| 3 | Progress photo / next batch archive | `App.js:2745-2762` | `batchHistory` grows via `arrayUnion`, new `currentBatch` set — the one case that actually changes what `reconstructSessionClusters` sees |
| 4 | Completion | `App.js:2580-2591` | `companionComplete` set |
| 5 | Retroactive save | `App.js:3030-3033` | `currentBatch.items` updated |
| 6 | Rename | `renameSpace`, `App.js:891-893` | `spaceName` set |
| 7 | Post-merge mutation through `canonicalSpaceId` | any of 1-6, applied to a plan whose `canonicalSpaceId` already points at a survivor | same as the underlying case, plus canonical-path verification |
| 8 | Repeated sync | `syncPlanToSpaceGraph` called twice with no plan change between calls | none — must be a clean no-op the second time via the existing version guard |
| 9 | Repair | `repairSpaceShadow` (delegates directly to `syncPlanToSpaceGraph`) | none new — exercises the delegation path itself |
| 10 | Runner rerun | `scripts/runSpaceMigration.js` re-run against an already-migrated, already-synced plan | none — must report `skipped-already-complete`, zero writes |

**Expected result after every case, exactly as specified:**
- `checkMigrationCompleteness(uid, planId).complete === true`.
- Zero *unnecessary* `forceFullReprojection` calls (case 10 proves this at the runner level).
- No duplicate Session or Batch documents (case 3 is the one that actually stresses this, since it's the only trigger that grows `batchHistory` and can legitimately add a new Session).
- `migrationVersion` never absent after any case.

[Decision] This reuses the same real-staging methodology already proven for the merge-execution regression pass (`cluttrd-staging`, synthetic seed-prefixed uid, real triggers via Admin-SDK mirrors, cleanup-and-verify at the end) — no new test infrastructure needs to be built, only new cases run through it once the fix lands.

---

## Closing

The fix this document scopes is small in code (one function's derivation body, replaced with a call already made available by another function) but the failure mode it closes is large: `checkMigrationCompleteness` — the signal every migration runner, every merge-execution eligibility check, and every diagnostic tool trusts — currently cannot stay true across a single Pause. Nothing in §12 Migration Parts 1-4 needs to change; they were built correctly against a projection function that was, at the time, not yet asked to match the one doing the actual live work.
