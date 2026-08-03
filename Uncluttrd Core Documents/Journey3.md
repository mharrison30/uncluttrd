# Journey 3 — Today's Focus

Status: Authoritative implementation specification
Source: Journey 3 wireframe (verified primary artifact)
Governed by: ArchitecturalReasoningStandard.md

This document follows ArchitecturalReasoningStandard.md's bracketed claim-type notation (`[Observation]`, `[Inference]`) throughout. Per that Standard's governing rule for evidence, nothing here is corrected, modernized, or reconciled against current architecture - see Section 6 for why.

---

## 1. Purpose

This document faithfully records the verified Journey 3 wireframe artifact: its screen structure, its exact copy, and its own stated design rationale. It is not a redesign, and it is not a reconciliation against current architecture or terminology. Where the artifact is silent on something, that is recorded as an open question (Section 5), not filled in. Where the artifact resembles, extends, or conflicts with currently documented architecture, that is recorded as a comparison (Section 6), not resolved. Resolution belongs to a future Journey 3 Reconciliation document, not to this one.

---

## 2. Artifact Provenance

[Observation] The artifact is a single wireframe image titled "Journey 3 — Today's Focus," depicting six sequential phone screens, a right-side flow diagram, and several page-level callouts.

[Observation] This artifact was uploaded directly into conversation and, separately, read directly from its committed file for this document - the content recorded in Sections 3-5 below was read directly from the image itself, not reconstructed from memory or from a prior description of it.

[Observation] The artifact is committed to the repository at `Uncluttrd Core Documents/Mock Ups/Journey3 wireframe.png` (its actual on-disk name; note the space rather than underscore separators). Its PNG file signature was verified directly before this document was written. It was committed in `feeaf58c1aaef3264a446e9a778c9b1913761bf5`, "Promote verified Journey 1-6 wireframes from conversation to durable storage." The file's own modification timestamp is 2026-07-26 17:40 local time.

[Observation] The artifact's own "Journey 3 Flow" diagram (O24-O32 below) shows "Return from Journey 2" as its first, topmost step - the artifact's own stated entry point into this journey.

---

## 3. Observations

Numbered for traceability from Section 4.

### 3.1 Page-level elements

- **O1** [Observation] The page title reads "Journey 3 — Today's Focus" (em dash).
- **O2** [Observation] Below the title: "Companion shows one trustworthy action at a time."
- **O3** [Observation] A box in the top-right of the page is headed "What We Never Show," listing five items, each preceded by a circle-x icon: "Step numbers," "Total steps," "Plans or checklists," "Estimates or scores," "Impact, priority, difficulty."
- **O4** [Observation] A row of four tiles appears below the title, each with an icon, a bold title, and a short subtext:
  1. Eye icon - "Evidence First" - "We observe, then recommend."
  2. Target icon - "One Action" - "Only the next trustworthy action."
  3. Speech-bubble icon - "No Overclaims" - "We say what's true. Nothing more."
  4. Cycle/refresh icon - "Adaptive" - "Actions emerge from current evidence."

### 3.2 The six phone screens

