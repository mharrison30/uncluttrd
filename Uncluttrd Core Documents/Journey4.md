# Journey 4 — Return After Interruption

Status: Authoritative implementation specification
Source: Journey 4 wireframe (verified primary artifact)
Governed by: ArchitecturalReasoningStandard.md

This document follows ArchitecturalReasoningStandard.md's bracketed claim-type notation (`[Observation]`, `[Inference]`) throughout. Per that Standard's governing rule for evidence, nothing here is corrected, modernized, or reconciled against current architecture - see Section 6 for why.

---

## 1. Purpose

This document faithfully records the verified Journey 4 wireframe artifact: its screen structure, its exact copy, and its own stated design rationale. It is not a redesign, and it is not a reconciliation against current architecture or terminology. Where the artifact is silent on something, that is recorded as an open question (Section 5), not filled in. Where the artifact resembles, extends, or conflicts with currently documented architecture, that is recorded as a comparison (Section 6), not resolved. Resolution belongs to a future Journey 4 Reconciliation document, not to this one.

---

## 2. Artifact Provenance

[Observation] The artifact is a single wireframe image titled "Journey 4 — Return After Interruption," subtitled "Wireframe v1.1 (Neutral Choices)," depicting one screen: a header, a central greeting-and-choice area, a bottom navigation bar, a set of left-margin annotation callouts, a set of right-side explanatory panels, and two bottom notes boxes.

[Observation] This artifact was inspected directly from its committed file for this document - the content recorded in Sections 3-5 below was read directly from the image itself, not reconstructed from memory or from a prior description of it.

[Observation] The artifact is committed to the repository at `Uncluttrd Core Documents/Mock Ups/Journey4 wireframe.png` (its actual on-disk name; note the space rather than underscore separators). Its PNG file signature was verified directly before this document was written. It was committed in `feeaf58c1aaef3264a446e9a778c9b1913761bf5`, "Promote verified Journey 1-6 wireframes from conversation to durable storage." The file's own modification timestamp is 2026-07-26 18:15:07 -0400.

[Observation] DecisionLog.md's entry "2026-07-26 — An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object" was recorded in commit `90d41ad590662b8fbc71447f79c44c44c44d7efc`, dated 2026-07-26 18:12:53 -0400. This artifact's file modification timestamp (18:15:07) falls 2 minutes 14 seconds after that commit's timestamp. This is recorded here solely as provenance about the artifact's creation context. No conclusion about consistency or inconsistency between the artifact and that entry is drawn in this section - see Section 6.

---

## 3. Observations

Numbered for traceability from Section 4.

### 3.1 Page-level elements

- **O1** [Observation] The page title reads "Journey 4 — Return After Interruption" (em dash).
- **O2** [Observation] Below the title, in smaller gray text: "Wireframe v1.1 (Neutral Choices)."

### 3.2 App header (within the mocked screen)

- **O3** [Observation] A header bar contains, left to right: a hamburger/menu icon, the text "Companion," then on the right side a bell icon, the text "Kitchen" followed by a downward-chevron icon, and a circular icon containing a person silhouette.

### 3.3 Central content

- **O4** [Observation] Centered above the heading, a small cluster of sparkle/star-shaped icons (one larger, several smaller).
- **O5** [Observation] Below the sparkle icons, a large bold heading: "Welcome back."
- **O6** [Observation] Below the heading, plain body text: "Last time, I suggested clearing the countertop."
- **O7** [Observation] Below that, in a lighter blue-gray color distinct from O6's text color: "I'm not sure what's changed while you were away."

### 3.4 The two choice cards

- **O8** [Observation] A left card: a camera icon, bold text "Pick that back up," and below it "Continue from the last recommendation I shared."
- **O9** [Observation] A right card, positioned beside the left card: a magnifying-glass icon, bold text "Take a fresh look," and below it "We'll take a fresh look at the Space."
- **O10** [Observation] The two cards share the same size, border style (rounded rectangle, thin dark outline), internal padding, icon size, and text alignment, and are positioned side by side at equal width.

### 3.5 Bottom navigation bar

