# Journey 4 Reconciliation — Return Decision

Status: Adopted (production-facing)
Governed by: ArchitecturalReasoningStandard.md
Reconciles: Journey4.md's Section 6.1 Architecture conflict, using RecommendationApplicabilityInvestigation.md's findings

This document follows ArchitecturalReasoningStandard.md's bracketed claim-type notation (`[Observation]`, `[Inference]`, `[Decision]`) throughout. Unlike Journey4.md, this document does resolve its subject - resolution of Journey 4's Section 6.1 conflict was explicitly deferred to a future Journey 4 Reconciliation document; this is that document.

---

## Objective

[Decision] The governing constraint for this reconciliation, stated exactly once: determine the minimum behavioral change required so that resuming a Companion session never implicitly claims that a previously generated recommendation remains trustworthy without current evidence, while preserving the existing persistence model (`currentBatch`, `companionComplete`, resumability, the resume affordance) unless a stronger reason emerges to change them.

---

## Current Architecture (baseline)

Described without criticism - this is the production starting point this reconciliation changes.

[Observation] Every plan document persists a `currentBatch: { batchIndex, suggestedAt, items: [{id, text, status}] }` field, with each item's `status` one of `"pending"`, `"checked"`, `"carried"`, or `"skipped"` (`App.js`).

[Observation] A `companionComplete` boolean field marks a plan as finished and is never cleared once set (`App.js`).

[Observation] `isCompanionResumable(plan)` returns `true` when `companionComplete` is not set, `currentBatch.items` exists and is non-empty, and at least one item's status is not `"pending"` - i.e., the user engaged with the batch before leaving (`App.js`).

[Observation] `resumablePlan = history.find(isCompanionResumable)` surfaces the single most relevant resumable plan on Home. When one exists, a "Continue Your Session" banner renders on Home, showing the plan's `spaceType` as a subtitle (`App.js`).

[Observation] Tapping that banner calls `resumeCompanionSession(item)`, which sets `showCompanion: true`, restores the plan's saved photo (`restorePhotoFromPlan`), and routes the user directly into the Companion loop showing `currentBatch.items` exactly as they were left - no intermediate screen, no confirmation, no new evidence request (`App.js`).

[Observation] Today, a user who taps the resume banner sees and can act on the same checklist they left, with the same photo, regardless of how much time has passed since they left it.

---

## Governing Decision

[Observation] DecisionLog.md's "2026-07-26 — An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object" is Adopted, Class 1 - Forced Discovery.

[Inference] What that decision actually requires, independent of what the Journey 4 wireframe drew or what code currently does: on return from an interruption, Companion may honestly narrate what it previously recommended and may state that it doesn't know what has changed - but it may not imply, by action or by silence, that the prior recommendation remains currently valid. The next interaction "should offer a real choice, such as 'Pick that back up' versus 'Take a fresh look'" - the decision requires a genuine choice to exist, not any particular visual form for that choice. "Pick that back up" itself "must be understood as the user choosing to resume the prior recommendation, not Companion asserting that it is still correct."

[Inference] The decision constrains the *epistemic content* of the interaction (no implicit validity claim, a real choice must exist), not its presentation mechanics (screen, banner, modal, or otherwise). This distinction is what Phase 3 below evaluates.

---

## Gap

[Observation] Production behavior currently resumes as though the previous recommendation remains valid without obtaining current evidence.

---

## Phase 1 — Initial Presentation Exploration (superseded)

[Decision] Three presentation alternatives were considered as direct responses to the Gap, before it became clear that presentation could not be meaningfully resolved without first resolving what "resuming" is even allowed to mean:

- **Initial Design Space A - Full interstitial matching the wireframe.** A dedicated screen, structurally following Journey4.md's transcribed artifact: greeting, uncertainty statement, two equal-weight cards ("Pick that back up" / "Take a fresh look").
- **Initial Design Space B - Two-target banner.** Split the existing "Continue Your Session" banner into two adjacent tap targets on the same Home-screen row, avoiding a new screen entirely.
- **Initial Design Space C - Forced silent refresh.** Require a new photo automatically before any resume is permitted, with no user-facing choice at all.

[Decision] Initial Design Space C was rejected outright, immediately, and remains rejected - it is not revisited in Phase 3. It removes the choice rather than adding the missing confirmation, which directly contradicts the governing decision's explicit requirement of "a real choice." Solving the Gap by eliminating the decision point is not a solution to the Gap as the governing decision defines it.

This exploration was intentionally suspended when it became clear that presentation depended on an unresolved Recommendation Applicability question. The options above are preserved for historical completeness but are superseded by the Applicability Investigation and the resumed presentation evaluation later in this document.

---

## Phase 2 — Recommendation Applicability Investigation

[Observation] See `RecommendationApplicabilityInvestigation.md` for the full seven-task investigation; its content is referenced here by name and not duplicated.

