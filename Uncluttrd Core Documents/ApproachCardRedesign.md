# Results UI — Approach Card Redesign

**Scope shipped:** the interaction-model and information-density change to the Results approach cards. **No approach switching** — "Change approach" is a placeholder.

**Branch:** `feature/companion` · **Verified against:** `cluttrd-staging` · **Date:** 2026-08-11

---

## 1. What changed

### Item 1 — "What we noticed"

A sentence-case heading above the overview card (App.js:9799). Deliberately **not** `s.sectionLabel`'s all-caps tracked style — that marks machine-ish dividers like "HOW WOULD YOU LIKE TO APPROACH THIS?", whereas this should read as the app talking, matching the prose it introduces. New style `s.resSectionHeading`. Applies to old- and new-format plans alike, since the overview is schema-independent.

### Item 2 — Collapsed card carries the comparison

The collapsed card previously showed name, spend, strategy, and a bare `ChevronRight`. It now also shows:

- **keyChanges** — up to 4, as tight bullet rows (`s.approachChangeRow`), filtered to non-empty strings. Small colored dot rather than the heavier `s.step`/`stepChk` checkmark used in expanded guidance: these are outcomes to skim, not tips to follow, and the card has to stay compact enough that all three fit (item 8).
- **Suggested additions** — a single line of product **types** joined with `·`, from `productRecommendations`. **Omitted entirely when the approach recommends nothing** — never an empty label.
- **A worded toggle** — "See full details" / "Show less" plus a rotating chevron (`s.approachToggleRow`), replacing the bare arrow. The mystery-arrow problem was that the only clue more content existed was an icon that didn't say what it did.

The additions line has **no tap target** — item 6 is explicit that shopping lives solely in the expanded card's product rows.

### Item 3 — Tap is expand/collapse only

```js
onPress={() => setPreviewApproach((prev) => (prev === id ? null : id))}
```

Toggling to `null` on a second tap is what makes "read it, close it, open the next" work. One card at a time falls out for free — exactly one id can equal `previewApproach`. `previewApproach` remains local state that is **never written to Firestore**; browsing all three persists nothing. `accessibilityState={{ expanded }}` replaces the old ", expanded" string appended to the label.

### Item 4 — Commitment lives inside the expanded card

`"Start with {name} →"` (`s.approachStartBtn`, green, full-width within the card, App.js:10071-10083), rendered only when `!results.selectedApproach`.

**The shared "Start This Plan →" button below all three cards is deleted.** It had two problems: it was frequently off-screen at the moment the user had just decided, and being shared it never named what it was starting — which made expanding feel like selecting.

`handleStartThisPlan` itself is **unchanged** (App.js:6358-6404). It still writes `selectedApproach` + `approachHistory` via `arrayUnion`, awaits both, seeds `currentBatch` from that approach's `taskChecklist`, then navigates to Companion. Its existing failure behavior already matched item 4's requirement: on error it alerts and leaves `previewApproach` untouched, so the expanded card stays open and the same tap can be retried with no state lost.

### Item 5 — Post-commitment state

The section no longer hides once a plan is started. The gate changed from `results.approaches && !batchItems.length` to `results.approaches`, and the header branches:

- **Uncommitted** → "HOW WOULD YOU LIKE TO APPROACH THIS?"
- **Committed** → `Your approach: {name}` + a "Change approach" link (`s.approachChosenRow`).

The chosen card is expanded on arrival, via a one-line change to the existing results effect (App.js:3944): `setPreviewApproach(results.selectedApproach || null)`. An uncommitted plan still opens fully collapsed — the comparison state. This seeds an ephemeral value from already-persisted state; it writes nothing.

Other cards stay collapsed but fully expandable for reference. "Change approach" shows a "Coming soon" alert — switching has real consequences for an in-flight Companion batch and is its own piece of work.

### Items 6 & 7 — Unchanged

Shop options still builds the Amazon URL at tap time from `searchTerms` (`openProduct`, App.js:6350) — untouched. Old-schema plans are untouched: the entire new section is behind `results.approaches`, and tier rendering was not modified.

---

## 2. One decision worth flagging

**"Let's Get Started" (App.js:10102-10114) was kept.** Item (k) asks that the commitment button be the only start action. That button is not a start action — it is *resume*, gated on `batchItems.length > 0`, i.e. only for a plan that has already been started. Critically, **it is the sole Companion entry point for all 27 old-format plans in staging**, which item 7 requires to remain unchanged. Removing it would have been a regression in the exact area item 7 protects. For a new-format plan it appears only after commitment, alongside "Your approach: …", where "resume my Companion" is a reasonable and distinct affordance.

---

## 3. Staging data findings — one of them significant

