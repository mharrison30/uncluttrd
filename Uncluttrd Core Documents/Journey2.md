# Journey 2 — Capture Today's Reality

Status: Authoritative implementation specification
Source: Journey 2 wireframe (verified primary artifact)
Governed by: ArchitecturalReasoningStandard.md

This document follows ArchitecturalReasoningStandard.md's bracketed claim-type notation (`[Observation]`, `[Inference]`) throughout. Per that Standard's governing rule for evidence, nothing here is corrected, modernized, or reconciled against current architecture - see Section 6 for why.

---

## 1. Purpose

This document faithfully records the verified Journey 2 wireframe artifact: its screen structure, its exact copy, and its own stated design rationale. It is not a redesign, and it is not a reconciliation against current architecture or terminology. Where the artifact is silent on something, that is recorded as an open question (Section 5), not filled in. Where the artifact resembles or differs from currently documented architecture - or from claims made about it elsewhere in the project - that is recorded as a comparison (Section 6), not resolved. Resolution belongs to a future Journey 2 Reconciliation document, not to this one.

---

## 2. Artifact Provenance

[Observation] The artifact is a single wireframe image titled "Journey 2 – Capture Today's Reality," depicting a five-step happy path, a reshoot loop, and an insufficient-evidence recovery flow.

[Observation] This artifact was uploaded directly into conversation and, separately, read directly from its committed file for this document - the content recorded in Sections 3-5 below was read directly from the image itself, not reconstructed from memory or from a prior description of it.

[Observation] The artifact is committed to the repository at `Uncluttrd Core Documents/Mock Ups/Journey2 wireframe.png` (its actual on-disk name; note the space rather than underscore separators). Its PNG file signature was verified directly before this document was written. It was committed in `feeaf58c1aaef3264a446e9a778c9b1913761bf5`, "Promote verified Journey 1-6 wireframes from conversation to durable storage."

[Observation] Journey1.md and its governing Decision Log entry ("2026-07-30 — Journey 1: Take Photo Transition") describe Journey 1's "Take Photo" action as handing off into this journey's entry point. That decision's stated evidence includes a claim about this artifact - see Section 6 for a direct comparison between that claim and what this document independently observed here.

---

## 3. Observations

Numbered for traceability from Section 4.

### 3.1 Page-level elements

