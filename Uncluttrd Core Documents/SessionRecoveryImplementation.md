# Session / Hierarchy Recovery — Needs Review UI (Implementation Report)

Companion to `SessionRecoveryDesign.md`, which records the investigation
and the three premise corrections this implementation is built on. This
document records what was built, what was verified, and what was found to
be different from the task specification.

Branch `feature/companion`. Client-only change: no Cloud Function, no
Firestore rule, and no index change, so it ships by OTA alone.

---

## 1. What this is

Fourteen completed organizing sessions in staging carry
`sessionScope: "unresolved"` — real work the user did, currently invisible
because the hierarchy cannot say where it belongs. Twelve of them are
orphans whose computed `spaceId` points at no Space document at all.

Needs Review is the surface that lets the user place them. It is a
**temporary migration state, not a domain object**: its entry point is
conditional, nothing else in the app links to it, and when the condition
goes false the whole surface becomes unreachable without any further code
change.

---

## 2. Premise corrections (detail in `SessionRecoveryDesign.md` §1)

Three assumptions in the task specification did not hold against the code,
and the implementation differs accordingly.

**(1a) Plan-level soft delete did not exist.** Section 3 option 4 and
Section 5 both say "uses the existing soft-delete path". There was none for
plans: `deletePlan` (App.js) is an irreversible hard delete of the document
*and* its Storage objects, and plan documents carried neither `retired` nor
`deletedAt`. Rooms and Areas had soft delete; sessions did not. `softDeletePlan`
and `restorePlan` were written for this work, mirroring `softDeleteRoom`/
`softDeleteArea`'s shape one level down.

**(1b) `reclassifyLegacyPlan` is wrong for the twelve orphans.** Section 4
says "use existing `reclassifyLegacyPlan` machinery where applicable" — the
qualifier turns out to be load-bearing. That machine moves a plan *between
two Spaces*; `claimReclassification` captures the current `spaceId` as
`oldSpaceId`, and for an orphan that is a phantom id pointing at nothing.
`cleanUpOldSpace` then tombstones it with `setDoc(..., { merge: true })`,
which **creates a missing document** — one junk retired Space per classified
orphan. `classifySession` therefore branches on whether a source Space
actually exists, and uses `reclassifyLegacyPlan` only when it does.

**(1c) The entry point cannot vanish the instant the last session is
classified.** Section 8 says it disappears when all sessions are classified.
Taken literally that strands every soft-deleted session: Recently Deleted
for sessions lives *on* the Needs Review screen, so the moment `unresolved`
hits zero the only route back to Restore would disappear with it. The
condition is `unresolved > 0 || recentlyDeleted > 0`, so it survives until
there is genuinely nothing left to act on.

**A fourth correction surfaced during verification.** Section 2 says each
card shows "the session's photo (from `photoUrl`)". Three of the fourteen
have no `photoUrl` at all — "Kitchen Counter Workspace", "Dual Monitor
Workspace" and "Multi-Monitor Workspace". Those cards fall back to a neutral
icon and keep their label, date and task counts, and evidence (e2) proves a
photo-less session classifies into a new Area without incident (the Area
gets `originalPhotoUrl: null`, not `undefined` and not a throw).

---

## 3. What was built

### 3.1 Primitives (App.js, module scope)

| Function | Purpose |
|---|---|
| `createRoomSpace(uid, displayName)` | The first and only way to create a Space with no founding plan. Closes the gap `AreaReparentingDesign.md` §3b identified. |
| `softDeletePlan(uid, planId)` | `retired: true` + `deletedAt`, tears down the shadow Project, recomputes Room and Area summaries. |
| `restorePlan(uid, planId)` | The mirror image; reprojects only when the plan has a Space to project into. |
| `classifySession(uid, planId, { targetRoomId, targetAreaId, newAreaName })` | The single commit point for all three placement options. |

**`createRoomSpace`** deliberately omits the projection provenance fields
(`sourcePlanId`, `sourceVersion`, `shadowSchemaVersion`) rather than faking
them: they describe a founding projection that did not happen, and
`shared/spaceMigration.js`'s own field-ownership comment records that
nothing reads them back. `createdWithoutPlan: true` is a breadcrumb for
anyone later wondering why they are absent on this one Space.

**`softDeletePlan`** calls `deleteProjectSubtree`, *not*
`deleteSpaceShadowGraph`. The latter deletes the parent Space once no
sibling Projects remain, which would destroy a real Room because one of its
sessions was deleted. Removing only the Project makes summaries fall to the
correct counts while leaving the Room, the plan document and every Storage
object intact — which is what makes restore a true restore rather than a
re-creation. Both it and `restorePlan` are guarded on the Space existing,
because an orphan has none.

**`classifySession`** is where the two paths meet:

- *Source Space exists and differs from the target* → `reclassifyLegacyPlan`,
  which owns shadow create/delete, summary maintenance and merge-candidate
  reconciliation, exactly as it does for Room merge and Area move.
- *Orphan, or already under the target* → direct field write plus
  `forceFullReprojection`.

