# Cross-Journey Findings

A running engineering log of things noticed while working through the Journey documents that are bigger than any single journey - patterns, repeated mistakes, severity calls, corrections to earlier framing. Not a standard, not a governance document. Nothing here creates a rule; anything that looks like it might needs to actually go through DecisionLog.md first.

Add to this file as new findings come up. Don't rewrite old entries - if something here turns out to be wrong or incomplete, append a correction (see 2026-07-31 #5 for the pattern), the same way DecisionLog.md handles it with Provenance Addenda.

---

## 2026-07-31 - #1: Ownership verification before transcription paid off on Journey 3

Before writing Journey3.md, an ownership pass checked the wireframe's premise against shipped code first and found the batch-workflow conflict *before* any design/reconciliation work started. That meant Journey 3's eventual scope narrowed up front - screens that turned out to be superseded (5, 6, parts of the flow diagram) never got treated as live design surface in the first place. Worth calling out as a habit that's earning its keep, not just process for its own sake: it caught the conflict for free, instead of after sinking time into reconciling screens that didn't need reconciling.

## 2026-07-31 - #2: Chronology checks ruled out "wireframe came first" for both Journey 3 and Journey 4

In both cases, the actual git/commit history showed the governing architectural decision predated the wireframe by roughly one to two weeks, not the other way around:

- Journey 3: the 2026-07-18 batch-workflow decision (commit `3948c07`) predates the Journey 3 wireframe's 2026-07-26 file date by over a week.
- Journey 4: the shipped auto-resume mechanism (commit `8c7a095`, 2026-07-13) predates the "An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object" decision (commit `90d41ad`, 2026-07-26) by 13 days, which in turn predates the Journey 4 wireframe by about two minutes.

Checking this mattered - "the design just hadn't caught up yet" is the easy, comfortable explanation, and in neither case was it true. Ruling it out directly is what let both conflicts get classified as real Architecture conflicts on their own merits, instead of being written off as ordinary lag.

## 2026-07-31 - #3: Recurring pattern - decision adopted, supporting infrastructure built, confirmation step skipped

Same shape shows up in both verified cases so far:

- Journey 3 (2026-07-18 batch decision): required showing the user a session's-worth-of-items batch instead of one action at a time. The batch infrastructure (`BatchChecklist`, `firstActionBatch`, `generateNextAction`) shipped. What didn't ship was anything resolving the open pacing question the decision itself left unanswered.
- Journey 4 (2026-07-26 decision): required that returning to an interrupted session offer an explicit choice ("Pick that back up" vs. "Take a fresh look") rather than silently resuming. The persistence infrastructure (`currentBatch`, `companionComplete`, `isCompanionResumable`) shipped, and shipped early. The explicit choice step the decision calls for was never built - the resume banner just resumes.

Both times: the decision gets reasoned through and adopted, the data/plumbing side gets built, and the user-facing confirmation/choice moment the decision actually turns on doesn't. Flagging this explicitly as something to watch, not a conclusion - two cases is a pattern worth paying attention to on the next journey, not a proven tendency in how this project ships decisions. Don't treat this as license to assume a third case will follow the same shape; check it the same way the first two were checked.

## 2026-07-31 - #4: Not all Architecture conflicts carry the same weight

Journey 3's and Journey 4's conflicts both got classified as Architecture conflicts, but they're not equivalent in consequence:

- Journey 3's conflict is about execution *shape* - single action vs. batch rendering. It's a UX-presentation mismatch. Nobody's trust in the app is at stake if this stays unresolved a while longer.
- Journey 4's conflict is about evidence *trust* - shipped code appears to violate the Evidence Boundary in actual production behavior, by silently resuming a stale recommendation without collecting new evidence first. That's not a rendering question; it's the app currently doing, in production, the specific thing an adopted decision says it must not do.

Recording this so it doesn't get lost in the classification: when fixes for either of these actually get scheduled, Journey 4's should be treated as the higher priority. Same category label, different stakes.

## 2026-07-31 - #5: Correction - Journey 3 isn't more "done" than Journey 4, they're at the same stage

Earlier discussion of Journey 3's conflict talked about it as though classifying and documenting the conflict settled the matter. It didn't, and that framing was loose. What Journey 3's screens should actually *do* given the conflict - the production-level resolution - is still explicitly deferred to a future Journey 3 Reconciliation document, exactly like Journey 4's is right now. Both journeys are sitting at the same point: the conflict is found and classified, nothing about actual product behavior has changed yet. Correcting this here rather than letting the earlier framing stand uncorrected.