- **O5** [Observation] Every one of the six phone screens shares the same header pattern: a hamburger/menu icon (not a back arrow or X, unlike Journey 1 and Journey 2's camera screens), a coffee-cup icon, the text "Coffee Station," and a three-dot overflow menu icon - in that order, on every screen.
- **O6** [Observation] Screen 1, "1. Analyzing": below the header, "Analyzing today's photo..."; a magnifying-glass icon inside a circle; "Finding the best place to begin."; three loading dots (two filled, one lighter). Caption below the phone: "A pure activity state. No progress, no narration about AI."
- **O7** [Observation] Screen 2, "2. Today's Focus": below the header, bold heading "Today's Focus"; a divider line; a card with a sparkle icon and the bold text "Clear the items from the front of the countertop."; below the card, "This will make the space easier to work with and reveal what still needs attention."; a button reading "Start"; a text link reading "Not right now." Caption: "One action. A clear reason. No claims beyond the evidence."
- **O8** [Observation] Screen 3, "3. Action Complete": below the header, a green checkmark inside a circle; bold heading "Nice."; a divider; "Whenever you're ready, show me the space again."; a button reading "Take Updated Photo"; a text link reading "Pause Session." Caption: "We do not assume. We verify with new evidence."
- **O9** [Observation] Screen 4, "4. Reanalyzing": below the header, "Looking again..."; a refresh/loop icon inside a circle; the same three-dot loading indicator as O6. Caption: "Short transition. No narration about AI."
- **O10** [Observation] Screen 5, "5. Next Focus": below the header, bold heading "Today's Focus" - the same heading text as Screen 2 (O7), even though this screen's own step label is "Next Focus"; a divider; a card with a sparkle icon and the bold text "Put the mugs back into the cabinet."; below the card, "The counter is clear enough to do this without moving anything else."; a button reading "Continue" - different label text than Screen 2's "Start" (O7); a text link reading "Pause Session." Caption: "A new recommendation, earned from updated evidence. Nothing promised beyond this."
- **O11** [Observation] Screen 6, labeled "Final Screen — Session Complete": below the header, bold heading "Today's Session" - a third distinct heading variant, different from both "Today's Focus" (O7, O10) and from this screen's own step label "Session Complete"; a green leaf icon inside a circle; "I don't have another trustworthy action to suggest based on what I can see."; "If something changes, or you'd like another set of eyes later, we can continue from here."; a button reading "See Before & After"; a text link reading "Finish." Caption: "Completion means no further trustworthy action exists based on what I can see, not that the space is 'done.'"

### 3.3 Journey 3 Flow (right-side diagram)

- **O12** [Observation] A vertical flow diagram headed "Journey 3 Flow" shows the following boxes, top to bottom, connected by arrows: a camera icon labeled "Return from Journey 2" (light blue/lavender box); a dotted-circle icon labeled "Analyze" (outline box); a sparkle icon labeled "Today's Focus" (green-tinted box); a person icon labeled "User acts" (tan/cream box); a camera icon labeled "Updated Photo" (light blue box); a dotted-circle icon labeled "Analyze Again" (outline box); a sparkle icon labeled "Today's Focus" again (green-tinted box, second occurrence).
- **O13** [Observation] From this second "Today's Focus" box, a dashed arrow labeled "(repeat)" curves back up to the "User acts" box, forming a loop. The same second "Today's Focus" box also continues downward via a solid arrow to a leaf icon labeled "No further trustworthy action" (light purple box), then to a flag icon labeled "Session Complete" (white box).

### 3.4 Bottom callouts

- **O14** [Observation] A section headed "Key Principles in Action" lists five items, each preceded by a checkmark: "We observe before we interpret." / "We recommend one action at a time." / "We never promise future steps." / "We make no claims beyond what evidence supports." / "We complete the session when no further trustworthy action exists based on what I can see."
- **O15** [Observation] A section headed "Open Design Question (Pacing)" reads: "After an action is complete, should Companion require a new photo every time (evidence-first), or present the next action immediately and verify later (trust-then-verify)?" followed by "This is an interaction design decision, not an architectural one."
- **O16** [Observation] A blue-tinted box headed "Status" reads: "Architecture Validated — Copy & Interaction Refinement" (bold), followed by "Structure is sound. Now refining copy and interaction pacing."

---

## 4. Inferences

Each traceable to specific observations above.

- **[Inference]** The flow diagram's loop (O12-O13) shows that after a "Today's Focus" recommendation and a user action, the journey can either repeat (return to "User acts" for another round) or terminate (proceed to "No further trustworthy action" / "Session Complete") - both are live possibilities from the same point in the flow, not a strictly linear sequence. *(Based on O12, O13.)*
- **[Inference]** The button label difference between Screen 2's "Start" (O7) and Screen 5's "Continue" (O10) suggests the first action in a session and later actions may be treated as distinct moments with distinct call-to-action wording, though the artifact does not state this as a rule. *(Based on O7, O10.)*
- **[Inference]** "Today's Focus" (O7, O10) is used as the heading for any screen presenting a single recommended action, regardless of whether it is the first action of the session or a later one - the same heading text appears on both. *(Based on O7, O10.)*
- **[Inference]** The consistent per-screen header (O5) - hamburger icon, "Coffee Station" with its icon, three-dot menu, present identically on all six screens - indicates the active Location is treated as a stable, always-visible piece of context for the duration of this journey, not something shown only once or only on certain screens. *(Based on O5.)*
- **[Inference]** "Pause Session" (O8, O10) appearing on both the post-action screen and the next-focus screen suggests pausing is available at more than one point in the loop, not only at a single designated exit screen. *(Based on O8, O10.)*

---

## 5. Open Questions / Ambiguities

The artifact's own explicitly stated open question, followed by other genuinely unaddressed points. Recorded as observations about the source artifact, not resolved here.

- **[Observation]** The artifact itself explicitly poses one open question, in its own words, and explicitly marks it as non-architectural (O15): "After an action is complete, should Companion require a new photo every time (evidence-first), or present the next action immediately and verify later (trust-then-verify)? ... This is an interaction design decision, not an architectural one." The artifact does not answer this question; both options remain live per the artifact's own framing.
  - **[Observation]** A Stage 1 verification pass checked this question against DecisionLog.md's "2026-07-26 — Session Generation and Session Presentation Are Separate Architectural Concerns" entry, on the hypothesis that the entry might already settle this question. Result: related, not the same decision - the entry settles a coarser question (no complete/upfront plan is ever shown; one action at a time) but does not specify the timing relationship between "observe again" and "recommend one trustworthy action" within a single cycle, which is exactly what this pacing question asks. The question remains NOT SETTLED by that entry.

    One further interpretive thread was identified and deliberately left open rather than resolved: the entry's "Revisit when" clause states, "Revisit only if the product later gains reliable, user-visible evidence that can support stable future actions, such as continuous visual observation or explicit user confirmation of the complete session strategy." Whether "continuous visual observation" functions as a gating condition specifically bearing on this pacing question (evidence-first vs. trust-then-verify), or is an example belonging to a different concern (e.g., what might eventually justify showing more than one action at once), has not been determined. This requires close reading of the sentence's logical structure ("only," "such as," "or") in a future session, not assumed either way.

    - **[Observation]** An independent, second close-reading pass (conducted without reference to the first) reached the same conclusion: "continuous visual observation" and "explicit user confirmation of the complete session strategy" are parallel examples of one condition - evidence sufficient to support a *sequence* of future actions (plan visibility), not evidence bearing on the timing of a single next action. The sentence does not gate this pacing question in either direction. This interpretive thread is now closed; the pacing question remains NOT SETTLED, unresolved by any existing repository decision.
  - **[Observation]** A screen-ownership verification pass found that this pacing question presupposes the exact transition Screen 3 ("Action Complete") depicts - one action finishes, then a decision about whether a new photo gates the next single action. Screen 3 has no shipped analog at all: no per-single-item completion screen exists anywhere in the current Companion loop (`toggleBatchItem` is a local checkbox toggle with no screen transition; the photo-submission moment is gated on the entire batch being resolved, not one item). This is a real scope implication, not resolved here: if the transition point this question is about doesn't currently exist, the question as posed may not describe a live decision in current architecture. Whether a restated, batch-level version of this question would still apply is not addressed - that would be design work, out of scope for this document.
  - **[Observation]** SETTLED. Resolved by DecisionLog.md's "2026-07-31 - Journey 3 - Batch Is the Unit of Recommendation Applicability" and "2026-07-31 - Journey 3 - Mismatched Items Must Be Surfaced, Not Silently Reconciled." The pacing question is resolved as trust-then-verify at the batch grain, bounded by the next photo: the batch, not the individual item, is the unit of recommendation applicability, and all items remain actionable for the duration of the session without a new photo between individual completions. This is kept within the Evidence Boundary not by proving item independence in advance, but by mismatch surfacing rather than silent reconciliation - a fresh photo showing a previously "checked" item was not actually addressed now resurfaces that item until the user explicitly dismisses or completes it, superseding the prior "don't call out the discrepancy" prompt instruction. This settles the question in the form it actually takes in current architecture - the batch-level restatement - not the original single-item form, which remains without a shipped analog per the finding immediately above.
- **[Observation]** The artifact does not state what "Pause Session" (O8, O10) actually does - whether it behaves like the pause mechanism described elsewhere in the project, ends the screen entirely, or something else.
- **[Observation]** The artifact does not state what happens when "Not right now" (O7) is tapped on Screen 2 - whether this skips to a different action, ends the session, or does something else.
- **[Observation]** The artifact does not state what "See Before & After" (O11) actually shows or does.
  - **[Observation]** A screen-ownership verification pass found Screen 6 to be superseded, specifically by the already-shipped `CompanionCompletedSummary` component (not `CompanionWrapUp`, which governs a different concern - unresolved-item handling, not final completion). This is no longer an open Journey 3 question: the current behavior for this moment lives in `CompanionCompletedSummary`'s already-shipped functionality, not as an unresolved Journey 3 design gap.
- **[Observation]** The artifact does not state why Screen 2 uses "Start" while Screen 5 uses "Continue" (O7, O10) for what otherwise appears to be the same kind of action-presentation moment - whether this is a deliberate first-action/later-action distinction or an inconsistency in the artifact itself is not addressed.
  - **[Observation]** A screen-ownership verification pass found Screen 5 to be superseded (the moment it depicts is BatchChecklist territory, not a single card). Comparing a still-relevant screen (Screen 2, itself only Ambiguous, not confirmed current) against a superseded one (Screen 5) is no longer a live Journey 3 scope question in its original form.
- **[Observation]** The artifact does not explain why Screen 6 uses "Today's Session" (O11) while Screens 2 and 5 use "Today's Focus" (O7, O10) - three different heading strings appear across the six screens for related but distinct moments, and the artifact does not state whether this is intentional.
  - **[Observation]** A screen-ownership verification pass found this question spans one Ambiguous screen (2) and two superseded screens (5, 6). A terminology-consistency question across screens where two-thirds are no longer current is no longer a live Journey 3 scope question as posed.

---

## 6. Relationship to Current Architecture

Per ArchitecturalReasoningStandard.md's Evidence Confidence Hierarchy, comparisons below are Level 1 - Resemblance only unless stated otherwise. Nothing below is resolved; that is explicitly deferred to a future Journey 3 Reconciliation document, per the task that produced this one.

### 6.1 Match: DecisionLog.md, "Session Generation and Session Presentation Are Separate Architectural Concerns" (2026-07-26)

[Observation] That entry's "Use instead" line states: "The interface may show Today's Focus, the current action, practical guidance for that action, Retake or refresh evidence controls where required, Pause or adjust controls, and the next action once it becomes trustworthy." Every element it names is directly present in this artifact: the "Today's Focus" heading (O7, O10), a single current action with guidance text (O7, O10), a retake/refresh-evidence control ("Take Updated Photo," O8), pause controls (O8, O10), and a next action once evidence supports one (O10, via the reanalyze loop O9). This is a close textual match. It is recorded at Level 1 - Resemblance, not higher: this DecisionLog entry and the wireframe's own file modification date are both 2026-07-26, the same day - same-day artifacts are not easier to treat as independently corroborating than harder, for the same reason noted in Journey2.md's comparable finding. No provenance evidence was reviewed establishing which, if either, came first or influenced the other.

[Observation] The same DecisionLog entry's "Consequence - No 'Today's Plan' Screen" states: "There is no legitimate list-of-steps screen to redesign. It is removed entirely." This matches the artifact's own "What We Never Show" callout (O3: "Plans or checklists") and "Key Principles in Action" (O14: "We recommend one action at a time").

### 6.2 Conflict: Journey5.md, "Journey 3 Reconciliation," and the Companion batch workflow decision

[Observation] Journey5.md's "Journey 3 Reconciliation" (dated by that document's own file modification date, 2026-07-27 - one day after this artifact's 2026-07-26 date) states: "The single-trustworthy-action philosophy governs the first action of a session. After that, BatchChecklist is the documented execution exception for the remainder of the session. The underlying Recommendation object remains the same throughout."

[Observation] Nothing in this artifact shows or references a BatchChecklist, a multi-item list, or any screen presenting more than one action at a time, at any point in its six screens or its flow diagram - including Screen 5 ("Next Focus," O10), which is explicitly *after* the first action and still presents exactly one action, styled identically to Screen 2's first action. The artifact's "What We Never Show" callout (O3) explicitly lists "Plans or checklists" as something never shown, without qualifying that this applies only to the first action of a session.

[Observation] DecisionLog.md's "2026-07-18 — Companion batch workflow" entry - dated over a week before this artifact's 2026-07-26 file date - already establishes the batch model ("analyzePhoto/generateNextAction return a balanced session's worth of checklist items instead of one action") as the then-current design for the Companion loop generally.

This is recorded as a direct conflict, not a resemblance question, and is not resolved here: this artifact's own single-action-only structure, for every screen including screens after the first action, does not match Journey5.md's later "Journey 3 Reconciliation" statement that BatchChecklist governs "the remainder of the session" after the first action - a statement that itself postdates this artifact by one day. The artifact's own "Status" box (O16) states "Architecture Validated" as of its creation, which was after the batch-workflow decision already existed in DecisionLog.md. Whether Journey5.md's reconciliation note was written specifically to address this exact tension is not established here; only the dates and the textual conflict are recorded.

[Observation] A Stage 1 classification pass, run against this conflict, concluded: Architecture conflict, not "unresolved" or "something else." The timing-lag explanation (that Journey 3's screens simply hadn't caught up to an already-approved batch decision) is ruled out directly - commit 3948c07, "Implement the Companion batch workflow (Session 2)," the exact implementation named as pending in the 2026-07-18 decision, shipped 2026-07-18, over a week before this wireframe's 2026-07-26 file date, and introduces BatchChecklist by name along with the core Companion loop rewrites Journey 3 governs. This artifact's own "Status" box (O16: "Architecture Validated — Copy & Interaction Refinement") is therefore an explicit, unqualified governance claim made at a moment when it was false relative to already-shipped architecture - not a hedge, not a neutral description.

[Observation] This is recorded as one Architecture conflict, not two separate findings, supported by two citations that do different jobs: the 2026-07-18 "Companion batch workflow" entry establishes that the conflict existed and that it predates this artifact; the 2026-07-27 "Journey 3 Reconciliation" in Journey5.md establishes precisely what this artifact's Screen 5 conflicts with (the specific first-action/remainder split that maps directly onto Screen 5's after-the-first-action position).

