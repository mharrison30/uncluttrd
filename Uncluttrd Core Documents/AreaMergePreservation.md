# Area Preservation in Room Merges — Implementation Report (2026-08-10)

Replaces `mergeRoomIntoRoom`'s prior "always clear `areaId`" behavior, which destroyed durable
Area identity (visit history, reference photos, recognition eligibility) on every Room merge —
exactly the regression Phase A/B's own work was meant to prevent. Implements the corrected,
restartable design from the prior turn's design review.

- Commit: `511299e`
- OTA (staging): iOS `019fe979-3cfb-7073-b5b6-6cdda0c1f6d4`, Android `019fe979-3cfb-7d91-bcf8-e1b27464b310`

## The critical correction

An earlier version of this idea used a single in-memory map built during one function call, with
target-Area creation and source-Area retirement happening together. That's not restartable: a
crash between "target created" and "source retired" would leave no record of the mapping, and a
retry would either create a duplicate target Area or, worse, retire a source Area that still had
unmigrated plans pointing at it.

The fix: **target establishment and source retirement are separate phases**, connected by a
field — `migrationTargetAreaId` — **persisted directly on the source Area document**, not held
only in a variable. `retired`/`redirectTo` are never written until a separate, later step has
verified zero plans still reference the source Area.

## Implementation

### `establishTargetArea(uid, oldRoomId, oldAreaId, targetRoomId)`
Idempotent. Reads the source Area; if `migrationTargetAreaId` is already set (from this attempt
or a prior, interrupted one), returns it directly — no duplicate created. Otherwise creates a
fresh target Area (`displayName`, `originalPhotoUrl` copied; `createdAt` **preserved from the
source**, not reset to migration time — a merge is an administrative correction, not a new
organizing event, and `createdAt` means "when the user first organized this spot" everywhere
else in this data model, matching Space tombstoning's own "preserve forever, for lineage"
philosophy), then persists `migrationTargetAreaId` on the source Area. **Never writes
`retired`/`redirectTo` here.**

Never searches for an existing same-named Area in the target Room to merge into — always creates
fresh, satisfying item 5's explicit rule (two "TV Console" Areas coexisting is correct; automatic
reconciliation is future work).

### `mergeRoomIntoRoom` — 7 phases (numbering matches the design 1:1)
1. **Snapshot** every source plan's current `areaId`/`areaName`/`areaScope` *before* any plan
   moves — `reclassifyLegacyPlan` is never assumed not to touch `areaId` (it doesn't, but the
   wrapper doesn't rely on that assumption). The self-plan (founding visit, whose doc id never
   changes) is only re-included if its `canonicalSpaceId` shows it hasn't already moved on a
   prior attempt — closes a real bug I caught while implementing: without this check, a retry
   would re-snapshot an already-migrated plan, see its *new* (target-side) `areaId` as if it were
   an unrecognized source Area, and wrongly clear it.
2. **Establish** a target twin for every distinct source Area referenced by any snapshotted plan.
   Source Areas untouched (not retired).
3. **Move** every plan via the unchanged `reclassifyLegacyPlan`, then repoint its `areaId` via the
   durable mapping from Phase 2 — only for plans whose move actually completed.
4. **Verify** — per migrated Area, query whether any plan anywhere still has the old `areaId`.
5. **Recompute** the target Area's summary (`updateAreaSummary`) — always, regardless of (4)'s
   result.
6. **Tombstone**, only now, only if (4) found zero remaining references. A source Area with any
   plan still pointing at it (e.g. one sibling failed to move) is never retired.
