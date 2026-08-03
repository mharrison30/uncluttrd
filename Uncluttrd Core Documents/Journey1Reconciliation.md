# Journey 1 Reconciliation

Status: Authoritative reconciliation of Journey1.md against settled decisions
Source: Journey1.md (historical transcription, unmodified by this document) and the four "Journey 1:" Decision Log entries dated 2026-07-30
Governed by: ArchitecturalReasoningStandard.md

This document follows ArchitecturalReasoningStandard.md's bracketed claim-type notation (`[Observation]`, `[Inference]`, `[Decision]`) throughout.

---

## 1. Purpose

This document resolves Journey1.md's Section 5 open questions using the four Decision Log entries recorded on 2026-07-30, and maps the resulting, resolved Journey 1 onto current architecture. It supersedes Journey1.md's Section 6 framing wherever a decision now makes a relationship explicit rather than merely resemblant - it does not supersede Journey1.md itself. Journey1.md remains the unmodified historical record of what the V2 wireframe actually showed; this document is what the project decided to do about the questions that record raised.

---

## 2. Resolved Ambiguities

Each of Journey1.md Section 5's items, paired with the Decision Log entry that resolves it.

- **[Observation]** Journey1.md Section 5: "'Your Session' ... and 'Today's Session' ... name the same screen with two different phrases within the same artifact."
  **[Decision]** Resolved by *"2026-07-30 — Journey 1: Session Screen Heading and Carry-Forward Language."* Neither wireframe phrase is adopted. The heading is decided to communicate continuity of work, in the same register as "Welcome back" (leading candidate: "Picking up where you left off"), with exact final copy left flexible within that register.

- **[Observation]** Journey1.md Section 5: "'You asked to come back to:' ... and 'These are the things you chose to keep.' ... describe the same two list items with two different phrases within the same artifact."
  **[Decision]** Resolved by the same entry. "You asked to come back to..." is adopted; "chose to keep" is rejected for framing the items as inventory rather than as an established historical fact.

- **[Observation]** Journey1.md Section 5: "A verification pass found no authoritative project decision establishing 'Today's Focus' as Journey 1's heading. ... It requires a new design decision rather than the application of an existing one."
  **[Decision]** Resolved by the same entry. "Today's Focus" was considered and explicitly rejected as a candidate for Journey 1 specifically - not adopted, and not left ambiguous by omission.

- **[Observation]** Journey1.md Section 5: "The artifact does not state the relationship between 'Kitchen' ... and 'Coffee Station' ... whether one contains the other, whether they are the same kind of thing at different granularity, or something else."
  **[Decision]** Resolved by *"2026-07-30 — Journey 1: Space/Location Relationship (Kitchen ↔ Coffee Station)."* Kitchen is the Space; Coffee Station is a recurring Location within it. The relationship is nested, not flat, and must be communicated explicitly rather than left implicit.

- **[Observation]** Journey1.md Section 5: "The artifact does not show or describe what screen or flow follows Screen 3's 'Take Photo' action."
  **[Decision]** Resolved by *"2026-07-30 — Journey 1: Take Photo Transition."* The transition leads directly into Journey 2's camera experience, with no added instructional or ceremonial step, carrying the active Location forward so Journey 2 begins with it already established.

- **[Observation]** Journey1.md Section 5: "The artifact does not state what happens if more than two items would qualify for the 'You asked to come back to' list ... whether the list scrolls, caps at a fixed number, or behaves some other way."
  **[Decision]** Resolved in principle, not in mechanism, by *"2026-07-30 — Journey 1: Growing Kept-Items List Behavior."* The list is structured as a "start here" set plus a "more to come back to later" set, with the latter never implied to be less important. The specific display mechanism (collapsible section, scroll, or otherwise) is explicitly left open by that same entry, as its stated Open Design Detail.

All six Section 5 items now have a governing decision. None remain unresolved.

---

## 3. Architectural Mapping

Journey1.md Section 6 recorded every comparison to current architecture as Level 1 - Resemblance only, per ArchitecturalReasoningStandard.md's Evidence Confidence Hierarchy, because nothing had yet established the relationships as more than structurally similar. The 2026-07-30 decisions change that for some, not all, of those comparisons.

- **Space.** Journey1.md Section 6 recorded that "Current Space: Kitchen" resembles the settled Space object. **[Decision]** *"Space/Location Relationship"* now explicitly names Kitchen as the Space in this journey, not merely as something shaped like one. This moves the claim from Resemblance to an explicit, decided mapping - though it is still a single decision applied to one journey, not independent corroboration from a second, separately developed source. It does not rise to Level 3 (Historically Verified Independent Convergence), which would require demonstrated provenance that two independently developed artifacts converged without influencing each other. This is one artifact (Journey1.md) reconciled by one decision, not two independent artifacts agreeing.

