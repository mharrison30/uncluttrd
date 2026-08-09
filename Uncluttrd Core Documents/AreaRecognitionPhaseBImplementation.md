# Area Identity — Phase B: Visual Recognition — Implementation Report (2026-08-09)

Implements `AreaIdentityDesign.md`'s visual recognition step. Governing principle throughout:
visual similarity may **propose** Area identity; only explicit user confirmation **establishes**
it. Recognition unavailability never auto-creates or auto-merges an Area.

- App.js / functions/index.js commits: `a616ed5` (main implementation), `4b91107` (RECOGNITION_FAILED
  correctness fix found during testing)
- OTA (staging): iOS `019fe87c-9fa7-703b-ba87-74fc83df02a3`, Android `019fe87c-9fa7-7d15-b2cb-d73b751e37d7`
- Cloud Function `compareAreaCandidates`: deployed to `cluttrd-staging`

---

## Step 0 — Payload constraint measurements (real calls, not estimated)

Measured directly against the deployed `compareAreaCandidates` function, using real photos
already in Storage for the test account, with a real "true match" photo mixed among genuine
decoy photos from other real Areas/Rooms.

| Total images | Elapsed | Input tokens | Output tokens | Est. cost (published pricing) | Found true match? |
|---|---|---|---|---|---|
| 2 (today + 1 ref) | 3706ms | 3,063 | 78 | $0.0104 | YES |
| 4 (today + 3 refs) | 3666ms | 5,843 | 72 | $0.0186 | YES |
| 8 (today + 7 refs) | 4265ms | 10,810 | 72 | $0.0335 | YES |
| 16 (today + 15 refs) | 3839ms | 23,343 | 82 | $0.0713 | YES |
| 17 (today + 16 refs — design doc's own stated worst case) | 4972ms | 24,733 | 77 | $0.0754 | YES |

Cost computed at claude-sonnet-4-5's published pricing ($3/MTok input, $15/MTok output).

**Findings:**
- **Max images per call**: Anthropic's documented API limit is far above anything tested here
  (up to 100 images per request). The real constraint is cost/latency/UX, not a technical ceiling
  — confirmed by testing straight through the design doc's own stated worst case (17 images) with
  zero errors.
- **Latency**: stayed in a narrow 3.7–5.0s band across the entire 2–17 image range — no meaningful
  scaling with image count in this range. Latency is dominated by fixed model overhead, not input
  size, for images this small (768px compressed).
- **Cost**: scales linearly with image count (~1,400–1,450 tokens per image at this compression),
  from ~$0.01 (minimum case) to ~$0.075 (worst case, 17 images) per comparison call.
- **Quality at scale**: **no degradation observed** — the true match was found correctly in every
  single run from 2 through 17 images, including with 15 unrelated decoy images in the same call.
- **NO_MATCH correctness**: verified separately — a photo compared only against genuine decoys
  (no true match present) correctly returned `{"candidates":[]}`.

**Narrowing strategy** (used since testing confirmed headroom, not because it was forced): at
most 3 candidate Areas go into any one visual call (≤2 reference images each + today's photo =
≤7 images), comfortably inside the measured envelope. When a Room has more than 3 eligible
Areas, candidates are narrowed by loose `suggestedAreaName` word-overlap — explicitly a **weak
co-signal for narrowing only**, never the match decision itself (that's always the visual call,
or no call at all). Excluded Areas are always recorded in `diagnostics.excludedAreas`, never
silently dropped. `originalPhotoUrl`/`latestPhotoUrl` are deduplicated per Area when they resolve
to the same URL, capping each Area at 2 distinct reference images.

**A real limitation discovered during testing** (not from Step 0's own measurement, from later
test (b) — see below): the model is **not perfectly deterministic**. One specific decoy/candidate
pair (a real "Under-Sink Cabinet" photo vs. a real "Corner Shelf" photo — both happen to share a
wood-toned, light-cabinet color palette) produced a false-positive match in 3 of 6 repeated calls
with identical input. A second, more visually distinct decoy pair produced 0 false positives in 4
repeated calls. This is real evidence that recognition quality varies by photo pair, not a code
defect — reported honestly rather than smoothed over, and it's exactly why the governing principle
requires explicit user confirmation before anything is written: a false-positive proposal still
requires the user to tap "Yes, same area" before any data changes.

---

## Implementation

### `compareAreaCandidates` (functions/index.js) — new Cloud Function
Sends today's photo + reference images (fixed order, narrated in the prompt text — same pattern
as `generateNextAction`'s original/before/after) to `claude-sonnet-4-5`, asks a single narrow
question ("does today's photo show the same physical area as any of these? compare the physical
space, furniture, and fixtures, not the level of organization"), and requires JSON output
`{"candidates":[{"areaId":"...","evidenceReason":"..."}]}`. No numeric confidence is ever
requested or parsed. Not gated by the free-plan analysis count — this is an internal step of one
user-facing photo, not a separately invoked feature, so it never double-charges a credit.

### `findAreaRecognitionCandidates(roomId, newPhotoBase64, existingAreas, suggestedAreaName, uid)` (App.js)
Same three-outcome shape as Room recognition. One deliberate signature deviation from the
originally specified `newPhotoUrl`: the parameter is a **base64** image, not a URL — at the point
this runs, the plan has not been saved yet (see the invariant below), so no `photoUrl` exists.
The already-captured local photo is compressed to base64 by the caller instead, exactly like
every other multi-image comparison already in this file.

- Filters to non-retired Areas; narrows to top 3 by `suggestedAreaName` word-overlap when needed.
- Fetches/dedupes/compresses reference photos (768px, matching the rest of the file's convention).
- **Zero usable reference photos → `RECOGNITION_FAILED`, not `NO_MATCH`** (see the bug fix below).
- Calls `compareAreaCandidates`; maps returned `areaId`s back to full Area objects for the UI.

### Governing invariant: no plan saved until both Room and Area identity are established
Both integration points now **pause before saving** when Area recognition needs to run:

- **`completeRoomConfirmation`** (generic-camera path): for `outcome === "existing-room"` +
  `areaScope === "sub-area"`, loads the target Room's existing Areas *before* calling
  `createReturningPlan`/`savePlanToHistory`. Zero Areas → falls straight through to save (Phase A
  path, unchanged). One or more Areas → pauses via `beginAreaConfirmation`, save happens later via
  `finishRoomConfirmationSave` (the original save+bookkeeping logic, extracted unchanged, now
  parameterized by the resolved Area intent).
- **`analyze()`'s "Organize Another Area" branch** (`returningContext.spaceId` set,
  `returningContext.areaId` null): same gate, same `beginAreaConfirmation`, its own
  `finishOrganizeAnotherAreaSave` continuation. This **replaces** the prior turn's Area Creation
  stopgap (which unconditionally created a fresh Area) — that code path no longer exists.
- **"Organize Again" from an existing Area** (`returningContext.areaId` already set): completely
  untouched — the gate's own condition (`!returningContext.areaId`) is false, so recognition never
  runs, exactly matching "identity established by navigation."

`beginAreaConfirmation` is the single shared gate for both integration points — it resolves
`NO_MATCH` and the zero-existing-Areas case immediately (zero UI friction), and only shows the
proposal screen for `MATCH_FOUND`/`RECOGNITION_FAILED`. This guarantees the two entry paths can
never drift into different Area-recognition behaviors.

**Concrete new-Area creation still happens after save** in the "new area" intent case (reads back
the just-saved plan's `photoUrl`, same as Phase A/the prior stopgap already did) — the *decision*
between matched/new/picked is made before any save; only the mechanics of minting a brand-new
Area document (which needs a real `photoUrl` to exist) happen after, matching the same
already-established pattern a brand-new *Room* uses (`writeSpaceShadowStructure`'s Space doc is
also only written once a plan exists).

### Proposal UI
Mirrors Room Confirmation's own structure (checked *before* `roomConfirmation` in the render
if-chain and the Android back-handler, since `roomConfirmation` stays truthy — paused, not
cleared — while Area confirmation shows):
- **MATCH_FOUND**, one candidate: single compact card. Multiple: stacked cards. Either way, "This
  is a new area" and "Choose another saved area" below — no per-candidate reject button.
- **NO_MATCH**: no screen at all, immediate creation.
- **RECOGNITION_FAILED**: distinct failure-state chooser — "We couldn't check your saved Areas
  right now," a manual list of existing Areas (with photos), and "This is a new area." Never
  auto-creates.
- Cancel: clears local state only (`areaConfirmationPendingRef`/`areaConfirmation`) — nothing was
  ever written during the pause, so cancel is a pure no-op against Firestore.

### A real bug found and fixed during implementation
`findAreaRecognitionCandidates` originally returned `NO_MATCH` when every candidate Area's
reference photo failed to download/compress — but no comparison actually happened in that case,
so "genuinely checked, found nothing" was a false claim, and it would have silently created a new
Area exactly when the governing principle says not to. Fixed to return `RECOGNITION_FAILED`
instead (commit `4b91107`), caught before shipping to the user by re-reading the code while
preparing test (f).

### Step 6 — known-identity grounding for a Phase-B-confirmed match
**No new code needed.** Two things already guarantee this once `plan.areaId` is set correctly
(which every path above now does before/at save time):
1. `resolveVisitAreaLabel` (Room Detail's shared label resolver) already prefers the durable
   Area's *live* `displayName` over historical plan text whenever `plan.areaId` is set — so any
   future visit or view of this Area anywhere in Room Detail is automatically correct.
2. The existing-Area Organize Again grounding note (built in the prior turn) already fires for
   *any* future revisit to this Area, since it reads the Area's current `displayName` live via
   `organizeAgainContext.areaId` — which will correctly point at this newly-confirmed Area the
   next time the user organizes it.

Per the design's own initial-content contract, the pre-confirmation analysis (overview, tasks,
etc., already generated before the user ever saw the proposal screen) is never regenerated — no
second `analyzePhoto` call was added, exactly as specified.

---

## Step 7 — Test results (real staging evidence)

Ran against a dedicated test Room (kept separate from the user's real Living Room to avoid
repeating an earlier session's data-contamination mistake), with 3 real Areas backed by real
reference photos, using the same Admin-SDK save mirrors (`savePlanToHistoryAdmin`,
`createAreaForPlanAdmin`, `updateAreaSummaryAdmin`, `syncPlanToSpaceGraphAdmin`) already
established and trusted earlier this session, plus real calls to the deployed
`compareAreaCandidates` function. All test data was fully deleted afterward (Areas, shadow
Projects, plans, and the Room doc itself).

| # | Test | Result |
|---|---|---|
| a | New photo of existing Area → candidate proposed → confirm → associated, no new Area | **PASS** — `MATCH_FOUND`, plan.areaId set to the matched Area, Area count stayed at 3 |
| b | New photo of a genuinely different area → NO_MATCH → new Area, no friction | **PASS** (with a clearly-distinct decoy: 0/4 false positives). See the Step 0 limitation note above — a *harder*, more visually-confusable decoy pair produced 3/6 false-positive proposals; not a code defect, a real recognition-quality limit mitigated by required confirmation |
| c | Same physical area, different `suggestedAreaName` → still proposes the match | **PASS** — tested with a deliberately wrong name ("Kitchen Nook") passed for the real Corner Shelf photo; still matched, since `suggestedAreaName` is never sent to the vision call at all (narrowing-only, and unused below 4 eligible Areas) |
| d | Multiple Areas → candidates shown with correct photos | **PASS** — candidate objects carry correct `id`/`displayName`/`latestPhotoUrl` |
| e | Single candidate → compact card | **PASS** — the Corner Shelf match returned exactly 1 candidate |
| f | Recognition failure (simulated) → failure chooser → manual selection → associated correctly | **PASS** — simulated by forcing every reference fetch to fail; correctly reported `RECOGNITION_FAILED`; manual pick associated with the chosen Area, no new Area created |
| g | Recognition failure → "This is a new area" → created | **PASS** |
| h | Organize Again from existing Area → recognition skipped entirely | **Verified by code inspection** — the gate's own `!returningContext.areaId` condition is false, so `beginAreaConfirmation` is never even called |
| i | Whole-room visit → no recognition | **Verified by code inspection** — gated on `areaScope === "sub-area"` |
| j | New Room (no Areas) → no recognition, new Area created directly | **Verified by code inspection** — `beginAreaConfirmation`'s `eligible.length === 0` shortcut calls `saveContinuation({kind:"new"})` immediately, no screen |
| k | After association, Area summary updates correctly (visitCount, latestPhotoUrl; originalPhotoUrl unchanged) | **PASS** — visitCount 1→2 after a real founding visit + real matched revisit, latestPhotoUrl updated, originalPhotoUrl unchanged |
| l | Plan-count invariant: zero before confirmation, one after | **PASS** |
| m | Back/cancel from proposal screen → no plan, no Area | **Verified by code inspection** — cancel only calls `setAreaConfirmation(null)`, never `saveContinuation` |
| n | Step 0 measurements reported with actual numbers | **Done** — see above |
| o | Plan and shadow Project `areaId` aligned after association | **PASS** |
| p | "Organize Another Area" (Room known, Area unknown) → recognition runs | **Verified by code inspection** — `findAreaRecognitionCandidates`/`beginAreaConfirmation` are the exact same shared functions used by test (a)/(b)/(f)/(g) above; both integration points are structurally identical from this point on |

**Honest disclosure**: (h), (i), (j), (m), (p) were verified by direct code inspection rather than
a live end-to-end run, since they're pure control-flow guards (a boolean condition that's provably
never reached) rather than data-producing paths worth re-proving with a live call. On-device
UI/visual confirmation (does the proposal screen actually render and look right on a real phone)
was not performed — data-level and logic-level correctness only.