- **O11** [Observation] Below the two cards, a horizontal row of five icon-and-label pairs, left to right: a house icon labeled "Home" (rendered in blue, distinct in color from the other four), a grid icon labeled "Spaces," a calendar icon labeled "Routines," a clock icon labeled "History," and a gear icon labeled "Settings."

### 3.6 Left-margin annotation callouts

Each of the following is a bold label with a short explanatory line beneath it, connected by a leader line/dot to a specific point on the mocked screen.

- **O12** [Observation] "History Context," pointing to the "Welcome back." heading area: "Neutral narration of what Companion knows. No claims about current state."
- **O13** [Observation] "Uncertainty," pointing to the "I'm not sure what's changed while you were away" line (O7): "Direct statement of unknown current state. No assumption of validity."
- **O14** [Observation] "Equal Visual Weight," pointing to the two cards: "Identical size, stroke, spacing, and visual treatment."
- **O15** [Observation] "Equal Interaction Cost," pointing to the two cards: "Whole card is the tap target. No button styling or hierarchy."
- **O16** [Observation] "Equal Order": "Options displayed in the same order every time."

### 3.7 Right-side panels

- **O17** [Observation] A box headed "LAYOUT NEUTRALITY" lists seven items, each preceded by a green checkmark icon: "Both options same size" / "Both options same visual weight" / "Both options same spacing" / "Neither visually emphasized" / "No default focus indicated" / "Order consistent every time" / "No animation or motion emphasis."
- **O18** [Observation] A box headed "LANGUAGE NEUTRALITY" lists five items, each preceded by a green checkmark icon: "Both verbs equally weighted" / "No wording implies preference" / "No wording implies responsibility" / "No wording implies likelihood" / "Neutral framing throughout."
- **O19** [Observation] A box headed "WHAT COMPANION KNOWS" lists three plain bullet items: "A recommendation was previously shown" / "User chose to leave the session" / "No further evidence was collected."
- **O20** [Observation] A box headed "WHAT COMPANION DOES NOT KNOW" lists four plain bullet items: "Whether recommendation is still valid" / "What changed while user was away" / "User intent" / "Work completed."
- **O21** [Observation] A blue-tinted box with a shield icon, headed "EVIDENCE BOUNDARY," reads: "This screen stays within what Companion knows. No assumption. No overclaim."
- **O22** [Observation] A box headed "ICON LEGEND" lists two entries, each with its icon: a camera icon labeled "History (previous recommendation)"; a magnifying-glass icon labeled "Fresh Evidence (new look)."

### 3.8 Bottom notes boxes

- **O23** [Observation] A box headed "NOTES" lists three bullet items: "This screen is shown after an interrupted session when the user returns." / "Companion presents history as context, not as current truth." / "User chooses next step. Companion does not recommend."
- **O24** [Observation] A box headed "BEHAVIOR" lists three bullet items: "Selecting an option proceeds to the next screen relevant to that choice." / "Neither option is favored or recommended." / "Companion does not store an 'In Progress' state."

---

## 4. Inferences

Each traceable to specific observations above.

- **[Inference]** The two cards' matching size, border treatment, icon size, and spacing (O10), together with the "Equal Visual Weight," "Equal Interaction Cost," and "Equal Order" annotations (O14-O16) and the "LAYOUT NEUTRALITY" / "LANGUAGE NEUTRALITY" checklists (O17-O18), indicate that avoiding bias toward either option is a deliberate design goal of this screen, not an incidental styling choice. *(Based on O10, O14-O18.)*
- **[Inference]** The explicit split between "WHAT COMPANION KNOWS" (O19) and "WHAT COMPANION DOES NOT KNOW" (O20), together with the "EVIDENCE BOUNDARY" callout (O21), indicates the screen's content is deliberately scoped to confirmed historical facts, with unknowns stated explicitly rather than left implicit. *(Based on O19-O21.)*
- **[Inference]** The icon legend's association of the camera icon with "History (previous recommendation)" (O22), together with its use on the left card (O8), indicates the camera icon on this screen symbolizes continuity with prior context rather than an invitation to capture a new photo directly from this screen. *(Based on O8, O22.)*
- **[Inference]** The icon legend's association of the magnifying-glass icon with "Fresh Evidence (new look)" (O22), together with its use on the right card (O9), indicates the icon symbolizes gathering new evidence rather than a literal search function. *(Based on O9, O22.)*
- **[Inference]** The "BEHAVIOR" statement that "Companion does not store an 'In Progress' state" (O24), combined with the "NOTES" statement that "Companion presents history as context, not as current truth" (O23) and the "History Context" annotation (O12), indicates the artifact's intent is for this screen's copy to describe only past events and present uncertainty, never to imply a currently tracked session state. *(Based on O12, O23, O24.)*
- **[Inference]** The "Home" icon's distinct coloring within the bottom navigation row (O11) suggests this screen is understood, within the artifact, as a state reachable from the Home tab specifically, rather than a separate top-level destination. *(Based on O11.)*

