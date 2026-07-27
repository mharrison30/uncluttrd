# Journey 5 — Long-Term Continuity

Status: Frozen

Core Principle: A remembered statement may influence a future recommendation only when it was captured as the user's direct response to a Companion-defined decision within a recognized Decision Dimension, and only when the statement's Scope supports the current context.

## Screens

**Screen 1 — Recommendation.** The user is working normally; nothing announces memory or learning. A quiet "Change Recommendation" row appears below the recommendation only when it has a recognized Decision Dimension. Recommendations without one omit the row entirely.

**Screen 2 — Structured Choice.** Tapping the affordance presents a structured choice whose alternatives come directly from the Decision-Dimension Taxonomy. No free text, no "Other," no prompt asking the user to explain themselves.

**Screen 3 — Recommendation Updated.** Returns to the recommendation with a minimal acknowledgment: plain "Updated." text, no icon (deliberately avoids the reserved completion-checkmark, and avoids naming a durable preference before it's earned). This acknowledges that the structured choice was accepted - not that the recommendation visibly changed, since the user's choice may confirm rather than contradict what was already recommended.

**Screen 4 — Future Session.** A different recommendation, in a later session, shows "Based on your preference for X" for the first time. No announcement, no "Companion remembered..." - the memory simply results in a better recommendation.

## Integration Principles

- **Recommendation Object:** Recommendation is the stable architectural object. Screens render Recommendation objects; they do not own recommendation behavior.
- **Structured Capture:** Only Recommendations exposing a recognized Decision Dimension display the Change Recommendation affordance. The taxonomy, not the screen, determines whether the affordance exists.
- **Journey 3 Reconciliation:** The single-trustworthy-action philosophy governs the first action of a session. After that, BatchChecklist is the documented execution exception for the remainder of the session. The underlying Recommendation object remains the same throughout.
- **Memory:** Memory is earned through structured interaction and demonstrated only when it influences a later recommendation. Companion never announces that it learned something.

Deliberately open, not part of this spec: the user-facing affordance label ("Change Recommendation" vs. alternatives) is an unresolved UX wording decision. Whether the Recommendation Change Affordance needs its own documented exception to CompanionDesignPrinciples.md Principles 1/7 is deferred to implementation governance, not an architectural blocker.
