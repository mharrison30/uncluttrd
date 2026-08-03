# Investigation: Recommendation Applicability Across Evidence Boundaries

This document is cited evidence for future Journey 3 and Journey 4 Reconciliation work. It does not itself reconcile either journey. Like `CrossJourneyFindings.md`, this is a living record of an investigation, not a governance document or a new standard - nothing here creates a rule on its own. It was conducted read-only: no files were modified, no UX copy was drafted, and neither journey was reconciled while producing it.

---

## Objective

Determine how Companion may present and use a previously generated Recommendation when the evidence that originally supported it may no longer establish its current applicability. This question is shared by Journey 3 (immediately after the user completes an action during a continuous session) and Journey 4 (when the user returns after an interruption that may have lasted minutes, hours, or days). The investigation did not assume these contexts require the same rule, and did not assume evidence-first or trust-then-verify is correct going in - both were investigated as genuine candidates.

---

## Task 1 — The shared question, stated neutrally

Both journeys are instances of the same underlying problem: **a Recommendation exists, generated from evidence available at some earlier point (T0); at the moment the user might act on it (T1), it is not established that the evidence supporting the Recommendation's applicability at T0 still holds at T1.** Both ask what Companion is entitled to do with that Recommendation at T1, given the gap.

What genuinely differs, established directly from the artifacts and shipped code (not assumed):

- **Continuity.** Journey 3's gap occurs mid-session; the user never left the interaction, and Companion directly observed the user's immediately preceding action (batch resolution, `submitCompanionProgressPhoto`). Journey 4's gap occurs after the user left the app; Companion observed nothing during the gap.
- **Magnitude.** Journey 3's gap is implicitly short and bounded by session length (~10-15 minutes, per "Working Set is Computed, Not Stored"). Journey 4's gap is explicitly unbounded by its own artifact - the wireframe states no duration at all; the "minutes, hours, or days" framing is imposed from outside, not stated by the wireframe itself.
- **Declared unknowns.** Journey 4's wireframe explicitly enumerates what Companion does not know (O20: validity, environmental change, user intent, work completed). Journey 3 has no equivalent explicit unknowns list - the batch's own state is fully known to Companion at the moment of the gap.