- **Location Reference.** Journey1.md Section 6 recorded the Kitchen/Coffee-Station pairing as resembling the Space/Location Reference relationship, "though the artifact never uses either term." **[Decision]** The same *"Space/Location Relationship"* entry states this "independently converges with ObjectModel.md's existing Location Reference definition ... without having been designed with that definition in mind." That is a claim of **Level 2 - Independent Convergence**, per ArchitecturalReasoningStandard.md: two independently developed artifacts (the Journey 1 wireframe and ObjectModel.md's Location Reference definition) arriving at the same structure. It is a stronger claim than Resemblance, and this document records it as Level 2. It is not recorded as Level 3, since no provenance/timeline evidence was presented establishing that the two were genuinely developed without any shared influence - that would need to be separately demonstrated, not asserted, to earn Level 3. Coffee Station is treated as a Location Reference instance owned by the Kitchen Space going forward in this journey; ObjectModel.md's own Location Reference definition is not modified by this document.

**[Observation]** `Journey1_Design_Session_Excerpt.md` was subsequently reviewed as candidate Level 3 evidence. It documents that the Kitchen/Coffee Station conclusion (Step 2) was reached after an explicit instruction to set the object model aside (Step 1), with the correspondence to Location Reference identified only afterward (Step 3), and with no mention of Location Reference or ObjectModel.md anywhere in Step 2's text.

**[Decision]** The classification remains Level 2, not Level 3. This excerpt demonstrates sequencing within a single conversation, not independence between two artifacts that "genuinely could not have influenced each other" - the standard Level 3 requires. The same reasoning agent that produced Steps 2 and 3 had ObjectModel.md's Location Reference definition in context throughout the session, had quoted it verbatim multiple times before this excerpt, and authored the "independently converges" language in the underlying Decision Log entry itself - a self-assessment of independence by the same party whose independence is in question, not external verification. ArchitecturalReasoningStandard.md's own falsification condition for Level 3 - "a shared author working on both at once... demotes the claim back to Level 2" - describes exactly this situation; it is not a hypothetical risk here but a demonstrated fact. The excerpt does support a narrower, legitimate claim: the design conclusion is defensible on UX reasoning alone, not reverse-engineered to fit the architecture. It does not support the broader claim of independently corroborated convergence that Level 3 requires.

- **Persistent Work.** Journey1.md Section 6 recorded that the "kept" items resurfacing in a later session resembles Persistent Work's settled definition. **[Decision]** *"Growing Kept-Items List Behavior"* and *"Session Screen Heading and Carry-Forward Language"* adopted "You asked to come back to..." as the carry-forward items' wording specifically because it reads as an established historical fact rather than inventory framing - a UX/wording decision grounded in user experience, not an architectural classification decision. Neither entry, nor any other Decision Log entry, explicitly classifies the carry-forward items as Persistent Work instances. **[Observation]** The adopted wording is consistent with Persistent Work's settled definition (a Space-owned object with stable identity that can resurface in later Sessions), but consistency with a definition is not the same as a decision applying that definition. This relationship remains **Level 1 - Resemblance**, unchanged from Journey1.md Section 6, and is not upgraded by anything decided on 2026-07-30. Persistent Work's own definition in ObjectModel.md is unchanged.

- **Evidence Boundary.** Journey1.md Section 6 recorded that Screen 3's "Respects the evidence boundary" / "No assumptions before we see" resembled the Evidence Boundary decisions in spirit. **[Decision]** *"Take Photo Transition"* does not alter this relationship - it is not one of the four questions Section 5 raised about the Evidence Boundary specifically, and no decision above reclassifies it. It remains Level 1 - Resemblance, unchanged from Journey1.md Section 6, and is not claimed here as more than that.

- **Remembered Statement.** Journey1.md Section 6 recorded the wireframe's "remember" language as a difference/tension with the reserved Remembered Statement term, not an agreement. None of the four 2026-07-30 decisions addresses this. It remains an open difference, not resolved by this document.

---

## 4. Implementation Notes

Concrete consequences drawn directly from the four Decision Log entries, not new decisions of this document's own.

- Final heading copy for Journey 1's second screen must come from the "continuation" register (e.g., "Picking up where you left off"), not the "commitment" or "place" register named in the Growing Kept-Items List Behavior entry. Exact final copy is not decided.
- The carry-forward section uses "You asked to come back to..." as its established phrasing; "chose to keep" is not used.
- "Today's Focus" is not used as Journey 1's heading.
- The UI must show the Kitchen → Coffee Station transition explicitly. Exact copy/typography for that transition is not decided.
- A future growing kept-items list may group by Location without promoting any Location to Space-equivalent status.
- Tapping "Take Photo" must lead directly into Journey 2's camera experience with no added instructional or ceremonial step; any transition motion is interaction feedback only, not a separate stage.
- The active Location (e.g., Coffee Station) must be passed through to Journey 2's entry point as part of that transition, so Journey 2 begins with a known location context.
- The carry-forward list is structured as a "start here" set plus a "more to come back to later" set. Items in the latter set must never be implied to be less important than items in the former.

**Open Design Detail carried forward from Decision 4, not resolved by this document:** whether the "start here" set is always exactly one item, or can be a small set of two or three. The Decision Log entry states this explicitly as an implementation detail of its own decision, not a separate design decision - this document does not resolve it either.
