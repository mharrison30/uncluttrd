# Visualization Regeneration (Implementation Report)

Lets a user replace a visualization whose content is wrong. Strictly error
correction, not creative exploration: one entry point, one image per
approach, no history and no versioning.

Branch `feature/companion`. **Client-only — no Cloud Function change.**
`generateVisualization` already accepted an arbitrary prompt and returned an
image; regeneration is the same call with different bookkeeping around it.
Ships by OTA alone.

---

## 1. The entry point

A quiet `Regenerate visualization` link with a `RefreshCw` icon, directly
below the existing thumbnail inside the expanded approach card. Secondary
text colour (`BRAND.slate`), regular weight — deliberately not competing
with "Start with X".

It renders **inside the `vizImage[id] ?` branch**, so "only visible when a
visualization already exists" is structural rather than a condition that can
drift. Pro gating is the same: the link is wrapped in `isPro`, and a non-Pro
user has no visualization there to regenerate in the first place. The
underlying `if (!isPro) { setShowPaywall(true); return; }` in
`generateVisualization` remains as the real gate.

---

## 2. Safe replacement — order is the design

The whole feature is one invariant: **never lose the known-good
visualization while attempting to replace it.** The sequence enforces it.

| # | Step | On failure |
|---|---|---|
| 1 | Generate new image | old kept, error shown |
| 2 | Compress to JPEG | old kept, error shown |
| 3 | Upload new object to Storage | old kept, error shown |
| 4 | **Persist `vizImages.<approachId>` to Firestore** | old kept, error shown |
| 5 | Swap the UI thumbnail | — |
| 6 | Delete the old Storage object | **best effort; never rolls back** |

Two ordering decisions carry the invariant:

**Firestore is written before the thumbnail changes.** The original
generation did the opposite — `setVizImage` first, persist after, with the
save failure swallowed to a `console.log`. That was harmless when there was
nothing to lose. With a known-good image at stake it is not: it would put an
image on screen that the user would not have after reopening the plan. Now
what is displayed can never be ahead of what is recorded.

**The old object is deleted last, and only after the replacement is
confirmed persisted.** By that point the regeneration has already succeeded.
An orphaned object costs a few KB; rolling back would cost the user the
image they just asked for. So step 6 catches everything, logs, and emits
`visualization_cleanup_failed` so the orphan is findable later.

Two failure modes needed tightening to make steps 1–5 genuinely atomic from
the user's point of view:

- **Upload failure** previously fell back to keeping the raw data URI as
  `finalUrl`. For a regeneration that would write a multi-megabyte data URI
  where a Storage URL belongs, so it now throws instead.
- **Firestore save failure** was swallowed. For a regeneration it now throws.
- A plan with no `currentPlanId` refuses to regenerate at all rather than
  swapping in an image that will not survive a reopen.

Nothing above step 4 mutates Storage-of-record, Firestore, or `vizImage`, so
"the old image is intact on failure" is true by construction rather than by
a rollback path that would itself need testing.

---

## 3. The loading state keeps the old image on screen

`vizLoading[id]` is rendered **beside** the thumbnail, never in place of it —
the `<Image>` stays mounted throughout. Same treatment as initial
generation: spinner, "Creating your transformation…", and the rotating
`VIZ_TIPS` line.

On failure the link is replaced by `Couldn't regenerate. Tap to try again.`
in red, which is itself the retry control. `vizError` is a separate state
map from `vizImage`, keyed by approach id, cleared at the start of each
attempt. Initial generation keeps its `Alert`, because with no thumbnail
there is nothing to attach an inline message to.

---

## 4. Prompt and storage

The prompt is `buildApproachVizPrompt`, unchanged — so
`stripInfrastructureClaims` and the `noNewInfrastructure` constraint apply
to a regeneration exactly as to a first generation. There is no separate
regeneration prompt to drift.

New object: `viz/{uid}/{planId}/{approachId}_{timestamp}.jpg` — the existing
path shape, whose timestamp already guarantees the new object never collides
with the one being replaced. The dotted-path write
`` `vizImages.${vizKey}` `` is what keeps a regeneration of one approach from
touching the other two.

---

## 5. Staging evidence

Run against `cluttrd-staging` through the deployed function, on a scratch
copy of a real plan seeded with three real visualizations. **7 of 7 passed.**
The user's own plan was not modified; the scratch uid and its 4 Storage
objects were removed afterwards.

| # | Evidence | Result |
|---|---|---|
| d-generate | Failure at generation → old image intact | PASS — Firestore unchanged, old object present |
| d-upload | Failure at upload → old image intact | PASS |
| d-persist | Failure at Firestore persist → old image intact | PASS — the new object is removed again, so a failed attempt leaves no orphan either |
| c / f | Success → Firestore points at the new URL, old object deleted | PASS — `cleanup=deleted`, new present, old absent |
| h | Other approaches unaffected | PASS — `simple` and `elevated` URLs and objects untouched |
| e | Sanitizer applies to the regeneration prompt | PASS — zero fixture words in the prompt body, constraint present |
| i | **Cleanup failure keeps the new visualization** | PASS — new URL persisted, orphaned old object still present, no rollback |

The failure cases were run **before** the success case deliberately: proving
the old image survives three different failure stages is the claim the
feature rests on, and running it first means the success case cannot mask it.

**Code-verified only** (a, b, g) — render-layer claims, no emulator here:

- **(a)** the link renders below the thumbnail, inside the `vizImage[id]`
  branch;
- **(b)** the `<Image>` stays mounted while `vizLoading[id]` renders beside
  it, so the old thumbnail cannot disappear during regeneration;
- **(g)** the link is inside `isPro`, and the handler re-checks `isPro`
  before doing anything.

Metro production export clean.

---

## 6. Deliberately not built

No history, no versioning, no "version 1 / version 2" comparison, no "try
another look", and no regeneration from the full-screen viewer. One entry
point on the Results card.

One known consequence, stated rather than hidden: because there is no
history, a regeneration is **irreversible** — a user who regenerates a good
image into a worse one cannot get the first one back, and step 6 will
already have deleted it. That is the correct trade for error correction (the
alternative is accumulating Storage objects nobody asked for), but it is a
real edge and worth revisiting if regeneration turns out to be used for
exploration despite the framing.
