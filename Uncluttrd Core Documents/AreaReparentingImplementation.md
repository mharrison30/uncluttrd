# Area Re-parenting — Phase A Implementation Report

**Scope shipped:** Move an Area to an **existing** Room. "Create a new Room during move" is deferred to Phase B (present in the picker, disabled, labelled "Coming soon").

**Design followed:** `AreaReparentingDesign.md`. Section references below (§) are to that document.

**Branch:** `feature/companion` · **Verified against:** `cluttrd-staging` (real Firestore writes, cleaned up afterward) · **Date:** 2026-08-10

---

## 1. What was built

### 1.1 `moveAreaToRoom` — the orchestrator (App.js:1907-2062)

A scoped variant of `mergeRoomIntoRoom`, exactly as §5 recommends — not a new orchestrator. It reuses `establishTargetArea`, `reclassifyLegacyPlan`, `updateAreaSummary` and `updateSpaceRoomSummary` unmodified, selecting plans by `areaId` instead of by `canonicalSpaceId`.

| Phase | What it does |
|---|---|
| 0 | Validate target Room exists and is not retired; validate source Area exists. **Idempotency short-circuit:** a source Area that is already `retired` *and* carries `migrationTargetAreaId` returns `already-completed` immediately, touching nothing. |
| 1 | Snapshot every plan where `areaId == sourceAreaId` (id, `areaName`, `areaScope`). Also snapshots whether the source Room was **already** retired before the move (see §1.2). |
| 2 | `establishTargetArea(uid, sourceRoomId, sourceAreaId, targetRoomId)` — unchanged. Idempotent via `migrationTargetAreaId` persisted on the source Area *before* any plan moves. |
| 3 | Sequential (never `Promise.all`) per-plan `reclassifyLegacyPlan` to the target Room, then repoint that plan's `areaId` to the new twin and re-sync its shadow. Same two extra lines `mergeRoomIntoRoom` Phase 3 already uses. |
| 4 | Re-query `plans where areaId == sourceAreaId`. Non-empty ⇒ a partial failure ⇒ Phase 6 refuses to retire. |
| **5a** | **New: undo the source-Room retirement if this move caused it** (see §1.2). |
| 5 | `updateAreaSummary(target)`, `updateSpaceRoomSummary(target)`, `updateSpaceRoomSummary(source)`. |
| 6 | Retire the source Area — `{retired: true, redirectTo: newAreaId, retiredAt}` — **only** when Phase 4 found zero remaining references. Then re-run the source Room summary, because the Room recompute reads `retiredAreaIds` fresh and the tombstone did not exist one write earlier. |
| 7 | Return. Merge-candidate reconciliation is *not* repeated here — `reclassifyLegacyPlan`'s own Phase 6 already ran once per moved plan (§8/§1f). Verified empirically, not assumed — see test (k). |

Return shape: `{outcome, sourceRoomId, sourceAreaId, targetRoomId, newAreaId, movedCount, totalCount, results, failed, retired, stillReferencedCount, sourceRoomRestored}`. `outcome` is one of `completed` · `already-completed` · `partial` · `invalid-target` · `invalid-source` · `failed`.

### 1.2 The one real defect found and fixed — source Room auto-retirement

§4 requires: *"If this was the last Area and last plans, the Room becomes empty — it must remain ACTIVE, never implicitly retired or deleted."* The design pass concluded this needed no code because *"zero code paths automatically soft-delete or tombstone a Room merely because its Project/Area count reaches zero."*

**That conclusion does not hold for this feature.** `cleanUpOldSpace` (App.js:1640-1653) — Phase 4 of `reclassifyLegacyPlan`, which Phase 3 above calls once per plan — tombstones the source Space (`retired: true, redirectTo, retiredAt, reclassificationExecutionId`) as soon as its **last** Project is deleted. It cannot distinguish "the whole Room was merged away" (where that is correct) from "one Area moved out and happened to be the Room's only content" (where it is not). The design's audit was of *direct* Room-emptiness checks; this retirement is reached indirectly, through the per-plan reclassification the Area move reuses.

