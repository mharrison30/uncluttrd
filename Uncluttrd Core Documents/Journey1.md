# Journey 1 — Returning to the Same Space

Status: Authoritative implementation specification
Source: Journey 1 V2 wireframe (the sole verified primary artifact - see Section 2)
Governed by: ArchitecturalReasoningStandard.md

This document follows ArchitecturalReasoningStandard.md's bracketed claim-type notation (`[Observation]`, `[Inference]`) throughout, since observations, inferences, and open questions genuinely coexist in it. Per that Standard's governing rule for evidence, nothing here is corrected, modernized, or reconciled against current architecture - see Section 6 for why.

---

## 1. Purpose

This document faithfully records the verified Journey 1 V2 wireframe artifact: its screen structure, its exact copy, and its own stated design rationale. It is not a redesign, and it is not a reconciliation against current architecture or terminology. Where the artifact is inconsistent with itself, or silent on something, that is recorded as an open question (Section 5), not corrected. Where the artifact resembles or differs from currently documented architecture, that is recorded as a comparison (Section 6), not resolved. Resolution belongs to a future Journey 1 Reconciliation document, not to this one.

---

## 2. Artifact Provenance

[Observation] The artifact is a single wireframe image titled "Journey 1 — Returning to the Same Space (V2)," depicting three sequential phone-screen mockups plus page-level annotations (a promise callout, per-screen design rationale, and a bottom summary bar).

[Observation] This artifact was uploaded directly into conversation and visually inspected there - the content recorded in Sections 3-5 below was read directly from that image, not reconstructed from a prior description of it.