---

## 5. Open Questions / Ambiguities

Recorded as observations about the source artifact, not resolved here.

- **[Observation]** The artifact does not show or describe the destination screen for either choice - "Selecting an option proceeds to the next screen relevant to that choice" (O24) is stated, but neither the "Pick that back up" destination nor the "Take a fresh look" destination is depicted.
- **[Observation]** The artifact does not state whether "Take a fresh look" requires the user to take a new photo immediately upon selection, or simply clears prior evidence before eventually prompting for one.
- **[Observation]** The artifact does not address what happens if more than one interrupted session exists at once (e.g., unconfirmed recommendations in more than one Space) - whether this screen would show one, cycle through several, or be scoped per-Space, is not stated.
- **[Observation]** The artifact does not define what triggers this screen to appear versus an ordinary Home view - no elapsed-time threshold, session-boundary definition, or other condition is given for "after an interrupted session" (O23).
- **[Observation]** The bottom navigation bar's other four destinations - Spaces, Routines, History, Settings (O11) - are shown but none of their contents, or their relationship to the "Kitchen" header value, are described by this artifact.
- **[Observation]** The artifact's own subtitle, "Wireframe v1.1 (Neutral Choices)" (O2), implies at least one earlier version existed. The artifact does not state what changed from a prior version or what alternative it is contrasting "Neutral Choices" against.

---

## 6. Relationship to Current Architecture

Per ArchitecturalReasoningStandard.md's Evidence Confidence Hierarchy, comparisons below are Level 1 - Resemblance only unless stated otherwise. Nothing below is resolved; that is explicitly deferred to a future Journey 4 Reconciliation document. This section incorporates the findings of the ownership pass and classification check already completed for this artifact, rather than re-deriving them.

### 6.1 Conflict: shipped auto-resume behavior

[Observation] Shipped code (`isCompanionResumable`, `resumeCompanionSession`, the "Continue Your Session" banner - `App.js`) resumes an interrupted session with a single tap and no intermediate screen, always continuing from the prior recommendation. This artifact's entire premise (O1-O24) is a screen offering an explicit, neutrally-presented choice between continuing and starting fresh. This is a direct conflict, not a resemblance.

[Observation] Chronology rules out the explanation that this artifact simply predates the behavior it conflicts with. The shipped auto-resume mechanism was introduced in commit `8c7a095` (2026-07-13) and last revised in commit `3948c07` (2026-07-18) - both well before this artifact's 2026-07-26 file date. The governing DecisionLog entry, "2026-07-26 — An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object," was itself adopted after the conflicting code already existed, and this artifact's file timestamp follows that entry's commit by 2 minutes 14 seconds (Section 2). No commit has touched the auto-resume mechanism since.

[Observation] Shipped code contains no second user decision point corresponding to this artifact's "Take a fresh look" card. The closest shipped analog, `startOverBtn` ("Analyze a New Space"), exists but performs a materially heavier action - it discards Space identity entirely via `reset()`, rather than merely discarding stale evidence while keeping the same Space, which is what "Take a fresh look" (O9: "We'll take a fresh look at the Space") describes. This is not "nothing resembles it" - it is "the closest thing serves a different function." An alternative reading under which the shipped banner and this artifact answer two different, non-competing questions was directly investigated and rejected on this basis, and on the governing DecisionLog entry's own framing of "Pick that back up" versus "Take a fresh look" as one choice offered at a single interaction, not two sequential decisions.

