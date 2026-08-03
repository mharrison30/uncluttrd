# Merge Execution Design — §12 Migration, Part 4

Status: Draft
Version: 0.1 (2026-08-02)
Audience: Everyone implementing merge execution — the final piece of the §12 migration lifecycle
Purpose: Defines the transaction that consolidates two or more user-confirmed-same Spaces into one canonical Space, and every supporting mechanism (canonical mapping, atomicity, restartability, lineage, staleness) required for that transaction to be durable.
Depends on: SpaceMemoryModel.md §12 (Migration Invariant, Restartability Principle), MergeProposalDesign.md (Decision Philosophy, Candidate State Machine, Handoff Contract §8, N-Way Comparison §9), `shared/spaceMigration.js`, `App.js`'s Shadow Synchronization block (lines 79–1032)

This document does not implement anything. It follows MergeProposalDesign.md's claim-classification notation: `[Observation]` (directly verified against real code), `[Inference]` (reasoning drawn from observations), `[Decision]` (a choice made).

---

## 0. Grounding — what execution inherits

[Observation] Verified directly, not from memory of a prior session:

- `computeShadowIds(planId)` (`shared/spaceMigration.js:110-112`) is pure and unconditional: `{ spaceId: planId, projectId: planId, sessionId: planId }`. Every shadow-graph function in `App.js` — `syncPlanToSpaceGraph`, `forceFullReprojection`/`deriveFullReprojectionDocs`, `checkSpaceShadowExists`, `deleteSpaceShadowGraph`, `reconcileActivePlanShadow`, `checkMigrationCompleteness`, `buildExpectedSpaceState` — derives its Firestore paths from this one function.
- `syncPlanToSpaceGraph` (`App.js:534-639`) is a `runTransaction` that reads the plan and the existing Project doc, compares `plan.shadowSourceVersion` against `Project.sourceVersion`, and no-ops if the existing shadow is already at or ahead. This exact guard pattern — read-compare-write inside one transaction, trusting Firestore's own conflict retry — is the precedent Task 8 reuses for execution's own claim step.
- `forceFullReprojection`/`deriveFullReprojectionDocs` (`App.js:763-797`, `shared/spaceMigration.js:168-222`) unconditionally rebuild the *entire* Space/Project/Session/Batch graph from the live plan document — every Session reconstructed from `batchHistory` via `reconstructSessionClusters`, every Batch. This is the function Task 5 reuses wholesale.
- `mergeCandidates/{candidateId}` (content-derived ID, `computeMergeCandidateId`) already carries `confirmedPlanIds`, `expectedSpaceState: { [planId]: { sourceVersion, migrationVersion } }`, and `confirmationEventId` pointing at an immutable `history/{eventId}` entry (`App.js:898-960`). History entries already declare `actor: "detector" | "user" | "system" | "execution"` (MergeProposalDesign.md §7) — `"execution"` was reserved, not newly invented here.
- Firestore rules (`firestore.rules:29-64`) grant the authenticated owner `read, write` on `plans/{planId}`, the entire `spaces/{spaceId}` subtree, and `mergeCandidates/{candidateId}` (+ `history`). Every write in this design stays inside that same ownership-scoped model — nothing here requires a Cloud Function. `analysisIdempotency`/`revenueCatWebhookEvents` (Admin-SDK-only, `allow write: if false`) exist for *adversarial* concerns (a client cheating itself free analyses); merging a user's own Spaces has no analogous adversarial dimension, so that server-only pattern is deliberately **not** reused here (see §4).
- SpaceMemoryModel.md's Restartability Principle: "no resume-from-checkpoint tracking… every plan can be independently evaluated against reality and acted on only if incomplete." This governs Task 4/8/9 directly.

---

## 1. The N-way merge transaction, in outline

[Decision] Stated fully in §4 (phases) after §2 and §3 settle *what* gets written. In outline, for a confirmed set of N plans `{P1…Pn}`:

- **Created**: one `mergeExecutions/{confirmationEventId}` record (new collection, §8). No new Space/Project/Session/Batch document *shape* is invented — everything else is an existing document type written to an existing deterministic path.
- **Updated**: `canonicalSpaceId` written onto all N plan documents (§2); the survivor's Space/Project docs re-derived to reflect merged identity (§3); `mergeCandidates/{candidateId}.resolutionStatus → "merged"` (§11).
- **Retired, not deleted**: the N−1 losing plans' *old* `spaces/{losingPlanId}` documents, tombstoned in place (§6).
- **Re-parented**: each losing plan's Project (+ Session + Batch descendants) — via full re-projection to a new path, not copy-then-delete (§5).
- **Never touched**: the plan documents' own content fields (besides `canonicalSpaceId`/`shadowSourceVersion`). Plans remain authoritative; execution only ever changes where their *projection* lives.

