# Phase C1: Retirement Guards + Soft-Delete Primitives — Implementation Report (2026-08-10)

Implements `DeletionDesign.md`'s Soft-Delete Revision: retirement guards for the two verified
write-path gaps, and the instant soft-delete operations for Area/Room. No hard deletion in this
phase — that's the background cleanup job, a later phase.

- Commits: `e71d348` (guards + soft-delete primitives + UI), `d2fc9c3` (resurrection-gap
  follow-up, found while building tests), `3357d7d` (Admin-mirror guard consistency, no client
  impact)
- OTA (staging): iOS `019feb56-b863-76a0-93e6-79c7ba85fa1e` → `019feb5b-9182-7c13-9bc4-e47e71a42f8b`
  (follow-up), Android `019feb56-b863-7220-8ca8-747143777959` → `019feb5b-9182-71a0-822c-5a273fe12166`

## 1. Retirement guards

- **`syncPlanToSpaceGraph`** (client) and **`syncPlanToSpaceGraphAdmin`**: read the target Space
  before writing; if `retired === true`, return `{outcome: "target-retired"}` and write nothing.
  Non-fatal — the plan itself is valid, it just doesn't project into a retired destination.
- **`forceFullReprojection`/`Admin`**: identical guard, same outcome shape.
- **`establishTargetProjection`/`Admin`** (the reclassification phase that calls
  `forceFullReprojection`): now handles the new `target-retired` outcome the same way it already
  handles `source-plan-missing` — marks the execution `blocked`, not silently `established`. This
  only fires in a narrow race (target retired *after* `claimReclassification`'s own
  `validateTargetSpace` check already passed but *before* reprojection ran) — added for
  correctness, not because it's reachable in normal operation.
- **`establishTargetArea`**: reads the target Room's Space doc first; if retired, **throws**
  (not a silent `null` return, unlike its pre-existing "source Area vanished" defensive case) —
  this is a real caller error, not a benign race, and must abort the whole
  `mergeRoomIntoRoom`/`resolveAreaForSinglePlanMove` call loudly rather than silently degrading
  into clearing `areaId` on every plan that would have migrated.

## 2/3. Soft-delete primitives

`softDeleteArea(uid, roomId, areaId)` — one `updateDoc`. `softDeleteRoom(uid, roomId)` — one
atomic `writeBatch` covering the Space doc plus every currently-*live* Area under it (an Area
already retired via a prior merge is explicitly skipped — see contract below). Both are
idempotent: a call against an already-retired target is a no-op, specifically so a double-tap or
a retry after a dropped network response can never reset `deletedAt` and restart the 30-day
countdown.

`updateSpaceRoomSummary`/`Admin` now excludes any shadow Project whose `areaId` points at a
retired Area (merge tombstone or soft-delete) before computing the Room's summary — without this,
a soft-deleted Area's still-fully-live Projects would keep counting toward the Room's `visitCount`
forever, since soft-delete never touches plans/shadows. Called explicitly after an Area soft-
delete; not needed after a Room soft-delete (the Room itself is now hidden).

## 4. Contract (verified, not just asserted)

`retired: true` alone = structural tombstone (merge/reclassification), never eligible for
Recently Deleted or purge. `retired: true` + `deletedAt` = user soft-delete, eligible for both.
Test (m) below constructs a genuine merge-tombstone-shaped document (`retired: true, redirectTo`,
no `deletedAt`) and confirms it's distinguishable from — and unaffected by — the soft-delete
contract.

## 5. Hiding — verified, and two real gaps found and closed

Verified via direct code reading, not assumed:

| Consumer | Status |
|---|---|
| My Rooms, Room Detail's Area/visit render filters, `beginAreaConfirmation` | Already correct (pre-existing `!retired` filters, unmodified) |
| Area recognition (`findAreaRecognitionCandidates`) | Already correct (pre-filtered at every call site, twice over) |
| **Room Detail's own visit list** (LAST SESSION / EARLIER ORGANIZING VISITS) | **New filter added** — previously showed every plan under the Room regardless of whether its `areaId` pointed at a now-retired Area; now excludes them, reusing the already-loaded `roomDetailAreas` state (zero new query) |
| **Room recognition** (`findRecognitionCandidates`) | **Real gap found and closed.** Operates purely on `plans` docs with no join back to `spaces` — under the *original* hard-delete design this was safe by construction (a deleted Room's plans were gone too), but soft-delete deliberately never touches plans, so a soft-deleted Room's plans stay fully live and would otherwise still surface as "is this your [deleted Room]?" Added an `excludeRetiredCandidates` step (bounded to ≤3 extra reads, candidates already capped at 3) at both the cache-hit and fallback-query return points. |
| **Merge-candidate detection** (`detectAndPersistMergeCandidatesForUser`) | **Same class of gap, found and closed.** Not reachable from the live app (Admin/CLI-only), but still fixed for correctness and because the task's own test suite checks it: excludes any plan whose canonical Space is currently retired before clustering. |
| "Organize Another Area" / "Organize Again" entry points | Already correct — both depend entirely on the AREAS IN THIS ROOM list, which already filters `!retired`; a retired Area's own "Organize Again" button simply isn't rendered. |

Both gaps were discovered while building the real-staging test suite for this task, not during
initial implementation — flagged and fixed in a follow-up commit (`d2fc9c3`) before testing
continued.

## 6. UI

- **Delete Room**: the existing "Coming soon" placeholder (`handleDeleteRoomPlaceholder`) is now
  `handleDeleteRoom` — real `softDeleteRoom` call, updated confirmation copy ("...You can restore
  it from Recently Deleted within 30 days," replacing the old "permanently remove" language that
  no longer matches the soft-delete model). On success: removes the Room from local `rooms` state
  and navigates back to My Rooms (`setRoomDetailRoomId(null); setShowHistory(true)`).
- **Delete Area**: new red "Delete" text link on each "AREAS IN THIS ROOM" row, next to "Organize
  Again" on the same line (matching this screen's established quiet-text-link pattern rather than
  a menu). Same confirmation copy pattern. On confirm: `softDeleteArea` +
  `updateSpaceRoomSummary`, with a local `roomDetailAreas` patch so the Area disappears
  immediately without a full re-fetch.
- No processing overlay for either — both operations are effectively instant (single document
  write / one small atomic batch), matching the design's own "no meaningful async work to cover"
  conclusion.

## Test results (real staging, throwaway Room fully cleaned up afterward)

