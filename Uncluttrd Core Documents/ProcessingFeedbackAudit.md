# Processing Feedback Audit — Needs Review fix + app-wide survey

**Task 1 fixed and shipped to staging.** Task 2 is report-only, as instructed.

---

## The structural finding

The app has **three** synchronous re-entry refs in total:

| Ref | Guards |
|---|---|
| `roomConfirmationInFlightRef` | Room confirmation (added 2026-08-12 after a real on-device double-save) |
| `detailInFlightRef` | Per-plan detail analysis (a `Set`, keyed by planId) |
| `classifyInFlightRef` | **new** — Needs Review classification |

**Every other async commit in the app is guarded by React state, or not guarded at all.**
That matters because `completeRoomConfirmation` already documents why state is
insufficient:

> `setRoomConfirmationSaving(true)` does not take effect until React re-renders, so
> two taps landing in the same frame BOTH passed a state check and both ran the
> whole save — creating the plan twice.

That reasoning was never generalized beyond the one handler where the bug was
observed. The audit below is essentially a list of places where the same class of
bug is still reachable.

A second, subtler pattern recurs: **a handler clears the state that keeps its host
modal mounted, then does the async work.** The overlay then has nothing to paint
on. That is precisely what made Needs Review invisible, and it is worth checking
for wherever a "pick something" sheet commits directly.

---

## TASK 1 — Needs Review classification (FIXED)

### What was wrong

`runClassify` is the single commit point for whole-Room, existing-Area and
new-Area classification. It ran `classifySession` (plan reclassification → shadow
Project → summary recompute → Space retirement), then optionally
`createAreaForPlan`, `updateSpaceRoomSummary` and a Space re-read — several
awaited round-trips — guarded by:

```js
if (!classifyFor || classifySaving) return;   // state, not a ref
```

**The worst case was the whole-Room path.** `onRoomPickerSelectForMove` did this:

```js
setRoomPickerFor(null);        // closes the picker
...
if (ctx.mode === "whole") runClassify(targetRoom.id, null);   // then commits
```

The picker unmounted *before* the commit started, so the entire multi-write
sequence ran behind a bare Needs Review list — no spinner, no disabled state,
nothing. Adding an overlay to that sheet alone would have fixed nothing, because
the sheet was already gone.

**Why the state guard is not merely theoretical here.** `classifySession` is not
idempotent across a double-fire: the second call re-reads a plan whose
`canonicalSpaceId` the first has already moved, so it takes the "already under
the target" branch (`App.js:807`) and reprojects a second time.

### What changed

| Change | Why |
|---|---|
| `classifyInFlightRef` on `runClassify`, `submitNewRoomName`, session delete | Synchronous — a same-frame second tap loses the race even before the overlay paints |
| `ProcessingOverlay` on all four classify sheets | Options, Room picker, Area picker, name sheet |
| Overlay text names the destination | "Assigning to Kitchen…", "Moving to Kitchen / Corner Shelf…", "Creating Kitchen…", "Deleting session…" |
| `onRoomPickerSelectForMove` no longer closes the picker before committing | The core gap — gives the overlay a mounted host; `closeClassify` still clears it on success |
| Room picker now renders `classifyError` | A whole-Room commit happens *inside* that sheet, so its failure had nowhere to surface |
| `closeClassify` / `closeRoomPicker` guard on the ref | Captured state can be stale; these are the backdrop / Cancel / Android-back paths |
| Area picker's inline spinner → shared overlay | It used to swap the whole list out mid-save; now the sheet stays put |
| Session delete moved `closeClassify()` to *after* the write | It closed the sheet first, then deleted with nothing on screen |
| Every row/button `disabled={classifySaving}` | Belt and braces behind the overlay |

**Failure behaviour:** the overlay comes down, the error shows in the sheet, the
sheet stays open, and the session stays unclassified so the user can retry.
Nothing is rolled back — `classifySession` either reported `completed` or it did
not.

**Coverage** — all five actions in scope: assign to whole Room, assign to existing
Area, create new Area, create new Room, delete session.

**Verified:** `node -c` pass · `scripts/auditTdz.js` 0 violations · `expo export`
exit 0. Not device-verified — see the bottom of this document.

---

## TASK 2 — Audit findings

Ordered by severity. "Tap protection" means a **synchronous** guard; a `disabled`
prop is listed separately because it is state and therefore one render behind.

### HIGH

**1. Visualization generation / regeneration — `generateVisualization` (App.js:7818)**
- **User sees:** good feedback. `vizLoading[key]`, button `disabled`, plus rotating
  tips (`startVizTips`).
- **Tap protection:** **none.** The entry checks are `isPro` and `photo?.uri`
  only — `vizLoading` is never consulted before the work starts.
- **Why it matters most:** this calls the `generateVisualization` Cloud Function
  with a **300-second timeout**. A double-fire is two image generations — real
  latency and real cost — and the second write can land after the first, so the
  displayed image may not be the one the user waited for.
- **Needs fix:** yes. Highest value-per-line in the audit.

**2. Account deletion — `handleConfirmDelete` (App.js:9883)**
- **User sees:** `ProcessingOverlay text="Deleting your account..."` — good.
- **Tap protection:** none. Guard is `if (!deletePassword)`; `deleteLoading` is set
  but never checked.
- **Why it matters:** irreversible, and re-authenticates then calls a Cloud
  Function. A double-fire risks a second `deleteAccount` against an already
  signed-out session.
- **Needs fix:** yes — destructive operations should not rely on the overlay
  painting in time.

### MEDIUM