[Inference] That investigation's conclusion, as it applies to Journey 4: one shared, already-adopted principle - no unconfirmed applicability may be presented as confirmed - governs both Journey 3 and Journey 4, satisfied through context-specific mechanisms rather than one uniform mechanism. Journey 3 already satisfies it through a mandatory fresh-evidence gate (`submitCompanionProgressPhoto`) softened by silent reconciliation against self-reports. Journey 4 currently satisfies it through nothing - the confirmed Architecture conflict this reconciliation addresses.

[Decision] For Journey 4 specifically, **Applicability Model B is adopted**, reframed during this reconciliation from "explicit confirmation" to **"explicit assumption of historical context."** The reframing matters: the user is not confirming that the prior recommendation is true, only choosing to proceed from it as a known starting point. This distinction is what keeps the model honest under the governing decision's own text ("must be understood as the user choosing to resume the prior recommendation, not Companion asserting that it is still correct").

[Inference] Model B is adopted, directly, for three reasons: (1) it matches the governing decision's own prescribed language exactly - "Pick that back up" is already how that decision frames this choice; (2) it requires no new Recommendation state, unlike transparent trust-then-verify (Model C2), which would require modeling a provisional/confirmed status that does not exist anywhere in `ObjectModel.md` or shipped code today; (3) it composes naturally with the already-shipped reconciliation `submitCompanionProgressPhoto` performs at the next natural evidence boundary - no new reconciliation mechanism is needed, only a gate on when the user is allowed to reach that mechanism without first being told what Companion doesn't know.

[Inference] Applicability and presentation are different questions. Resolving which model governs applicability (this section) does not by itself determine what screen, banner, or interstitial expresses that model to the user (Phase 3).

[Inference] Model A (evidence-first) was directly considered and found to go further than the governing decision actually requires: forcing fresh evidence before any resume is possible eliminates the choice rather than making it informed, which is not what the governing decision asks for. This is a materially different failure than Initial Design Space C's failure above, but the same underlying objection - removing the choice is not a permitted way to close the Gap.

[Inference] Applicability Models C1 (silent trust-then-verify, unbounded form), C2 (transparent trust-then-verify), D (history-only review), and E (context-dependent model) were each addressed in the source investigation and are carried forward into this reconciliation's Terminology Correspondence Table below rather than re-argued here: C1's unbounded form is what production currently, effectively does by default, and is what this reconciliation replaces; C2 was considered and not adopted, for the new-state reason given above; D was already found foreclosed by the governing decision's own text, independent of this reconciliation; E is the meta-model this reconciliation instantiates - Journey 4 adopts its own mechanism (B) under the same shared principle Journey 3 already satisfies through a different mechanism.

[Decision] The non-negotiable requirement carried forward into Phase 3: the uncertainty disclosure - that Companion does not know what changed during the interruption - must be co-located with the choice itself, visible at the moment the user decides. Without this, any mechanism collapses back into an extra tap in front of an equally permissive destination, which is the same failure the two-target banner (Initial Design Space B) risks below.

---

## Phase 3 — Presentation Revisited

[Decision] Interstitial vs. expanded banner (Initial Design Space B, reconsidered under the Phase 2 requirement) are evaluated against three requirements:

1. **Disclosure** - the user sees that Companion doesn't know what changed.
2. **Real choice** - both paths are explicit and available, not one default plus a buried alternative.
3. **No false validation** - choosing the historical path communicates "use this as my starting context," not "this recommendation has been confirmed as currently correct."

[Inference] An expanded banner can be made to satisfy all three requirements only by growing to contain: the uncertainty disclosure text, two distinct labeled actions, and framing language separating "starting context" from "confirmed current state." Once a banner carries that much content, it is no longer a compact discovery affordance - it functionally becomes a small interstitial rendered inline, which undermines the original appeal (avoiding a new screen) that made the banner form attractive in the first place.

[Decision] The full interstitial (Initial Design Space A) is adopted. It is the only form that satisfies all three requirements without distorting the shape of the element that was supposed to remain simple (the Home resume banner).

