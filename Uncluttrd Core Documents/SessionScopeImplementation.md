# Session Scope Foundation + Legacy Classification — Implementation Report

**Scope shipped:** the `sessionScope` field, written on every new plan and backfilled across all existing staging plans. **No recovery UI** — deliberately out of scope, per instruction.

**Design followed:** `SessionScopeDesign.md` (Q2/Q3/Q4 established the ambiguity this closes).

**Branch:** `feature/companion` · **Verified against:** `cluttrd-staging`, uid `ZYe7h9hM25UB7Pk6YRbPysg2cGC3` · **Date:** 2026-08-11

---

## 1. The field

```
sessionScope: "room" | "area" | "unresolved"
```

`"room"` = intentionally whole-Room (`areaId` null **by design**). `"area"` = targets a durable Area. `"unresolved"` = scope cannot be *proven* from the plan's own data — a **temporary state**, not a third kind of place.

This is now the **sole** authoritative discriminator. Nothing should read `areaId` absence, `areaScope` absence, or `schemaVersion` to infer scope again — the investigation showed the first two are ambiguous and the third is unrelated (it tracks the AI payload shape; 27 of 28 real plans are version 1, spanning every scope category).

### One classifier, two callers

`resolveSessionScope(planData)` — a pure function in `shared/spaceMigration.js:743-781`, exported and used by **both** the live client and the backfill script, so a backfilled plan and a brand-new plan can never be classified by different rules.

```js
function resolveSessionScope(planData) {
  if (!planData) return "unresolved";
  if (planData.areaId) return "area";
  if (planData.areaScope === "whole-room") return "room";
  return "unresolved";
}
```