Every subsequent section evaluates against this N-plan case, not a pair — nothing below assumes N=2.

---

## 2. Canonical plan-to-Space mapping

[Observation] This is the load-bearing decision every other task depends on. Three options were evaluated.

### Option A — `canonicalSpaceId` on each plan document

Add `plan.canonicalSpaceId: string | null`. Resolution: `resolveCanonicalSpaceId(plan, planId) = plan.canonicalSpaceId || planId` — a new pure function in `shared/spaceMigration.js`, same shape as `getSpaceDisplayName(planData)` (already pure, already takes fetched plan data, already SDK-neutral). Absent field ⇒ today's exact behavior, for every plan that has never been merged, forever, with zero migration.

### Option B — separate `planSpaceMap/{planId}` association document

Same resolution logic, but the pointer lives in its own collection instead of on the plan.

### Option C — redirect/tombstone on the retired Space

Leave `spaces/{losingPlanId}` in place, overwrite its content with `{ redirectTo, retired: true }`; every reader/writer must consult it before acting.

### Evaluation

| Sub-question | Option A | Option B | Option C |
|---|---|---|---|
| Extra read needed at most call sites | None — every call site that needs the spaceId already reads the plan doc first for other reasons | Yes — a second doc read | Yes, and only on the specific path being written to |
| Atomically settable for all N plans | Yes — same batch that touches the plan docs anyway | Yes — N new doc writes | N/A (this is a per-losing-Space marker, not a mapping mechanism) |
| Legacy-plan backward compatibility | Free (field absent) | Free (doc absent), but costs an existence-check read for every unmerged plan, forever | Free (no tombstone present) |
| `deleteSpaceShadowGraph` (runs **after** the plan is deleted, `App.js:650`) can still resolve the target | No — needs the caller to pass `canonicalSpaceId` explicitly (signature change) | Yes — the mapping doc has its own lifecycle, independent of the plan | Yes — it already computes `computeShadowIds(planId)`, same path, no change needed |
| **Can a future sync ever recreate the retired Space?** | **No — structurally impossible.** Once `canonicalSpaceId` is set, there is no code path left that ever recomputes the plan's own id as its spaceId. | **No**, same reasoning. | **Yes, unless every single write call site remembers to check the tombstone first.** This is exactly the recreation failure mode the merge is trying to prevent, now expressed as an ongoing discipline burden instead of a structural guarantee. |

[Decision] **Option A.** The deciding factor is the last row: Option C makes the correct behavior something every future call site must *remember*; Option A/B make it the *only representable outcome*. Between A and B, Option A wins on read cost everywhere except one call site (`deleteSpaceShadowGraph`), which gets a documented, mechanical signature change instead: `deleteSpaceShadowGraph(uid, planId, canonicalSpaceId)`, with the caller capturing `canonicalSpaceId` from the plan record it already has in hand before initiating deletion — the same pattern this function's own callers already follow for other pre-deletion captures. A second collection to keep permanently in sync with the plan (Option B) is not justified to save one call site a signature change.

[Decision] Note carefully: **Option A does not replace tombstoning.** §6 still tombstones the losing Spaces — for *lineage*, not for mapping. Rejecting Option C as the *mapping* mechanism does not mean tombstones have no role; it means they must never be the thing correctness depends on.

### Answering the six sub-questions