**3. Area re-parenting and Room-level move — `confirmMove` (App.js:8973)**
- **User sees:** `ProcessingOverlay` via `renderMoveConfirm`, and every dismissal
  path is blocked while `moveSaving`. Genuinely good.
- **Tap protection:** **none — not even a state check.** The entry guard is
  `if (!moveConfirmTarget) return;` and nothing else.
- **Mitigation:** `moveAreaToRoom` has an `already-completed` idempotency
  short-circuit, so the second run largely no-ops.
- **Needs fix:** yes — cheap, and covers both flows at once since they share this
  handler.

**4. Room merge from rename-duplicate — `handleMovePlansIntoExisting` (App.js:8578)**
- **User sees:** `ProcessingOverlay text="Moving plans..."` (App.js:8717).
- **Tap protection:** none. `if (!renameDuplicateDialog) return;` only.
- **Needs fix:** yes, same one-liner as #3.

**5. Share as PDF — `generatePDF` (App.js:7401)**
- **User sees:** **nothing at all.** No spinner, no disabled state, no overlay. It
  builds a large HTML document, runs `Print.printToFileAsync`, then
  `Sharing.shareAsync` — seconds of dead UI on a big plan.
- **Tap protection:** none (`if (!results) return;`).
- **Mitigating:** invoked from an `Alert` action sheet, which dismisses on tap, so
  double-firing is awkward but not impossible.
- **Needs fix:** yes — this is the worst *feedback* gap left in the app, even
  though its double-tap risk is lower than the items above.

**6. Restore from Recently Deleted — `handleRestoreSession` (9179), `handleRestoreRoom` (9674), `handleRestoreArea` (9692)**
- **User sees:** nothing. No spinner, no disabled row.
- **Tap protection:** none on any of the three.
- **Mitigating:** `restoreRoom` is deliberately idempotent — its own comment notes
  "a Room already live (not retired) is a no-op, so tapping Restore twice" is
  safe. Correctness is fine; the silence is the problem.
- **Needs fix:** low-risk, but a row-level spinner would be cheap.

**7. Room / Area rename — `handleSaveRename` (8526), `performRoomRename` (8492)**
- **User sees:** button `disabled`, label flips to "Saving…", suggestion chips
  disabled. Reasonable.
- **Tap protection:** none. `performRoomRename` has no guard whatsoever and is
  reachable from two paths (direct save and "Rename anyway").
- **Needs fix:** moderate — `renameSpace` fans out into local cache patching, so a
  double-fire is messy rather than dangerous.

### LOW

**8. Approach selection — "Start with X →" (App.js:8129)**
- Guard `if (!previewApproach || !currentPlanId || startingPlan) return;` — state,
  but the button is `disabled={startingPlan}` and reads "Starting…".
- Same-frame double-tap is theoretically possible. Low impact.

**9. Approach switching — `switchApproach` (App.js:8007)**
- Guard `|| switchingApproach) return;` plus `disabled={!!switchingApproach}` and a
  "Switching…" label. Same theoretical gap, low impact.

**10. Merge review actions — 5 handlers (App.js:8360–8443)**
- `mergeActionLoadingId` set per candidate; buttons `disabled={loading}`. No
  synchronous guard, but each is scoped to one candidate id.

**11. Room / Area deletion — `handleDeleteRoom` (9593), `handleDeleteArea` (9626)**
- Both behind a destructive `Alert`, which dismisses on tap — double-fire is
  effectively unreachable.
- `handleDeleteArea` deliberately waits 300 ms for the swipe-row animation, then
  runs `softDeleteArea` + `updateSpaceRoomSummary` with **no feedback**. Room
  delete is described in-code as "nearly instant, so no processing overlay is
  used" (App.js:9495) — that judgement still looks right.
- **Needs fix:** no, unless the Area path is observed to lag.

### Not a finding

- **`enterAreaStep`** sets `classifyStep("pick-area")` *before* awaiting `getDocs`,
  so the Area sheet is on screen while the list loads. Briefly shows "Whole Room"
  and "Create a new Area…" before existing Areas pop in — acceptable.
- **Paywall purchase** already renders its own "Processing…" state (App.js:10089).

---

## Recommended order

| Priority | Fix | Cost |
|---|---|---|
| 1 | `generateVisualization` re-entry ref | 2 lines · protects a 300 s Cloud Function and real spend |
| 2 | `handleConfirmDelete` re-entry ref | 2 lines · irreversible operation |
| 3 | `confirmMove` + `handleMovePlansIntoExisting` refs | 4 lines · covers Area re-parent and both Room merges |
| 4 | `generatePDF` — add a processing state | ~10 lines · the largest remaining *feedback* hole |
| 5 | Rename handlers | 2 lines |
| 6 | Restore ×3 — row spinner | ~10 lines |

Items 1–3 and 5 are all the same two-line pattern. A single pass could close every
HIGH and MEDIUM double-tap finding; the PDF and restore items are the only ones
needing actual UI.

---

## Verification status

Task 1 is **code-verified, not device-verified.** `node -c`, the TDZ auditor and a
full `expo export` all pass, and the staging OTA is published at runtime
`194c6294…`, matching the installed staging build.

What still needs a device, because none of the above can prove it:

1. Classify a session to a whole Room — overlay appears **immediately** and names
   the Room; list updates; header count drops.
2. Classify into an existing Area — overlay reads "Moving to Room / Area…".
3. Create a new Area, and separately a new Room — overlay through both steps.
4. Delete a session — overlay, then the row disappears.
5. **Double-tap a Room row hard** in the picker — exactly one session moves.
6. Force a failure (airplane mode) — overlay clears, error shows in the sheet,
   session stays in the list and can be retried.