24 of 25 assertions passed against real staging data (Room with Area A [2 plans], Area B [1
plan], 1 whole-room plan).

| # | Test | Result |
|---|---|---|
| a | Area soft-delete: retired+deletedAt set; plans and shadow Project still exist | **PASS** (3/4 — see Storage note below) |
| b | Room soft-delete cascades to live Areas; Area already retired (from test a) keeps its *original* `deletedAt`, not reset; all 4 plans still exist | **PASS** (5/5) |
| c | Room summary recomputed after Area soft-delete: `visitCount` drops from 4 to 2, correctly excluding Area A's 2 plans | **PASS** |
| d | `syncPlanToSpaceGraph` refuses to write beneath a retired Space | **PASS** |
| e | `forceFullReprojection` refuses to write beneath a retired Space | **PASS** |
| f | `establishTargetArea` throws (not silently degrades) when the target Room is retired | **PASS** (2/2) |
| g | Soft-deleted Area excluded from the Area-recognition eligible set; live sibling Area still eligible | **PASS** (2/2) |
| h | Soft-deleted Room excluded from Room recognition's candidate set | **PASS** (2/2) |
| i | Merge-candidate detection: a genuine same-`spaceType` live sibling Room was created specifically to prove a real 2-plan cluster *would* have formed if the deleted Room's plan were wrongly included — it wasn't | **PASS** |
| j | Plans under a soft-deleted Area excluded from the Room Detail visible-visit-list filter logic | **PASS** |
| k | Zero active Areas remain visible after both Areas are soft-deleted (AREAS IN THIS ROOM / Organize Another Area would show none) | **PASS** |
| l | Soft-deleted Room has both `retired: true` AND `deletedAt` set | **PASS** |
| m | A constructed merge-tombstone-shaped document (`retired: true`, `redirectTo` set, no `deletedAt`) is confirmed distinguishable from, and untouched by, soft-delete logic | **PASS** (2/2) |