Either way it then writes `areaId` and `sessionScope` **in the same update**
(they must never be observable in disagreement — the same discipline
`createAreaForPlan` already follows), resyncs the shadow so `Project.areaId`
is not left stale, and runs the **source-Room retirement repair** identical
in intent to `moveAreaToRoom`'s Phase 5a: `cleanUpOldSpace` tombstones a
source Space as soon as its last Project leaves and cannot distinguish "the
Room was emptied by a correction" from "the whole Room was merged away". An
emptied Room is a Room the user keeps. The repair is guarded on a pre-move
snapshot, so a Room the user had already deleted stays deleted.

The `newAreaName` case defers the `areaId`/`sessionScope` write entirely to
`createAreaForPlan`, which already performs that pair atomically — but still
writes `areaName` and `areaScope: "sub-area"` as part of the move, because
otherwise the reprojection would project the session as whole-room and the
later `areaId` write would leave `Project.areaScope` permanently
disagreeing with the plan.

### 3.2 The recovery query

One uncapped, uid-scoped `where("sessionScope", "==", "unresolved")` read,
split in memory into active and recently-deleted (30 days). Deliberately
**not** the collection-group form: Firestore rules here are user-scoped, so
a client-side collection-group read would span other users' plans and be
denied. Uncapped on purpose — the 20-plan History cache is exactly what made
these sessions invisible in the first place (10 of the 14 sit outside it).

### 3.3 Soft-delete filters

Plans gained a deleted state, so every plans consumer had to learn to
exclude it. Three call sites: `loadHistory`, `roomDetailPlans` (both halves
of its OR-query), and `findRecognitionCandidates`. All filter in memory
rather than by `where` clause — those queries already carry `orderBy` +
`limit`, and adding an inequality would need a composite index for no
behavioural gain at this scale.

### 3.4 UI

- **Entry point** on My Rooms, below active Rooms and above Recently Deleted.
  One row, not fourteen photo cards: these are a migration artifact and
  should not be the loudest thing on the user's own Rooms screen.
- **Needs Review screen**, an early return placed *before* the History
  screen's own. `showHistory` stays true underneath, so closing it returns
  the user to the scroll position they left rather than to Home.
- **Classification options sheet** — the four options from §3.
- **Room Picker**, the existing reusable component, extended with
  `kind: "session"`. Its "Create a new Room…" row — shown-but-disabled since
  Area Re-parenting Phase A, because no `createRoom()` helper existed — is
  now **live for sessions**, since `createRoomSpace` supplies exactly the
  missing path. It stays disabled for Area and Room moves, which remain
  Phase B territory.
- **Area Picker**, new. Its first row is always "Whole Room", which is what
  lets one component serve "this session covers all of the Room I just
  picked" and "it belongs to one Area inside it" — including immediately
  after creating a Room, which is how §3 option 3's "or continue to Area
  selection within the new Room" is satisfied without a second pass.
- **Name sheet**, shared by new-Room and new-Area.

`classifyStep` encodes both where the flow is *and* what a Room selection
means (`pick-room-whole` vs `pick-room-area`), so no separate mode state can
drift out of sync with it. Android back unwinds one step at a time and is
checked before `showHistory`, so back cannot close My Rooms out from under
an open recovery flow.

There is **no confirmation step** before classification, deliberately.
Unlike a move or a merge, this is a repair: nothing is retired or merged,
and getting it wrong is fixed by classifying again. Deletion keeps its
confirmation, with the copy given verbatim in the spec.

---

## 4. Staging evidence

Run against `cluttrd-staging`. **19 of 19 checks passed.**

Two uids, deliberately. `ZYe7h9hM25UB7Pk6YRbPysg2cGC3` — the real user — was
**read only**: evidence (a), (b) and (k) are observations of the actual 14
sessions, and observing them is all a script may do. Where each one belongs
is the user's decision, made in the app with the photos in front of them,
and is precisely the judgement this screen exists to collect; a script
guessing at destinations would destroy the evidence it claims to produce.
Confirmed afterwards: 30 plans, 14 still unresolved, 0 retired, 4 Spaces —
unchanged.

Every mutating check ran on a scratch uid seeded with **verbatim copies** of
those same plan documents (field for field, so document shape is never a
stand-in) plus two real Rooms built by projecting two real resolved plans.
The scratch uid was wiped at the end of the run.