Its priority order satisfies the go-forward rules and the backfill rules simultaneously: `areaId` set → `"area"`; `areaScope === "whole-room"` → `"room"`; `areaScope === "sub-area"` with no `areaId` → falls through to `"unresolved"` (should have an Area and doesn't); no `areaScope` at all → `"unresolved"`.

It reads only fields that are themselves the product of an explicit decision. A durable `areaId` is only ever written by navigation from a real Area or by explicit Area creation/confirmation — never inferred from `areaName`. `"whole-room"` is only ever produced by the confirmation resolvers. **The function never guesses.**

---

## 2. New plans going forward

**`savePlanToHistory` is the single creation chokepoint** — this was verified, not assumed. `createReturningPlan` (App.js:4790-4799) is a thin wrapper around it, and `finalizeAnalysisResult` (App.js:5187-5201) and `completeRoomConfirmation` (App.js:5296-5305) both reach Firestore only through one of those two. Stamping the field once, there (App.js:4686-4707), covers all four paths named in the task.

**The one case save time cannot settle**, and how it is handled: a fresh sub-area visit is saved *before* its Area exists — `createAreaForPlan` runs afterwards and is what creates it. That plan is therefore correctly stamped `"unresolved"` at save, then corrected to `"area"` **in the same write that sets `areaId`** (App.js:377-383), so the two fields are never observable in disagreement. Verified end-to-end by test (j).

**Two further sites** were updated for correctness, beyond the four named. Both repoint `areaId` on existing plans, and without them a moved session's `sessionScope` would go stale:

- `moveAreaToRoom` Phase 3 (App.js:1996-2003) — always `"area"` (an Area move never changes what kind of session it is).
- `mergeRoomIntoRoom` Phase 3 (App.js:2124-2135) — **recomputed**, not assumed: `newAreaId` can legitimately be `null` here when a whole-Room founding visit passes through a merge.

`savePlanToHistoryAdmin` and `createAreaForPlanAdmin` in `scripts/runSpaceMigration.js` were updated identically — they are documented as 1:1 mirrors of the client, and the test harness exercises them.

---

## 3. Classification pass — `scripts/classifySessionScope.js`

Restartable and idempotent by construction: `resolveSessionScope` is pure and total, and a plan is written **only** when its stored value differs from the freshly computed one. A second run over unchanged data performs zero writes. A plan whose underlying data genuinely changed since the last run is correctly re-classified — that is re-convergence, not non-idempotency.

Guarded to `cluttrd-staging` unless `--i-understand-this-is-not-staging` is passed. Supports `--dry-run` and `--recovery-query`.

**It writes `sessionScope` and nothing else.** No `areaId`, no `areaScope`, no `canonicalSpaceId`, and — explicitly — **no Space documents for orphan plans.** The 12 orphans' `spaceType` values (`"Under-Sink Cabinet"`, `"Bar/Whiskey Display"`, `"Kitchen Counter Workspace"`) are Areas that the pre-Room-First-Identity system stored in the Room slot; materialising Rooms from those strings would re-commit the exact mistake this work exists to correct. They keep `sessionScope: "unresolved"` and their existing (or absent) `canonicalSpaceId`, for a future recovery flow. Test (e) asserts the Space count is unchanged.

### Results

| | Count |
|---|---|
| Plans scanned | **28** |
| `"room"` | **2** |
| `"area"` | **12** |
| `"unresolved"` | **14** |
| — of which orphans (no Space document) | **12** |
| Writes on first run | 28 |
| Writes on second run | **0** |
| Space documents before → after | **4 → 4** |

The 2 non-orphan unresolved plans are the Dining Room and Office founding visits — they have a Room but never had scope established.

---

## 4. Global recoverability

**This required a Firestore index that does not exist automatically, which the task's premise did not anticipate.** `collectionGroup("plans").where("sessionScope", "==", "unresolved")` failed with `FAILED_PRECONDITION: requires a COLLECTION_GROUP_ASC index`. Firestore's automatic single-field indexes are **collection**-scoped only; collection-group scope must be declared explicitly.

Added to `firestore.indexes.json` as a `fieldOverride` and deployed to staging (index build took ~2.5 min):

```json
{
  "collectionGroup": "plans",
  "fieldPath": "sessionScope",
  "indexes": [
    { "order": "ASCENDING",  "queryScope": "COLLECTION" },
    { "order": "DESCENDING", "queryScope": "COLLECTION" },
    { "order": "ASCENDING",  "queryScope": "COLLECTION_GROUP" },
    { "order": "DESCENDING", "queryScope": "COLLECTION_GROUP" }
  ]
}
```

**The `COLLECTION`-scope entries are load-bearing, not padding.** A `fieldOverride` *replaces* the automatic index configuration for that field — declaring only `COLLECTION_GROUP` would have silently dropped the collection-scoped index that the client-facing query depends on, breaking the very query any future recovery UI must use. (The two pre-existing `deletedAt` overrides in this file declare only `COLLECTION_GROUP`; those fields are filtered in memory, so nothing depends on their collection-scoped index — worth knowing before copying that shape.)

**Both query forms were verified, because they are not interchangeable:**

| Query | Returned | Notes |
|---|---|---|
| `collectionGroup("plans").where(sessionScope == "unresolved")` | **14** for this uid (14 across all users) | Admin/global form |
| `users/{uid}/plans.where(sessionScope == "unresolved")`, **no limit** | **14** | The form a client can actually run |

Identical sets. The subcollection form matters because Firestore rules here are user-scoped: a client-side `collectionGroup("plans")` would span other users' documents and be denied. **Any future recovery UI must use the subcollection form** — the collection-group index exists for admin tooling.

**Proof the cap is genuinely bypassed:** 8 of the 14 unresolved plans fall outside the History screen's newest-20 window (`limit(20)`, App.js:4455) and are invisible there today — `1F18pg81Zjpq32cHGE5b`, `2cKMDIfEhpj1o7uuYynX`, `RtVHqqH2JlObTwKANq88`, `Vhd2WUqibkstuwP4M9XH`, `WOfY9adBdZA0qAtkLhwV`, `jrgDqWQG3dK0zs9nXIuz`, `kbb68MXvLCkFxytkV4Wg`, `s7kIaHOgE9PBoK0nfaol`. All 8 are returned by both queries.

---

## 5. Test results — 10/10, real staging Firestore

Tests (a)–(g) ran against the real account; (h)–(j) against a throwaway uid, purged afterwards.

| # | Test | Result | Evidence |
|---|---|---|---|
| a | Classification counts; every plan classified | **PASS** | 28 total: 2 room / 12 area / 14 unresolved (12 orphans). 0 plans without the field. |
| b | Every plan with `areaId` set → `"area"` | **PASS** | 12 plans with `areaId`, **0 violations** |
| c | Every `areaScope: "whole-room"` + no `areaId` → `"room"` | **PASS** | 2 matching, 0 violations |
| d | Every legacy plan with no `areaScope` → `"unresolved"` | **PASS** | 14 legacy plans, 0 violations |
| e | No Space documents created for orphans | **PASS** | 4 → 4; 12 orphan plan ids listed and untouched |
| f | Re-run is idempotent | **PASS** | 0 writes, 28 unchanged, values byte-identical |
| g | Global query returns ALL unresolved, past the 20-cap | **PASS** | 14 = 14 = 14, both forms agree; 8 provably beyond the cap |
| h | Delete an `"unresolved"` plan (no Space, no Area) | **PASS** | No error, plan deleted, confirmed it had no Space of its own |
| i | Delete a `"room"` plan (`areaId` null) | **PASS** | No error; the Room's Area **and** sibling session both survived |
| j | New plan through the normal save path is classified correctly | **PASS** | whole-room → `"room"`; sub-area → `"unresolved"` at save, `"area"` after `createAreaForPlan`; legacy-shaped → `"unresolved"` |

**Honest scoping of (j):** it exercises `savePlanToHistoryAdmin`/`createAreaForPlanAdmin`, the documented 1:1 admin mirrors, because there is no device or emulator available here to drive the React Native client. The client and admin paths now call the *same* shared `resolveSessionScope` at the same points, so the classification logic is genuinely shared and tested — but the client's own save was verified by code inspection and a clean Metro production export, not by running the app.

**Build:** full Metro production export succeeded — 9.84 MB Hermes bundle, no errors.

---

## 6. Deployment

Client-side plan-creation paths changed, so this **does** need an OTA (the task's conditional applies).

- Firestore indexes deployed to `cluttrd-staging` before the verification run.
- `functions/shared/` and `functions/scripts/` regenerated via `scripts/prepareFunctionsDeploy.js` — they are generated copies, never hand-edited.

---

## 7. Known / deferred

- **No recovery UI**, as instructed. The 14 unresolved sessions are now *discoverable* but not yet *resolvable* in-app.
- **The 12 orphans still have no Room.** Classification records that fact; it does not fix it. They remain reachable only via the global query until a recovery flow exists.
- **`sessionScope` is not yet read by any UI.** Room Detail still renders EARLIER ORGANIZING VISITS undifferentiated (App.js:8570-8573). The WHOLE ROOM / AREAS / NEEDS REVIEW layout from `SessionScopeDesign.md` Q9 is deliberately not built.
- **Production is untouched.** Both the classification pass and the index deploy targeted staging only. Production will need the same index before any recovery UI ships there.