- **O1** [Observation] The page title reads "Journey 2 – Capture Today's Reality" (en dash, not the em dash used in Journey 1's title).
- **O2** [Observation] Below the title: "Purpose: Transition from what Companion remembers to what Companion can honestly observe today."
- **O3** [Observation] In the top-right of the page - once, at the page level - a rounded box contains a coffee-cup icon, the bold text "Coffee Station," and the smaller gray label "Location" beneath it. This box appears exactly once on the page. It is not repeated inside any individual phone-screen mockup, reshoot-loop box, or insufficient-evidence-recovery box.
- **O4** [Observation] A green, all-caps section header reads "HAPPY PATH (NO CONFIRMATION STEP)," directly above the five happy-path phone screens.

### 3.2 Happy path (five phone screens, left to right, connected by arrows)

- **O5** [Observation] Screen 1: status bar "9:41" with signal/wifi/battery icons; an X icon and a flash icon at the top; a camera viewfinder showing the coffee station (shelves, mugs, coffee maker, plants); overlay text "Take a photo of the entire area."; a bottom row with a gallery-thumbnail icon, a white circular shutter button, and "1x."
- **O6** [Observation] Screen 2: the same viewfinder image; overlay reads a checkmark icon followed by "Photo captured." and "Looks good."; below that, "Retake" (text, left) and a green circular checkmark button (right), replacing the shutter-button row.
- **O7** [Observation] Screen 3: visually the same as Screen 1 - the same viewfinder image, the same "Take a photo of the entire area." overlay, and the same gallery/shutter/1x row.
- **O8** [Observation] Screen 4: white background (not a camera view); an abstract graphic of two overlapping circles; bold text "Analyzing your photo"; subtext "We're identifying items and understanding your space."; a mostly-filled horizontal progress bar (dark green on a light gray track).
- **O9** [Observation] Screen 5: white background; a checkmark inside a circle icon; bold text "All set!"; subtext "Let's build today's session."; a dark green button reading "Continue."
- **O10** [Observation] Below the five screens, five numbered captions, each a bold title followed by a short description:
  1. "Camera opens immediately." - "One calm instruction. No explanation. No ceremony."
  2. "Photo captured." - "Quick, unobtrusive preview. No confirmation required."
  3. "Retake (optional)." - "If the photo isn't right, tap Retake and you're right back in the camera."
  4. "Processing begins automatically." - "No extra taps. No confirmations. We move forward together."
  5. "Ready for Journey 3." - "Companion now has evidence and can build your session."

### 3.3 Reshoot loop

- **O11** [Observation] A green, all-caps header reads "RESHOOT LOOP (STAYS IN THE SAME FLOW)."
- **O12** [Observation] Five boxes, connected left to right by arrows, each with an icon, a bold title, and a short subtext:
  1. Camera icon - "Take photo" - "Follow the same instruction."
  2. Eye icon - "Quick preview" - "See the result."
  3. Loop/refresh icon - "Retake" - "Back to camera."
  4. Eye icon - "Review again" - "Better this time?"
  5. Sparkle icon - "Continue" - "Move into analysis."
- **O13** [Observation] Below the boxes: "The loop is fast, calm, and contained. The user never leaves the camera/preview rhythm."

### 3.4 Insufficient evidence recovery

- **O14** [Observation] A dark red/maroon, all-caps header reads "INSUFFICIENT EVIDENCE RECOVERY (SEPARATE FLOW)."
- **O15** [Observation] A box with a warning-triangle icon reads "We couldn't get enough from that photo." followed by "It might be too blurry, too dark, or not show the whole area." and a dark green "Try Again" button.
- **O16** [Observation] A phone-screen mockup box shows the same status bar, X/flash icons, coffee-station viewfinder image, and "Take a photo of the entire area." overlay as Screens 1 and 3 (O5, O7).
- **O17** [Observation] A box headed "Tips for a better photo" lists four items, each with its own icon: "Include the entire area," "Make sure it's well lit," "Hold steady," "Avoid close-ups," followed by a "Got it" button.
- **O18** [Observation] A box with a cloud-upload icon reads "Upload failed." followed by "Check your connection and try again." and a dark green "Try Again" button.
- **O19** [Observation] To the right of these boxes, three unheaded paragraphs read: "When evidence is insufficient or something goes wrong, Companion stays honest and helpful." / "We explain the problem simply, give the user a clear next step, and return them to the camera with confidence." / "This preserves trust without breaking momentum longer than necessary."

### 3.5 Key Principles in Action

- **O20** [Observation] A bold, black (not colored) header reads "KEY PRINCIPLES IN ACTION."
- **O21** [Observation] Five items, each with an icon, a bold title, and a short subtext:
  1. Shield/check icon - "Evidence before interpretation" - "No observations until the photo exists."
  2. Eye-slash icon - "Demonstrate, don't narrate" - "We act according to the architecture, we don't explain it."
  3. Camera icon - "Instruct, don't interpret" - "Pre-photo copy gives procedure, never meaning."
  4. Upward-arrow icon - "Momentum over checkpoints" - "No unnecessary confirms. The last photo is the current candidate."
  5. Heart icon - "Honest when we can't proceed" - "We pause with clarity, not error jargon, and keep trust intact."

---

## 4. Inferences

Each traceable to specific observations above.

- **[Inference]** The reshoot loop (O11-O13) is the happy path's own first three steps (O5-O7, O10 items 1-3) restated as a self-contained cycle, not a different mechanism - both describe take photo → preview → retake → move forward. *(Based on O5-O7, O10, O12.)*
- **[Inference]** "The last photo is the current candidate" (O21, item 4) implies that retaking a photo replaces the prior one as the thing that will be analyzed, rather than the system retaining multiple candidate photos. *(Based on O6, O12 "Retake - Back to camera," O21.)*
- **[Inference]** The insufficient-evidence recovery flow (O14-O19) and the reshoot loop (O11-O13) are presented as two distinct flows rather than one, since the artifact gives them separate headers, separate framing ("STAYS IN THE SAME FLOW" versus "SEPARATE FLOW"), and separate visual treatment (green heading versus dark red/maroon heading). *(Based on O11, O14.)*
- **[Inference]** The page-level "Coffee Station / Location" badge (O3) is intended to apply to the whole journey shown on this page, not to any single screen specifically, since it is positioned at the page header rather than inside any individual screen mockup. *(Based on O3.)*
- **[Inference]** "Upload failed" (O18) is presented as a distinct failure mode from "insufficient evidence" (O15) - one concerns the photo's content, the other concerns whether the photo transmitted at all - since the artifact gives them separate boxes with separate icons (warning triangle versus cloud) and separate copy. *(Based on O15, O18.)*

---

## 5. Open Questions / Ambiguities

Recorded as observations about the source artifact, not resolved here.

- **[Observation]** The artifact does not state what mechanism determines "insufficient evidence" (O15). The copy lists possible reasons a photo might be rejected ("too blurry, too dark, or not show the whole area") as user-facing explanation, but nothing in the artifact states whether this is an AI judgment, a technical/heuristic check, or some other mechanism.
- **[Observation]** The artifact names a destination after Screen 5's "Continue" - caption 5 states "Ready for Journey 3" (O10) - but does not show or describe the actual transition: no next screen is depicted, and nothing on Screen 5 itself restates that the active Location carries forward into whatever comes next.
- **[Observation]** The artifact does not state what happens if "Upload failed" (O18) recurs on a second or later attempt - whether "Try Again" behaves identically every time, or whether repeated failure leads anywhere else.
  - **[Observation]** Design-session analysis identified a candidate principle: repeated failures should be acknowledged once their repetition itself becomes informative, but only through observations Companion is actually entitled to make (e.g., "we've tried several times and this hasn't resolved" is consistent with the Evidence Boundary; speculating a cause, e.g. "check your router" or "try disabling your VPN," is not, since Companion has no basis to know that). This principle is not yet adopted as a final decision; specific escalation copy remains open.
  - **[Observation]** Design-session resolution: trigger is attempt-based, not time-based (repeated failures constitute new evidence; elapsed time alone does not). Attempts 1-2 use the original wireframe copy unchanged ("We couldn't upload your photo. Check your connection and try again."). Attempt 3 onward: "We're still having trouble uploading your photo. It doesn't look like this is resolving. You can try again in a moment, or come back to this later." — reports only the observed fact of persistence, makes no diagnosis of cause (no "check your connection," no speculation about Wi-Fi or signal), and does not imply eventual success. Escalation stops after this point; no further changes on attempts 5, 8, 12, etc., since no new evidence accumulates beyond confirmed persistence. A secondary "Not now" text-link action is required alongside "Try Again" starting at attempt 3, matching the established pattern used elsewhere in Companion (Journey 1's "Not right now," Journey 3's "Pause Session"). "Not now" pauses the upload attempt only — it exits the upload flow, leaves the current organizing session intact, preserves existing progress, and allows the user to resume later exactly where they left off. It is not a cancellation.
  - **[Observation]** SETTLED. Final structure: Stage 1 (attempts 1-2) retains the wireframe's original copy unchanged — "We couldn't upload your photo. Check your connection and try again." — with Try Again as the only action. Stage 2 (attempt 3 onward) reads "We're still having trouble uploading your photo. It doesn't look like this is resolving. You can try again in a moment, or come back to this later.," with Try Again as the primary action and a secondary "Not now" text link. Trigger is attempt count, not elapsed time. "Not now" pauses the upload attempt only — it exits the upload flow, leaves the current organizing session intact, preserves existing progress, and is resumable later; it is not a cancellation. No stage exists beyond Stage 2. This converges with Recovery Lifecycle (see the parallel closing Observation below) on the same two-stage structure — an unchanged Stage 1, a single persistence-acknowledging Stage 2 pairing Try Again with Not now, and nothing beyond it — while differing in Stage 1 content (connection-error copy here versus insufficient-evidence copy with troubleshooting tips there). This structural match was not imposed for symmetry; each flow reached it independently by applying the same underlying test — escalate only when repetition itself becomes new evidence, and only once.
- **[Observation]** Direct comparison of O16 (the insufficient-evidence "Try Again" camera screen) against O5/O7 (the happy-path camera screens) confirms no observable difference: identical status bar, identical icons, identical viewfinder image, identical overlay copy ("Take a photo of the entire area."), and identical bottom control row. Combined with the Section 4 inference that the reshoot loop is the happy path's opening sequence restated as a self-contained cycle, not a separate camera configuration, this question is resolved: no routing distinction exists between these paths - both arrive at the same camera state.
- **[Observation]** The artifact depicts only a single insufficient-evidence attempt and does not address what happens across repeated failures - whether guidance changes, whether retry is unbounded, or whether Companion's behavior evolves as attempts accumulate. This is a real open UX question (informally: "Recovery Lifecycle") distinct from the routing question above, not resolved by this document, and not blocked by the project's unresolved Session-persistence architectural decision - any retry-specific state is scoped to the current capture attempt, not to Session persistence.
  - **[Observation]** Design-session analysis identified the same underlying principle as item 3 above, but concluded its expression must diverge: Upload Failure escalates by becoming a more transparent communicator (acknowledging persistence, never diagnosing cause); Insufficient Evidence escalates by becoming a better coach (changing its guidance). A real dependency was surfaced and is recorded here rather than resolved: any cause-specific escalation copy (e.g., suggesting better lighting or a different angle) requires the insufficient-evidence trigger mechanism to actually provide cause information. Since that mechanism was explicitly left undecided in the Product Scope Decision, honest escalation copy must remain generic (e.g., "let's try a different approach") unless and until the mechanism is built to support cause-specific detection. This principle and constraint are not yet adopted as a final decision; specific escalation copy remains open, and is explicitly gated on a separate, not-yet-made implementation decision.
  - **[Observation]** SETTLED. Final structure: Stage 1 (attempts 1-2) retains the wireframe's existing recovery message and tips, unchanged — "We couldn't get enough from that photo." / "It might be too blurry, too dark, or not show the whole area." (O15) plus the four photo tips (O17) — with Try Again as the only action. Stage 2 (attempt 3 onward) reads "We're still having trouble getting enough from your photos. We still don't have enough to work from this photo. You can try again, or come back to this later.," with Try Again as the primary action and a secondary "Not now" text link, using the same pause-not-cancel behavior as Upload Failure's Not now: it exits this recovery attempt, leaves the organizing session intact, and is resumable later. Trigger is attempt count, not elapsed time. No stage exists beyond Stage 2 — cause-specific coaching and a conversational fallback were both explicitly considered and rejected, as a capability expansion beyond this flow's Product Scope rather than a legitimate escalation of it. This converges with Upload Failure (see the parallel closing Observation above) on the same two-stage structure — an unchanged Stage 1, a single persistence-acknowledging Stage 2 pairing Try Again with Not now, and nothing beyond it — while differing in Stage 1 content (insufficient-evidence copy with troubleshooting tips here versus connection-error copy there). This structural match was not imposed for symmetry; each flow reached it independently by applying the same underlying test — escalate only when repetition itself becomes new evidence, and only once.

---

## 6. Relationship to Current Architecture

Per ArchitecturalReasoningStandard.md's Evidence Confidence Hierarchy, every comparison below is Level 1 - Resemblance only, unless stated otherwise. Nothing below is resolved.

**Direct comparison against an existing claim about this artifact:**

- **[Observation]** The Decision Log entry "2026-07-30 — Journey 1: Take Photo Transition" states: "Journey 2's wireframe also displays a persistent Location badge on every screen, meaning it already assumes the active Location is known at camera-open." Direct inspection for this document found a single page-level "Coffee Station / Location" badge (O3), not a badge repeated on every individual screen (see O3's explicit note that it does not recur inside any phone-screen mockup, reshoot-loop box, or recovery box). The broader claim that the artifact assumes a known active Location for the journey is consistent with what was observed; the specific "on every screen" description is not - the badge appears once, at the page level. This document does not resolve or correct the Decision Log entry; it records the discrepancy as observed.

**Agreements (resemblance only):**

- **[Observation]** The page-level "Coffee Station / Location" badge (O3) resembles the Space/Location Reference relationship recorded in the 2026-07-30 "Journey 1: Space/Location Relationship" decision - a journey scoped to a specific, named Location within a Space - though this artifact never uses either term.
- **[Observation]** "Evidence before interpretation" / "No observations until the photo exists" and "Instruct, don't interpret" / "Pre-photo copy gives procedure, never meaning" (O21, items 1 and 3) closely resemble DecisionLog.md's Evidence Boundary and "Observation Does Not Establish Evaluation" principles (2026-07-26). The resemblance in wording is close. This is still recorded at Level 1 only: no provenance or timeline evidence was reviewed establishing that this artifact was developed independently of those Decision Log entries. Both are dated to the same general period (this artifact's file was last modified 2026-07-26, the same date as those entries), which if anything makes independent development harder to assume, not easier - a same-day artifact and a same-day decision are not automatically unrelated. This is not upgraded past Level 1 in this document.
- **[Observation]** "Momentum over checkpoints" / "No unnecessary confirms" (O21, item 4) and the happy path's explicit "NO CONFIRMATION STEP" framing (O4) resemble the general reduce-friction position found elsewhere in the project's product principles, without using their specific language.

**Differences / open relative to architecture:**

- **[Observation]** Neither "Space" nor "Location Reference" nor any other current ObjectModel.md term appears anywhere in this artifact's text - as with Journey1.md, every resemblance recorded above is structural, not terminological.
- **[Observation]** This artifact does not address Persistent Work, Remembered Statement, or Session in any form - none of those objects, nor any comparable concept, appears in this artifact.
