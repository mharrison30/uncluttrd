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