[Decision] Adopted flow: **Home resume banner → Return Decision interstitial → (Resume using this effort's historical context, which invokes `resumeCompanionSession` / OR Take a fresh look, which invokes the fresh-evidence path).** The Home banner's role narrows from "resume directly" to "surface that a resumable session exists and open the Return Decision interstitial" - it remains the discovery mechanism, not the action itself. "This effort's historical context" is deliberately not called "session context" - Session is a temporary concept, not durable memory (`ObjectModel.md`), while what actually persists across the interruption is scoped to the ongoing organizing effort itself. It is also deliberately not called "Project context" - Project has no implementation yet, confirmed this session (no `spaceId` field, no `spaces` collection, no Location Reference implementation anywhere), so naming it "Project" here would overclaim architecture that doesn't exist in shipped code. "This ongoing effort" is the honestly-scoped interim term until Project is real.

[Decision] "Take a fresh look" is specified here for the first time - this document previously named the fresh-evidence path without defining it, a real specification gap this closes, not merely an apparent one. The fresh-evidence path captures new evidence (a new photo) within the SAME ongoing effort. It does not end, close, or supersede the current effort, and it does not trigger the Superseded or Abandoned acknowledgment machinery (`DecisionLog.md`, "Project Scope Model - Space or Location Reference, Not Space-Only") - no new effort begins here, so no scope conflict exists to acknowledge.

[Observation] This is grounded directly in two already-existing pieces of evidence, not invented here. (a) Journey4.md's own transcribed wireframe copy, O9: "We'll take a fresh look at the Space" - the artifact's own words describe looking again at the same Space, never "start over" or an equivalent phrase. (b) The prior ownership-pass investigation's explicit finding that `startOverBtn` is not the correct analog for this path, since it "discards Space identity entirely... rather than merely discarding stale evidence while keeping the same Space."

---

## Recommendation

[Decision] Adopt a dedicated Return Decision interstitial, reached by tapping the existing Home resume banner, co-locating the uncertainty disclosure with two explicit paths, framed as the user choosing to continue using this effort's historical context rather than confirming the prior recommendation's validity.

---

## Consequences

**Changes:**
- The Home resume banner no longer routes directly into `resumeCompanionSession()`.
- A dedicated Return Decision state is inserted between the resume affordance and Companion.
- `resumeCompanionSession()` becomes the implementation of the "Resume using this effort's historical context" branch, not the direct banner action - a change in architectural responsibility, not necessarily in the function's internal logic.

**Preserved:**
- `currentBatch`, `companionComplete`, `isCompanionResumable`, and the resumability computation.
- The Home resume banner as the discovery/entry mechanism.
- Later reconciliation through `submitCompanionProgressPhoto` - no new reconciliation mechanism needed.

---

## Why This Is the Minimum Change

[Inference] This satisfies the Objective's constraint directly: it preserves persistence, preserves resumability, preserves the existing data model, restores the Evidence Boundary, and reuses an existing shipped uncertainty-resolution pattern - explicit user interaction, the same family as Journey 2's recovery flows ("Not now" pause-not-cancel) and the batch model's carried-item mechanism - rather than inventing a new one. It requires no new Recommendation object state, and introduces exactly one new interaction state (Return Decision) rather than a redesign of anything else already working.

---

## Terminology Correspondence Table

| Candidate | Origin | Final terminology | Status |
|---|---|---|---|
| Initial Design Space A (full interstitial matching the wireframe) | Phase 1 | Return Decision interstitial | **Adopted** (revisited and adopted in Phase 3, after being superseded pending Phase 2) |
| Initial Design Space B (two-target banner) | Phase 1 | Expanded banner | **Rejected** (Phase 3 - collapses into a small interstitial once it satisfies all three presentation requirements, undermining its own appeal) |
| Initial Design Space C (forced silent refresh) | Phase 1 | Forced silent refresh | **Rejected** (Phase 1, outright and final - eliminates the required choice; not revisited) |
| Applicability Model A (Evidence-first) | RecommendationApplicabilityInvestigation.md | Evidence-first | **Considered - not adopted** for Journey 4 (goes further than the governing decision requires; eliminates the choice rather than informing it) |
| Applicability Model B (Explicit confirmation) | RecommendationApplicabilityInvestigation.md | **Explicit assumption of historical context** | **Adopted** for Journey 4 (reframed this reconciliation; matches governing decision's own language, no new Recommendation state, composes with existing `submitCompanionProgressPhoto` reconciliation) |
| Applicability Model C1 (Silent trust-then-verify, unbounded form) | RecommendationApplicabilityInvestigation.md | Silent trust-then-verify (unbounded) | **Rejected** (this is what production currently, effectively does by default; replaced by Model B's explicit choice) |
| Applicability Model C2 (Transparent trust-then-verify) | RecommendationApplicabilityInvestigation.md | Transparent trust-then-verify | **Considered - not adopted** for Journey 4 (would require new Recommendation object state not currently modeled anywhere) |
| Applicability Model D (History-only review) | RecommendationApplicabilityInvestigation.md | History-only review | **Not applicable** to Journey 4 (already foreclosed by the governing decision's own text, independent of this reconciliation) |
| Applicability Model E (Context-dependent model) | RecommendationApplicabilityInvestigation.md | Context-dependent model | **Adopted** as the governing meta-framework (this reconciliation is Journey 4's instance of E; Journey 3 continues under its own already-shipped mechanism, both under one shared principle) |
| Applicability Model F (Other) | RecommendationApplicabilityInvestigation.md | Other | **Not applicable** (no repository evidence supported any model outside A-E; unused) |