[Observation] One explicit asymmetry is preserved rather than smoothed over: the 2026-07-18 decision carries stated reasoning, considered alternatives, and a formal "Outcome: Approved" lineage. This artifact's "Architecture Validated" status carries none of that - it is a self-assessment of unestablished provenance. Both sides genuinely govern the same concern incompatibly, which satisfies the Architecture classification, but they are not equally authoritative, and this document does not treat them as such.

[Observation] Why this artifact was built this way - deliberate divergence, oversight, or something else - remains genuinely unestablished by anything in the repository, and is not asserted here.

This conflict is now classified. Resolving it (what Journey 3's actual screens should do given this conflict) remains explicitly deferred to a future Journey 3 Reconciliation document, consistent with how Section 6.2 was originally scoped.

### 6.3 Other resemblances (Level 1)

[Observation] The per-screen "Coffee Station" header (O5) resembles the Space/Location Reference relationship recorded in the 2026-07-30 "Journey 1: Space/Location Relationship" decision, though this artifact never uses either term. This differs structurally from Journey2.md's finding for the Journey 2 wireframe, where the equivalent badge appeared once at the page level rather than repeated per screen (Journey2.md, Section 6) - this artifact and that one show two different presentations of the same underlying Location-context idea, recorded here as a factual difference between artifacts, not evaluated as better or worse.

[Observation] "We observe before we interpret" (O14) and "Evidence First" / "We observe, then recommend" (O4) resemble DecisionLog.md's Evidence Boundary and "Observation Does Not Establish Evaluation" principles (2026-07-26), and the Observation/Inference distinction in ArchitecturalReasoningStandard.md itself. Recorded at Level 1 for the same same-day-dating reason given in 6.1.

[Observation] Neither "Space" nor "Location Reference" nor "Recommendation" nor any other current ObjectModel.md term appears anywhere in this artifact's text - as with Journey1.md and Journey2.md, every resemblance recorded above is structural, not terminological. The artifact's "Today's Focus" card content (O7, O10) - a single action with supporting text - resembles the shape of the settled Recommendation object (Basis, Applies To, Recommendation Text) but does not use that object's field names.