**One failure, a test-methodology artifact, not a product bug**: the Storage-existence check for
test (a) reported the original photo file missing. Root cause: the test's throwaway plan reused
an *existing* photo URL (this session's established efficient-testing pattern) rather than
performing a real upload under the new synthetic plan's own id — so no file ever existed at the
path the check looked for, independent of soft-delete entirely. Confirmed by direct code
inspection (not just re-asserting): grepping both `softDeleteArea` and `softDeleteRoom` for any
Storage reference (`storageRef`, `deleteObject`, `listAll`) returns zero matches — neither
function contains any Storage-touching code at all, exactly as designed. Re-running this specific
check with a real per-plan upload would be needed to close it out cleanly in a future pass, but
the design property it was meant to verify (soft-delete never touches Storage) is already
provably true by inspection.

# Phase C2: Recently Deleted UI with Restore — Implementation Report (2026-08-10)

Builds the user-facing half of the soft-delete model: a small "Recently Deleted" section in My
Rooms and Room Detail, and real Restore actions. Intentionally minimal — no archive browser, no
filtering/sorting UI, no undo-toast pattern. Adds one new field (`deletedWithRoomId`) that makes
cascade ownership deterministic, which Restore Room's own logic depends on.

- Commit: `7bcf3b2` (deletedWithRoomId + restoreRoom/restoreArea + Recently Deleted UI, both
  screens)
- OTA (staging): iOS `019feb71-dc7b-7beb-a8f0-c43cbd44a864`, Android `019feb71-dc7b-7d8e-bc34-7fffeb061f8e`

## 1. `deletedWithRoomId` — cascade-ownership marking

`softDeleteRoom` now writes `deletedWithRoomId: roomId` (alongside the existing `retired: true,
deletedAt`) onto every currently-*live* Area it cascades into, exactly as before except for this
one extra field. An Area already retired at the time of the Room deletion — whether independently
soft-deleted or a merge tombstone — is still explicitly skipped (unchanged from Phase C1), so it
never receives `deletedWithRoomId` at all. This is the sole signal `restoreRoom` uses to decide
which Areas come back with the Room:

- Delete Area directly: `retired: true, deletedAt` — no `deletedWithRoomId`, ever.
- Delete Room: Space gets `retired: true, deletedAt`. Each currently-live Area gets `retired:
  true, deletedAt, deletedWithRoomId: roomId`.
- Merge/reclassification tombstones: `retired: true` only — no `deletedAt`, no
  `deletedWithRoomId`. Untouched by any of this, in either direction.

## 2. `restoreRoom(uid, roomId)`

One atomic `writeBatch`: un-retires the Space (clears `retired`/`deletedAt` via `deleteField()`),
and un-retires only the Areas where `deletedWithRoomId === roomId` (clearing `retired`,
`deletedAt`, and `deletedWithRoomId` on each). Idempotent — a Room that's already live is a
no-op (`{outcome: "already-restored"}`), so a double-tap or retry can't do anything the first tap
didn't. After the batch commits, recomputes the Room's summary and each restored Area's summary
from live Projects (`updateSpaceRoomSummary`/`updateAreaSummary`, both already Phase-C1-correct
about excluding retired Areas) — never trusts stale pre-delete summary values back to life
verbatim.

## 3. `restoreArea(uid, roomId, areaId)`

Single-document mirror of `softDeleteArea`: clears `retired`, `deletedAt`, and
`deletedWithRoomId` (if present) unconditionally — works identically whether the Area was
cascade-deleted or independently deleted, since restoring an Area directly always means "bring
this one back," regardless of how it got here. Also idempotent (`already-restored` no-op).
Recomputes both the Room's and the Area's own summary afterward, same reasoning as `restoreRoom`.

## 4. UI

- **My Rooms** — new `recentlyDeletedRooms` state, populated in the existing `loadRooms` effect
  from the *same* already-fetched `allSpaces` array (no second query). Filter:
  `retired === true && deletedAt exists && within 30 days` — a bare merge tombstone (`retired`,
  no `deletedAt`) never qualifies. Rendered below the active Room cards, under a "RECENTLY
  DELETED" section label, only when the list is non-empty. Each row: Room name, "Deleted X days
  ago" (`formatDeletedAgo`, handles Firestore `Timestamp` via `toMillis()`), and a "Restore"
  link — gray/quiet text, no Room-type icon, `#F8F9FA` row background, visually secondary to the
  BRAND-tinted active cards above.
- **Room Detail** — new `recentlyDeletedAreas` computed inline from the already-loaded
  `roomDetailAreas` state (same filter, zero new query), rendered as a "RECENTLY DELETED AREAS"
  section directly below "AREAS IN THIS ROOM," same quiet styling and Restore link.
- **Handlers** — `handleRestoreRoom` calls `restoreRoom` then refetches just that Space doc (its
  own summary fields can genuinely change from what was cached pre-delete, unlike a plain
  delete) and moves it from `recentlyDeletedRooms` into `rooms`. `handleRestoreArea` calls
  `restoreArea` then locally patches the one Area's `retired`/`deletedAt`/`deletedWithRoomId` in
  `roomDetailAreas` — the same "local patch, no full re-fetch" convention `handleDeleteArea`
  already established.
- No processing overlay, matching Phase C1's Delete actions — both Restore operations are a
  single doc write or one small atomic batch, no meaningful async work to cover.

## Test results (real staging, throwaway Room fully cleaned up afterward)

30 of 30 assertions passed. Setup: Room with Area A (cascade-delete target), Area B (deleted
independently *before* the Room), Area C (constructed directly as a merge-tombstone shape —
`retired: true`, `redirectTo` set, no `deletedAt`, no plans).

| # | Test | Result |
|---|---|---|
| a | Soft-delete a Room → retired+deletedAt set, matches My Rooms' Recently Deleted filter | **PASS** (2/2) |
| b | Soft-delete an Area (B, independently) → retired+deletedAt set, matches Room Detail's Recently Deleted Areas filter | **PASS** (2/2) |
| c | Restore Room → Room un-retired, cascade-deleted Area A restored, its plan/photo still exist, Room summary recomputed to include it again | **PASS** (5/5) |
| d | Restore Area (B) → un-retired, plan/visit still exists, Room summary recomputed to include it | **PASS** (4/4) |
| e | Restore Room with a merge-tombstoned Area (C) present: C stays retired, still no `deletedAt`, unaffected | **PASS** |
| f | Recently Deleted only shows items within 30 days; after both restores, zero items remain in either section for this Room | **PASS** (4/4) |
| g | A Room/Area soft-deleted 31 days ago is excluded from the Recently Deleted filter | **PASS** (2/2) |
| h | Restore is idempotent — a second `restoreRoom` call and a second `restoreArea` call are both no-ops (`already-restored`), state unchanged | **PASS** (3/3) |
| i | Area B, independently deleted before its Room was deleted, is untouched by the cascade (no `deletedWithRoomId`, `deletedAt` unchanged) and is NOT restored when the Room is restored | **PASS** (4/4) |
| j | `deletedWithRoomId` present and correct on cascade-deleted Area A, absent on independently-deleted Area B | **PASS** (4/4) |

No gaps found this phase — Phase C1's own retirement guards and hiding-consumer fixes already
cover everything Restore reactivates (a restored Area/Room simply re-enters all the same
already-correct `!retired` filters it left).

# Phase C3: Hard-Delete Engine — Implementation Report (2026-08-10)

Builds the server-side, restartable, idempotent hard-delete primitives `hardDeleteAreaAdmin`/
`hardDeleteRoomAdmin` (`scripts/runSpaceMigration.js`) — Admin-SDK only, never called from
user-facing UI. These implement DeletionDesign.md's original Sections 1-3 execution phases
(steps 3 onward; establishing `retired`/`deletionStatus` is the sweep-selection layer's job, not
this primitive's), now repurposed as the background retention-cleanup job's (Phase C4) and
account-deletion's (Phase C5) actual delete engine, per that doc's own "Soft-Delete Revision."
Naming matches that doc's own forward-referencing snippets (`hardDeleteRoomAdmin`,
`hardDeleteAreaAdmin`) exactly, so C4/C5 can call these functions as already sketched.

- Commit: (this phase, code only — no OTA, no client changes)

## 1. Recursive Storage cleanup

`deleteStoragePrefixesAdmin(bucket, prefixes)` replaces `deletePlanAdmin`'s prior "no Storage
cleanup at all" Admin-SDK gap. GCS object keys are flat — `bucket.getFiles({prefix})` already
returns every object under a prefix at any nesting depth in one call, so `original.jpg` and
`progress/{timestamp}.jpg` both come back together with no separate walk needed. This is
categorically different from the client Storage SDK's `listAll()`, which partitions a single
level into `.items` (this level only) and `.prefixes` (subfolders) and requires recursing into
`.prefixes` to reach nested content — App.js's own `deletePlan` calls `listAll()` and only ever
reads `.items` (App.js:6890-6895), which is the literal bug this phase's spec names: progress
photos are never actually deleted by the client path today.

**Scope decision, stated explicitly**: this phase fixes the gap only on the Admin-SDK path
(`deletePlanAdmin`, and therefore every hard-delete call). The client-side `App.js` `deletePlan`
bug is **not** fixed here — this phase's own closing instruction was explicit: "Admin-SDK only,
no client changes." That client bug remains open, tracked here for a future phase: either apply
the same one-level `.prefixes` walk `listAll()`'s account-deletion sibling already does
(App.js:6752-6758, `viz/{uid}`), or replace the client's own Storage cleanup entirely with a call
into this same Admin-SDK path via a Cloud Function.

Throws (does not swallow) on any listing or delete failure — Invariant 2 requires
`deletePlanAdmin`'s caller to be able to tell Storage cleanup genuinely completed, not just
attempted.

## 2. `deletePlanAdmin` revisions

Two deliberate changes from the Phase C1/C2-era mirror, both required by this phase's Invariant 2:

- **Storage-first ordering.** Storage cleanup now runs *before* the Firestore plan doc is
  touched — the reverse of App.js's own `deletePlan` ordering (Firestore first, Storage
  best-effort after, explicitly accepting an orphaned image as low-stakes for that single-tap
  "delete from My Plans" flow). Hard-delete needs the opposite tradeoff: the plan document itself
  is this function's own restart marker for its Storage cleanup. As long as it still exists, a
  retried `hardDeleteAreaAdmin`'s own `where("areaId","==",areaId)` query finds it again and
  retries Storage cleanup. Deleting the Firestore doc first would make a failed Storage cleanup
  permanently unreachable on retry — nothing durable left to requery by (the exact gap
  DeletionDesign.md's own Addendum already flagged: "Where live-state discovery genuinely falls
  short: Storage, not Firestore"). This ordering change applies to **every** caller, not just
  hard-delete, per the task's own "applies to ALL plan deletions going forward."
- **`{ manageParentSpace = true }`.** When `false` (`hardDeleteAreaAdmin`/`hardDeleteRoomAdmin`'s
  own usage), skips the "delete the Space if no sibling Projects remain" / summary-recompute
  branch entirely. A real bug this closes, found while implementing (not hypothetical): without
  this, `deletePlanAdmin`'s own existing "auto-delete the Space when its last Project goes" side
  effect could delete the Room document mid-way through `hardDeleteRoomAdmin`'s own per-Area loop
  — e.g. while processing Area 2 of 3, if that Area's last plan happens to also be the *Room's*
  last surviving Project. If the process then crashed before Area 3 finished, a retry's own
  first check (`spaceSnap.exists`) would see the Room already gone and report `already-deleted`,
  **skipping Area 3 and its plans/Storage entirely** — a real data-loss-on-restart bug, not just
  an ordering nicety. The parent Space/Area document must be removed *exclusively* by its own
  engine's explicit final step. Every other caller (the original single-plan delete flow) keeps
  the original auto-cleanup behavior, unchanged, as the default.

## 3. Merge-candidate reconciliation, scoped (Invariant 3)

`detectAndPersistMergeCandidatesForUser(db, uid, scopeSpaceTypes = null)` gained one optional
parameter. When supplied, reconciliation is restricted to just those spaceTypes instead of the
account's full spaceType set — every existing full-account caller (`main()`'s own detect pass)
passes nothing and is unaffected.

