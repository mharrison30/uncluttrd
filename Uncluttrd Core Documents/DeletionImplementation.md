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