A read-only census of the staging account (uid `ZYe7h9hM25UB7Pk6YRbPysg2cGC3`, 28 plans):

| | Count |
|---|---|
| New-format (`approaches` present) | **1** |
| Old-format (`tiers`) | **27** |

**The one new-format plan is `schemaVersion: 2` and has `keyChanges: 0` on all three approaches.**

`keyChanges` was introduced by the AI Analysis Redesign Phase B.1 prompt change (commit `8e78be6`), which bumped `schemaVersion` to 3 — and **no analysis has been run since**, so no plan in staging carries the field. On that one real plan the redesigned collapsed card renders name, spend, strategy and additions, but **no keyChanges bullets** — the headline new content of item 2 is empty.

This is graceful, not broken: `(a.keyChanges || []).filter(...)` yields an empty array and the block is omitted. But it means **item 2's keyChanges requirement cannot be observed on existing staging data.** Seeing the full redesigned card requires one fresh analysis, which will produce a v3 plan.

The same census gives genuinely useful evidence for item (h): on that plan, `simple` has **0** products while `polished` has 2 and `elevated` has 3 — so the omit-vs-render branch of "Suggested additions" is exercised by real data within a single plan:

```
simple    products=0  -> additions preview: OMITTED
polished  products=2  -> "decorative tray · floating shelf or niche shelf"
elevated  products=3  -> "bar cabinet or liquor cabinet · LED picture light or niche lighting · decorative sculpture or art object"
```

All products on that plan carry `searchTerms`, so no Shop options link would build an empty query.

---

## 4. Test results

These are render-layer and interaction tests. There is **no UI-driving harness in this project, and no device or emulator available in this environment** — so they were verified by real staging *data* where the data is what decides the outcome, and by source inspection where the render is what decides it. Stating which is which rather than implying uniform runtime evidence:

| # | Test | Result | Basis |
|---|---|---|---|
| a | Collapsed card shows name, spend, strategy, keyChanges, additions | **Partial — data-limited** | Name/spend/strategy/additions confirmed present on the real plan. **keyChanges cannot be shown: zero on the only new-format plan in staging** (§3). Render path verified in source (App.js:10005-10022). |
| b | Tap expands (guidance + products + commit button); tap again collapses | Verified in source | Toggle App.js:9999; expanded block App.js:10029-10084 |
| c | Comparing between cards persists nothing | Verified in source | The handler is a pure `setPreviewApproach`; the only Firestore write in the section is `handleStartThisPlan`. Census confirms `selectedApproach: null`, `approachHistory: []` on the real plan. |
| d | Commit persists `selectedApproach` + `approachHistory`, seeds Companion | Verified in source, **logic unchanged** | `handleStartThisPlan` App.js:6358-6404 was not modified — only its trigger moved |
| e | Persistence failure keeps the expanded card, allows retry | Verified in source | `catch` alerts and leaves `previewApproach` untouched (App.js:6398-6404) |
| f | Return after commitment shows "Your approach: …", chosen card expanded | Verified in source | Header App.js:9925-9946; expansion seeded App.js:3944 |
| g | "Shop options →" opens Amazon search | **Unchanged code path** | `openProduct` App.js:6350 not modified; all real products carry `searchTerms` |
| h | Zero products → no additions line, no product section | **PASS — real data** | `simple` (0 products) vs `polished`/`elevated` on the real plan (§3) |
| i | Old-format plans render tier layout unchanged | **PASS — real data** | 27 plans, `tiers: 3`, `approaches: absent`; new section is behind `results.approaches`, tier code untouched |
| j | "What we noticed" appears above the overview | Verified in source | App.js:9799 |
| k | Commitment button is the only start action | Verified in source | Shared "Start This Plan →" deleted; "Let's Get Started" retained deliberately as *resume* — see §2 |

**Build:** full Metro production export succeeded — 9.85 MB Hermes bundle, no errors.

---

## 5. OTA

Committed and pushed to the `staging` EAS Update branch.

- iOS update ID: `019ff137-06d4-7bb3-8ba3-a83a9e4b9c25` (group `d0b95dd7-42fd-4b9b-9e63-1a03df0f8dcd`)
- Android update ID: `019ff137-06d4-72ea-8f68-92cbbb7ba4dc` (group `18c2ef52-71b8-4a24-a5a7-6a7ba26bc2d5`)

---

## 6. Known / deferred

- **Approach switching is not built.** "Change approach" is a placeholder alert.
- **keyChanges is unobservable on current staging data** — run one fresh analysis to produce a `schemaVersion: 3` plan and see the complete collapsed card.
- **No visual confirmation on device.** Layout claims in item 8 (all three cards visible without excessive scrolling; expansion feeling like an extension rather than a new screen) are design intent expressed in the styles, not something measured on a real screen here.