No "Historical Recommendation" object exists anywhere in the repository (`ObjectModel.md`'s `Recommendation` entry has no staleness, confidence, or validity field of any kind - confirmed by direct inspection). Any use of that phrase in this document is informal description only, not settled architecture.

---

## Task 2 — Evidence inventory (reported, not reconciled)

**Journey3.md Section 5** - the wireframe's own "Open Design Question (Pacing)" (O15) asks whether Companion should require a new photo after every single action (evidence-first) or present the next action immediately and verify later (trust-then-verify), and explicitly labels this "an interaction design decision, not an architectural one." Prior verification in that document found: (a) the question is NOT SETTLED by the 2026-07-26 "Session Generation and Session Presentation" entry, (b) the exact transition the question presupposes (single-item completion → gate) has no shipped analog at all, since `toggleBatchItem` is a local, ungated toggle. Journey3.md does not restate a batch-level version of that question as settled - it explicitly leaves that "out of scope."

**Journey4.md Sections 5-6** - records the wireframe's own explicit Evidence Boundary framing (O21, O19, O20) and the confirmed Architecture conflict: shipped auto-resume presents the prior Recommendation as immediately actionable with no confirmation step, chronology rules out timing-lag, and no shipped second decision point exists for "fresh look."

**Ownership/chronology findings** (this session) - shipped auto-resume (`8c7a095`, 2026-07-13) and its last revision (`3948c07`, 2026-07-18) both predate both governing 2026-07-26 DecisionLog entries and the wireframe.

**DecisionLog entries directly on point:**
- *"Pre-Photo Evidence Boundary"* (2026-07-26, Class 1): "Before a fresh photo exists, Companion may only present information derived from: explicit user decisions, the current Space, and durable history. **Fresh recommendations require fresh evidence.**" Prescribed flow: "(1) Surface durable context, (2) Capture fresh evidence, (3) Generate new recommendations." This governs *generating* new recommendations; it does not on its own text address whether an *existing* Recommendation may be re-actioned without repeating that flow.
- *"The Evidence Boundary Applies Across Time, Not Only Across Knowledge"* (2026-07-26, commit `6e22e57`, 18:14:52 - 15 seconds before the Journey 4 wireframe's own file timestamp, 1m59s after the "In Progress Object" entry): allows process descriptions of an immediate action, forbids outcome predictions about unestablished future states. Its own "Worked example" is explicitly labeled **"final Journey 4 return-screen card copy"** - "Pick that back up" / "Take a fresh look" - meaning this entry claims direct authorship of the wireframe's exact copy, not mere resemblance. Recorded as an even tighter same-session pairing than previously found in Journey4.md; still Level 1 only, no directionality established.
- *"An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object"* (2026-07-26, `90d41ad`, 18:12:53): prescribes "a real choice, such as 'Pick that back up' versus 'Take a fresh look'" on return; forbids "Continue clearing the countertop" as an implicit-validity assertion.
- *"Observation Does Not Establish Evaluation"* (2026-07-26): repeated observation alone cannot justify a change in strategy/evaluation - relevant to whether elapsed time or a Location change alone could ever justify Companion inferring anything about current state.
- *"Session Generation and Session Presentation Are Separate Architectural Concerns"* (2026-07-26) + its 2026-07-30 addendum: governs "one action at a time" language, already found not to match shipped batch behavior; not directly about applicability across gaps, but establishes that Companion may hold broader internal state not equal to what's shown.

**Journey5.md** - "Journey 3 Reconciliation" governs the single-trustworthy-action/BatchChecklist split, not evidence-applicability directly; not further relevant here beyond what's already recorded in `CrossJourneyFindings.md`.

**Shipped implementation (`App.js`), directly inspected:**
- `toggleBatchItem` - ungated local toggle, no evidence check.
- `submitCompanionProgressPhoto` - **requires** a new photo to generate the next batch. Its own AI prompt instructs: *"Trust photo 3 over what the user reported. The checklist reflects intent, not verified fact - if an item was marked done but photo 3 shows it clearly wasn't addressed, don't call out the discrepancy... Just generate the next batch naturally around what photo 3 actually shows."* This is a **shipped, already-adopted instance of silent trust-then-verify (C1)**, specifically for reconciling the user's self-reported outcomes against fresh photo evidence, at the within-session batch boundary.
- "Carried" items (user-marked "still working on this") are folded into the next batch as `status: "pending"` - re-presented as actionable again, but only *after* `submitCompanionProgressPhoto`'s fresh-photo gate has run. So within-session: fresh evidence is required before re-actionability (Evidence-first, A), and the AI silently reconciles against that fresh evidence rather than trusting the user's prior self-report at face value (C1) - a shipped hybrid of A and C1, not a pure form of either.
- `resumeCompanionSession` (Journey 4's real analog) - calls **no** evidence-gathering step. It restores the old photo and old `currentBatch.items` and sets `showCompanion: true` directly. There is no equivalent of `submitCompanionProgressPhoto`'s gate anywhere in the resume path. The user can act on stale items immediately, with the same reconciliation only occurring *whenever* they eventually submit a new progress photo - which could be arbitrarily far in the future.

**CrossJourneyFindings.md** - records that both conflicts share the "decision adopted, infrastructure built, confirmation step skipped" shape, and that Journey 4's is evidence-trust severity while Journey 3's is UX-shape severity. Cited, not restated further.

---

## Task 3 — Evaluating the candidate models

**A. Evidence-first.** Directly supported as the *default* by "Pre-Photo Evidence Boundary" ("fresh recommendations require fresh evidence") and directly shipped at the within-session batch boundary via `submitCompanionProgressPhoto`. Strong precedent for Journey 3. For Journey 4, no shipped precedent exists at all - the resume path has zero evidence gate today.

**B. Explicit confirmation.** The governing DecisionLog entry for Journey 4 explicitly prescribes exactly this: a choice ("Pick that back up") that the user must select, standing in for fresh evidence. Also shipped, in a narrower form, at the within-session boundary: an item's "carried" status is itself an explicit user confirmation that a Recommendation remains live - though that confirmation is *not* treated as sufficient on its own; it still gets checked against the next fresh photo (see A+C1 hybrid above). This is evidence that explicit confirmation, in this repository's actual practice, has so far never stood alone - it's always paired with eventual fresh-evidence reconciliation, not treated as a substitute for it.

**C1. Silent trust-then-verify.** Already shipped, already adopted (not merely theoretical), at the within-session boundary - and its own prompt text ("Trust photo 3 over what the user reported... don't call out the discrepancy") shows the repository has already judged this compatible with the Evidence Boundary *in that specific context*, where reconciliation against fresh evidence is guaranteed to occur before the next action becomes visible. Whether it remains compliant *without* that guarantee (Journey 4's actual current behavior - stale items actionable with no forced reconciliation point at all) is a materially different case: nothing in the repository evaluates C1 *without* a bounded, guaranteed verification step. Journey 4's shipped behavior is closer to "C1 minus its own safety property" than to the shipped, evaluated form of C1.

**C2. Transparent trust-then-verify.** No shipped precedent either way. Tests well against "The Evidence Boundary Applies Across Time" (a process description like "picking up where you left off, not yet reconfirmed" is a permitted process description, not an outcome prediction) and against "Every Visible Element Asserts Both Truth and Importance" (the provisional-status disclosure would itself need to pass Evidence + Relevance review, which it plausibly could, since it changes the user's understanding of confidence). No repository text forecloses this option.

**D. History-only review.** Directly contradicts the governing DecisionLog entry's own text, which requires the return interaction to offer "a real choice" including one that leads to action ("Pick that back up" is explicitly a path to resuming, not merely viewing history). D is not viable as the Journey 4 answer given already-adopted governing text, unless that text itself is revisited (out of scope here).

**E. Context-dependent model.** Directly consistent with what's already shipped: the repository already treats the within-session boundary (A+C1 hybrid, gated) differently from the cross-interruption boundary (currently ungated, arguably a gap rather than a considered C1). Nothing in the repository requires a single uniform mechanism across both.

**F. Other.** No repository evidence points to a model outside A-E.

---

## Task 4 — Timescale

Timescale is not irrelevant, but the repository's own reasoning locates its relevance in what elapsed time *permits Companion to infer*, not in elapsed time as a quantity itself. "Observation Does Not Establish Evaluation" already forbids inferring anything from mere repetition or the passage of time without independently grounded evidence - so a duration-based rule ("auto-resume if <N minutes, ask if >N minutes") would itself be an unsupported inference from elapsed time alone, exactly the move that decision rules out. What timescale plausibly *does* correlate with, per the artifacts themselves, is the two contexts' different *declared unknowns* (Task 1): a longer, interrupted gap is when "what changed while user was away" (Journey 4 O20) becomes a live unknown, versus a short, continuous gap where Companion directly witnessed the intervening action. **This makes duration a proxy for context discontinuity, not itself the operative variable** - an arbitrary timeout would optimize the wrong thing. This weighs toward E (context-dependent) but on the basis of continuity/observation, not clock time.

---

## Task 5 — Other differences

Established by the repository directly:
- **Direct observation of the preceding action** - true in Journey 3 (batch resolution witnessed), false in Journey 4 (nothing witnessed during the gap). Established.
- **Continuous interaction** - true in Journey 3, false in Journey 4 by definition ("Return After Interruption"). Established.
- **New evidence already expected as part of the flow** - true in Journey 3 (`submitCompanionProgressPhoto` is a normal, expected step of continuing); Journey 4's own wireframe presents "Take a fresh look" as *optional*, not mandatory, meaning fresh evidence is not already expected as part of resuming. Established from both artifacts.

Plausible but not established by the repository:
- **Location change.** Neither Journey 3 nor Journey 4's artifacts state whether Location can change during either gap. The "Active Location Persists Across Inter-Journey Handoffs" decision addresses handoffs between journeys, not interruption/resumption specifically - not directly on point. Hypothesis only.
- **Stability of the underlying condition** (e.g., "clear the countertop" vs. something more likely to have changed) - no repository text distinguishes Recommendations by this axis at all; would require new architecture to even represent. Hypothesis only.
- **Explicit user confirmation of continuity** as a distinct signal from the "Pick that back up" choice itself - not distinguished anywhere; plausible refinement, not established.

---

## Task 6 — Models against governing constraints

| Model | Evidence Boundary | Obs. vs. Eval. discipline | Epistemic transparency | Stale-as-current risk | BatchChecklist compat. | Resumability infra compat. | Duplicates J3 micro-pacing ownership? | New Product Scope needed? |
|---|---|---|---|---|---|---|---|---|
| A (Evidence-first) | Compliant (matches Pre-Photo Evidence Boundary directly) | Compliant | N/A - no stale state ever shown as current | None | Compatible (mirrors existing batch-boundary gate) | Requires new gate on resume path (currently absent) | No - operates at a different boundary (interruption) | Likely yes for Journey 4 (a mandatory-photo resume flow doesn't exist today) |
| B (Explicit confirmation) | Compliant only if paired with eventual fresh-evidence reconciliation, per the only shipped precedent (carried items); untested as a standalone substitute for evidence | Compliant | Good - user's own act is the confirmation | Low, if reconciliation still occurs later | Compatible | Matches the governing DecisionLog entry's own prescribed screen | No | Minimal - closest to what's already governed, not yet built |
| C1 (Silent trust-then-verify) | Compliant *only* within a guaranteed, bounded reconciliation window (the shipped, evaluated case); Journey 4's current unbounded form has no such guarantee and has not itself been evaluated by any adopted decision | Compliant *if* reconciliation is genuinely evidence-grounded (it is, in the shipped case) | **Poor** - user's understanding ("this is current") does not match Companion's actual confidence (unconfirmed) whenever no reconciliation point is imminent | High for Journey 4 as currently shipped; low for Journey 3 as currently shipped | Fully compatible (already how batches work) | Fully compatible (it's the status quo) | No | No - already shipped for J3; would need explicit adoption to cover J4 as-is |
| C2 (Transparent trust-then-verify) | Compliant on the same basis as C1's evidence handling, plus satisfies transparency directly | Compliant | Good - by construction | Low - staleness is disclosed, not concealed | Compatible (a status badge/line doesn't conflict with checklist rendering) | Compatible, but requires new UI state (provisional/confirmed flag) not currently modeled anywhere | No | Yes - "provisional Recommendation" display state doesn't exist in `ObjectModel.md` or shipped code |
| D (History-only) | Compliant | Compliant | Trivially good (nothing actionable is shown) | None | Not applicable - no action available | Compatible | No | Contradicts already-adopted governing text for Journey 4 - not a live option there |
| E (Context-dependent) | Depends entirely on which sub-model each context uses | Same | Same | Same | Same | Same | No, provided the two contexts are governed by explicit, separately-justified rules rather than one silently reused for both | Likely yes, since it requires formalizing the distinction itself, not just picking a mechanism |

No model is favored here for being the smallest change - C1 already being shipped is reported as a fact about the current codebase, not as a reason to prefer it going forward.

---

## Task 7 — One rule, context-specific mechanisms, or two rules?

The evidence does not support a single, identical rule applied without modification to both contexts, nor does it establish that two fully independent rules (with no shared principle at all) are required. What the repository actually shows:

- A **shared underlying principle already exists and is already adopted**: an existing Recommendation may not be presented as though its applicability is currently established when it isn't (Pre-Photo Evidence Boundary; Evidence Boundary Applies Across Time). This applies to both contexts identically and doesn't need to be re-decided per journey.
- **How that principle is satisfied already differs, in shipped code, by context** - and does so along a repository-established axis (continuity/direct-observation, Task 5), not an invented one. Journey 3 satisfies it via a mandatory fresh-evidence gate before re-actionability (A), softened by silent reconciliation against self-reports (C1) - itself only justified by that mandatory gate's presence. Journey 4 currently satisfies it via **nothing** - this is the confirmed Architecture conflict, not a working alternative mechanism.

This points to **one governing rule with context-specific mechanisms (a version of E)**, not two unrelated rules - but this is as far as the evidence goes. Whether Journey 4's specific mechanism should be A, B, or C2 is **UNRESOLVED**: all three are architecturally viable per Task 6, none is ruled out by any adopted decision, and the repository contains no decision that chooses among them for the cross-interruption case specifically. C1 in Journey 4's *current, unbounded* form is the one candidate the evidence weighs against, on transparency and Evidence Boundary grounds specific to the missing reconciliation guarantee - but C1 in a *bounded* form (mirroring Journey 3's guarantee) has not been ruled out either.

### Verification: toggleBatchItem and submitCompanionProgressPhoto are distinct mechanisms

Directly verified in `App.js` to confirm the batch-boundary findings above do not also describe, or resolve, Journey3.md's separate per-item pacing question (O15).

`toggleBatchItem` (`App.js:1380-1387`) - synchronous, local-only, no network call, no photo:

```js
const toggleBatchItem = (itemId) => {
  setBatchItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const checking = item.status !== "checked";
    logEvent(getAnalytics(), checking ? "batch_step_checked" : "batch_step_unchecked", { planId: currentPlanId, batchIndex: companionBatchIndex, itemId });
    return { ...item, status: checking ? "checked" : "pending" };
  }));
};
```

It only flips an item's status between `"checked"` and `"pending"` in local state and logs an analytics event. No photo, no server call, no evidence check of any kind. This is wired directly to `BatchChecklist`'s `onToggleItem` prop.

`submitCompanionProgressPhoto` (`App.js:1567` onward) - async, requires a photo, calls the AI, gates the next batch:

```js
const submitCompanionProgressPhoto = async (progressUri, progressBase64, planIdOverride = null) => {
  ...
  setProgressPhoto({ uri: progressUri, base64: progressBase64 });
  if (!isPro) {
    setCompanionStage("paywall-prompt");
    ...
    return;
  }
  const originalSource = companionOriginalPhotoRef.current;
  if (!originalSource) {
    console.log("Companion next-batch error: original photo not yet available");
    ...
    return;
  }
  setCompanionStage("generating");
  ...
```

It requires an actual `progressUri`/`progressBase64`, checks Pro entitlement, checks a cached original-photo reference before proceeding, and moves the stage to `"generating"` - leading into the AI call (the "Trust photo 3 over what the user reported" prompt, quoted in Task 2 above) that produces the next batch. This is invoked only from the photo-capture path (`openBatchPhotoSheet` → `captureCompanionPhoto`/`pickCompanionPhoto` → `submitCompanionProgressPhoto`), never from `toggleBatchItem`.

No overlap: one is a synchronous checkbox flip with no evidence involved; the other is an async, photo-gated, AI-mediated transition. Confirmed genuinely distinct.

**Clarification:** This investigation resolves the repository's current treatment of Recommendation applicability at the batch boundary (`submitCompanionProgressPhoto` → next batch). It does not resolve Journey3.md's existing per-item pacing question (O15), which concerns the ungated transition represented by `toggleBatchItem`. That question remains exactly as previously recorded: a genuine, unresolved design decision whose presupposed interaction has no shipped analog today.

---

## Required outcome — summary

- **Genuinely shared:** the underlying problem (Recommendation applicability across an evidence gap) and the governing principle already adopted for it (no unconfirmed applicability presented as confirmed).
- **Materially distinguishing:** continuity of interaction, direct observation of the intervening action, whether fresh evidence is already an expected step of the flow (Task 5) - not raw elapsed time, which the repository's own "Observation Does Not Establish Evaluation" decision would treat as an unsupported inference if used as the operative variable (Task 4).
- **Trust-then-verify (C1) legitimacy:** remains legitimate, and is already adopted, but only in its *bounded* form (guaranteed reconciliation before the next action, as shipped for Journey 3). Its *unbounded* form, which is what Journey 4 currently ships, has not been evaluated or adopted by any governing decision and fails epistemic transparency as currently implemented. C2 has not been ruled out anywhere and has no shipped precedent either way.
- **Timescale:** relevant only as a proxy for context discontinuity, not as an operative threshold in its own right; an arbitrary timeout is not architecturally supported.
- **Surviving candidates:** A, B, and C2 all survive scrutiny for Journey 4; C1 survives only in a bounded form not yet built for that context. D is foreclosed by already-adopted text. E (context-dependent, sharing one principle) is the model the evidence actually points to.
- **Shared / context-sensitive / separate:** **context-sensitive under one shared principle** - not fully shared (the mechanisms already differ in shipped code) and not fully separate (both are instances of the same adopted Evidence Boundary concern).
- **Where the repository does not support a conclusion:** which specific mechanism (A, B, or C2) should govern Journey 4 is **UNRESOLVED** - reported as such rather than forced. This determination is left for a future Journey 4 Reconciliation, consistent with this document's read-only, non-reconciling scope.