[Observation] The conflict concerns evidence trust specifically, not merely screen presence. The governing DecisionLog entry states Companion "may not say 'Continue clearing the countertop' - that would claim the old recommendation remains valid without current evidence." Shipped code's unconditional auto-resume does exactly this: it proceeds directly into the prior recommendation with no confirmation step, which functions as an implicit assertion that the old evidence still holds. This reading is stated directly in the governing entry's own reasoning, not inferred from a UI difference alone.

### 6.2 Annotation-by-annotation ownership

[Observation] Layout Neutrality (O17), Language Neutrality (O18), and Equal Visual Weight (O14) currently have no live implementation anywhere in the shipped product - no shipped screen presents two competing options for these principles to apply to. Where a structurally comparable shipped pattern exists (the budget-tier selector), it does the opposite: a "POPULAR" badge and a color highlight on the selected/recommended tier are explicit emphasis, not neutrality. These annotations are contradicted by the closest comparable pattern, not merely absent.

[Observation] Equal Interaction Cost (O15) is partially embodied elsewhere: the budget-tier selector's cards are each a single whole-card tap target, matching this annotation's first half. Its second half - "no button styling or hierarchy" - is not embodied there, since that same selector applies a badge and a selected-state color change.

[Observation] Equal Order (O16) is not contradicted anywhere, but is also not meaningfully live: with no shipped screen presenting competing options at all, there is nothing whose ordering could vary or be tested against this annotation.

### 6.3 Interface chrome and navigation ownership

These additions do not represent new investigation. They complete Section 6's architectural comparison by incorporating already-verified ownership findings from the Journey 4 ownership pass that were intentionally omitted from the initial transcription because the original prompt enumerated Section 6's contents non-exhaustively, and Claude Code correctly did not expand beyond that scope.

[Observation] The hamburger/menu icon (O3) has a shipped analog: a `Menu` icon renders identically on at least six other current screens, including Home (`App.js`). Recorded at Level 1 - Resemblance only, since whether it opens the same kind of menu this artifact implies was not confirmed.

[Observation] The "Companion" wordmark in the header (O3) is Ambiguous. It was not directly located in shipped code during the ownership pass - the app's actual Home header shows "Hi, {name}" followed by hero text (`App.js`), a different header pattern than a static wordmark - but this was not confirmed as a full absence, only as not found where searched.

[Observation] The bell/notification icon (O3) has no shipped analog - zero matches for `Bell` anywhere in `App.js`.

[Observation] The "Kitchen" header dropdown (O3) has no shipped analog - zero matches for any space/location switcher pattern (`activeSpace`, `switchSpace`, `spaceSelector`, `locationDropdown`) anywhere in `App.js`. Separately, and unresolved by the artifact itself: this document does not state the relationship between "Kitchen" (O3) and "the Space" referenced in the right card's subtext (O9) - whether the header value denotes a Space or a Location Reference, or whether the "away"/uncertainty framing (O7) is scoped to this one value specifically or to the user's account generally.

[Observation] The profile/account icon (O3) was not checked during the ownership pass. Its shipped status is unconfirmed, not established either way.

[Observation] The bottom navigation bar (O11: Home / Spaces / Routines / History / Settings) has no shipped analog - zero matches for `"Spaces"` or `"Routines"` as UI labels anywhere in `App.js`, consistent with `App.js`'s conditional-early-return architecture (no persistent tab bar, no router).

[Observation] The central sparkle icon (O4) is a Level 1 resemblance only: a `Sparkles` icon is used in the shipped resume banner (`App.js`) for a comparable "Companion/AI moment" purpose, but in a different layout context - an inline banner icon rather than a standalone icon centered above a full-screen greeting.

### 6.4 Cross-journey pattern

[Observation] This conflict is one of two independently verified cases (alongside Journey 3's batch-workflow conflict) of the same shape: a deliberate, adopted architectural decision requiring a new user-facing confirmation or choice step, where supporting infrastructure shipped but the confirmation step itself did not. See `CrossJourneyFindings.md` for the full record of this pattern, the chronology findings supporting it, and the severity distinction drawn between this conflict (evidence trust) and Journey 3's (execution shape) - not restated here.

This conflict is now classified as an Architecture conflict. Resolving it - what this screen (or its absence) should actually do given the conflict - remains explicitly deferred to a future Journey 4 Reconciliation document.