| # | Evidence | Result |
|---|---|---|
| a | Entry point shows with correct count | PASS — visible, count 14 |
| b | All 14 shown with labels, dates, photos where present | PASS — 14/14 label + date, 11/14 photo, all `areaId` null |
| c | Classify as whole-Room → correct Room Detail | PASS — `sessionScope: "room"`, `areaId` null, Project under target |
| d | Classify into existing Area → correct `areaId` | PASS — plan *and* `Project.areaId` both point at it |
| e | Classify into a NEW Area | PASS — Area's `originalPhotoUrl` is the session's own photo, `areaScope: "sub-area"` |
| e2 | Photo-less session into a new Area | PASS — `originalPhotoUrl: null`, no throw |
| f | Create a new Room during classification | PASS — Room created, `visitCount` 1, session moved |
| f2 | Zero-visit Room survives summary computation | PASS — `visitCount` 0, lists normally (§6) |
| g | Delete an unresolved session | PASS — soft-deleted, in Recently Deleted, restored, work intact |
| h | All completed work survives | PASS — tasks, photo, `createdAt`, batch history, analysis, tier all identical across 4 classifications |
| i | Summaries recompute | PASS — Room `visitCount` equals its Project count; Area 2 visits, photo and timestamp set |
| j | Entry point disappears | PASS — and correctly *stays* while a soft-deleted session is still restorable, then goes once it ages out |
| k | Recovery query uncapped | PASS — 14 returned, 10 of them outside the 20-plan cache |
| l | No special class of migrated plan | PASS — no recovery-only fields; the Area recovery created was re-parented to another Room by the **shipped** Area re-parenting flow, carrying its session; Room recognition finds the target |
| m | New Room in Room Picker and My Rooms | PASS |
| n | Deletion at every `sessionScope` | PASS — unresolved, room, area all soft-delete |
| n2 | Multi-session Area, delete one | PASS — Area and sibling intact, `visitCount` 2 → 1 |
| s9 | `sessionScope` agrees with `resolveSessionScope` on every live plan | PASS |
| s9b | Approach/tier data untouched | PASS |

Evidence (l) is the one worth reading twice. It is not a claim that
classification *should* leave an ordinary plan behind — it exercises the
shipped Area re-parenting flow and the shipped recognition resolver against
a session that recovery placed, and both treat it as any other plan.

Two harness bugs were found and fixed during this run, not implementation
bugs: the seed initially drew two plans from the same Space (making
between-Room tests vacuous), and the recognition check read `.candidates`
off a function that returns a bare array. Both were producing false
failures. One real, if minor, code change came out of the run:
`softDeletePlan` now skips the teardown and summary recomputes when the
plan has no Space, which was previously a wasted round trip that logged a
`NOT_FOUND` reading exactly like a real failure.

**Not verified on a device.** No Android emulator or device is available in
this environment. Everything above is real Firestore reads and writes
through admin-SDK mirrors that match the client functions line for line.
The render layer — layout, tap targets, modal transitions, the neutral-icon
fallback actually drawing — is code-verified only. Metro production export
is clean.

---

## 5. Section 6 and Section 9 questions answered

**Does Room Detail handle a Room with zero visits gracefully?** Yes. A
Room created by `createRoomSpace` has `visitCount: 0`, `lastOrganizedAt:
null`, `latestPhotoUrl: null`, and Room Detail's existing empty state
handles it — the same state a Room reaches when its last plan is deleted.

**Does Room summary computation handle zero plans?** Yes —
`computeRoomSummaryFields` has a zero-projects branch; evidence (f2)
exercises it against a real Space.

**Does the Room Picker include a newly created Room?** Yes. The picker
takes its whole input from `rooms`, which `loadRooms` populates from the
Spaces collection filtered to non-retired — a Space created without a plan
is in it like any other (evidence m).

**Section 9 compatibility.** Room/Area summary computation, Room
recognition, Recently Deleted, Approach selection and Room Picker are all
covered by the evidence above. Area *visual* recognition is not separately
tested here: it calls `compareAreaCandidates`, a real multimodal Cloud
Function, and it is pre-scoped to one Room by its caller — a classified
session's Area is an ordinary Area under an ordinary Room, so it enters that
flow with no distinguishing property.

---

## 6. Known gaps

- **No bulk classification.** Fourteen sessions, one at a time. A
  "classify the rest as X" affordance would be quick to add but would make
  a careless answer cheaper than a considered one, which is the opposite of
  what this screen is for.
- **No undo on classification** beyond re-classifying, which is the honest
  undo: the session simply moves again.
- **A soft-deleted session that ages past 30 days is never actually
  purged.** It stops being listed, and its plan document and Storage objects
  remain. That matches Rooms and Areas, which have the same gap; a real
  purge is a Cloud Function job, out of scope here.
- **Classification is not atomic.** It is a sequence of writes, not a
  transaction, so a mid-flight failure can leave a session moved but not
  yet scoped. It re-appears in Needs Review when that happens, and
  re-classifying it completes cleanly — the direct branch handles "already
  under the target".

---

## 7. Deployment

Metro production export clean. Client-only, so this ships by OTA to the
staging channel with no Cloud Function deploy and no index change.

Commit `09b8819`. Published to the `staging` branch:

| Platform | Runtime version | Update group | Update ID |
|---|---|---|---|
| Android | `c266213e8d2ef2dcba1adcae706e94c1a1495fb8` | `8628fc8a-49ac-4b2a-a445-4f69bbf52387` | `019ff239-a690-732c-af0f-a85b6fa74bcb` |
| iOS | `194c6294ae70b8bf34cd79c67f09187a2289a4a1` | `35a67783-574f-4108-8977-1bddd8f58b1c` | `019ff239-a690-7713-aa5c-d0a0e5dbe841` |

Whether a device has actually pulled the update cannot be observed from
here — the IDs above are what EAS reports as published, not what any
handset is running.