`snapshotAffectedMergeCandidates(db, uid, planIds)` — new — given a set of plan IDs about to be
hard-deleted, finds every `mergeCandidates` document referencing at least one of them, captured
**before** any deletion happens, returning `{ candidateIds, spaceTypes }`. Both
`hardDeleteAreaAdmin` and `hardDeleteRoomAdmin` call this first, then pass the captured
`spaceTypes` into the scoped reconciliation call after deletion — never rediscovering the
plan↔candidate join from data the operation itself just destroyed. `candidateIds` is carried
through into each function's own return value, for introspection/tests.

The underlying reconciliation logic itself (`evaluateCandidateInvalidation`) is unmodified —
still "reuse unmodified," per DeletionDesign.md Section 1's original decision. This phase only
adds the ability to scope *which* spaceTypes a given call bothers reconciling, in service of
Invariant 3.

## 4. `hardDeleteAreaAdmin(db, uid, roomId, areaId)`

a. Query `plans` where `areaId == areaId` (unscoped by Room — `areaId` has no Room prefix of its
   own); verify each candidate's `computeShadowIds(planId, plan).spaceId === roomId` (Invariant 1)
   before including it. A candidate whose own canonical Space resolves elsewhere is left
   completely untouched, not just skipped-with-a-warning — returned in `skippedWrongRoomPlanIds`.
b/c. Delete each verified plan via `deletePlanAdmin(..., {manageParentSpace: false})`. Abort
   immediately on the first failure — the Area document is left exactly as-is, the restart marker.
d. Reconcile merge candidates from the Invariant-3 snapshot.
e. Recompute the parent Room's summary — safe even if the Room is itself mid-hard-delete or
   already gone, since `updateSpaceRoomSummaryAdmin` already catches and no-ops internally.
f. Hard-delete the Area document. Sole step that removes the restart marker.

Idempotent/restartable **by construction**, not by any stored checkpoint (Restartability
Principle, SpaceMemoryModel.md §12 — the same discipline this whole file already commits to
elsewhere, not a new pattern introduced here): a missing Area doc is a no-op; a present one
re-derives exactly which plans are still actually left via the same live query, regardless of how
many prior attempts partially succeeded.

## 5. `hardDeleteRoomAdmin(db, uid, roomId)`

a. Load **all** Areas under the Room, including already-retired ones from prior merges — they
   still have real shadow data (Projects/Sessions/Batches under whatever plans point at them)
   needing the same cleanup as any live Area.
b. Snapshot every plan genuinely belonging to this Room — its own founding plan (doc id ===
   roomId) OR any plan whose `canonicalSpaceId === roomId` — captured before any deletion.
   Separately compute `wholeRoomPlanIds` (no `areaId`) — the ones the per-Area loop below will
   never see, since `hardDeleteAreaAdmin` only ever queries plans by `areaId`.
c. Hard-delete every Area via `hardDeleteAreaAdmin` as a sub-routine — single source of truth for
   Area-deletion semantics, not reimplemented inline. Abort immediately on the first failure — the
   Space document (and any not-yet-processed Area) remains as the restart marker.
d. Delete whatever plans remain directly under the Room — whole-Room visits and legacy
   `areaId`-less plans.
e. Reconcile merge candidates from the Invariant-3 snapshot — this pass specifically matters for
   candidates referencing whole-Room-visit plans, which no per-Area reconciliation pass would ever
   have seen. Also a harmless, idempotent second pass over any spaceType an Area-level call
   already reconciled (confirmed by direct testing — a `"superseded"` candidate re-encountered
   here is simply re-confirmed `"kept-superseded"`, never re-processed).
f. Hard-delete the Space document. Sole step that removes the restart marker.

**Invariant 4 (inbound tombstone policy), stated explicitly per the task spec**: neither function
queries for, walks, or touches any *other* Space/Area elsewhere whose `redirectTo` points at the
thing being deleted. Those are historical lineage from a prior merge/reclassification *into* the
now-being-deleted target — already hidden from every user-facing surface via the existing
`retired` filter regardless of whether their redirect target still exists (matches
DeletionDesign.md Section 4's "leave orphaned redirects as-is" decision, and this codebase's
established "never physically delete audit trail" convention for `mergeCandidates`/
`reclassificationExecutions`). They remain, with a now-dangling historical `redirectTo`, until
account deletion — which hard-deletes every Room the account owns, tombstones included, by
iterating every Space document directly, never by following redirects.

Both functions are unconditional destroy primitives: neither checks or requires
`retired`/`deletedAt` itself. That decision belongs entirely to the caller — the retention sweep's
own cutoff query (Phase C4), or account deletion bypassing retention checks entirely (Phase C5).

## Test results (real staging, throwaway data fully cleaned up afterward)

33 of 33 assertions passed. Setup: Room X with Area A (2 plans, one carrying real `progress/`
Storage content), Area B (1 plan), Area C (0 plans), Area D (already-retired merge-tombstone
shape, 1 live plan), Area E (1 plan, reserved for the Storage-failure simulation), Area F (3
plans, reserved for the restart-after-partial-failure simulation), a whole-Room visit, a legacy
plan with no `areaId` field at all, an unrelated "wrong-room" plan whose `areaId` collides with
Area A's but whose own canonical Space is not Room X, a `mergeCandidates` document referencing two
of Room X's plans, and a separate Room Z retired with `redirectTo` pointing at Room X (the inbound
tombstone).