The consequence was concrete, not theoretical: `loadRooms` filters `s.retired !== true` (App.js:4440), and the Recently Deleted list requires **both** `retired` and `deletedAt` — a merge tombstone only sets `retiredAt`. An emptied source Room would have vanished from My Rooms with no way to get it back.

**Fix — Phase 5a**, deliberately *not* a change to `reclassifyLegacyPlan` (§8's explicit discipline: keep the proven Room-merge state machine unmodified). `moveAreaToRoom` undoes the one side effect that is wrong for this caller, and only when this call actually caused it:

```js
if (!sourceRoomWasRetiredBeforeMove) {
  const sourceSpaceAfter = await getDoc(sourceSpaceRef);
  if (sourceSpaceAfter.exists() && sourceSpaceAfter.data().retired === true) {
    await updateDoc(sourceSpaceRef, {
      retired: false,
      redirectTo: deleteField(),
      retiredAt: deleteField(),
      reclassificationExecutionId: deleteField(),
    });
  }
}
```

Two details that matter. `sourceRoomWasRetiredBeforeMove` is snapshotted in Phase 1, so a Room the user had **already** soft-deleted before starting stays deleted — this repairs, it does not resurrect. And the full tombstone field set is cleared, not just `retired`: a live Room left holding a dangling `redirectTo` at the target Room is exactly the stale-reference class of bug the tombstone convention exists to prevent.

Confirmed by test (m): `sourceRoomRestored: true`, source Room ends `retired:false`, no `redirectTo`/`retiredAt`/`deletedAt`, `visitCount: 0`, zero Projects, and passes `loadRooms`' own visibility filter.

### 1.3 UI — Area overflow menu (§9)

Each Area row in AREAS IN THIS ROOM is now:

```
[photo] Corner Shelf
        2 visits
        Organize Again              •••
```

"Organize Again" keeps the primary-action slot; `•••` sits on the same line pushed right by a spacer (App.js:8482-8508), a 44×44 hit target. Tapping it opens an action sheet (`renderAreaActionsSheet`, App.js:7115-7163) with **Rename Area · Move to another Room · Delete Area**.

Rename and Delete are the **existing** implementations, only relocated — `openAreaRenameSheet` and `handleDeleteArea` are called unchanged. Delete is invoked from the sheet with no `swipeableMethods` argument, which `handleDeleteArea` already tolerates (every use is optional-chained), so swipe-left-to-delete keeps working alongside the menu rather than being replaced by it: two entry points, one implementation.

### 1.4 UI — the reusable Room Picker (§9/§10)

`renderRoomPicker` (App.js:7176-7241). Built standalone, per §10 — *not* extracted from the Room-First-Identity confirmation picker, which is tightly coupled to `roomConfirmation`/`recognitionPendingRef`.

- Sources entirely from `rooms` (already non-retired via `loadRooms`), with a belt-and-braces `r.retired !== true`.
- Each row: Room-type icon (`getRoomTypeIcon`, reused directly), Room name, visit count, chevron.
- **Excludes the current Room** — the Area's parent for an Area move, the Room itself for a Room-level move.
- **"Create a new Room…" present but disabled**, rendered as a non-touchable `View` at 0.5 opacity with a "Coming soon" subtitle. Shown-but-disabled rather than hidden so the capability is discoverable and its absence explained (§3b: no `createRoom()` helper exists anywhere today — Phase B).
- Empty-state copy when the user has no other Room to move into.

Genericity is real, not aspirational: the picker takes its input from `rooms` and its output from one callback, branching only on `roomPickerFor.kind` (`"area"` vs `"room"`). That is what lets both flows share it verbatim.

### 1.5 UI — confirmation + processing overlay (§9)

`renderMoveConfirm` (App.js:7243-7292). Copy for an Area move is exactly as specified: **"Move [Area name] to [Room name]? All visits, photos, and history will move with it."** The Room-level variant states that the source Room will be merged away.

While `moveSaving` is true the dialog shows a `ActivityIndicator` + **"Moving…"** and **every** dismissal path is disabled — backdrop tap, Cancel, and `onRequestClose` all early-return through `closeMoveConfirm`. An Area move runs N sequential `reclassifyLegacyPlan` calls, each itself a 7-phase state machine, so multi-second latency is expected and must be visibly covered rather than left dismissible.

On success the flow patches `rooms` from freshly-read Space docs and navigates to the target Room's Room Detail (`setRoomDetailRoomId(targetRoom.id)`); both `roomDetailPlans` and `roomDetailAreas` are keyed on that id by their own effects, so the moved Area is showing when the screen lands — no extra refetch.

`already-completed` is treated as success, not an error: the Area really is under the target Room, which is all the confirmation promised.

### 1.6 Room-level "Move to another Room" — gap closed (§10)

`handleMoveRoomPlaceholder` (`Alert.alert("Coming soon", …)`) is **deleted** — zero occurrences remain in App.js. Room Detail's bottom link now calls `openRoomMovePicker(room)` (App.js:8570), which opens the same picker and the same confirmation, resolving to the existing, already-tested `mergeRoomIntoRoom`. This closes a gap open since Phase B of Room Grouping.

---

## 2. Design decisions carried through unchanged

- **New Area id, not a stable one** (§2). `establishTargetArea` is reused verbatim: new document, new auto-id, source retired with `redirectTo` lineage. Every plan's `areaId` changes, which costs nothing — its `canonicalSpaceId` write was mandatory anyway.
- **No auto-merge on name collision** (§7). Inherited free from `establishTargetArea`.
- **`reclassifyLegacyPlan` untouched** (§8). Not one line changed.
- **Recognition needs no code changes** (§6). Confirmed empirically in both directions — tests (g) and (h).

---

## 3. Staging verification

**Backend (a–m): 13/13 PASS**, real writes to `cluttrd-staging` under a dedicated synthetic uid, asserted against ground truth read back from Firestore, then hard-deleted. The harness runs a 1:1 Admin-SDK mirror of the shipped `moveAreaToRoom` (same phases, same guards, same order, including Phase 5a) over the real `reclassifyLegacyPlanAdmin` / `establishTargetArea` / summary machinery.

Fixtures: Room A "Verify Living Room" (Area **Corner Shelf** ×2 visits, plus an unrelated **TV Console** Area) → Room B "Verify Bedroom" (which already contains its *own* "Corner Shelf", for the collision test).

| # | Test | Result | Evidence |
|---|---|---|---|
| a | Both plans under Room B with correct `canonicalSpaceId` + `areaId` | **PASS** | both plans `canonicalSpaceId=zk1UdT…`, `areaId=AQF1rP…` |
| b | Area recreated under target, `displayName`/`originalPhotoUrl`/`createdAt` preserved | **PASS** | `createdAt` identical (`2026-08-11T02:28:34.973Z`), not reset to migration time |
| c | Shadow Projects moved to target Room | **PASS** | both Projects now under Room B with `areaId=AQF1rP…`; **Room A's other Area's Project untouched** (`TV Console` still present, correct `areaId`) |
| d | Source Room summary recomputed, count decreased | **PASS** | 4 → 2 |
| e | Target Room summary recomputed, count increased | **PASS** | 2 → 4 |
| f | Source Area retired with `redirectTo` → target Area | **PASS** | `retired:true, redirectTo:AQF1rP…, retiredAt` set, `deletedAt` absent (tombstone, not a soft-delete, not a document delete) |
| g | Recognition discovers moved Area under target Room | **PASS** | ran `findAreaRecognitionCandidates`' own Room-scoped query + `!retired` filter; moved Area present |
| h | Recognition no longer proposes it under source Room | **PASS** | source Room's eligible set is `[TV Console]` only |
| i | Name collision: coexists, no auto-merge | **PASS** | two distinct "Corner Shelf" Areas in Room B |
| j | Retry after partial failure, no duplication | **PASS** | genuinely interrupted attempt (twin established, 1 of 2 plans moved) then resumed → same twin id, **one** twin, 2/2 moved |
| k | Merge candidates reconciled | **PASS** | a *real* pending candidate containing a moved plan went `pending → superseded`, and the moved plan's execution recorded it in `reconciledCandidateIds` |
| l | Idempotent: re-run after completion is a no-op | **PASS** | `already-completed`, same `newAreaId`, Area count unchanged 3→3, `retiredAt` unchanged, source `visitCount` unchanged |
| m | Emptied source Room stays active and visible | **PASS** | `sourceRoomRestored:true`; `retired:false`, no `redirectTo`/`retiredAt`/`deletedAt`, `visitCount:0`, 0 Projects, passes `loadRooms` filter |

**On test (k):** the first run produced an empty candidate set, which was weak evidence, so the fixture was strengthened. `detectMergeCandidates` skips any plan whose `canonicalSpaceId` points at a different Space (shared/spaceMigration.js:458), so an ordinary returning-visit Area plan can *never* appear in a candidate. The only plan that can is a Room's **founding** plan (doc id === spaceId, no `canonicalSpaceId`) that also carries an `areaId`. The fixture builds exactly that, plus a second Room sharing its display name to force a real cluster. This is the one place §1f flagged as needing empirical proof rather than reasoning, and it now has it.

### Tests n–q — UI layer, verified by code inspection

There is no automated UI-driving harness in this project, and these four are render-layer facts with no Firestore side effects to observe. They were verified against the source, not exercised on a device; stating that plainly rather than implying runtime evidence:

| # | Test | Result | Location |
|---|---|---|---|
| n | "Create a new Room" visible but disabled in Room Picker | Verified in source | App.js:7222-7230 — non-touchable `View`, opacity 0.5, "Coming soon" |
| o | Area overflow menu shows Rename, Move, Delete | Verified in source | App.js:7128-7155 |
| p | Room-level "Move to another Room" wired and functional | Verified in source | App.js:8570 → `openRoomMovePicker` → `confirmMove` → `mergeRoomIntoRoom` (App.js:7093). `handleMoveRoomPlaceholder`: **0 occurrences** |
| q | Swipe-left Delete still works alongside the overflow menu | Verified in source | App.js:8457-8464 — `renderRightActions` still calls `handleDeleteArea(area, swipeableMethods)`, untouched |

### Build verification

Full Metro production export (`npx expo export --platform ios`) succeeded — 9.84 MB Hermes bundle, no errors.

---

## 4. OTA

Committed (`33a5e9c`) and pushed to the `staging` EAS Update branch.

- iOS update ID: `019feeab-8d3a-78e9-97db-3a9c55d20589` (update group `d71fe1a8-c663-462d-ab8a-de3936801fef`)
- Android update ID: `019feeab-8d3a-79c9-9bdf-57562f3a57fb` (update group `bb21b10b-db16-41a0-a975-cebed28e268e`)

---

## 5. Addendum — Legacy Area Backfill (`scripts/backfillLegacyAreas.js`)

Re-parenting operates on Area **documents**, but plans written before Area Identity Phase A carry only a flat `areaName` string with `areaId: null`. Those visits had no Area to move, and Room Detail's AREAS IN THIS ROOM section renders only Areas some plan points at — so the feature was unusable on exactly the existing data it was built to fix. This script closes that.

Per plan with a non-empty `areaName` and null `areaId`: resolve the canonical Room (`computeShadowIds(...).spaceId`), group by **(Room, areaName)** so N plans naming the same Area share ONE document, create the Area (`displayName` from `areaName`; `originalPhotoUrl`/`latestPhotoUrl` from the group's oldest/newest plan photo; `createdAt` from the **oldest member plan**, since a backfill is an administrative correction, not a new organizing event), repoint each plan's `areaId`, bump `shadowSourceVersion` and re-sync so `Project.areaId` catches up, then recompute the Area summary from its actual Projects.

**Grouping is exact-match on `areaName`, deliberately.** This codebase never auto-merges same-named Areas (§7) and has no un-merge tool, so collapsing names only a human can confirm are the same spot is not a call this script makes. Near-duplicates are reported instead; `--group-case-insensitive` exists for when the user has reviewed the report and wants it.

**Restartability:** a plan with an `areaId` is not a target, and an existing non-retired same-named Area in the Room is reused before creating — so a crash between "Area created" and "plans repointed" converges rather than duplicating. Created Areas are stamped `backfillSource: "legacy-areaName"` and preferred when matching.

**Safety:** refuses any project other than `cluttrd-staging` without an explicit `--i-understand-this-is-not-staging` flag.

**Redoing the grouping — `--reset-backfilled[=<areaName>]`.** The grouping choice is otherwise permanent: once plans carry an `areaId` they stop being targets, so re-running with different grouping flags is a *silent no-op*, and collapsing two already-created Areas would be an Area merge — which this codebase has no tool for. This flag reverses a prior run (plans back to `areaId: null`, its Area documents deleted) so the backfill can be redone. It only ever touches documents stamped `backfillSource: "legacy-areaName"`, so a user-authored Area can never be deleted by it, and it refuses any Area since drawn into a move or lineage reference. Optional name scoping keeps ids stable for Areas that aren't being regrouped.

**Run — `cluttrd-staging`, uid `ZYe7h9hM25UB7Pk6YRbPysg2cGC3`:** 28 plans scanned, 7 already had an `areaId`, 16 had no `areaName`; **5 plans backfilled into 5 Areas**, 0 groups skipped. Second run: no-op. One near-duplicate reported and not acted on: `"Corner shelf"` / `"Corner Shelf"` in Living Room.

**Follow-up run — regrouped case-insensitively at the user's request.** `--reset-backfilled="Corner Shelf"` reversed exactly those two Areas (2 plans back to `areaId: null`), then `--group-case-insensitive` recreated them as **one** Area `W6RqWrQK5UCBAwMGWANT` named **"Corner Shelf"** — the oldest member plan's own spelling, which here is also title case. `visitCount: 2`, both plans and both shadow Projects pointing at it, `createdAt` from the older plan and `lastOrganizedAt` from the newer. `"Corner Shelf Display"` (pre-existing, 4 visits) was untouched, as were the three other backfilled Areas. Final state: Office 1 Area row, Living Room 6.

Grouping, crash-resume and idempotency were exercised separately against a throwaway staging uid, since every group in the *first* real run happened to contain exactly one plan — 12/12 checks passed, including two plans sharing one Area document and `visitCount` recomputed to 2.

---

## 6. Known, accepted, out of scope

- **Benign `[AREA SUMMARY] NOT_FOUND` log line during a move.** `reclassifyLegacyPlan`'s reprojection recomputes the Area summary using the plan's *current* `areaId` — still the source Area's — under the *target* Room, where no such document exists. It is caught and logged, never thrown, and the correct summary is written moments later by Phase 5's `updateAreaSummary(target, newAreaId)`. Pre-existing behavior shared with `mergeRoomIntoRoom`, not introduced here.
- **Phase B — "Create a new Room during move."** Deferred as instructed. §3b's finding stands: no `createRoom()` helper exists anywhere; every Space today is founded as a side effect of a plan being saved. Needs its own design decision (synthesize an empty Room vs. let the moved Area's first plan found it).
- **Results screen Area-name staleness** (§8). Pre-existing for plain renames, out of scope, not made worse.
- **Dangling `redirectTo` after a later hard-delete of a target Room** — already-accepted limitation, Invariant 4 (scripts/runSpaceMigration.js:1071-1084). No new gap.
