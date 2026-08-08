# Area Identity — Phase A Implementation & Real Staging Validation

Status: Implemented, validated against real `cluttrd-staging` data (synthetic uid). Real Room-First confirmation UI unchanged in behavior; recognition/matching (Phase B) not implemented.
Version: 0.1 (2026-08-08)
Companion to: `AreaIdentityDesign.md` (this document reports against that design's Sections 1-3/13 unchanged; the governing principle restated in the implementation task — Area association only through navigation, generic-camera entry always creates a new Area for sub-area visits — matches the design doc's own Section 5/9 conclusions exactly, no deviation)

---

## 1. Data model

New subcollection `spaces/{roomId}/areas/{areaId}`, exactly the path `AreaIdentityDesign.md` §2 specified. Fields match the design doc's own table one-to-one: creation-owned (`id`, `roomId`, `createdAt`, `originalPhotoUrl`), user-owned (`displayName`), projection-owned (`latestPhotoUrl`, `lastOrganizedAt`, `visitCount`), plus `retired`/`redirectTo` present and unused (future Area-merge, not built).

`plan.areaId` (`string | null`) is now written on every plan by `savePlanToHistory`/`savePlanToHistoryAdmin`, unconditionally — `null` for a whole-Room or legacy-descriptive visit, never absent, matching the task's explicit requirement.

`Project.areaId` was added to `deriveFullReprojectionDocs` (`shared/spaceMigration.js`), carried straight from `plan.areaId` exactly the way `Project.scopeId` already mirrors `plan.canonicalSpaceId`. **This turned out to be required, not optional** — see §4 below.

## 2. Area creation (generic-camera path)

Wired into `completeRoomConfirmation`, the one funnel every Room-First confirmation outcome already passes through. After a successful plan save, if `confirmedPlan.areaScope === "sub-area"`, `createAreaForPlan(uid, roomId, newPlanId, areaName)` runs: creates the Area doc with `originalPhotoUrl`/`latestPhotoUrl` set directly from the plan's own just-uploaded photo, `visitCount: 1` — set directly rather than via a summary recompute, since at that exact moment the plan's own shadow Project may not exist yet (`writeSpaceShadowStructure` is fire-and-forget from `savePlanToHistory`), so there's nothing to recompute from yet; the direct write is correct by construction (this genuinely is the Area's first and only visit at that instant).

Per the explicit governing principle: **Phase A never attempts to match an existing Area.** Every confirmed sub-area visit through the generic-camera path gets a brand-new Area, full stop — proven by real-staging test (c) below (two visits with byte-identical `suggestedAreaName` produce two separate Area documents).

Whole-Room outcomes need no special handling — `savePlanToHistory`'s new default (`areaId: null` unless the caller sets it) already covers them.

## 3. Existing-Area "Organize Again"

`startOrganizeAgain(item, areaId)` gained an optional second parameter, threaded through `organizeAgainContext.areaId` → `finalizeAnalysisResult`'s new 4th parameter → the plan object passed to `createReturningPlan`/`savePlanToHistory`. Identity is established purely by which button the user tapped (Room Detail's per-Area "Organize Again"), never inferred from the fresh photo's own AI analysis — confirmed by real-staging test (b): a second visit with a *different* `suggestedAreaName` than the first still lands under the same `areaId`, and no duplicate Area is created.

## 4. Real bug found and fixed during testing: shadow Project never caught up

**Finding:** the first real-staging test run failed 4 of 43 checks (items l, b, j). Root cause: `createAreaForPlan` updates the *plan* document's `areaId` after the Area exists, but the plan's shadow *Project* document was already written earlier (inside `savePlanToHistory`, before the Area existed) with `areaId: null`. Nothing was re-syncing it. This meant `updateAreaSummary`'s own Projects-collection scan (which filters by `project.areaId === areaId`) silently excluded the very first visit of every new Area from every future summary recompute — a real, would-have-shipped correctness bug, not a test artifact.

**Fix:** `createAreaForPlan`/`createAreaForPlanAdmin` now bump the plan's `shadowSourceVersion` and call `syncPlanToSpaceGraph`/`syncPlanToSpaceGraphAdmin` (awaited, not fire-and-forget) immediately after setting `plan.areaId` — the same "changed something the shadow needs to catch up on, bump the version and resync" pattern `renameSpace` already uses for an analogous problem, not a new mechanism. Re-ran the full suite after this fix: 43/43 pass.

## 5. Area summary maintenance

`updateAreaSummary`/`updateAreaSummaryAdmin` mirror `updateSpaceRoomSummary` exactly: read the Room's whole `projects` collection (no new query/index — Areas don't get their own Projects subcollection, per the design doc's own path decision), filter in memory to `project.areaId === areaId`, recompute via the new pure `computeAreaSummaryFields` (`shared/spaceMigration.js`). Hooked into the same four points Room summaries already live at: `writeSpaceShadowStructure`, `syncPlanToSpaceGraph`, `forceFullReprojection`, `deletePlan` — each conditioned on the relevant plan/Project actually carrying a non-null `areaId`.