7. **Return** a full summary (`areaMigrations` array: which Areas migrated, whether each was
   retired, and why not for any that weren't).

### `resolveAreaForSinglePlanMove(uid, planId, oldRoomId, oldAreaId, targetRoomId)`
The single-plan counterpart (item 3). Counts other plans still referencing the same `areaId`:
present → `{action: "clear"}`, the Area stays behind untouched. None → this plan is the last
member → runs the identical establish → verify → recompute → retire sequence for just this one
Area, then returns `{action: "migrate", newAreaId}`.

### Why a wrapper, not a change to `reclassifyLegacyPlan`
Both the full-merge and single-plan cases need information `reclassifyLegacyPlan` structurally
can't have: the full-merge case needs to know about every plan in the source Room at once (to
build one shared mapping); the single-plan case needs to know about every *other* plan currently
referencing the same Area. Neither is a fact about the one plan `reclassifyLegacyPlan` is moving.
Keeping the proven, already-tested Room/Project reprojection state machine completely unmodified
avoids risking it for a feature it was never scoped to know about.

### Firestore rules — no changes
`migrationTargetAreaId` is just a new field on the existing `spaces/{spaceId}/areas/{areaId}`
document; the rule is already wildcard-scoped by `{spaceId}` and covers it identically in the
target Room. Confirmed by reading the deployed rule directly.

### Phase B recognition — no changes needed
`findAreaRecognitionCandidates`'s three call sites all run a fresh, uncached query against
`spaces/{roomId}/areas` at the moment recognition runs. A migrated Area is a real, non-retired
document at exactly that path — it's discovered automatically. Verified directly in testing
(below), not just by re-reading the code.

### A disclosed, non-fatal side effect
During Phase 3, `reclassifyLegacyPlan`'s own internal reprojection hook opportunistically calls
`updateAreaSummary` using the plan's *pre-repoint* `areaId` (still the old, source-side value at
that instant) against the *already-updated* target room path — a combination that doesn't exist,
so it logs a caught, non-fatal `NOT_FOUND` and moves on. This is harmless: Phase 5's own
unconditional recompute is the authoritative one and runs after the repoint. Confirmed non-fatal
by the fact that every test below passed with fully correct final state despite these log lines
appearing. Not fixed by reordering (pre-setting `areaId` before calling `reclassifyLegacyPlan`
would silence the log but risks leaving a plan's `areaId` pointing at a new-Room-scoped Area
while the Room move itself failed) — correctness was chosen over quiet logs.

## Test results (real staging, Admin-SDK-mirrored, fully cleaned up afterward)

All 26 assertions passed. Faithful port of the exact App.js logic (same field names, same phase
order, same idempotency guard), driving the real, unchanged `reclassifyLegacyPlanAdmin`.

| # | Test | Result |
|---|---|---|
| a | Full merge: TV Console (2 plans) + Corner Shelf (1 plan) both migrate correctly | **PASS** |
| a | Both source Areas tombstoned with correct `redirectTo` | **PASS** |
| b | Idempotency: re-running after completion creates no duplicate Areas | **PASS** |
| c | Crash simulated between target-Area creation and source tombstone: retry reuses the same target Area (no duplicate); source Area not retired merely because its twin exists | **PASS** (both assertions) |
| d | Crash simulated midway through a 2-plan Area's merge: source Area stays active while one plan remains; retry (moving the second plan) completes and retires correctly, final visitCount 2 | **PASS** (4 assertions) |
| e | Single-plan move, sibling remains: `action: "clear"`, moved plan's `areaId` cleared, source Area intact with correctly recomputed `visitCount: 1` | **PASS** (4 assertions) |
| f | Single-plan move as last member: `action: "migrate"`, source Area tombstoned only after the move + verification | **PASS** (2 assertions) |
| g | Whole-room visit: moves with `areaId` still `null` throughout | **PASS** |
| h | `findAreaRecognitionCandidates`'s own query (not a proxy) discovers both migrated target Areas | **PASS** |
| i | Migrated Area's `displayName`, `originalPhotoUrl`, `createdAt` match the source exactly (`createdAt` timestamp-identical, confirming it was preserved, not regenerated) | **PASS** (3 assertions) |
| j | Source Area with a plan still referencing it is never retired — verified explicitly at the exact mid-crash moment, not just after full completion | **PASS** |
| k | Target Room visit count (5 = 1 pre-existing + 4 moved) and Area summaries all correct | **PASS** |

No leftover test data — verified via a final scan for any space with "Test"/"Crash" in its
`displayName` after cleanup (0 found).