- **What `syncPlanToSpaceGraph` reads to decide which Space to write to**: it already reads the plan document first (`App.js:550-554`). It now additionally computes `const spaceId = plan.canonicalSpaceId || planId;` in place of `computeShadowIds(planId).spaceId`. This is the **single unifying code change** this whole document requires — it threads through `syncPlanToSpaceGraph`, `forceFullReprojection`/`deriveFullReprojectionDocs`, `buildExpectedSpaceState`, `checkMigrationCompleteness`, `reconcileActivePlanShadow`, `checkSpaceShadowExists`, `loadSpaceShadowGraph`. `projectId`/`sessionId`/`batchId` stay planId-derived and **unchanged** — only the Space-parent segment of the path moves.
- **Deterministic Project identity under a new parent**: unchanged and elegant precisely because of the above — Project ID is *always* `planId`, merge or no merge. Only its **path** changes, from `spaces/{planId}/projects/{planId}` to `spaces/{resolveCanonicalSpaceId(plan)}/projects/{planId}`. Identity and parentage are cleanly separated; this is what Task 5 exploits.
- **Whether all confirmed plans receive the surviving Space ID atomically**: yes — one `writeBatch`/transaction in Phase 1 (§4) sets `canonicalSpaceId` on all N plans (including the survivor, set to itself, for symmetry — see §4).
- **Legacy plans without this field**: `plan.canonicalSpaceId || planId` is exactly today's behavior. No backfill, no migration script, satisfies the Restartability Principle directly — nothing needs to know whether a plan has ever been through this code path.
- **How deletion/repair locate the correct graph**: `deleteSpaceShadowGraph`'s signature changes as above. `repairSpaceShadow`/`reconcileActivePlanShadow` need no change — they already read the plan first.
- **How a retired Space is prevented from being recreated**: structurally, not procedurally — see the table above.

---

## 3. Survivor selection and field-level canonical values

[Decision] Per the prompt's own instruction: do not assume one source wins every field. Three separate rules, stated separately.

**Canonical Space identity (which spaceId survives)**: the plan with the **earliest `createdAt`** among `confirmedPlanIds`. [Rationale] Deterministic, requires no subjective "most complete" heuristic, and matches the intuitive model — the first time this physical space was ever documented is the identity every later revisit folds into. Ties (identical `createdAt`, astronomically unlikely) broken by lexicographically smallest `planId`, matching `computeMergeCandidateId`'s own existing `[...new Set(planIds)].sort()` convention.

**Canonical display name**: **not** necessarily the survivor's own name. Rule: prefer the survivor plan's own `getSpaceDisplayName` result if non-null; otherwise, among the *other* confirmed plans, prefer the most-recently-**created** plan's effective display name. [Rationale] Avoids requiring a new `spaceNameUpdatedAt` field just to arbitrate between two user-set names that disagree (e.g., "Living Room" vs. "Lounge") — it defers to whichever plan is about to become canonical, and only reaches for another source if the survivor itself never got a name.

**Canonical starting evidence (primary photo)**: the **earliest-created plan among confirmed plans that actually has a non-null `photoUrl`** — not simply the survivor's own photo. [Rationale] If the survivor (oldest plan) happens to have no photo but a later-but-still-confirmed plan does, using the survivor's null photo would be strictly worse than an available one. This is the concrete case where identity, name, and evidence genuinely diverge across three different source plans within the same merge — demonstrating the "don't assume one source wins every field" instruction rather than just asserting it.

---

## 4. Atomicity boundary and execution phases

[Observation] A Project can own an unbounded number of Sessions/Batches; the largest realistic N-way merge (many plans, each with long `batchHistory`) could not be re-projected in a single ≤500-op Firestore transaction if execution tried to copy every descendant document explicitly.

[Decision] It cannot commit atomically as one operation for the largest realistic graph — **but see §5**: because Task 5 rejects copy-then-delete in favor of re-projection via already-existing `forceFullReprojection`, the "copy N potentially-huge descendant sets" problem that would force a >500-op transaction never actually arises. The real atomicity boundary is much smaller than the prompt's framing initially suggests. Four phases:

**Phase 1 — Claim + canonical ownership (atomic, one transaction).** Inside a single `runTransaction`:
1. `tx.get(mergeExecutions/{confirmationEventId})` — if it already exists, this is a retry or a race loser; no-op (§8, §9).
2. Re-verify eligibility fresh (§7) — plans exist, `mergeCandidate.resolutionStatus === "confirmed-merge"`, no blocking drift.
3. Choose the survivor (§3) — **exactly once**, recorded durably; never recomputed on any later retry.
4. Write `canonicalSpaceId = survivorId` (including on the survivor plan itself, set to its own id) and `shadowSourceVersion: increment(1)` on all N plan docs.
5. Create `mergeExecutions/{confirmationEventId}` with `status: "phase1-complete"`, `survivorSpaceId`, `confirmedPlanIds`.
6. Update `mergeCandidates/{candidateId}` — leave `resolutionStatus` as `"confirmed-merge"` still (only Phase 4 sets `"merged"` — see §11 for why completion is deferred to validated completion, not claimed intent).