| # | Test | Result |
|---|---|---|
| a | `hardDeleteAreaAdmin`(Area A): Area + both plans + shadow Project gone; parent Room survives with correctly recomputed `visitCount` | **PASS** (7/7) |
| b | `hardDeleteRoomAdmin`(Room X): Room, all remaining Areas (B/D/E), all their plans/shadows, all Storage gone; nothing remains | **PASS** (5/5) |
| c | Whole-Room visit (`areaId: null`) caught by `hardDeleteRoomAdmin` | **PASS** |
| d | Legacy plan with no `areaId` field caught by `hardDeleteRoomAdmin` | **PASS** |
| e | Recursive Storage cleanup: Area A's plan's `original.jpg` **and** `progress/` subfolder object both genuinely removed | **PASS** |
| f | Already-retired Area D (merge-tombstone shape) — and its still-live plan — cleaned up by `hardDeleteRoomAdmin`; Area E (left fully untouched by test m's aborted attempt) cleaned up fresh in the same pass, Storage included | **PASS** (3/3) |
| g | Merge candidate reconciled from the pre-deletion snapshot: a `"dismissed"` candidate referencing Area A's founding plan transitions to `"superseded"` once that plan is gone; `hardDeleteAreaAdmin`'s own return value lists the captured candidate id | **PASS** (2/2) |
| h | Re-running `hardDeleteAreaAdmin` on an already-deleted Area is a no-op (`already-deleted`) | **PASS** |
| i | Re-running `hardDeleteRoomAdmin` on an already-deleted Room is a no-op (`already-deleted`) | **PASS** |
| j | Restart after partial failure: Area F with 2 of 3 plans already gone (simulated via direct out-of-band cleanup, deterministic rather than racing live query order mid-abort) and its Area doc still present — a fresh `hardDeleteAreaAdmin` call finds only the one remaining plan and completes correctly | **PASS** (3/3) |
| k | `hardDeleteAreaAdmin` on a zero-plan Area (C): Area doc removed, `deletedPlanCount: 0`, no errors | **PASS** (2/2) |
| l | Room-scoped verification: a plan with Area A's `areaId` but a different (self) canonical Space is never deleted, at both the Area level and confirmed still true after the Room-level pass; reported in `skippedWrongRoomPlanIds` | **PASS** (3/3) |
| m | Storage failure (simulated via a targeted `File.prototype.delete` override for one exact object — every other Storage/Firestore operation in the run stayed fully real) aborts `hardDeleteAreaAdmin` *before* the Area doc or the plan's Firestore doc are touched; the real Storage object is confirmed still present, not silently gone | **PASS** (4/4) |
| n | Inbound tombstone Room Z (`retired: true, redirectTo: roomId`) is not walked, not touched, not deleted by Room X's hard-delete — still present with its redirect intact afterward | **PASS** |

**One real gap found and fixed during implementation, not just during testing**: the
`manageParentSpace` option (Section 2) — without it, `hardDeleteRoomAdmin` could lose track of
not-yet-processed Areas after a mid-run crash, because `deletePlanAdmin`'s own pre-existing
"auto-delete the Space when its last Project goes" side effect could remove the Room's restart
marker early. Caught by reasoning through the exact crash-recovery scenario while implementing,
confirmed by direct code reading of `deletePlanAdmin`'s original sibling-Project-count logic, not
by a failing test (the test suite's own restart scenario, test j, is scoped to the Area level,
where this specific failure mode doesn't arise).

# Phase C4: Retention Cleanup Job — Implementation Report (2026-08-10)

Builds the scheduled Cloud Function (`functions/index.js`'s `cleanupExpiredDeletions`) that
hard-deletes soft-deleted Rooms/Areas once their 30-day retention window passes, by calling the
real Phase C3 engine (`hardDeleteRoomAdmin`/`hardDeleteAreaAdmin`) — this file contains no deletion
logic of its own, only discovery/scheduling/logging around calling that engine.

- Commit: (this phase)
- Deployed: `cleanupExpiredDeletions` (staging, `us-central1`, daily at 03:00 UTC), plus two
  Firestore collection-group field-override indexes (`spaces.deletedAt`, `areas.deletedAt`)

## 1. Reusing the C3 engine across a deploy boundary

Firebase Functions deploy only bundles the `functions` source directory (`firebase.json`) —
`functions/index.js` cannot `require("../scripts/runSpaceMigration")` in production; that path
simply won't exist in the deployed container. To call the *real* C3 engine rather than write a
second implementation, `scripts/prepareFunctionsDeploy.js` (new) copies
`shared/spaceMigration.js`, `shared/spaceShadowValidation.js` (its own sibling dependency,
discovered when the first copy attempt threw `Cannot find module './spaceShadowValidation'` —
fixed by adding it to the copy list, not by trimming the dependency), and
`scripts/runSpaceMigration.js` into `functions/shared/` and `functions/scripts/`, preserving the
exact same relative directory shape so the copied `runSpaceMigration.js`'s own
`require("../shared/spaceMigration")` resolves unchanged — a byte-for-byte copy (each prefixed
with a "GENERATED FILE, do not hand-edit" header inserted *after* `runSpaceMigration.js`'s own
`#!/usr/bin/env node` shebang, which only Node-special-cases as the literal first line), not a
transcription that could drift.

Wired as this functions codebase's `predeploy` hook (`firebase.json`:
`"predeploy": ["node scripts/prepareFunctionsDeploy.js"]`), so every real
`firebase deploy --only functions` refreshes the copies from the canonical source automatically.
The generated copies are committed to git (not `.gitignore`'d) — not because they're meant to be
hand-edited, but so a clone always has a deployable `functions/` directory even if a deploy is
ever triggered without this predeploy hook firing; `git diff` on `functions/shared/`/
`functions/scripts/` without a corresponding root-level `shared/`/`scripts/` change in the same
commit is the tell that something touched the wrong copy.

`functions/index.js` requires `hardDeleteAreaAdmin`/`hardDeleteRoomAdmin` from `./scripts/runSpaceMigration`
(the generated copy) at module load — verified deployed and callable via the real staging test
suite below, which requires the actual `functions/index.js` module directly (not a stand-in).

## 2. Firestore indexes

`db.collectionGroup("spaces")`/`.collectionGroup("areas")` range queries on `deletedAt` need an
explicit collection-group index — Firestore's automatic single-field indexing does not extend to
collection-group scope by default. Added `firestore.indexes.json` (new) with `fieldOverrides` for
both collection groups (not a composite `indexes` entry — a field override is the correct,
minimal config for "extend automatic indexing to collection-group scope for this one field",
avoiding a full composite index for what is, and stays, a single-field query — matching this
file's own established "avoid composite indexes where a single-field range suffices" preference,
see `checkOrphanedUserDeletions`/`reengagementNudge`'s identical reasoning). Wired into
`firebase.json`'s `firestore.indexes` pointer and deployed ahead of the function itself
(`firebase deploy --only firestore:indexes --project cluttrd-staging`).

## 3. `runExpiredDeletionSweep(db, { retentionDays = 30 })`

Exported as a plain function (`exports.runExpiredDeletionSweep = runExpiredDeletionSweep`), not
wrapped in `onCall`/`onSchedule` — firebase-functions v2 only treats exports created via its own
builders (which attach internal `__endpoint` metadata) as deployable, so this export is inert to
`firebase deploy` (confirmed: it did not appear as a created/updated function in the real deploy
output) and exists solely so a real-staging test can `require("./functions/index.js")` and invoke
it directly with a shorter retention window — matching DeletionDesign.md's own original sketch of
this exact requirement almost verbatim. `db` is an explicit parameter (this file's own
`db = admin.firestore()` is not reached for directly), matching the dependency-injection
convention every function in `scripts/runSpaceMigration.js` already uses, so a test's own Admin
app's Firestore instance can be passed straight through.

**Pass 1 (Rooms)**: `collectionGroup("spaces").where("deletedAt", "<=", cutoff)`, then
`hardDeleteRoomAdmin(db, uid, roomId)` per result — which already recursively hard-deletes every
Area under it (Phase C3), so this pass alone fully closes out a Room-level soft-delete.

**Pass 2 (standalone Areas)**: `collectionGroup("areas").where("deletedAt", "<=", cutoff)`. For
each: derive `uid`/`roomId` from `areaDoc.ref.parent.parent`, read the parent Space, and skip
(outcome `skipped-parent-deleted`) whenever the parent is itself currently user-deleted
(`retired === true` and has its own `deletedAt`) — **regardless of the Room's own cutoff status**,
per the task's own governing rule: once a Room is soft-deleted, its child Areas belong to that
Room's retained/restorable graph; the Room's own expiration governs the whole subtree, an
individual Area's (possibly much older) `deletedAt` never overrides that. Only processed
(`hardDeleteAreaAdmin`) when the parent is active or a bare merge tombstone (`retired`, no
`deletedAt`) — i.e. genuinely not user-deleted.

**deletedAt alone (no separate `retired == true` clause) is a sufficient, deliberate filter** —
never set without `retired: true` also being set (the soft-delete contract from Phase C1/C2), and
a bare tombstone categorically lacks the field, so it can never match a range filter on it. Test
(d) below confirms this directly, including under a 0-day retention window, not just by code
inspection.

**A real, correct interaction found while testing, not a bug**: when a Room-level hard-delete
*fails* partway (Storage cleanup failure, Phase C3's own abort-before-parent-removal guarantee),
its own cascade-Area is still fully present in Firestore, unchanged — so Pass 2's *independent*
query, running moments later in the *same* sweep call, discovers it too, and correctly skips it
(its parent Room is still very much soft-deleted). Harmless: not a double-delete, no data lost —
just confirmation that a partially-failed Room stays consistently "still retained" from both
passes' point of view within one run, and fully resolves itself (Pass 1 succeeds, Pass 2 no longer
even discovers that Area, since it's already gone) on the very next scheduled run.

## 4. Scheduling and logging

`exports.cleanupExpiredDeletions = onSchedule({ schedule: "0 3 * * *", timeZone: "UTC" }, ...)` —
daily at 03:00 UTC, explicit timezone (Firebase's own default is project-local, not UTC, so this
is stated rather than assumed).

Every item logs `uid`, `roomId`/`areaId`, `deletedAt` (ISO string, converted from the Firestore
`Timestamp`), and outcome (`deleted` / `already-gone` / `skipped-parent-deleted` / `failed`, the
last with the full result detail attached) via `console.log`/`console.error`, matching this file's
own `[tagName]`-prefixed logging convention throughout. A final `SUMMARY` line logs the complete
counts object.

**One structural note, worth stating explicitly rather than leaving implicit**: `alreadyGone` will
realistically always read `0` in a real sweep run. `hardDeleteRoomAdmin`/`hardDeleteAreaAdmin`'s own
`already-deleted` outcome only fires when the target document doesn't exist at all — but the sweep
only ever calls either function for an id it *just* discovered via a live query in the same pass,
so the document, by definition, existed a moment earlier. A nonzero `alreadyGone` would only occur
under a genuine concurrent-run race (two sweep invocations overlapping) — vanishingly unlikely for
a once-daily cron, and not something this test suite forces, for that reason.

## Test results (real staging, throwaway data fully cleaned up afterward; the sweep's own final
0-day run did most of that cleanup itself, by design)

18 of 18 assertions passed, across three consecutive `runExpiredDeletionSweep` calls against the
real deployed module. Setup: Room A (cascade-soft-deleted 31 days ago), Room B (active) with
independently-soft-deleted Area B1 (31 days ago), Room C (soft-deleted today), Room D (genuine
merge tombstone), Room E (soft-deleted today) with independently-soft-deleted Area E1 (31 days
ago), and Rooms F1/F2 (both cascade-soft-deleted 31 days ago, F1's own plan's Storage cleanup
forced to fail via the same `File.prototype.delete` targeted-override technique the Phase C3 suite
established).

| # | Test | Result |
|---|---|---|
| a | Expired Room A: `hardDeleteRoomAdmin` removes the Room, its Area, its plan, all Storage | **PASS** |
| b | Independently-expired standalone Area B1 (parent Room B active): `hardDeleteAreaAdmin` removes just the Area and its plan; Room B untouched | **PASS** |
| c | Room C, soft-deleted today (within 30 days): not touched | **PASS** |
| d | Merge tombstone Room D (`retired`, no `deletedAt`): not touched — re-confirmed even under a 0-day retention window (run 3) | **PASS** (2/2) |
| e | Re-running the sweep: no errors; already-cleaned items aren't rediscovered (fully gone); still-pending items (Room F1 after recovery, Area E1's stable skip) behave identically on every subsequent run | **PASS** (4/4) |
| f | Room E soft-deleted today (not expired) + its Area E1 independently expired 31 days ago: **neither** touched — the Area stays preserved as part of the Room's still-retained graph | **PASS** (2/2) |
| g | Partial failure (Room F1's forced Storage failure) does not block Room F2 (sibling, same run) from completing; F1 recovers cleanly on the very next run once the failure is no longer forced | **PASS** (3/3) |
| h | Summary counts are correct — including accounting for the real Pass-1/Pass-2 interaction on a partially-failed Room (Section 3's own note), verified against a captured pre-test baseline so the assertion is robust to any unrelated pre-existing data, not a fragile absolute number | **PASS** (2/2) |
| (bonus) | `retentionDays: 0` genuinely changes sweep behavior (Room C and Room E, both untouched under the real 30-day window, are newly eligible and cleaned up) — proves the directly-callable export's own parameter is honored, not hardcoded, satisfying item 2's own explicit reason for existing | **PASS** (2/2) |

No gaps found this phase. The one non-obvious finding (Section 3's Pass-1/Pass-2 interaction on a
partially-failed Room) was caught by the test suite itself — an initial hardcoded expected-count
assertion failed, and root-causing it confirmed the actual behavior was correct, not a bug; the
test's own expectation was wrong, not the implementation.

# Phase C5: Server-Side Account Deletion — Implementation Report (2026-08-10)

Replaces the client-side Delete Account handler (App.js — direct Firestore/Storage/Auth client-SDK
calls) with a server-side Admin-SDK orchestration, `hardDeleteAccountAdmin(db, uid)`
(`scripts/runSpaceMigration.js`), exposed to the client via a new `hardDeleteAccount` callable
Cloud Function. Reuses the Phase C3 engine for every actual deletion; this phase only adds the
account-level orchestration, the auth-gated entry point, and the client wiring.

- Commit: `4c2e237`
- Deployed: `hardDeleteAccount` (staging, `us-central1`)
- OTA (staging): iOS `019fec16-a320-71eb-b31d-e1c3b79c58ad`, Android `019fec16-a320-737f-ad60-7afdb0b7cb21`

## 1. `hardDeleteAccountAdmin(db, uid)`

**Phase 1 — every known Room.** `userRef.collection("spaces").get()`, unfiltered — retired or not.
Soft-deleted Rooms still inside their 30-day retention window and merge/reclassification
tombstones are both included and both permanently removed: account deletion bypasses the
soft-delete/retention path entirely (`BYPASS SOFT DELETE`) — there's no "My Rooms" left to restore
into once the account itself is gone. Each Room is hard-deleted via `hardDeleteRoomAdmin`
(Phase C3), which already recursively handles its own Areas/plans/shadows/Storage.

**Phase 2 — uid-scoped orphan sweep.**
- (a) Remaining plans: `userRef.collection("plans").get()`, not `collectionGroup("plans")` as the
  task's own text suggested — a deliberate deviation, explained below.
- (b) Remaining Spaces: the identical query as Phase 1, re-run (catches anything Phase 1 missed or
  failed on; naturally empty in the common case).
- (c) Remaining Areas with no reachable parent Space at all: `collectionGroup("areas")`, genuinely
  necessary here (unlike (a)/(b) — Areas don't have a single-level direct subcollection off
  `users/{uid}`), scoped to this uid's own subtree via a `FieldPath.documentId()` range query.
- (d) **Generalized beyond the task's own literal list**: every *other* direct subcollection under
  `users/{uid}` — found via `userRef.listCollections()`, not a hardcoded name list — flat-deleted.
  `mergeCandidates`/`reclassificationExecutions` were the two named in the task; direct code search
  turned up two more real, existing subcollections the literal list didn't name —
  `mergeExecutions` (`scripts/executeMerge.js`) and `analysisIdempotency`
  (`functions/index.js`'s `analyzePhoto`) — both of which would have violated test (a)'s own
  "zero documents in ANY subcollection" bar if left untouched. `listCollections()` also makes this
  robust against a *future* phase adding a new subcollection without anyone remembering to update
  an account-deletion allowlist.
- (e) Storage: `plans/{uid}/` and `viz/{uid}/`, via the Phase C3 `deleteStoragePrefixesAdmin`
  primitive directly — a defensive backstop beyond per-plan cleanup already performed above.

**`collectionGroup("plans")` vs. a direct `users/{uid}/plans` query, explained:** the task's own
text specified `collectionGroup("plans")`. `plans` documents have exactly one location in this
codebase's entire write path — `users/{uid}/plans` — verified directly, not assumed (every
`savePlanToHistory{Admin}` call site writes there and nowhere else). A `collectionGroup("plans")`
scan would additionally read every *other* user's plans project-wide on every single account
deletion, for zero additional correctness in this schema (a plain subcollection query already
finds every real orphan, and — confirmed directly, not assumed — works identically for a
parentless user, since Firestore subcollection queries never require their parent document to
exist). Implemented as the cheaper, equivalent direct query instead; flagged here explicitly as a
deliberate deviation, not an oversight. `spaces` similarly — Phase 2b just re-runs Phase 1's own
direct query. `areas` is the one case a collection-group query is genuinely required (Section
above), since Areas nest two levels under `users/{uid}`, not one.

**A real bug caught and fixed while implementing, found by direct code reading of
`deletePlanAdmin`, not by a failing test**: `deletePlanAdmin`'s own pre-existing "auto-delete the
Space if no sibling Projects remain" side effect (unrelated to this phase — it's the same logic
Phase C3 already had to guard against for `hardDeleteRoomAdmin`'s own per-Area loop) would, if left
unguarded here too, risk deleting a Space document as an incidental side effect mid-sweep. Every
call in this phase to `deletePlanAdmin` — Phase 2a's orphan-plan loop — passes
`{ manageParentSpace: false }`, the exact same Phase C3 guard, for the exact same reason.

**A real Firestore validation error found and fixed during testing, not by code inspection alone**:
the collection-group range-query bound for Phase 2c initially used a bare collection path
(`users/{uid}/spaces/`) as both the lower and upper `FieldPath.documentId()` bound. Firestore
rejects this outright at query-construction time — "must result in a valid document path... odd
number of segments" (confirmed against real staging Firestore, not inferred) — `FieldPath
.documentId()` bounds must themselves parse as a *document* reference (even segment count), not a
bare collection path. Fixed by appending a sentinel document-ID segment to each bound (a low U+0000 null character, a high U+F8FF character) — the actual cross-uid scoping still works correctly regardless,
since Firestore compares the full resource-path *string* lexicographically, so a real Area document
nested arbitrarily deeper under `users/{uid}/spaces/{anyRoomId}/...` still sorts correctly between
these two 4-segment bounds despite its own true depth (6 segments).

## 2. Identity-last, content-gated (the account-level "parent-last with a gate")

Phase 3 (delete `users/{uid}` if it exists, then the Firebase Auth account) runs **only** if every
content phase above reports zero failures — tracked as a single `contentCleanupFailed` flag across
all of Phase 1/2's per-category failure counts. If anything failed, `hardDeleteAccountAdmin` returns
`{outcome: "content-incomplete", ...}` **before touching the profile doc or Auth account at all** —
this is Phase C3's own Invariant 2 (parent-last, Storage-gated) applied one level up, from a single
Room/Area to the whole account: a partial content failure can never strand data with no identity
left to rediscover it by. `uid` alone remains a valid, re-queryable retry point regardless of what
failed.

**AUTH-LAST RETRY, verified concretely**: `admin.auth().deleteUser(uid)` failing with anything
*other* than `auth/user-not-found` returns `{outcome: "auth-delete-failed", ...}` — but the profile
doc (Phase 3a) has, by construction, already been deleted by this point (it's step *a*, before step
*b*). A re-run finds zero content work left (Phase 1/2 all report zero discovered) and zero profile
doc left (already gone, skipped) and lands directly on retrying just the one thing that actually
failed — Auth deletion. `auth/user-not-found` itself (the account genuinely already gone, from a
prior successful run) is explicitly treated as success, not a failure, the same convention
`checkOrphanedUserDeletions` already established for this exact error code.

## 3. `hardDeleteAccount` (onCall)

`uid` is taken **exclusively** from `request.auth.uid` — the ID token Firebase Callable Functions
already verifies server-side — never a client-supplied parameter. There is no way for an
authenticated caller to trigger this against any account but their own, and no unauthenticated
caller can trigger it at all (`HttpsError("unauthenticated", ...)`, verified against the real
deployed function, not just asserted). `timeoutSeconds: 300` (`generateVisualization`'s own
precedent) — a large account's real per-Room/per-Storage-prefix work can genuinely take a while,
not get stuck. A non-`"hard-deleted"` outcome from `hardDeleteAccountAdmin` is translated into an
`HttpsError("internal", ...)` — the client's own retry UI needs a rejected promise to act on, and
the content-gate above already guarantees a "failure" response never means anything was left
half-done.

## 4. Client changes (App.js)

`handleConfirmDelete` (My Account's "Delete Account" flow) keeps its existing password
reauthentication step unchanged (still the right client-side gate — it confirms the person holding
this signed-in session actually knows the account's password, independent of who does the actual
deletion work) but now calls `httpsCallable(functions, "hardDeleteAccount")()` instead of the prior
direct `deleteDoc`/`listAll`/`deleteObject`/`deleteUser` sequence. Only after the callable resolves
does it call `signOut(auth)` and clear local state (`email`/`password` form fields,
`analysisCount`/`isPro`/`skipOnboarding` from `AsyncStorage`) — the client's own local Auth SDK
session has no way to know the server just deleted this account server-side until it's told.
Added `{deleteLoading && <ProcessingOverlay text="Deleting your account..." />}` inside the
existing password modal, matching the same `ProcessingOverlay` convention every other multi-step
save flow in this file already uses. The now-unused `deleteUser` import was removed.

## 5. Cross-deploy-boundary reuse

No new mechanism needed — `hardDeleteAccountAdmin` was added directly to `scripts/runSpaceMigration.js`
(the same file Phase C4's `cleanupExpiredDeletions` already pulls its hard-delete engine from) and
picked up automatically by the existing `scripts/prepareFunctionsDeploy.js` predeploy copy
established in Phase C4.

## Test results (real staging, throwaway Auth accounts and data; self-cleaned by the very function
under test in every case)

29 of 29 assertions passed, across dedicated throwaway Firebase Auth accounts (never the shared
Phase C1-C4 test uid, since this suite genuinely deletes Auth accounts).

| # | Test | Result |
|---|---|---|
| a | Full-featured account (3 Rooms, Areas, plans, shadows, Storage, merge candidates, reclassification/merge execution records) → `hardDeleteAccountAdmin` → zero documents in any subcollection, zero Storage files, no Auth account | **PASS** (4/4) |
| b | Soft-deleted Room still well inside its 30-day retention window: removed immediately, not preserved | **PASS** |
| c | Merge-tombstone Room (retired, `redirectTo`, no `deletedAt`) with a live plan: removed | **PASS** |
| d | `reclassificationExecutions` record removed; `mergeExecutions`/`mergeCandidates` also removed (beyond the task's literal list — see Section 1) | **PASS** (2/2) |
| e | Parentless user (no `users/{uid}` doc, real plans/Areas/Room exist): deletion succeeds without errors, content and Auth account both fully removed | **PASS** (4/4) |
| f | Re-run on an already-cleaned uid: genuine no-op (zero discovered everywhere), no errors | **PASS** (2/2) |
| g | Content cleanup succeeds but Auth deletion fails (simulated via a targeted `admin.auth().deleteUser` override for one exact uid, restored immediately after use): profile doc already gone, Auth account confirmed still present, not silently gone; re-run completes Auth deletion and confirms it | **PASS** (5/5) |
| h | Orphan sweep catches a plan with no matching Space anywhere, *and* an Area with no parent Space document at all (the collection-group range-query path) | **PASS** (3/3) |
| i | Real end-to-end HTTP call through the *deployed* `hardDeleteAccount` callable — genuine email/password sign-in (not a custom-token mint, which requires IAM signing infrastructure unavailable to this local dev environment's personal-user credentials; email/password sign-in is arguably the more faithful reproduction of what the client's own `httpsCallable()` call sits on top of anyway) obtains a real ID token, the call performs real deletion work (verified against Firestore/Storage/Auth afterward, not just a 200 status), and a separate unauthenticated call is confirmed rejected | **PASS** (5/5) |

**Two real, confirmed-not-assumed findings during implementation** (both described in full in
Section 1): the `manageParentSpace: false` guard needed on Phase 2a's `deletePlanAdmin` calls, and
the `FieldPath.documentId()` sentinel-segment fix for the Phase 2c collection-group range query
(the latter caught by a real query-construction error against live Firestore during testing, not
by code inspection).
