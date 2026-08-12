# Approach Switching (Implementation Report)

Implements `ApproachSelectionDesign.md` Section 6. Client-only; ships by OTA.

**Core rule: changing approach changes the future, not the past.**

---

## 1. State is derived, never stored

A stored state field could disagree with the batch it describes. So it is
computed from the batch itself, every render:

| State | Condition | Behaviour |
|---|---|---|
| `none` | no `selectedApproach` | the initial chooser already handles this |
| `state2` | every item still `pending` | trivial switch, no dialog |
| `state3` | **any** item `checked`, `carried` **or** `skipped` | confirmation first |
| `state4` | `companionComplete` set | no switching at all |

`skipped` counting as progress is the subtle one and is deliberate: skipping
is a decision the user made about a specific task. Treating it as "no work
done" would silently discard that decision and let the switch happen without
a warning. It is archived as truthfully as a completed item.

State 4 hides the "Change approach" link entirely. A finished visit is a
closed record; a new approach belongs to a new visit via "Organize Again".

---

## 2. Task disposition — the whole feature in four lines

| Status | Disposition | Why |
|---|---|---|
| `checked` | permanent in the archived batch, **not** repeated | already recorded; repeating would double-count |
| `carried` | **survives verbatim**, same item id | the user said "still working on this" — invested effort, closer to completed than to a fresh suggestion |
| `pending` | **retired** with the old approach | these belong to the *old* approach's guidance; the new batch is composed fresh from the new one's checklist |
| `skipped` | stays skipped in history, **never reintroduced** | a deliberate decision, not an oversight to correct |

Carried items are placed **first** in the new batch, matching the ordering
the existing rotation already uses: continuing work reads above newly
suggested work.

---

## 3. It reuses the existing rotation, not a new mechanism

An approach switch is modelled as an early, user-triggered batch rotation
without the progress-photo step — the user is changing direction, not
reporting progress. The write is the same shape `generateNextAction`
already produces:

```
batchHistory: arrayUnion({ batchIndex, items, completedAt })
currentBatch: { batchIndex: +1, suggestedAt, items: [...carried, ...newTasks] }
```

plus `selectedApproach`, an appended `approachHistory` entry, and a
`shadowSourceVersion` bump followed by `syncPlanToSpaceGraph` — the same
projection maintenance every other plan mutation performs.

**State 2 does not archive.** Writing a batch of untouched items into
`batchHistory` would invent a chapter of history the user never lived, so
the batch is replaced in place and `batchIndex` does not advance. Only
state 3 rotates.

No new AI call: the new batch comes from the target approach's
already-generated `taskChecklist` (Call 2 produced all three).

---

## 4. The confirmation is not a modal

State 3 shows the required copy — *"Your completed work will stay in your
history. Unfinished tasks from your current approach will be replaced with
the new approach's plan."* — as a banner **above** the three cards, not as
an `Alert`. The decision needs the cards visible to browse; a modal would
cover exactly what the user is deciding between.

Selecting a different card **is** the confirmation. Tapping the current card
or Cancel dismisses with no change. The current approach carries a
`CURRENT` badge on the card itself, not only in the heading, so "which one
am I on?" stays answerable while reading the others.

The "Start with X →" button becomes "Switch to X →" on non-current cards
while the chooser is open — same control, same position.

---

## 5. What follows the new approach, and what does not

Follows: products, `visualizationDirection`, organizing guidance, the
Companion batch.

Untouched: `overview`, `itemsFound`, `problemsFound`, `proTip`, `scopeSize`,
Room/Area identity, photos, completed task history, and the plan document
itself (updated, never duplicated).

Visualizations are keyed by approach id, so `vizImages.simple` survives a
switch to elevated and is still visible by expanding Simple's card. "See the
transformation" generates against whichever approach's card it sits in, so
it naturally follows the current one without special-casing.

---

## 6. Staging evidence — 12 of 12

The state rule and the disposition core were **extracted from `App.js`** and
executed, so the rules under test are the shipped ones rather than a
restatement. Multi-switch sequences ran against real Firestore on a scratch
uid seeded from a real plan. The user's own plan was not modified.

| # | Evidence | Result |
|---|---|---|
| a | State 2: trivial switch, no archive, batch replaced | PASS — 6 items = Elevated's 6, `archive=false` |
| b | State 3: archives, batch rotates | PASS — batch 2 archived, new batch 3 |
| b2 | Checked items not repeated | PASS |
| c | **Skipped alone triggers state 3**, archived, not reintroduced | PASS |
| d | Carried survives verbatim, **same id**, placed first | PASS — `id=old-1` unchanged |
| e | Pending retired, not blended | PASS |
| f/m | `approachHistory` append-only across 3 switches | PASS — `simple → elevated → simple → polished` |
| k | State 4: no switching | PASS |
| l | Round trip keeps all history | PASS — 3 archived batches; the original `checked` item still recorded in batch 1 |
| m2 | No duplicates, no stale pending accumulation | PASS — final batch = Polished's 5 + 1 carried, all ids unique |
| 7 | Stable analysis, identity, photos untouched | PASS — 8 fields byte-identical |
| j | Prior visualizations still at their own keys | PASS — `simple, polished, elevated` unchanged |

Test (m2) is the one that would catch the likeliest bug: after three
switches the batch is exactly the target approach's checklist plus the one
genuinely carried item — no accumulation of retired pending tasks, no
duplicated carried items.

**Code-verified only** (g, h, i, n) — render/lifecycle claims, no emulator:

- **(g)** after a switch `setPreviewApproach(newApproachId)` expands the new
  card and the `CURRENT` badge follows `selectedApproach`;
- **(h)** Companion reads `batchItems`, which the switch sets to the composed
  list, so it shows new tasks + carried and never the retired pending ones;
- **(i)** the visualization button lives inside each approach card and builds
  its prompt from that card's approach;
- **(n)** the write is the same `arrayUnion(archivedBatch)` + `currentBatch`
  shape `generateNextAction` uses — verified by reading both, not by
  reimplementing.

Metro production export clean.

---

## 7. Known edge

A switch performed from Results while Companion has never been opened uses
`results.currentBatch.items` rather than the live `batchItems` array, since
the latter is only populated once Companion mounts. `liveBatchItems()`
prefers the live array and falls back to the persisted one, so both entry
points read the same truth — but the fallback is the untested path here, and
it is the one a user takes when they switch immediately after starting a
plan without opening Companion.