[Observation] The artifact is now committed to the repository at `Uncluttrd Core Documents/Mock Ups/Journey1v2 wireframe.png` (note: this is the file's actual committed name; it differs from the underscore-separated name originally requested for it). Commit `feeaf58c1aaef3264a446e9a778c9b1913761bf5`, "Promote verified Journey 1-6 wireframes from conversation to durable storage." Its PNG file signature was verified directly (not inferred from the `.png` extension) before this commit was made.

[Observation] Journey 1 V2 is the sole primary artifact for Journey 1. A direct, repository-wide search (file names and full text of every document) found no file, and no textual reference, corresponding to a separate "Journey 1 V1" artifact.

A "V1" was previously believed to exist as a missing-but-real historical source. That belief is not corroborated by anything this document's author independently verified - it is recorded here as the asserted resolution of that belief, not as a fact this document's author confirmed first-hand: V1 was a conceptual discussion that got mistakenly treated as a preserved historical source in an earlier, untraceable task. No V1 wireframe, transcription, or spec is treated as existing anywhere in this document.

---

## 3. Observations

Numbered for traceability from Section 4. Organized by where each element appears on the artifact.

### 3.1 Page-level elements

- **O1** [Observation] The page title reads "Journey 1 — Returning to the Same Space (V2)."
- **O2** [Observation] The page subtitle, directly beneath the title, reads "Open the app and continue where you left off."
- **O3** [Observation] A callout box in the top-right corner of the page, outside any phone screen, contains a leaf icon and the heading "Our promise," followed by "We remember what you choose." and "We'll make new suggestions after we see what's changed."
- **O4** [Observation] Three numbered steps run left to right across the top of the page, each with a circled number, a bold title, and a short description, positioned above its corresponding phone screen:
  1. "Welcome Back" - "Re-establish continuity and the current space."
  2. "Your Session" - "Surface what you chose to keep. We'll start with one of them."
  3. "Fresh Look" - "Invite a new photo to see what's changed."
- **O5** [Observation] Arrows connect the three phone-screen columns left to right.
- **O6** [Observation] A full-width bar spans the bottom of the page, below all three phone screens. It has a leaf icon and the heading "What you can count on," followed by three two-line phrases: "We remember / what you choose," "We respect / your decisions," and "Today is / a fresh start."
- **O7** [Observation] The same bottom bar has a right-aligned section headed "What we're not doing," listing three items, each preceded by a circle-slash icon: "No scores," "No percentages," "No assumptions."

### 3.2 Screen 1 (under step "Welcome Back")

- **O8** [Observation] Status bar reads "9:41" with signal, wifi, and battery icons.
- **O9** [Observation] Bold text reads "Welcome back." followed by "Ready to make a little more progress?"
- **O10** [Observation] Below that text is a photograph of a kitchen coffee station: open shelves holding mugs, a drip coffee maker, a window, and potted plants on the counter.
- **O11** [Observation] Below the photo is a card containing a house icon, the label "Current Space," the bold word "Kitchen," and the line "Last seen 6 days ago."
- **O12** [Observation] Below the card is a full-width dark green button reading "Continue."
- **O13** [Observation] Below the phone, under the heading "Why this works," three bullets read: "Reorients you to your space." / "Builds continuity without metrics." / "Calm start, no evaluation."

### 3.3 Screen 2 (under step "Your Session")

- **O14** [Observation] Same "9:41" status bar; below it, a back arrow (←).
- **O15** [Observation] Below the back arrow, bold heading text reads "Today's Session" - this is the text rendered on the phone screen itself, distinct from the step label "Your Session" positioned above the phone in the page's step row (O4).
- **O16** [Observation] Below the heading, text reads "We'll start with," followed by an icon and the bold text "Coffee Station."
- **O17** [Observation] Below a divider line, a green section header reads "You asked to come back to:"
- **O18** [Observation] Below that header, a list item shows an icon, bold text "Return the serving tray," and smaller gray text "Kept last time."
- **O19** [Observation] Below a second divider, a second list item shows an icon, bold text "Find a home for the extra mugs," and smaller gray text "Kept last time."
- **O20** [Observation] Below the list, a highlighted callout box with a leaf icon reads "These are the things you chose to keep. We'll see what's changed today." This describes the same list items as O17's "You asked to come back to:" header, using different wording than that header.
- **O21** [Observation] Below the callout is a full-width dark green button reading "Continue."
- **O22** [Observation] Under "Why this works," three bullets read: "Shows your kept items, not predictions." / "\"We'll start with\" is an intention, not a priority." / "No claims about what's still true."

### 3.4 Screen 3 (under step "Fresh Look")

- **O23** [Observation] Same "9:41" status bar and a back arrow.
- **O24** [Observation] Below the back arrow, bold heading text reads "Let's take a fresh look." followed by "A new photo helps us see what's changed since last time."
- **O25** [Observation] Below that text is a dashed-border box containing a camera icon and the text "Take a new photo of your Coffee Station."
- **O26** [Observation] Below that box is a smaller tip box with a sun icon reading "Good natural light works best. No editing needed."
- **O27** [Observation] Below the tip box is a full-width dark green button with a camera icon reading "Take Photo."
- **O28** [Observation] Under "Why this works," three bullets read: "Respects the evidence boundary." / "No assumptions before we see." / "One clear next step."

---

## 4. Inferences

Each traceable to specific observations above.

- **[Inference]** The three-step structure and the button-to-button chaining across screens (O4, O5, O12, O21, O27) indicate this journey is a fixed, linear sequence rather than a branching flow. *(Based on O4, O5, O12, O21, O27.)*
- **[Inference]** "Kept last time" (O18, O19) implies these two items originate from a prior session's outcome, not from anything established in the current session. *(Based on O18, O19.)*
- **[Inference]** "Return the serving tray" and "Find a home for the extra mugs" are individually tracked, persistent items rather than one freeform note, since each carries its own icon and its own "Kept last time" label. *(Based on O18, O19.)*
- **[Inference]** The wireframe's "remember" language (O3, O6) is used broadly, to describe the product's overall behavior toward the user, not narrowly scoped to one specific mechanism. *(Based on O3, O6.)*
- **[Inference]** The "Why this works" callouts (O13, O22, O28) function as design-rationale annotations for a reviewer of the wireframe, not as in-product copy shown to an end user - no phone screen itself displays this text. *(Based on O13, O22, O28.)*
- **[Inference]** "Kitchen" (O11) and "Coffee Station" (O16, O25) refer to two different levels of specificity: "Kitchen" reads as the overall space, and "Coffee Station" as a more specific location or item within it. *(Based on O11, O16, O25.)*
- **[Inference]** The absence of any numeric count, score, or percentage on any of the three phone screens (O8-O28) is consistent with the "No scores / No percentages / No assumptions" callout in the bottom bar (O7). *(Based on O7 and the absence of any such element across O8-O28.)*

---

## 5. Open Questions / Ambiguities

Recorded as observations about the source artifact, not resolved here.

- **[Observation]** "Your Session" (the step label above the phone, O4) and "Today's Session" (the heading rendered on the phone screen itself, O15) name the same screen with two different phrases within the same artifact.
- **[Observation]** "You asked to come back to:" (the section header inside Screen 2, O17) and "These are the things you chose to keep." (the callout box at the bottom of the same screen, O20) describe the same two list items with two different phrases within the same artifact.
- **[Observation]** A verification pass found no authoritative project decision establishing "Today's Focus" as Journey 1's heading. Review of DecisionLog.md, ObjectModel.md, and the recorded conversation history further established that "Today's Focus" originated later during Journey 3's design work and was never propagated back to Journey 1 after Journey 1 was frozen. This inconsistency is therefore genuinely unresolved, not a forgotten or uncommitted prior decision. It requires a new design decision rather than the application of an existing one.
- **[Observation]** The artifact does not state the relationship between "Kitchen" (O11) and "Coffee Station" (O16, O25) - whether one contains the other, whether they are the same kind of thing at different granularity, or something else. (See also Inference on this point, Section 4.)
- **[Observation]** The artifact does not show or describe what screen or flow follows Screen 3's "Take Photo" action (O27). Nothing in this artifact states that transition.
- **[Observation]** The artifact does not state what happens if more than two items would qualify for the "You asked to come back to" list (O17-O19) - whether the list scrolls, caps at a fixed number, or behaves some other way.

---

## 6. Relationship to Current Architecture

Per ArchitecturalReasoningStandard.md's Evidence Confidence Hierarchy, every comparison below is Level 1 - Resemblance only: the wireframe and the currently documented architecture were not independently verified to have developed without influencing each other, so resemblance supports hypothesis generation for the future Reconciliation document, not validation of alignment. Nothing below is resolved.

**Agreements (resemblance only):**

- **[Observation]** The "Current Space: Kitchen" card (O11) resembles the settled Space object (ObjectModel.md, SpaceImplementation.md) in shape - a named, identified place the session is scoped to.
- **[Observation]** "Kitchen" versus "Coffee Station" (O11, O16, O25) resembles the Space / Location Reference relationship in ObjectModel.md - a Space with a more specific, recurring sub-location inside it - though the artifact never uses either term.
- **[Observation]** The "kept" items resurfacing in a later session (O18-O20) resembles Persistent Work's settled definition in ObjectModel.md - a Space-owned object with stable identity that can resurface in later sessions.
- **[Observation]** The Screen 3 rationale "Respects the evidence boundary" / "No assumptions before we see" (O28) resembles, in spirit, DecisionLog.md's 2026-07-26 "Observation Does Not Establish Evaluation" and "The Evidence Boundary Applies Across Time" decisions - waiting for new evidence (a new photo) before asserting anything about it.
- **[Observation]** "Today's Session" (O15) uses "Session" in a way that is not inconsistent with ObjectModel.md's Temporary Concept "Session" - a temporary interaction boundary.

**Differences / tensions (not resolved here):**

- **[Observation]** The wireframe's repeated "remember"/"remembers" language (O3, O6) is not scoped to ObjectModel.md's Remembered Statement object, which that document's Architectural Language Registry (Section 6) reserves for a specific, structured kind of durable truth, created only through one of two defined paths. The wireframe's usage reads as general product-voice language, closer in substance to the "kept items" behavior (Persistent Work, per the agreement above) than to Remembered Statement. This is the same terminology collision ArchitecturalReasoningStandard.md's own origin story references, now directly located in the primary artifact rather than only discussed abstractly.
- **[Observation]** Neither "Space" nor "Persistent Work" nor "Location Reference" nor any other current ObjectModel.md term appears anywhere in the artifact's text. Every resemblance recorded above is structural, not terminological.