This touches ~2N+2 documents — small even for a large N-way merge, genuinely atomic, no chunking needed. Once this commits, the merge is **durably decided** even if nothing else ever runs (matches Task 8's "durable identity of a real domain event" framing).

**Phase 2 — Idempotent re-projection (not required to be atomic as a whole).** For each of the N confirmed plans (survivor included — harmless no-op for it, since its `canonicalSpaceId` already equals its own id): call the **existing, unmodified-in-purpose** `forceFullReprojection(uid, planId)`, now internally resolving its Space parent through `resolveCanonicalSpaceId`. Each call is independently atomic (its own pre-existing transaction) and independently idempotent (deterministic doc IDs via `tx.set`, full re-derivation, never incremental patching — re-running after a crash just re-writes identical content for plans already done).

**Phase 3 — Validation.** For each confirmed plan, an extended `checkMigrationCompleteness`-style check additionally verifies `Project.scopeId === survivorSpaceId` (not just `=== planId`, its current default assumption). Update `mergeExecutions.perPlanStatus[planId] = "validated"` per plan; `status: "phase3-validated"` once all are.

**Phase 4 — Retirement.** Only after Phase 3 passes for **all** N plans: tombstone each losing plan's old `spaces/{losingPlanId}` doc (§6), delete the now-orphaned old Project/Session/Batch docs at the losing paths (safe — Phase 3 already proved the new copies are complete), set `mergeCandidates/{candidateId}.resolutionStatus = "merged"`, set `mergeExecutions.status = "completed"`.

**What users/sync see while incomplete**: between Phase 1 and Phase 4, `canonicalSpaceId` is already live, so any *new* mutation to a confirmed plan already syncs to the correct survivor path (Task 10) — the user-visible Results page for that plan is correct immediately. What's still catching up in the background is historical Session/Batch backfill (Phase 2) and the old paths' cleanup (Phase 4) — neither is user-facing. [Decision] This is not called "atomic" as a whole, per the prompt's explicit instruction not to — only Phase 1 is; Phases 2–4 are idempotent and resumable, which is the property that actually matters here, not atomicity.

---

## 5. Project/Session/Batch reconstruction vs. relocation

[Decision] **Rebuilt from authoritative plans** (option b), not copied-then-retired (option a), not path-indirected (option c).

[Rationale] Every Project/Session/Batch document in this codebase is *already* a full, disposable re-derivation from the authoritative plan — `buildShadowDocs`, `syncPlanToSpaceGraph`, and `forceFullReprojection` never treat a shadow doc as independently authoritative; they always regenerate it wholesale from plan state. Re-running `forceFullReprojection(uid, losingPlanId)` — now writing to `spaces/{survivorId}/projects/{losingPlanId}/...` once `canonicalSpaceId` points there — produces byte-correct content at the new path with **zero need to read, copy, or verify the old path's documents at all**. The old path's shadow docs simply become orphaned (structurally identical to any other stale, unreferenced shadow) and are cleaned up independently in Phase 4, never as a data-integrity-critical step. This sidesteps the copy-then-delete model entirely, reuses 100% already-tested code, and is the direct reason Phase 2 (§4) never needs a >500-op transaction — the largest unit of work is "one plan's reprojection," a bound this codebase already accepted before merge execution existed.

---

## 6. Immutable lineage and source-Space retirement

[Decision] Nothing is hard-deleted at the top level. This matches an established bias already present in this codebase — `mergeCandidates` are "superseded," never deleted (MergeProposalDesign.md §10); this document follows the same value rather than introducing hard deletion as a new pattern.

**Preserved, permanently:**
- `mergeCandidates/{candidateId}` itself (`resolutionStatus: "merged"`) and its full `history` subcollection, including any `splitFrom` chain from a prior N-way split (§7 of MergeProposalDesign.md) — a reader can walk backward through history to the original detection.
- `mergeExecutions/{confirmationEventId}` (§8) — the definitive "what happened, when, which plans, which survivor" record, kept forever, not cleaned up after completion.
- Tombstoned `spaces/{losingPlanId}` documents: `{ retired: true, redirectTo: survivorSpaceId, retiredAt, mergeExecutionId: confirmationEventId }`. This is a pure lineage/audit marker with no correctness burden (§2 already established nothing depends on it being consulted correctly) — it exists so a reader who stumbles onto an old spaceId (a stale deep link, an old debug reference) can discover where it went without consulting `mergeCandidates`/`mergeExecutions` at all.

**Safe to delete, once Phase 3 validates:** the losing plans' old Project/Session/Batch documents. These are pure projections — disposable by this codebase's own existing definition — and `deleteSpaceShadowGraph` already deletes exactly this document shape today, just for a different trigger (plan deletion). No new deletion logic, just a new caller.

**Never touched:** the plan documents themselves. Plans remain authoritative throughout, unconditionally.

---

## 7. Eligibility and staleness at execution time

[Decision] Explicit rule, since the prompt correctly identifies that "changed since confirmation" is not one category:

**Acceptable drift (never blocks execution, never requires re-confirmation):**
- Display-name changes (renames) on any confirmed plan. [Rationale] Directly reapplying MergeProposalDesign.md §1's governing test: a rename answers "what do we call this place," not "is this the same place." Section 6 (stale-confirmed) already treats a post-confirmation rename as *exactly* the case where "your assessment isn't in question; the situation underneath it changed" — this rule is a direct extension of an already-settled principle, not a new one.
- `Project.sourceVersion` increasing due to ordinary continued use (more batches, checked items, companion progress). The plan continuing to be a living document does not call the physical-identity judgment into question.

**Staleness (blocks execution as originally confirmed, routes to the existing stale-confirmed flow — no new UI):**
- Any `confirmedPlanId` no longer exists. Reuses `evaluateCandidateInvalidation`'s existing "plan no longer exists" reasoning verbatim.
- A confirmed plan's `canonicalSpaceId` is already set to a *different* space than any candidate survivor (it was already merged elsewhere by a separate execution since confirmation) — genuine conflict.
- `mergeCandidates/{candidateId}.resolutionStatus` is no longer `"confirmed-merge"` at execution-read time (the user reversed or otherwise re-decided) — not an error, the user's own later action already is the answer; no notification needed.

**Retryable, not user-facing (self-heals):**
- `Project.migrationVersion` mismatch on a confirmed plan — triggers the *existing* Part 1 `forceFullReprojection` to bring that plan's structural shape current, then retries; silent, matching this codebase's existing self-healing repair mechanisms.

**Terminal anomaly (should not happen under normal operation):**
- `expectedSpaceState`'s snapshotted `sourceVersion` is *greater* than the live version — versions only increase; observing the opposite signals corruption or a restore, not ordinary drift. Routed to stale-confirmed with a distinct `staleReason` rather than silently retried indefinitely, so it never vanishes unexplained.

---

## 8. Merge-operation identity and restartability

[Decision] `mergeExecutions/{confirmationEventId}` — **reusing `confirmationEventId` directly as the document ID**, not a newly hashed or random operation ID. `confirmationEventId` is already a unique, immutable Firestore auto-ID (MergeProposalDesign.md §8); reusing it means "one confirmed decision, one execution record" is enforced by Firestore's own key uniqueness, with no new derivation scheme to get wrong.

Schema:
```
mergeExecutions/{confirmationEventId}: {
  candidateId, confirmedPlanIds: string[], survivorSpaceId,
  status: "phase1-complete" | "phase3-validated" | "completed" | "blocked",
  perPlanStatus: { [planId]: "pending" | "reprojected" | "validated" },
  claimedAt, completedAt, blockedReasons: string[] | null,
}
```

Preventing the four listed failure modes:
- **Two devices executing the same confirmation simultaneously**: Phase 1's `tx.get` on the execution doc, guarded inside the same transaction as the survivor choice and plan writes — the exact `syncPlanToSpaceGraph` pattern (read-compare-write, trust Firestore's own conflict retry) reused verbatim, not a new mechanism.
- **A retry creating duplicate Projects/copied descendants**: not applicable by construction — §5 rejected copying; Phase 2 is `tx.set` on deterministic IDs, inherently idempotent, same reasoning as `writeSpaceShadowStructure`'s own setDoc-not-addDoc idempotency.
- **Two execution attempts choosing different surviving Spaces**: survivor selection happens **exactly once**, inside the same winning Phase-1 transaction that creates the claim. Every later phase or retry reads `survivorSpaceId` from the execution record — it is never recomputed. This is the one place a resumed retry must trust durable state rather than re-deriving an answer that could theoretically differ if underlying data changed between attempts.
- **A completed merge being performed twice**: `mergeExecutions.status === "completed"` is checked before any phase runs; `mergeCandidates.resolutionStatus === "merged"` is a second, independent signal of the same fact — defense in depth without depending on a single field.