Deleting an Area's last remaining visit: confirmed the Area document survives at `visitCount: 0` (test i) — `computeAreaSummaryFields([])` returns summary fields only, never a deletion signal, and `deletePlan`'s own Area-summary call is deliberately unconditional on whether the Room itself also got deleted in the same operation (the Area document doesn't require its parent Space document to still exist for Firestore to read/write it — confirmed directly in test i, where the Room *was* also deleted).

`originalPhotoUrl` is never included in any summary-recompute payload — confirmed unchanged across a second visit + two separate summary recomputes (test h).

## 6. Rename

Reused the existing rename bottom sheet (`renamePlanTarget`/`renderRenameSheet`) rather than building a second modal — added an optional `kind: "area" | "plan"` discriminator. `handleSaveRename` branches early for `kind === "area"`, calling the new `renameArea(uid, roomId, areaId, newName)` (writes only `Area.displayName`) and skipping every plan-specific patch. Confirmed (test g): both the source plan's *and* a second visit's own historical `areaName` fields stay untouched after an Area rename.

## 7. Room Detail grouping

Room Detail now loads a second collection (`roomDetailAreas`, a plain `spaces/{roomId}/areas` read, no OR-query needed) alongside its existing plan list. Grouping logic: an Area renders as its own section only if at least one loaded plan's `areaId` matches it (this is also how a deleted-down-to-zero Area silently disappears from the ordinary view without any explicit `visitCount` check — item 5's "hide, don't delete"). Every other plan (no `areaId`, or an `areaId` pointing at an Area that hasn't loaded — a real possible race between the two independent loading effects) renders ungrouped, at the top, exactly per the task's own ordering. **A Room with zero durable Areas renders the exact same JSX subtree as before this change** — not just visually equivalent, the literal same code path, confirmed by test (k).

Each Area section: photo, `displayName` + rename pencil, `"N visits · Last organized {date}"` (+ an inline "N items remaining" note when the most recent visit has unfinished work), an "Organize Again" button scoped to that Area, then its own visits using the exact same row renderer (`renderVisitRow`, extracted so grouped and ungrouped rows share one implementation) already shipped for the flat list.

## 8. Real staging evidence — 43/43 checks pass

All against real `cluttrd-staging` Firestore, a dedicated synthetic uid, using the real Admin functions listed above (no client-only logic was left untested — the Room Detail grouping items were verified by replicating App.js's own grouping algorithm verbatim against the real data, since no device/simulator is available in this environment).

| # | Evidence item | Result |
|---|---|---|
| a | Sub-area visit creates a correct new Area (incl. `originalPhotoUrl`) | ✅ |
| b | Existing-Area Organize Again reuses the same `areaId` despite a different fresh `suggestedAreaName`; `visitCount` → 2; no duplicate Area | ✅ |
| c | Two independent generic-camera visits with identical `suggestedAreaName` create two separate Areas | ✅ |
| d | Whole-Room visit: `areaId: null` (present, not absent), no Area created | ✅ |
| e | Room Detail groups durable-Area visits correctly, excludes them from ungrouped | ✅ |
| f | Legacy `areaName`-only visit (no `areaId`) renders ungrouped | ✅ |
| g | Area rename touches only `Area.displayName`; both plans' own `areaName` untouched | ✅ |
| h | `originalPhotoUrl` unchanged across a second visit + two summary recomputes | ✅ |
| i | Deleting an Area's only visit: Area survives at `visitCount: 0` | ✅ |
| j | Deleting a non-last visit: summary correctly reverts to the remaining visit's own data | ✅ |
| k | Room with zero durable Areas: identical rendering path to pre-Phase-A | ✅ |
| l | `areaId` propagates to the shadow Project document | ✅ (found broken, fixed — see §4) |
| extra | `forceFullReprojectionAdmin` preserves `Project.areaId` and Area summary correctness through a full reprojection | ✅ |

Bundle verified clean (`node -c` on all three modified files, `expo export`) both before and after the §4 fix.

## 9. What was deliberately not built

Per the task's explicit scope: no Area recognition, no visual/AI matching, no confirmation-proposal UI (Phase B). No Area-level "Move"/"Delete" (Areas inherit the same tombstone fields Rooms have, unused). Room deletion's own eventual cascade-to-Areas cleanup (`AreaIdentityDesign.md` §11) was not built — out of scope, and Phase A's own Room-deletion-adjacent edge case (deleting a plan that happens to be a Room's last visit *and* an Area's last visit) was deliberately left as a disclosed, accepted orphan case, matching the design doc's own call-out, not silently ignored.