**Partial-execution detection/resumption**: a reconciliation sweep (mirroring `reconcileActivePlanShadow`'s existing app-start-trigger pattern) queries `mergeExecutions` where `status != "completed"`, and resumes from whatever phase `perPlanStatus` says is incomplete. This is not a new resumption model — it is the Restartability Principle already settled in SpaceMemoryModel.md, applied to merge execution instead of reinvented for it: no special resume-tracking beyond "what does current durable state say is still needed."

---

## 9. Abort and recovery behavior

**Pre-Phase-1** (evaluated inside the claiming transaction, before anything commits): already-claimed (idempotent no-op) · candidate not `confirmed-merge` (terminal, no user info — the user's own later action already answered it) · a confirmed plan missing (terminal → stale-confirmed, existing UI) · `migrationVersion` mismatch (retryable, silent self-heal) · a plan already `canonicalSpaceId`'d elsewhere (terminal → stale-confirmed).

**Mid-execution**:
- A confirmed plan is deleted between Phase 1 committing and Phase 2 running for it: `canonicalSpaceId` is already durably committed for it (Phase 1 already succeeded), so its shadow simply stays orphaned at an unreachable path; `forceFullReprojection` returns its existing `source-plan-missing` outcome and Phase 2 skips it — this fails only *that plan's* reprojection, not the whole merge.
- Phase 3 validation fails for some plan (should be rare, given Phase 2 reuses already-proven code): retry Phase 2 for that plan; if it fails repeatedly, `mergeExecutions.status = "blocked"` with `blockedReasons` (reusing `evaluateMigrationCompleteness`'s own `reasons: string[]` return shape). This is the one genuinely **new** user-facing surface this design requires — a minimal "this merge couldn't finish" notice — flagged honestly rather than presented as free.
- Phase 4 partially completes before a crash: safe to simply re-run — tombstoning an already-tombstoned doc and deleting an already-deleted doc are both made idempotent by existence-checking first, mirroring `deleteSpaceShadowGraph`'s own existing non-fatal try/catch pattern.

---

## 10. Shadow Synchronization redesign around canonical mapping

- **How sync reads the canonical Space**: `const spaceId = plan.canonicalSpaceId || planId;` — the single mechanism from §2, threaded through every existing shadow function.
- **Losing plan's sync — redirected, not disabled.** Disabling it would be strictly worse: it would silently stop the survivor Space from ever reflecting that plan's future progress, directly violating the prompt's own Critical Framing ("every future synchronization… permanently agrees on the same canonical Space identity"). Every existing mutation trigger (pause, completion, rename, next-batch, retroactive-save — the five call sites already wired to `syncPlanToSpaceGraph`) keeps firing exactly as today; it just now resolves to a different path.
- **A confirmed plan mutated after confirmation but before execution**: this is exactly §7's "acceptable drift" — the snapshot in `expectedSpaceState` falls behind live state, which is fine; Phase 2 reprojects from *current* plan state, not the stale snapshot, when execution eventually runs. Nothing is lost.
- **A plan mutated after execution completes**: its existing, unmodified mutation triggers fire `syncPlanToSpaceGraph` as always, which now resolves through `canonicalSpaceId` and writes under the survivor. This requires zero new code beyond §2's mechanism — sync was already a "re-derive from current plan state" projection that doesn't know or care whether a merge ever happened; it only needed to be told where to write.

---

## 11. Candidate and history outcomes after successful execution

[Decision] New terminal `resolutionStatus: "merged"` — explicitly the gap MergeProposalDesign.md §2 already flagged and deferred ("Successfully merged … Requires a new `resolutionStatus` value once merge execution exists. Not designed here."). Set only at Phase 4, **after** validation — not at Phase 1 claim time — so `resolutionStatus` never claims success before it's actually verified; a partially-executed merge stays `"confirmed-merge"` (with its progress visible via `mergeExecutions`, not via the candidate's own status).

No new field is needed to link the candidate to its execution record — `confirmationEventId` already is the FK (`mergeExecutions` is keyed by it directly, §8).

[Decision] One summary `history` entry, `actor: "execution"`, written at Phase 4 completion — not a blow-by-blow entry per phase. [Rationale] Matches this codebase's existing granularity: `"confirmed"`/`"dismissed"`/`"deferred"` are each one entry, not a running log; `mergeExecutions` (§8) already *is* the fine-grained phase-by-phase ledger, so history doesn't need to duplicate it. Entry payload: `{ actor: "execution", type: "merge-completed", survivorSpaceId, retiredSpaceIds: [...], at }`.

---

## 12. The confirmed-cluster-growing case (Part 2's deferred question)

[Observation] MergeProposalDesign.md §11 left this genuinely open: a new plan `E` appears sharing a label with an already-`confirmed-merge` pair. Under Part 2's exclusion rule, `A`/`B` are permanently excluded from future pending clustering, so `E` alone never forms a new candidate.

[Decision] Now resolved. The survivor plan (`A`, say) is never removed or altered as a *plan document* by execution — it keeps its own real `spaceType`/`spaceName` and remains fully visible to `detectMergeCandidates`. So `E`, sharing a label with `A`, forms an ordinary new 2-plan pending candidate `{A, E}` through the **existing, unmodified** clustering logic — no new candidate shape, no new "plan vs. already-merged-Space" comparison concept needed. The only necessary change: `detectMergeCandidates`'s plan-list input must exclude any plan where `canonicalSpaceId` is set to a *different* space than its own id (i.e., a plan that already **lost** a prior merge) — its identity question is already permanently answered, and proposing `E` against `B` specifically would be asking the user to re-answer something `B`'s own earlier merge into `A` already settled. One additional exclusion filter, in the same style as `detectMergeCandidates`'s existing no-display-name filter — not a new mechanism.

---

## 13. Staging evidence bar

1. **No plan data lost** — every confirmed plan's document is byte-identical before/after execution except `canonicalSpaceId`/`shadowSourceVersion`.
2. **No photos lost** — every distinct `photoUrl` referenced across all confirmed plans (starting evidence + any progress photos) remains independently loadable after execution.
3. **No user decisions lost** — walking `mergeCandidates/{id}/history` backward (including any prior `splitFrom` chain) reconstructs the original confirmation action, actor, and timestamp.
4. **No history orphaned** — every Session/Batch that existed under every losing plan's *old* path has a content-equivalent counterpart under the survivor's *new* path (automated, reusing `evaluateMigrationCompleteness`'s comparison shape against the new canonical path).
5. **Survivor Space contains everything all original Spaces contained** — explicitly: a merged Space ends up with **multiple Project documents nested under it**, one per originally-separate plan, side by side — not flattened into one. Confirm the survivor's Space subtree contains exactly N Projects, each independently passing its own completeness check. State this plainly in testing docs — it's a real design consequence (faithful preservation of N distinct documented visits) that could otherwise read as a bug if someone expects one Project per Space.
6. **Future syncs target the correct canonical Space** — mutate a confirmed non-survivor plan post-merge (e.g., toggle a checklist item); confirm the resulting write lands under `spaces/{survivor}/projects/{thatPlanId}/...`, not a recreated `spaces/{thatPlanId}/...`.
7. **Re-execution of a completed merge is safely prevented** — re-invoke execution against an already-`completed` `confirmationEventId`; confirm zero additional writes occur and `mergeCandidates.resolutionStatus` stays `"merged"`.
8. **Crash-and-resume** — manually force a `mergeExecutions` doc to `status: "phase1-complete"` without running Phase 2 (a diagnostic-state technique already used elsewhere this session); confirm the next reconciliation sweep completes Phases 2–4 correctly with no user action.
9. **Two-device race** — two sessions attempt to execute the same `confirmationEventId` within seconds of each other; confirm exactly one Phase-1 transaction wins, the other cleanly no-ops, and exactly one survivor is ever chosen.

---

## Closing

This document resolves every item MergeProposalDesign.md §8/§11 explicitly deferred to merge execution: the canonical mapping mechanism, the `"merged"` terminal state, and the confirmed-cluster-growing case. It introduces exactly one new collection (`mergeExecutions`), one new plan field (`canonicalSpaceId`), and one new UI surface (a "this merge couldn't finish" notice for the genuinely-exceptional blocked case) — everything else is reuse of already-shipped, already-tested projection and reconciliation machinery, redirected through a single resolution function.
