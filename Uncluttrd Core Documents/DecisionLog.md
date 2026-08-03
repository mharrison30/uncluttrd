# Uncluttrd Decision Log

Last updated: July 2026
Status: Living document. Add an entry whenever a meaningful architectural, product, or business decision is made. Lightweight version of an Architecture Decision Record (ADR) — enough context to remember why, months later.

**Rule: No feature gets built until it's documented in Vision.md, Architecture.md, Commerce.md, CommerceImplementation.md, Analytics.md, ProductPhilosophy.md (what we believe and why - see that document for the product's guiding philosophy), or here. This prevents half-implemented ideas and gives any future developer, including Claude Code, clear guidance before writing code.**

**Rule: Any Cloud Function change that alters a required request shape (new required fields, new auth requirements, or anything the client must send differently) must be explicitly checked for backward compatibility with the currently-live App Store/Play Store build before deploying — not just the branch currently in development. Record the current live build number somewhere visible (a pinned line at the top of BACKLOG.md, updated on every release) so this can be checked quickly, not looked up under pressure during an incident. Added 2026-07-15 after `85168f3` made `analyzePhoto` require an authenticated user and a client-sent `analysisId`, and was deployed straight to `cluttrd-3e335` — the same Firebase project the live public App Store build (build 15, which predates both requirements) also uses. There is no staging project and no separate build profile for internal testing, so every real production user's photo analysis was rejected outright for hours before this was caught. See the `2026-07-15 — analyzePhoto build-15 compatibility outage` entry below and `BACKLOG.md` for the incident and the hotfix.**

---

## 2026-08

### 2026-08-01 — Session Given Stable Identity, Project Remains the Durable Owner
[Decision] Session is promoted from an informal/implicit boundary to a stable-identity Project-owned event object.

[Rationale] A Session must answer concrete later questions - which photos/batches occurred during a specific visit, which items were completed/carried/dismissed/resurfaced during it, when it started and ended, what triggered its end. Without a stable Session ID, these events are only loosely groupable by timestamp or by whatever happens to sit in currentBatch at a given moment, risking one visit's evidence or decisions being misattributed to another.

[Consequences] MatchCandidate (from the item-identity/matching mechanism, already committed) and Persistent Work status transitions must carry a sessionId field alongside their existing fields, so "which Session produced this specific change" remains answerable. This was not part of the original matching-mechanism specification and is being added here as a required field, not a new mechanism.

---

### 2026-08-01 — Project Scope Model — Space or Location Reference, Not Space-Only
[Decision] Every Project has an explicit scope (Space or one Location Reference). Overlapping active Projects on the same physical area are not permitted: a Space may have either one active Space-scoped Project, or several concurrent active Location-Reference-scoped Projects, but never both covering the same ground at once. Superseding an active Project - whether by direct conflict on the same scope, or by narrowing scope (e.g., Kitchen → Coffee Station) - always requires explicit user acknowledgment, never silent inference. This supersedes the earlier "0 or 1 active Project per Space" framing outright; that framing is marked superseded, not deleted, in ObjectModel.md's Project entry and Section 9.

[Rationale] The earlier Space-only framing didn't account for a real case: a user may legitimately want to run a focused Coffee Station effort and a separate under-sink-cabinets effort at the same time, without either blocking the other or being forced to share one undifferentiated memory. The overlap problem this raises is real - two active Projects could, in principle, both touch the same physical area and produce conflicting Persistent Work - but nothing in the repository yet demonstrates that problem needs a general conflict-resolution system to handle it. The simpler rule adopted here (one broad Project OR several non-overlapping focused Projects, never both on the same ground, with any conflict resolved through the existing Superseded mechanism rather than a new one) fully closes the overlap gap for the cases actually described, without inventing new machinery ahead of evidence that anything more complex is warranted. This is the same discipline already applied elsewhere this session: prefer the smaller model that closes the known gap, revisit only if a real case demonstrates it's insufficient.

[Consequences] This entire model - Space, Location Reference, Project - currently exists only as architecture. Direct code verification this session confirmed Space itself has no implementation (no `spaceId` field, no `spaces` collection, no linkage between multiple analyses of the same physical space), and Location Reference has zero implementation anywhere either. This architecture is the target to build toward, not a description of current behavior. Implementing persistent Space is the actual prerequisite for any of this becoming real - Project's scope model, in particular, cannot be meaningfully built before Space and Location Reference themselves exist in code.

---

### 2026-08-01 — Persistent Work Item Identity and Matching
[Decision] Persistent Work item identity is preserved automatically only when identity has already been established, either through stable ID lineage (e.g., explicitly carried-forward items) or prior user confirmation. Semantic or visual similarity between a new Recommendation and existing Persistent Work may only PROPOSE a match - it may not merge histories, inherit status, reopen completed work, or resurrect accepted-as-is work without structured user confirmation.

[Rationale] Prevents the same category of overreach already disallowed elsewhere (AI silently judging item independence, AI silently reconciling completion mismatches) - an AI's informal judgment that two things are "the same" is inference, not established fact, and applicability must be established through structured capture, not assumed from similarity.

Match candidate states: proposed, confirmed_same, confirmed_different, deferred. If deferred (user selects "not now" / ignores it), the new item remains its own separate active item - no merge occurs, no timeout auto-resolves it. Companion should not re-ask during the same Session; revisit only when the unresolved relationship creates a real user-facing consequence (both items appearing together, one being completed/dismissed).

Matching inputs: owning Space/Location Reference, abstracted goal, original and later suggestion text, relevant objects/area, prior disposition, current visual evidence - text similarity alone is insufficient.

[Consequences] This is the technical prerequisite that makes the resurfacing UX (both directions - contradicted-done and satisfied-undone) honestly deliverable. Without it, "this came back around" cannot be truthfully claimed, since nothing currently links a new AI-generated suggestion back to a specific prior item.

---

### 2026-08-01 — Match and Memory Resolution Happens at Project/Session Boundary, Not Mid-Work
[Decision] Any unresolved match candidates, ambiguous dismissals, or other "what should Companion remember" questions are batched and resolved at the end of a working Session (after the completion/encouragement moment, not before it), not interrupted into the middle of active organizing work.

[Rationale] Separates "helping the user make progress" (the Session's job) from "keeping Companion's memory accurate" (bookkeeping). Interrupting active work to ask identity-matching questions is friction unrelated to the task at hand. Presented as a simple batched review ("A few things need your input before I remember today's progress"), not multiple modal interruptions.

[Consequences] This ordering is a Session-level pattern for how unresolved memory questions get surfaced. It is explicitly NOT yet generalized into a formal governing principle for other kinds of unresolved state - noted as a real, working pattern worth testing against future cases before promoting it into ArchitecturalReasoningStandard.md.

---

## 2026-07

### 2026-07-31 — Journey 3 — Batch Is the Unit of Recommendation Applicability
[Decision] The batch, not the individual item, is Companion's unit of recommendation applicability. Once a batch is generated and presented, all its items remain actionable for the duration of the session without requiring a new photo between individual completions. Applicability is re-established, for the batch as a whole, at the next natural evidence boundary (the next progress photo).

[Rationale] This is adopted directly as a product decision, not derived as a logical necessity from the Class 1 principles alone - a prior architectural investigation into whether AI-instructed item independence could itself satisfy the Evidence Boundary was suspended without a conclusion (see the unresolved first-order/second-order inference question). This decision doesn't require that question to be resolved: rather than attempting to prove in advance that sibling items are independent, the system instead commits (see the companion decision below) to honestly detecting and surfacing cases where that assumption turns out to be wrong, rather than silently absorbing the discrepancy. This resolves the underlying Evidence Boundary concern through correction rather than advance proof.

[Consequences] Resolves Journey3.md's O15 (evidence-first vs. trust-then-verify pacing question): trust-then-verify, bounded by the batch's own next photo, same shape as the already-shipped batch-to-batch mechanism, now deliberately adopted at this grain too, for this stated reason. Journey 4's "historical session context" language is confirmed consistent with this decision - Journey 4 already treated the resumed batch as one coherent unit, matching this decision's grain exactly. No amendment to Journey4Reconciliation.md is required.

---

### 2026-07-31 — Journey 3 — Mismatched Items Must Be Surfaced, Not Silently Reconciled (Supersedes Prior Silent-Reconciliation Instruction)
[Decision] This explicitly supersedes the "don't call out the discrepancy" instruction in the batch-generation AI prompt (established by the 2026-07-18 "Companion batch workflow" decision). Going forward: if a fresh progress photo shows an item previously marked "checked" was not actually addressed, Companion must resurface that item rather than silently generating around it. The resurfaced item must reach one of two explicit terminal states before it is treated as resolved: (a) the user confirms it's acceptable as-is (explicit dismissal), or (b) the user completes it. Until either occurs, the item continues to be resurfaced at future evidence checkpoints.

[Rationale] Adopted directly as a product decision. Not treating this as a Provenance Addendum - the original "don't call out the discrepancy" instruction wasn't factually wrong when written, it was a legitimate design choice being deliberately changed here, not corrected.

[Consequences] A session's completion state (the celebratory "you're done" moment) is withheld while any resurfaced item remains unresolved. This does NOT block navigation, pausing, or leaving the session at any point - the user can always exit freely, consistent with every other flow in this product (Journey 1's "Not right now," Journey 3's own "Pause Session," Journey 4's return choice). Only the completion trigger itself waits on resolution. Implementation will need to identify existing item-status machinery (carried/skipped statuses already exist in currentBatch.items) and determine whether they already support this behavior or need extension - flagged for implementation, not decided here.

---

### 2026-07-31 — Journey 2: Recovery Escalation Governing Principle
**Decision:** A recovery flow may escalate only when Companion has learned something new and user-relevant since the prior stage - repetition of the same failure is itself new evidence exactly once (that the attempt is not resolving), but escalation is never justified by failure count alone once no further new evidence exists. Further escalation requires genuinely new evidence, not merely additional attempts.
**Rationale:** This generalizes the reasoning already applied separately to Journey 2's two recovery flows into a single, explicit test, rather than leaving each flow's stopping point as an unexplained coincidence. It follows directly from the Evidence Boundary: Companion may act on what repetition itself establishes (that the failure is persisting, not resolving), but attempt count beyond that point is not itself evidence of anything - it is just more attempts. Treating failure count alone as license to keep escalating would let the UI imply an evaluation ("this is getting worse," "we should try something different") that no observation actually supports.
**Evidence considered:** Journey2.md Section 5's now-settled Upload Failure and Recovery Lifecycle entries, both of which independently stopped at a single escalation step; the 2026-07-31 "Journey 2: Upload Failure Escalation and Recovery" decision; the project's Evidence Boundary and Observation ≠ Evaluation principles.
**Consequences:** Observed, not defined by this rule: applied to both of Journey 2's recovery flows, this test currently produces exactly one escalation each. That is a fact about the evidence available in those two flows today, not a hard cap this principle imposes on future recovery flows - a flow with a genuinely different evidence profile could justify a different number of stages under the same test. Separately: pause ("Not now") must remain an explicit, first-class option in any recovery flow, never an implicit escape the user has to discover on their own.
**Related artifacts:** Journey2.md (Section 5, Upload Failure and Recovery Lifecycle settled entries), "2026-07-31 — Journey 2: Upload Failure Escalation and Recovery."

---

### 2026-07-31 — Journey 2: Upload Failure Escalation and Recovery
**Decision:** Journey 2's "Upload failed" recovery flow (O18) escalates its messaging based on attempt count, not elapsed time. Attempts 1-2 use the original wireframe copy unchanged: "We couldn't upload your photo. Check your connection and try again." Beginning at attempt 3, the copy changes to: "We're still having trouble uploading your photo. It doesn't look like this is resolving. You can try again in a moment, or come back to this later." This attempt-3 copy reports only the observed fact of persistence - it makes no diagnosis of cause and does not imply eventual success. Escalation stops at attempt 3; no further copy changes occur on attempts 5, 8, 12, or beyond, since repetition beyond confirmed persistence adds no new evidence. Starting at attempt 3, a secondary "Not now" text-link action appears alongside "Try Again," matching the pattern already established by Journey 1's "Not right now" and Journey 3's "Pause Session." "Not now" pauses the upload attempt only: it exits the upload flow, leaves the current organizing session intact, preserves existing progress, and lets the user resume later exactly where they left off. It is not a cancellation.
**Rationale:** Attempt-based triggering (rather than time-based) treats repetition itself as the evidence Companion is entitled to act on, consistent with the Evidence Boundary - persistence across attempts is something Companion can honestly observe, while elapsed time alone establishes nothing about cause. The attempt-3 copy is deliberately restricted to reporting persistence rather than diagnosing cause (no "check your connection," no speculation about Wi-Fi or signal) for the same reason: Companion has no basis to know the actual cause of an upload failure, and asserting one would violate the same Evidence Boundary already governing Insufficient Evidence Recovery. Escalation is capped at one step, not a ladder, because after persistence is confirmed at attempt 3, no additional attempt count produces new information - there is nothing further to honestly say. The "Not now" action is required, not optional, because without it a user stuck on a persistently failing upload has no honest exit that preserves their session progress; forcing continued retries or an implicit abandonment would both be worse than an explicit, honest pause.
**Evidence considered:** Journey2.md Section 5 (Upload Failure item and its prior candidate-principle observation, not yet adopted); Journey2.md O18 (original wireframe copy for "Upload failed"); the established "Not now"/"Pause Session" pattern from Journey 1 and Journey 3; the project's Evidence Boundary and Observation ≠ Evaluation principles.
**Consequences:** Client implementation must track a per-upload-attempt counter (not a timestamp) to select between the two copy variants. The "Not now" action must route through the same pause mechanism already used elsewhere in Companion (exits the current flow, preserves session state, resumable later), not a distinct or ad hoc implementation. This decision does not extend to Insufficient Evidence Recovery's escalation, which remains a separate, not-yet-decided design question per Journey2.md Section 5's existing dependency note (cause-specific coaching copy is gated on a trigger mechanism that does not yet exist).
**Related artifacts:** Journey2.md (Section 5, Upload Failure item and its closing Observation).

---

### 2026-07-30 — Soft Update-Availability Nudge
**Decision:** The client checks the installed app version against `config/appVersion` (Firestore, per-platform `ios`/`android` fields) once per app launch, and shows a dismissible nudge, "A new version of Uncluttrd is available," with "Update Now" (deep-links to the correct App Store/Play Store listing) and "Not Now" (dismisses). This is explicitly a soft nudge, never blocking app usage - no minimum-required-version or forced-update mechanism exists or is planned as part of this decision.
**Rationale:** Users on stale builds miss fixes silently, with no existing signal telling them a newer build exists. A soft, dismissible nudge closes that gap without the cost/risk of a forced-update flow, which is a materially bigger decision (server-enforced minimum versions, blocking screens) explicitly out of scope here.
**Implementation notes:** Version comparison is plain dot-separated-integer comparison (`isVersionBehind`, App.js) - no semver dependency added. The nudge is suppressed for 24h after being shown, tracked via a single AsyncStorage timestamp (`lastVersionNudgeShownAt`) written the moment the alert is shown, not only on "Not Now" - this also covers "don't reappear this session" as a side effect, since 24h always exceeds one session. Gated on `IS_PRODUCTION`; staging builds aren't distributed via the stores, so there's nothing to compare against. `config/appVersion` is public-read, never client-writable (firestore.rules) - it must be updated manually (Firebase Console or an Admin SDK script) after each store release, or the nudge will never fire.
**Consequences:** `config/appVersion` must be kept current after every App Store/Play Store release, or the feature silently does nothing (never a false positive - a missing/stale doc just means no nudge, a safe failure mode, but a real operational dependency). No new npm dependency, no new native module - stays OTA-eligible.
**Related artifacts:** App.js (`checkForAppUpdate`, `isVersionBehind`), firestore.rules (`config/{document}`).

---

### 2026-07-30 — Product Scope Decision: Insufficient-Evidence Recovery Capability
**Decision:** Companion intentionally includes a recovery path for cases where it cannot obtain sufficient evidence to perform a trustworthy analysis, defined by the trustworthiness of the resulting analysis (can Companion justify making observations from this evidence), not by specific image-quality heuristics like blur or darkness — those are one possible cause among several (extreme close-up, near-total obstruction, a blank/black frame, etc.). The triggering mechanism is explicitly left undecided as an implementation detail — client-side heuristic, AI-judged, or otherwise.
**Rationale:** This decision is motivated by, and consistent with, the project's existing Evidence Boundary principle (Companion should not assert what it hasn't established), extended to cover analysis inputs, not just output claims. It is recorded here as a deliberate product choice in that spirit, not as something the Evidence Boundary as previously defined strictly required — attempting analysis on any input and producing appropriately hedged output would not, on its own, have violated the existing principle. This decision chooses the more conservative path deliberately.
**Evidence considered:** Journey2.md Section 5 (confirmed: no corresponding implementation exists anywhere in functions/index.js or App.js — this is a genuine gap, not an undocumented existing behavior); the project's Evidence Boundary and Observation ≠ Evaluation principles.
**Consequences:** A real recovery flow must be designed and implemented; none currently exists. Trigger mechanism and the recovery flow's UX (Journey2.md's Questions 3 and 4) remain separate, later decisions.
**Related artifacts:** Journey2.md, DecisionLog.md's Evidence Boundary entries.

---

### 2026-07-30 — Architecture Decision: Active Location Persists Across Inter-Journey Handoffs
**Decision:** An active Location is preserved across inter-journey handoffs by default, unless a subsequent journey intentionally changes or exits that context.
**Rationale:** The original Journey 1 → Journey 2 decision was scoped narrowly to that one handoff, but its underlying reasoning, protecting continuity of user intent and context across a workflow boundary, was never actually specific to that pair of journeys. The repository first established the rule for Journey 1 → Journey 2; this entry recognizes that reasoning as an instance of a broader architectural rule, rather than claiming the general rule existed all along.
**Evidence considered:** "2026-07-30 — Journey 1: Take Photo Transition" and its Provenance Addendum; Journey2.md Section 5 (Question 2, confirmed NOT SETTLED as a general rule prior to this entry).
**Consequences:** The Journey 2 → Journey 3 handoff, and any future inter-journey handoff, must preserve the active Location by default. A future journey that intentionally changes or exits Location context must do so explicitly.
**Related artifacts:** "2026-07-30 — Journey 1: Take Photo Transition," its Provenance Addendum, Journey2.md.

---

### 2026-07-30 — Journey 1: Session Screen Heading and Carry-Forward Language
**Decision:** The Journey 1 resumption screen's heading communicates continuity of work, not ownership or calendar time (leading candidate: "Picking up where you left off," or wording in the same emotional register — exact final copy remains flexible within that register). The carry-forward items are described as "You asked to come back to..." — reflecting an established historical fact, not inventory framing ("chose to keep" was rejected for this reason).
**Rationale:** The heading should do the same job "Welcome back" does on Screen 1 — evocative and functionally clear at once, not a screen label. "Your Session" and "Today's Session" (the artifact's own internal inconsistency) both fail this test. "Today's Focus" was considered and explicitly rejected as a candidate here — it originated later, during Journey 3's design work, and was never adopted as a Journey 1 decision (verified via a Stage 1 check against DecisionLog.md and ObjectModel.md); using it now would need to be a deliberate, separate decision, not an unconscious carryover.
**Evidence considered:** Journey1.md Section 3 (O9, "Welcome back" as the Screen 1 precedent); Journey1.md Section 5 (the internal "Your Session"/"Today's Session" and "asked to come back to"/"chose to keep" inconsistencies); the project's Evidence Boundary principle and Observation ≠ Evaluation.
**Consequences:** Final heading copy for Journey 1's second screen must be selected from the "continuation" register, not the "commitment" or "place" register (see the 2026-07-30 Growing Kept-Items List Behavior entry below for why those registers were named and ruled out for a different, related case).
**Related artifacts:** Journey1.md, DecisionLog.md's Evidence Boundary entries.

---

### 2026-07-30 — Journey 1: Space/Location Relationship (Kitchen ↔ Coffee Station)
**Decision:** The user returns to a Space and resumes work at a recurring Location within that Space. The Space provides continuity and context; the Location provides the immediate focus of the organizing session. The transition from Space to Location must be communicated explicitly to the user, never assumed or left implicit.
**Rationale:** Users think "I'm back in my Kitchen" first, and "I'm working at the Coffee Station" second — a nested mental model, not a flat one and not one where the Location supersedes the Space. This independently converges with ObjectModel.md's existing Location Reference definition ("a recurring, user-recognizable sub-location... does not require promotion into an independent Area object") without having been designed with that definition in mind.
**Evidence considered:** Journey1.md Section 3 (O11 "Current Space: Kitchen," O16/O25 "Coffee Station" with no stated relationship); ObjectModel.md's Location Reference definition.
**Consequences:** Future UI must show the Kitchen→Coffee Station zoom explicitly (exact copy/typography not yet decided — remains open). This also resolves how a growing kept-items list could later group by Location without promoting any Location to Space-equivalent status (relevant to the Growing Kept-Items List Behavior entry below).
**Related artifacts:** Journey1.md, ObjectModel.md (Location Reference).

---

### 2026-07-30 — Journey 1: Take Photo Transition
**Decision:** The transition from Journey 1 to Journey 2 should communicate uninterrupted forward momentum. Tapping "Take Photo" should lead directly into the camera experience without introducing additional instructional, explanatory, or ceremonial steps. Any transition motion should serve only as immediate interaction feedback, not as a separate stage in the journey. The transition must also preserve the active Location context (e.g., Coffee Station) so that the camera experience begins with the correct location already established, consistent with Journey 2's documented expectation of a known location context.
**Rationale:** Journey 2's own wireframe explicitly states its happy path as "Camera opens immediately... One calm instruction. No explanation. No ceremony," which rules out instructional or ceremonial transition content — that responsibility already belongs to Journey 2, not to this handoff. Journey 2's wireframe also displays a persistent Location badge on every screen, meaning it already assumes the active Location is known at camera-open — the transition must carry that context forward, not just get the user to the camera.
**Evidence considered:** Journey 2 wireframe (happy path description; persistent Location/Coffee Station badge present on every screen of the happy path, reshoot loop, and insufficient-evidence recovery flow).
**Consequences:** Journey 1's implementation must pass the active Location through to Journey 2's entry point as part of this transition.
**Related artifacts:** Journey1.md, Journey 2 wireframe (once its own transcription/reconciliation happens).

---

### 2026-07-30 — Provenance Addendum
**Addends:** 2026-07-30 — Journey 1: Take Photo Transition.
Direct inspection during the creation of Journey2.md found that the Journey 2 wireframe contains a single page-level Coffee Station / Location badge rather than a repeated badge on every individual screen, contrary to the wording used in that entry's rationale. This finding does not affect the underlying decision that Journey 1 must preserve the active Location across the transition into Journey 2; it only narrows the supporting UI observation. See Journey2.md Section 3 (O3) for the verified artifact transcription, and Section 6 for the direct comparison against this entry's original wording.

---

### 2026-07-30 — Journey 1: Growing Kept-Items List Behavior
**Decision:** The interface communicates a starting point, not a priority ordering, regardless of how many carry-forward items exist. A structure in the shape of "We'll start here" (one or a small set of items that continue the session) plus "More to come back to later" (the remainder, mechanism not yet decided — expandable, scrollable, or otherwise) preserves this. The lower items must never be implied to be less important — only that they aren't where today's session begins.
**Rationale:** Journey1.md's own Screen 2 rationale (O22) states "'We'll start with' is an intention, not a priority" — this already rules out any design that implies sequence-as-importance (sorting by priority/urgency/age, "X remaining," "overdue," etc.) for a single item, and that same principle extends to a full list. "Visible accumulation" as an emotional target was also explicitly rejected — it conflicts with the artifact's own "No scores / No percentages" callout (O7).
**Evidence considered:** Journey1.md O7, O22.
**Consequences:** Whatever specific list-behavior implementation is chosen (collapsible sections, scrolling, progressive disclosure, etc.) must be evaluated against this principle before being finalized.
**Open Design Detail (explicitly NOT part of this decision, left for implementation):** whether the "start here" set is always exactly one item or can be a small set of two or three — this is an implementation detail of the decision above, not a separate design decision.
**Related artifacts:** Journey1.md.

---

### 2026-07-29 — Space Promoted to Persistent First-Class Object
**Decision:** Approved: Space is a persistent first-class object with independent identity, ownership, lifecycle, and relationships. Every new analysis must be associated with a Space through explicit user confirmation, by selecting an existing Space or creating a new one. The system may suggest an association but may not establish or merge Space identity through inference.
**Reason:** Space association is separate from the Decision-Dimension Taxonomy because it establishes identity before any Recommendation exists.
**Outcome:** Approved.

---

### 2026-07-27 — Recommendation Promoted to First-Class Object
**Decision:** Recommendation is promoted to a first-class object.
**Reason:** It has identity, ownership, lifecycle, and relationships independent of any single screen; Journey 5 already established that modification behavior belongs to the object, not the UI.
**Outcome:** Approved.

---

### 2026-07-27 — Decision Dimension Confirmed as Controlled Vocabulary, Not an Independent Object
**Decision:** Decision Dimension is confirmed as controlled vocabulary, not an independent object.
**Reason:** No independent identity, ownership, or lifecycle; exists only as a referenced value.
**Outcome:** Approved.

---

### 2026-07-27 — Remembered Statement Supports Two Creation Paths
**Decision:** Remembered Statement supports two creation paths - structured (carries Decision Dimension, actionable) and volunteered (no Decision Dimension, memory only, not directly actionable). Both are the same object type.
**Outcome:** Approved.

---

### 2026-07-27 — Decision Dimension Is Shared Controlled Vocabulary Referenced by Both Recommendation and Remembered Statement
**Decision:** Decision Dimension is shared controlled vocabulary referenced by both Recommendation and Remembered Statement - this shared reference is the mechanism that allows a stored Remembered Statement to be matched against a future Recommendation.
**Outcome:** Approved.

---

### 2026-07-27 — Claim Identity Remains Explicitly Deferred to Journey 5.1
**Decision:** Claim Identity remains explicitly deferred to Journey 5.1. Not resolved by this reconciliation.
**Outcome:** Approved.

---

### 2026-07-26 — Explicit Truth Carries Its Own Scope
**Decision:** Explicit Truth Carries Its Own Scope
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** Journey 5 initially appeared to require a propagation model for remembered truths - some system for deciding how broadly a stated preference should apply. A counterexample showed this assumption was unnecessary. Consider "I prefer baskets because I cook every day" versus a bathroom medicine cabinet encountered months later. Applying the preference there would mean silently generalizing beyond the reason the user actually gave - inferring a broader scope than what was stated. The statement itself already establishes its legitimate scope; Companion does not need to assign one afterward.
**Decision detail:** The scope of an explicitly remembered truth is determined solely by what the user explicitly states. Companion must neither broaden nor narrow that scope through inference. "I prefer baskets" is broad - no narrower scope was stated. "I prefer baskets because I cook every day" is limited by the reason the user supplied - Companion may honor that preference where the stated rationale applies, but must not silently generalize beyond it. "I hate labels in this drawer" is explicitly local - Companion must not apply it elsewhere. No additional ownership or propagation system is required; the remembered truth already contains its own scope.
**Use instead:** Scope is evidence. It is not metadata added later. Companion remembers what the user said, including any limits the user placed on that truth. It may not manufacture broader or narrower applicability than what was explicitly stated.
**Revisit when:** Only if a pattern emerges across many remembered truths that cannot be resolved by reading the scope directly from what the user stated - at that point, a more structured scope model may need its own independent discovery.

---

### 2026-07-26 — Observation Does Not Establish Evaluation
**Decision:** Observation Does Not Establish Evaluation
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** Journey 5 explored whether repeated organizing history could justify changing future recommendations. The working assumption was that a Space being organized, then messy again, implies the previous strategy failed. A counterexample demonstrated that the available evidence does not support this conclusion: the same repeated observations (organized, then messy again) are equally consistent with two opposite evaluations - that the previous strategy failed, or that the previous strategy succeeded exactly as intended. Because the available observations support both interpretations equally, Companion is entitled to neither. The boundary is therefore not about confidence - it is about evidence type. Observation establishes events. Evaluation establishes meaning. One cannot substitute for the other.
**Decision detail:** Repeated observations establish what occurred. They do not establish whether the observed outcome represents success, failure, or a problem requiring a different strategy. Evaluation requires independently grounded evidence. Observation answers "what happened?" Evaluation answers "what does that mean?" Repeated observations never become evaluation simply by accumulating. Evaluation requires evidence that directly addresses success, failure, satisfaction, or intent.

Consequences: Long-term photo history alone cannot justify changing organizing strategy. Long-term memory remains valuable for remembering explicit user preferences, accepted or rejected strategies, user feedback, and durable organizing decisions. Those are evaluative signals because they originate from explicit evidence rather than inference.
**Use instead:** Companion may use repeated observations to report history - for example, number of completed sessions, recommendation history, or previously completed work. Companion must not infer that a strategy succeeded, that a strategy failed, that recurrence is desirable or undesirable, or that a different strategy is now required. Those conclusions require independent evaluative evidence, such as explicit user feedback or another separately grounded signal.
**Revisit when:** If Companion gains a new, independently grounded source of evaluative evidence beyond repeated observations, this boundary may be revisited.

---

### 2026-07-26 — Every Visible Element Asserts Both Truth and Importance
**Decision:** Every Visible Element Asserts Both Truth and Importance
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** Earlier journeys established that every visible element is a claim about what Companion knows. Journey 5 exposed a separate failure mode. A rejected history wireframe presented only truthful, evidence-supported facts (five completed sessions, most recent session, included in the last five sessions), and it passed Evidence Review, Layout Review, Language Review, and Process vs Outcome Review. It was still architecturally incorrect. The failure was not that the information was false - it was that the interface never justified why those particular facts deserved the user's attention. Truth alone does not justify presentation. Selection itself communicates importance, and that assertion must be justified just as rigorously as the fact itself.
**Decision detail:** Every visible element makes two independent claims. Truth (Epistemic Claim): Companion is entitled to know this. Governed by the Evidence Boundary. Importance (Relevance Claim): Companion is entitled to interrupt the user's attention with this now. Governed by product value. A fact must change understanding, decision-making, or available action to justify proactive presentation. Otherwise it belongs in history, not in the current experience.

The review order becomes:
1. Evidence Review - Is Companion entitled to know this?
2. Relevance Review - Why this? Why now? What changes because it is shown?
3. Layout Review - Does presentation imply unsupported importance or preference?
4. Language Review - Does wording imply unsupported certainty or characterization?
5. Process vs Outcome Review - Does the interface describe only earned process, or does it predict outcomes?

Each stage assumes every earlier stage has already passed. A fact that fails Relevance Review should never proceed to Layout or Language review.

This prevents a new class of architectural error: displaying truthful but non-actionable information simply because it is available. It also establishes that prominence, grouping, ordering, badges, summary cards, callouts, and highlighted metrics are all relevance claims, not merely presentation choices.
**Use instead:**

**Passes Evidence, fails Relevance:** "This drawer has appeared in your last five completed sessions." True, but if it changes neither recommendation nor user decision, it should not be proactively surfaced.

**Passes Evidence and Relevance:** "This recommendation is based on today's photo." True, and relevant because it explains why the recommendation can be trusted.
**Revisit when:** If Companion later demonstrates that long-term memory changes future recommendations in ways that improve user decisions, Relevance Review may justify surfacing some historical context. The burden remains on demonstrating why the history matters now, not merely that it exists.

---

### 2026-07-26 — The Evidence Boundary Applies Across Time, Not Only Across Knowledge
**Decision:** The Evidence Boundary Applies Across Time, Not Only Across Knowledge
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** Companion may describe what has already happened and what it is about to do, but may not describe the results of a process before those results are established. This is the same Evidence Boundary already governing certainty, interpretation, interruption, persistence, and visual hierarchy, now shown to also govern temporal reach.
**Decision detail:** Process description is allowed - a sentence describing the immediate action about to occur. Outcome prediction requires evidence - a sentence describing a future state that has not yet been established is not permitted regardless of how confident or benign it sounds.
**Use instead:**

**Allowed - process descriptions of the immediate action:**
- "Continue from the last recommendation I shared."
- "We'll take a fresh look at the Space."
- "Take a photo of your Space."

**Not allowed - outcome predictions of a future state that has not yet been established:**
- "We'll look at your Space before making a recommendation."
- "We'll figure out the best next step."
- "We'll know what to do next."

**Worked example - final Journey 4 return-screen card copy:**
- Pick that back up: "Continue from the last recommendation I shared."
- Take a fresh look: "We'll take a fresh look at the Space."

These two lines are epistemically parallel rather than grammatically parallel - one truthfully describes the past (a recommendation was shared), the other truthfully describes the immediate next action (a fresh look will happen). Neither predicts a future outcome.
**Revisit when:** Only if the Evidence Boundary itself is intentionally revised.

---

### 2026-07-26 — An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object
**Decision:** An Interrupted, Unconfirmed Recommendation Does Not Become an In Progress Object
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** Silence creates no explicit state transition. The Session retains the historical fact that a recommendation was shown and received no confirmed outcome. "Unresolved" is derived from the absence of Confirmed, Kept, or Removed events - it is not itself a stored state. Creating an In Progress object, or a stored outcome: unresolved field, would require Companion to assert a state that silence and the available evidence do not establish. Storing "unresolved" as a positive classification would also turn the absence of a decision into a system-made claim, and could create synchronization problems if a stored outcome field and the underlying events ever disagreed. This directly conflicts with the adopted Evidence Boundary, so this is forced rather than preferential.
**Decision detail:** Assume the Session already records the recommendation that was presented, whether the user confirmed completion, whether the user explicitly kept or dismissed it, and session activity history. The possible outcomes are: confirmed_at exists -> Confirmed; kept_at exists -> Deferred into Persistent Work; removed_at exists -> Removed; none of the above -> Unresolved (the null case, not a stored value). The Session needs enough historical data to establish which recommendation was displayed, when it was displayed, whether any explicit outcome followed, and when activity last occurred. This is ordinary history about the temporary Session, not a new architectural state.

Consequences: Pause can remain low-friction, since no classification question is required when the user leaves. Persistent Work is created only through an explicit Keep decision - silence never satisfies this. Returning users are shown remembered context without Companion pretending it knows the current physical state. Fresh evidence is required before Companion independently reasserts or replaces a recommendation.
**Use instead:** On return, Companion may honestly say "Last time, I suggested clearing the countertop" and "We didn't confirm what happened after that." It may not say "Continue clearing the countertop" - that would claim the old recommendation remains valid without current evidence. The next interaction should offer a real choice, such as "Pick that back up" versus "Take a fresh look." "Pick that back up" must be understood as the user choosing to resume the prior recommendation, not Companion asserting that it is still correct. If the user asks for a fresh look instead, Companion gets new evidence before recommending anything.
**Revisit when:** Only if the Evidence Boundary is intentionally revised, or if the product gains a reliable mechanism (such as continuous observation) that would justify Companion asserting a recommendation remains valid without a fresh photo.

---

### 2026-07-26 — Session Generation and Session Presentation Are Separate Architectural Concerns
**Decision:** Session Generation and Session Presentation Are Separate Architectural Concerns
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** Companion may internally generate a broader organizing strategy from the available evidence. That internal strategy may include possible actions, dependencies, ordering, and alternatives. The existence of that reasoning does not entitle the interface to present the full strategy as settled fact. A complete visible plan would imply that the interpretation is stable, the execution order is settled, future evidence will not change the strategy, and every listed action is already trustworthy enough to ask of the user. The architecture does not support those claims. As the user acts, the Space changes and new evidence may reveal that an anticipated action is unnecessary, incorrect, incomplete, or should be reordered. Showing the full plan beforehand would therefore require Companion either to preserve a claim it no longer believes or silently revise something it previously presented as settled. Companion instead presents only the next action that is currently supported by the evidence.
**Decision detail:** Companion reveals trustworthy actions, not complete plans. The session unfolds as a repeated cycle: Observe, recommend one trustworthy action, observe again.

**Consequence - No "Today's Plan" Screen:** There is no legitimate list-of-steps screen to redesign. It is removed entirely. Companion may hold a broader internal strategy, but the user experience exposes one trustworthy action at a time.

**Consequence - Session Completion:** A session is complete when Companion has no further trustworthy action worth asking the user to take today. Completion does not mean the Space is finished, every possible task is complete, or the user successfully completed a predefined plan. It means the current session has reached the limit of what the present evidence and context support. This is consistent with Persistent Work because unfinished, deferred, or later-relevant work can remain attached to the Space without preventing the current session from ending.

**Consequence - Claim-Strength Audit:** The existing claim-strength review must check not only numbers and visual metrics, but also language that implies hidden evaluation. Review question: does this word imply Companion has evaluated something it has not actually established? Terms requiring an evidentiary basis include high impact, important, critical, priority, easy, difficult, quick, major, and minor. These are not automatically forbidden, but Companion may use them only when the claimed judgment is supported by a defined and demonstrable signal. Confidence that a task exists is not evidence of its impact, importance, or difficulty.

**Use instead:** The interface may show Today's Focus, the current action, practical guidance for that action, Retake or refresh evidence controls where required, Pause or adjust controls, and the next action once it becomes trustworthy. The interface must not show a complete numbered plan, a fixed step count, an upfront execution roadmap, or future actions presented as settled commitments.
**Revisit when:** Revisit only if the product later gains reliable, user-visible evidence that can support stable future actions, such as continuous visual observation or explicit user confirmation of the complete session strategy. Until then, Journey 3 must use reveal-as-you-go presentation.

---

### 2026-07-30 — Provenance Addendum
**Addends:** 2026-07-26 — Session Generation and Session Presentation Are Separate Architectural Concerns.
Verification conducted 2026-07-30 found that this entry's language - "recommend one trustworthy action, observe again" - uses "action" to mean a single discrete item, consistent with the repository's usage since the 2026-07-13 founding design ("Companion Experience, Session 1"). This does not match shipped behavior: the 2026-07-18 "Companion batch workflow" decision (predating this entry by 8 days) established that both analyzePhoto and generateNextAction shifted to multi-item batches, with no stated exception preserving single-item behavior for the first reveal - confirmed directly against firstActionBatch's shipped prompt instructions ("a small checklist... not a single tiny step"). This entry's singular "one trustworthy action" language does not reflect that already-adopted architecture. This finding does not resolve what "single-trustworthy-action" should mean going forward - see the separately planned investigation into that principle's current status.

---

### 2026-07-26 — Visual Weight Must Be Proportional to Claim Strength
**Decision:** Visual Weight Must Be Proportional to Claim Strength
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** This is a direct extension of the previously adopted Evidence over Inference principle and the Pre-Photo Evidence Boundary. A screen's visual composition makes claims just as surely as its copy does - size, contrast, whitespace, and container treatment all communicate importance independent of what the words say. A composition can overclaim even when every individual sentence on the screen is honest. Any alternative would allow layout to silently contradict a claim classification the architecture has already established, which is not permissible under Evidence over Inference.
**Decision detail:** Visual emphasis given to any element must match the evidentiary strength of the claim that element represents, using this scale: a durable fact may receive strong visual treatment; a temporary intention should receive moderate treatment; a prediction should receive restrained treatment; a hypothesis should receive minimal treatment. This principle governs the relationship between claim strength and visual weight - it does not prescribe specific visual techniques (e.g., whether to use a card, an icon, or plain text) for any given tier. Those remain implementation choices to be evaluated per screen.
**Use instead:** When reviewing any wireframe or screen, run two independent checks: (1) is every individual claim in the copy honestly scoped to its available evidence, and (2) does the visual hierarchy make a stronger claim than the copy does. A screen can pass the first check and fail the second - both must be checked separately.
**Revisit when:** Only if Evidence over Inference or the Pre-Photo Evidence Boundary are intentionally revised.

---

### 2026-07-26 — Pre-Photo Evidence Boundary
**Decision:** Pre-Photo Evidence Boundary
**Decision Class:** Class 1 - Forced Discovery
**Status:** Adopted
**Why:** This is a direct consequence of previously adopted architectural principles - Evidence over Inference, Durable Memory, and Space ownership. Any alternative would require Companion to make claims about the current physical state without supporting evidence, contradicting the established architecture.
**Decision detail:** Before a fresh photo exists, Companion may only present information derived from: explicit user decisions, the current Space, and durable history. Fresh recommendations require fresh evidence.
**Use instead:** Structure Companion flows as: (1) Surface durable context, (2) Capture fresh evidence, (3) Generate new recommendations.
**Revisit when:** Only if the underlying architectural principles (Evidence over Inference, Durable Memory, or Space ownership) are intentionally revised.

---

### 2026-07-26 — Working Set is Computed, Not Stored
**Decision:** Working Set is Computed, Not Stored
**Decision Class:** Class 2 - Product Philosophy
**Status:** Adopted
**Why:** Persistent Work may span many organizing sessions, while each session should remain achievable (approximately 10-15 minutes). Treating the Working Set as computed rather than stored preserves a simple ownership model and avoids prematurely introducing another durable object without evidence that it requires independent identity or lifecycle.
**Decision detail:** Companion sessions present a bounded Today's Working Set, assembled from Persistent Work at the start of each session. The Working Set is an ephemeral planning construct, not a durable object.
**Use instead:** Persistent Work remains the durable source of truth. Session planning selects an appropriate subset for today's session. The selection process produces a temporary Working Set used only for that organizing session.
**Revisit when:** When defining the product philosophy for Working Set selection, including questions such as: What emotional experience should Companion create when choosing today's work? Should the emphasis be responsibility, momentum, coaching, user agency, or another philosophy? Does user research indicate a need for a persistent planning object with its own identity or lifecycle? Note: Class 2 decisions are validated by real user reaction, not by scenario counterexamples - the appropriate test for revisiting this decision is user research or direct product testing, not further architectural reasoning.

---

### 2026-07-26 — Space progress is not represented as task counts or completion percentages
**Decision:** Do not represent overall Space progress as task counts or completion percentages.
**Why:** Companion is designed to support an ongoing relationship with a home, not to encourage completion-chasing. Quantitative progress implies a finite endpoint that doesn't reflect how homes evolve over time.
**Use instead:** Qualitative continuity ("picking up where you left off"), remembered context, and visible improvements. Session-scoped counts (e.g. "2 of 5 items completed" within a single active Session) remain acceptable, since a Session has a defined, bounded scope - unlike a Space, which does not.
**Revisit when:** If future user research shows people struggle to understand whether they're making progress without lightweight metrics.

---

### 2026-07-26 — Adopt ObjectModel.md v0.1 (Draft)
**Decision:** `ObjectModel.md` is created as a new foundational document, alongside ProductPhilosophy.md, ArchitectureGuide.md, and SpaceMemoryModel.md, depending on all three. It defines what objects exist in Uncluttrd's organizing domain and what owns what - not behavior over time (LifecycleModel.md), not storage implementation (PersistenceModel.md), and not the reasoning/evidence/history behind each decision (kept exclusively in this Decision Log). Adopted at Status: Draft, not Adopted - expected to gain further refinement once LifecycleModel.md and PersistenceModel.md exist and exercise these objects against real behavior and storage. Every statement in the document carries an explicit confidence tier (Settled, Provisional, Open, or Explicitly Rejected), per Section 2, "How to Read This Document."

**Settled, Space-owned durable objects (four):**
- Space - the root object of the organizing domain, owning the durable understanding and product activity associated with one real-world space.
- Persistent Work - a Space-owned object with stable identity that survives beyond the Session that created it, persisting as the exact item rather than a summary, and able to resurface in later Sessions.
- Location Reference - a Space-owned identity for a recurring, user-recognizable sub-location, carried by a stable internal ID rather than any single attribute, able to retain identity across renaming or relocation when evidence supports continuity.
- Durable Memory - Space-owned retained understanding, supported by available evidence, not identical to the raw evidence itself; its categories are already defined in SpaceMemoryModel.md and are not restated here.

**Explicitly rejected promotions (four), with revisit conditions:**
- Area - not currently justified as an independent domain object; the demonstrated requirement (rename/relocation continuity) is satisfied by a Space-owned Location Reference. Revisit if Area gains independent navigation, its own unresolved-work collection, an independent lifecycle, sharing/permissions, or an identity independent of its owning Space.
- Correction - an event and a source of evidence, not an object. Revisit only if new evidence demonstrates a need for independent ownership beyond the object it currently attaches to.
- Completion - a lifecycle transition on Persistent Work and a source of evidence, not an independently owned object. Same revisit condition as Correction.
- Deferral - a lifecycle event recorded on Persistent Work, not a separate object. Same revisit condition as Correction.

**Open questions (five), with what would resolve each:**
- Location Reference lifecycle (what makes a reference inactive, whether it can reactivate, whether reappearance reactivates the same identity or creates a new one) - resolves once real usage produces evidence of how renamed, relocated, or reappearing locations actually behave.
- Snapshot ownership and lifecycle (provisionally Space-owned) - resolves once deletion and historical-consequence scenarios are actually exercised, most likely once LifecycleModel.md defines deletion behavior.
- Runtime understanding / working interpretation representation - genuinely open, not leaning toward a three-layer model or any other specific structure; resolves once a concrete representation is designed against real interaction/prompt-assembly requirements.
- Whether repeated deferral of Persistent Work should independently produce behavioral memory - resolves from the deferral count/history evidence already being preserved for this purpose, once real usage accumulates enough of it to judge.
- Cross-cutting deletion behavior (Space deletion, account deletion) for the four durable responsibilities - explicitly deferred to LifecycleModel.md; resolves when that document is written.

**Traceability:** Scenario detail, evidence, and reasoning behind every decision in this document stay exclusively in this Decision Log rather than being duplicated in ObjectModel.md itself - ObjectModel.md states conclusions and their confidence tier only, matching ArchitectureGuide.md's Writing Standards (Principle before Reasoning before Examples, decisions/hypotheses/open/deferred stated explicitly) and Revision Philosophy (significant changes recorded in this Decision Log, not re-derived per document).

**Outcome:** Adopted as v0.1, Draft.

---

### 2026-07-26 — Reconcile SpaceMemoryModel.md to v0.2 against ArchitectureGuide.md v0.1
**Decision:** `SpaceMemoryModel.md` is updated to v0.2, a documentation reconciliation against the newly adopted `ArchitectureGuide.md`, not a design change. Four agreed edits: (1) old Sections 4 ("What It Means to Know a Space") and 5 ("Durable Memory Categories") are merged into a single Section 5, since the categories directly answer the question the first section poses. (2) A short bolded principle statement is added at the top of that merged section so it follows the Guide's Principle → Reasoning → Examples progression, matching the style already established by Section 3's Core Principle quote. (3) The document's introductory scope limitations (what the document does and does not define, previously plain prose before the first `---`) are promoted into a new, dedicated Section 2, "Scope Boundary," moved verbatim with no wording changes. (4) Version bumped 0.1 → 0.2. Section numbers 3 ("Core Principle") through 12 ("Questions Intentionally Deferred") shift accordingly; the one internal cross-reference that changed as a result ("The four Guiding Philosophy statements (Section 3)" in the Decisions Made section) is updated to "(Section 4)" - every other internal section reference already landed back on its original number by coincidence, since the one section added (Scope Boundary) and the one section removed (via the 4/5 merge) offset each other for everything after the merge point.
**Reason:** `ArchitectureGuide.md` (adopted 2026-07-26, see entry above) establishes that architecture documents should follow a Principle → Reasoning → Examples progression per section, and that scope limitations should be explicit rather than left as unlabeled introductory prose. This reconciliation applies only those two structural standards to the one existing document they visibly under-served - no other section, wording, or architectural decision in `SpaceMemoryModel.md` was touched, per the Guide's own Revision Philosophy: standards should be applied where they produce a meaningful improvement in an existing document, not enforced as blanket rewrites.
**Outcome:** Approved and applied as v0.2. Still Status: Draft - this reconciliation is a structural/documentation change only and does not resolve any of the questions the document already deferred to ObjectModel.md.

---

### 2026-07-26 — Adopt ArchitectureGuide.md v0.1 as a foundational document
**Decision:** `ArchitectureGuide.md` is adopted as a new foundational document, alongside ProductPhilosophy.md and SpaceMemoryModel.md, in `Uncluttrd Core Documents/`. It defines how architecture documents are organized, how responsibilities are divided between them, and how they evolve over time - the architecture of the documentation itself, not product behavior. It establishes the document hierarchy: Product Philosophy sits at the top, flowing down to Architecture Guide, which branches into four parallel documents at the same level - Space Memory Model, Object Model, Journey, and Analytics - which converge back down into Implementation Plans. This describes conceptual dependency, not implementation order or revision sequence: authority flows downward through the hierarchy, while learning - design pressure that surfaces a needed revision to a higher-level document - flows in every direction.
**Outcome:** Adopted as v0.1.

---

### 2026-07-25 — Create SpaceMemoryModel.md v0.1 (Draft)
**Decision:** `SpaceMemoryModel.md` is created as a new foundational document, alongside ProductPhilosophy.md, Architecture.md, DecisionLog.md, and CompanionDesignPrinciples.md, depending on ProductPhilosophy.md. It answers what Uncluttrd remembers about a Space and why - not how that memory is technically stored or structured. Core principle: a Space is not a database record, it is the AI's evolving understanding of a real place in the user's home. It establishes four guiding-philosophy statements, five durable memory categories (physical understanding, organizing history, user preferences and constraints, purchases and owned organizing products, and behavioral patterns over time) presented as strong working categories rather than a locked list, the distinction between durable memory and temporary coaching context, and the principle that memory must be intentional (not exhaustive) and must support correction and deliberate forgetting, not just indefinite accumulation.
**Status note:** No existing convention for marking a document "Draft" versus "Adopted" was found elsewhere in this Decision Log - ProductPhilosophy.md is the only prior foundational document adopted this way, and it shipped straight to v1.0/Adopted. This entry and the document's own metadata block state "Draft, v0.1" in plain prose rather than inventing a new formal status taxonomy.
**Deliberately deferred, not resolved here:** whether a smaller persistent object exists inside a Space; whether that object is called an "Area"; whether every photo creates an "Observation"; whether Observations belong to a Space, an Area, or begin unattached; whether Areas (if they exist) are user-created, AI-inferred, or gradually discovered; how much of memory is stored as structured fields versus a summarized AI-generated understanding; Session/Plan naming and lifecycle mechanics; billing/pricing mechanics; and Firestore schema/migration mechanics. The migration principle "every existing Plan becomes exactly one Space, no customer loses data, history, or access" is already decided and belongs in the future Object Model/migration plan - it does not control this document's content. All of the above remain open for ObjectModel.md.
**Outcome:** Created as v0.1, Draft. Expected to change through drafting - to be revisited once ObjectModel.md exists and once real product usage exists to test the memory categories against.

---

### 2026-07-25 — Adopt ProductPhilosophy.md v1.0 as a foundational document
**Decision:** `ProductPhilosophy.md` is adopted as a new foundational document, alongside Architecture.md, DecisionLog.md, and CompanionDesignPrinciples.md. It defines what Uncluttrd believes and the principles that guide product decisions, structured in four layers: Mission (internal, long-term direction), Product Promise (external-facing guidance), Values (what we believe about people and their homes), and Design Principles (how the product behaves, derived from the Values). It also adds a distinct, prominent "Things We Intentionally Do Not Do" section, protecting explicit product boundaries rather than leaving them implicit.
**Reason:** Features, interfaces, and technology change quickly; the philosophy behind the product should change much more slowly. This document exists so that future decisions - including decisions about problems that do not exist yet - can be checked against a written standard rather than reconstructed from memory, the same reasoning CompanionDesignPrinciples.md already applies at the Companion-feature level, now extended to the whole product.
**Scope decision:** "Trust compounds" was considered as a fifth Value and rejected as a separate entry - its reasoning is folded into the "Honest over persuasive" Design Principle instead, since it describes the mechanism (why honesty matters over time) rather than a distinct belief about people or homes.
**Deliberately deferred, not resolved here:** the future Object Model's definitions of Space, Session, Snapshot, Item, Identity, and Event, and their plain-English relationships; the January-versus-May Session lifecycle question; how Find queries or stores Items; Firestore schemas or write behavior; AI-session pricing; subscription entitlements; and migration mechanics. ProductPhilosophy.md explicitly must not resolve any of these - they belong in the Object Model, Architecture.md, Commerce.md/CommerceImplementation.md, or their own future Decision Log entries, once written.
**Outcome:** Approved as v1.0. Governance requires any future amendment to include a Decision Log entry, a version-number increment, and a dated revision-history note in the document itself - not a casual edit.

---

### 2026-07-24 — Three transactional emails (welcome, Pro upgrade, re-engagement), gated to avoid false triggers
**Decision:** Welcome email fires only when `users/{uid}`'s doc has `isNewSignup: true`, an explicit marker the real signup call site (App.js:359) sets - not on bare `onDocumentCreated`. Pro-upgrade email fires only on a genuine `isPro` transition inside `revenueCatWebhook` (reads the prior value before writing), not on every webhook delivery. Re-engagement nudge is a new hourly `onSchedule` (`reengagementNudge`) querying `createdAt` in a 30h-24h-ago window, sending once per user if they still have zero `plans` docs, marked via `reengagementEmailSentAt`.
**Reason:** `ensureUserDocument` (App.js) creates the `users/{uid}` doc on *any* first-time doc materialization, including a legacy user's routine login - a bare `onDocumentCreated` trigger would have sent "Welcome to Uncluttrd!" to existing users, not just new signups. The `isPro`-transition check avoids re-sending the Pro welcome on every unrelated webhook delivery for an already-Pro user. The re-engagement window is intentionally wider than the hourly schedule interval (30h-24h, not 25h-24h) so one failed/skipped scheduler run doesn't silently strand a cohort forever - `reengagementEmailSentAt` is checked in-memory rather than as a query clause, since Firestore's not-equal-style filters exclude documents missing the field entirely, which is the common case for a brand-new field.
**Known, accepted edge case:** the Pro-upgrade transition check is a read-then-write, not a Firestore transaction - two RevenueCat events for the same uid delivered close together could both read `isPro: false` before either write lands, producing two upgrade emails. Low-stakes (a friendly duplicate, not a billing/security issue), consistent with this codebase's existing risk tolerance for similarly rare races (see `analyzePhoto`'s accepted lost-race case). Not solved in this pass.
**Outcome:** Approved. Reuses `sendCanaryAlertEmail`'s existing Resend-calling pattern via a new shared `sendEmail({from, to, subject, text})` helper in `functions/index.js`, sending from the now-verified `hello@uncluttrd.app` (distinct from the canary alert's Resend sandbox sender). No `firestore.rules` changes needed - `isNewSignup` isn't blocked by the `allow create` rule, and `reengagementEmailSentAt` isn't in the client `allow update` allow-list, so both are already correctly scoped without any rule edits.

---

### 2026-07-22 — `eas build`/`eas update` fingerprint mismatch is a real tooling gap; publish updates in the same session as the build, not retroactively
**Decision:** For every future production release, run `eas update --branch production` immediately after `eas build --profile production` completes, in the same session/environment - not as a separate later step reconstructing the build's state from a checked-out commit.
**Reason:** After build #33, `eas update --branch production` (run later, in a separate session, checked out to the exact same commit) published an update whose fingerprint did not match build #33's embedded runtime version at all - meaning it could never actually be served to that build. Investigated thoroughly rather than guessed at: confirmed `APP_ENV=production` must be set explicitly in the shell (`eas update`/`eas fingerprint:compare` evaluate `app.config.js` locally and don't read `eas.json`'s build-profile `env` block the way `eas build` does - matches the open, unfixed [expo/eas-cli#3051](https://github.com/expo/eas-cli/issues/3051)); ruled out `node_modules` drift via a clean reinstall; ruled out `eas-cli` version via a controlled test (downgraded to the exact version - 20.2.0 - that built #33, recomputed, got the byte-identical mismatched fingerprint as under 21.0.3). After all three levers, the diff was isolated to exactly one fingerprint source: `eas.json` itself (`easBuild` reason), byte-identical on disk yet hashing differently. Leading theory, not fully proven: `eas.json`'s `"autoIncrement": true` + `"appVersionSource": "remote"` mean build numbers are resolved via EAS's own remote version ledger *at build time* - state a later, purely local fingerprint computation cannot reconstruct after the fact, regardless of matching commit/env/CLI version. Matches the unresolved, un-responded-to [expo/eas-cli#2615](https://github.com/expo/eas-cli/issues/2615), where someone else hit the identical symptom with no fix.
**Outcome:** Approved. Build #33 ships without OTA coverage - the same position every prior production build has already been in, not a regression. Not investigating further; this is treated as a genuine, currently-unfixable EAS tooling limitation, not a project misconfiguration. The going-forward practice (publish the update in the same session immediately after the build, never reconstructed later) sidesteps the gap entirely rather than requiring a fix for it.

---

### 2026-07-22 — `eas submit` for production requires `APP_ENV=production` set explicitly in the shell
**Decision:** Always run production iOS submission as `APP_ENV=production eas submit --platform ios --profile production ...`, never bare `eas submit --profile production`.
**Reason:** `eas build` gets `APP_ENV` injected by EAS's own build servers via `eas.json`'s per-profile `env` block - but `eas submit` evaluates `app.config.js` locally, on whatever machine runs the command, which has no `APP_ENV` set. `app.config.js` then falls back to its own `"staging"` default, so submit silently resolves the wrong bundle identifier (`com.mharrison.uncluttrd.staging` instead of `com.mharrison.uncluttrd`) and looks up (or, in interactive mode, offers to set up) credentials for the wrong app entirely. First hit 2026-07-22 submitting build #33 - failed outright non-interactively (`App Store Connect API Keys cannot be set up in --non-interactive mode`) because no staging-bundle ASC API Key credential existed yet; with `APP_ENV=production` set, it correctly resolved the already-configured production credential and submitted cleanly on the same attempt.
**Outcome:** Approved. Documented here rather than in `eas.json` itself - EAS's config schema rejects unrecognized keys (confirmed: a `_comment` field under `submit` fails schema validation, `"submit._comment" must be of type object`), so this can't be a comment in the JSON file itself.

---

### 2026-07-21 — RevenueCat webhook → Cloud Function → Firestore isPro sync (staging, structure only)
**Decision:** New `revenueCatWebhook` Cloud Function (`onRequest`) replaces the client-writable `isPro` field with a server-verified one, per the plan in `BACKLOG.md`'s long-standing "RevenueCat Webhook" item. Verified RevenueCat's actual webhook/API mechanics against their live docs before building, rather than relying on training knowledge, given this touches real payment/entitlement data - confirmed the exact HMAC signature algorithm (`"{timestamp}.{raw body}"`, HMAC-SHA256, hex-encoded), the current REST API for authoritative entitlement state (`GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements`, secret-key Bearer auth), and that RevenueCat supports per-app webhook filtering (resolving the "one RevenueCat project, two Firebase projects" mismatch via two separate dashboard-configured webhook integrations, not cross-project routing logic in code).

**No event-type filtering** - every webhook delivery re-fetches authoritative current entitlement state via the REST API rather than deriving active/inactive from the event's own `type`/`entitlement_ids`. RevenueCat's own docs confirm several event types (`BILLING_ISSUE`, `PRODUCT_CHANGE`, `REFUND_REVERSED`) are ambiguous without that extra context, and explicitly recommend this "call the REST API after any webhook" pattern over modeling transition semantics client-side.

**Idempotency** via `event.id`, scoped under `users/{uid}/revenueCatWebhookEvents` - same convention as `analyzePhoto`'s `analysisIdempotency`, ownership enforced by path.

**`app_user_id` assumed to equal the Firebase uid directly**, not re-derived - the client already calls `Purchases.logIn(u.uid)` at sign-in, so RevenueCat's subscriber identity and this app's uid are the same value by construction.

**One real uncertainty flagged, not asserted as fact:** whether the V2 API's `active_entitlements` response's `entitlement_id` field is the developer-facing identifier (`"Uncluttrd Pro"`, same string the client already checks) or an internal RevenueCat id - the one example response seen during research looked like it could be either. Temporary debug logging of the raw response is in place so the first real webhook delivery confirms this unambiguously rather than silently producing `isPro: false` forever if the comparison is wrong.

**Deployed to `cluttrd-staging` only, with placeholder secrets** (`REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_SECRET_API_KEY` via `firebase functions:secrets:set`; `REVENUECAT_PROJECT_ID` placeholder in `.env.cluttrd-staging`) - explicitly approved as a structure-first deploy, real secrets to follow once gathered from the RevenueCat dashboard. Verified deployable and correctly rejecting unsigned requests (401) with placeholders in place. `firestore.rules` gets a new server-only `revenueCatWebhookEvents` rule but **does not yet tighten `isPro`'s client-write access** - that's deliberately the last step, only once the webhook is proven end-to-end with a real sandbox/staging purchase, matching the approved staging-first plan. Production untouched in this pass.

**Outcome:** Approved and implemented (staging structure). End-to-end verification and the `firestore.rules` tightening are follow-up work once real secrets are provided.

**Impact:** Architecture, Security, Reliability

---

### 2026-07-20 — Confetti still looked like rain after three rounds of prop tuning: the real cause was container size
**Issue:** After fixing `spread`, `initialSpeed`, and `speedVariation` (two entries below), confetti still fell as rain rather than bursting. Three consecutive prop-tuning attempts, all correctly reasoned from the physics, all ineffective - a strong signal the actual bug wasn't a prop value at all.

**Root cause:** `<PIConfetti>` was rendered inside `CompanionCompletedSummary`'s `companionCard` - a content-sized card (no explicit `width`/`height`, sized to its own badge/headline/accomplishments/images), not the screen. `react-native-fast-confetti`'s internal `ConfettiCanvas` sizes itself to `height: '100%'`/`width: '100%'` of its immediate parent, and confirmed in the library's source that every physics formula (`speed`, `scaledGravity`, apex/duration estimation) scales directly off that measured container height. So the confetti was genuinely bursting correctly the whole time, per its configured physics - just within a container a few hundred pixels tall, positioned wherever the card happened to sit in the scrolling page, not the actual ~800-900px screen. No prop value could have fixed an undersized rendering container.

The old `react-native-confetti-cannon` never had this problem because it computed its own animation extents from `Dimensions.get('window')` directly, completely ignoring whatever container it was placed in - the exact same JSX position "worked" for the old library by accident, and silently broke for a library that correctly measures and scopes itself to its container.

**Decision:** Confetti moved out of `CompanionCompletedSummary`'s card entirely - now a sibling to the Companion screen's `ScrollView`, in a new `confettiOverlay` style (`position: absolute`, full `top`/`left`/`right`/`bottom: 0`) sized by the screen-filling `SafeAreaView` (`flex: 1`) rather than inheriting from the scrolling content card.

**Process note:** this was investigated as a genuinely new hypothesis after three rounds of prop-level fixes failed, rather than a fourth guess at values - traced the actual render tree, then confirmed the mechanism directly in `ConfettiCanvas.tsx`'s source rather than assuming a container-size issue from the symptom alone.

**Outcome:** Approved and implemented. Pure layout/JS change, no new native dependencies - shipped via `eas update`, no rebuild needed.

**Impact:** Product/UX, Architecture

---

### 2026-07-20 — PIConfetti still looked like rain after the spread/initialSpeed fix: speedVariation was the real dilution
**Issue:** After fixing `spread`/`initialSpeed` (entry below), confetti still fell as uniform rain rather than bursting - confirmed on-device with the correct update actually running, ruling out a stale-build explanation.

**Investigation approach, given two consecutive misses:** rather than a third guess, verified the exact JSX placement against the library's actual prop-consuming code (`usePIOrigins.ts` reads `spread`/`initialSpeed` directly off each `<PIConfetti.Origin>`'s own props - placement was correct, not a compound-component prop-forwarding bug). Re-derived the spread/angle math precisely (confirmed `spread={Math.PI}` genuinely produces a `[-π, 0)` angle range - left-horizontal through straight-up to right-horizontal, never downward - and cross-checked the y-down coordinate convention against `resolveNamedPosition`'s own position definitions to rule out a coordinate-sign-flip bug). Both checked out correctly.

**Root cause, found by reading the actual per-particle physics function (`generatePIBoxesArray`), not the README:** `speed = initialSpeed * speedMultiplier * ...`, where `speedMultiplier` is a random draw from `speedVariation`, which defaults to `{ min: 0, max: 1 }`. Even with a correctly-aimed burst cone and adequate `initialSpeed`, a meaningful fraction of the 100 particles were randomly drawing near-zero multipliers each render - launching with almost no velocity in any direction and just falling straight down from their spawn point, blending with the correctly-bursting particles into an overall "rain" impression.

**Decision:** `speedVariation={{ min: 0.7, max: 1 }}` on the Origin - every particle now gets a strong, visible burst instead of a random 0-100% spread of one.

**Outcome:** Approved and implemented. Chose to apply this fix directly rather than first spending a native build on internal library instrumentation (`patch-package` + rebuild) to confirm resolved prop values live, since this finding came from reading the actual physics computation directly, not from inference - judged strong enough to act on without that additional cost. Still needs on-device confirmation.

**Impact:** Product/UX

---

### 2026-07-20 — PIConfetti burst-direction fix: spread/initialSpeed were never set
**Issue:** After the confetti library swap (below), the new confetti fell as uniform rain from the top of the screen instead of bursting from the origin point the way the old cannon did.

**Root cause, confirmed from the library's actual source, not the README:** the initial swap set `blastPosition`, `count`, `fadeOutOnEnd`, and `gravity` on `<PIConfetti.Origin>`, but never `spread` or `initialSpeed` - the two props that control burst direction and force. Both fell back to library defaults: `spread: 2*Math.PI` (a full 360° circle) and `initialSpeed: 1`. Verified in `PIConfetti.tsx`/`utils.ts` that the spread cone is always centered on "upward" (`baseAngle = -Math.PI/2`, hardcoded regardless of `blastPosition`) - so a full-circle spread launched particles in every direction including straight down and sideways immediately at the top edge, with no room to visibly arc upward first. That read as rain, not a burst.

**Decision:** `spread={Math.PI}` (an upward hemisphere - full left-right screen coverage from a single top-center origin, zero particles launching downward initially) and `initialSpeed={2}` (using `CannonConfetti`'s own reference value for its edge-positioned origins, per the approved plan, since `CannonConfetti`'s narrower `Math.PI/5` default is tuned for two converging corner-origins, not one origin covering a full screen width alone). `gravity` nudged from `1.5` to `2` - the launch phase itself now creates hang-time, needing less compensation than when particles had no upward launch at all.

**Outcome:** Approved and implemented. All three values are a reasoned estimate from the physics model, not confirmed visually - needs an on-device test, same as the original swap.

**Impact:** Product/UX

---

### 2026-07-20 — Confetti library swap: react-native-confetti-cannon to react-native-fast-confetti
**Decision:** Swaps the completion-celebration confetti from `react-native-confetti-cannon` (plain `Animated` Views, unmaintained for ~5 years, no true physics) to `react-native-fast-confetti` (Skia Atlas API, real physics simulation, actively maintained). Investigated first (2026-07-20 investigation, not logged as its own entry): confirmed no better options exist within a pure-JS approach, confirmed no way to access iOS's actual native celebration effects (e.g. iMessage's) without either shipping undocumented `CAEmitterLayer` behaviors (explicitly flagged unsafe for production by the one detailed technical source that's achieved it) or taking on real, platform-asymmetric native-module maintenance (Android has no equivalent particle-emitter primitive) - even Shopify's own engineering team evaluated and moved away from a native `CAEmitterLayer` module toward a Reanimated-based JS approach for this exact problem. `react-native-fast-confetti` is the ceiling of the JS/Skia tier without taking on that native-maintenance burden.

**Compatibility confirmed before implementing, not assumed:** checked this project's actual installed versions against the library's stated requirements (React `19.1.0` vs `>=19`, React Native `0.81.5` vs `>=0.79`, Reanimated `4.1.7` resolved vs `>=4.1.0 <5`) - all already satisfied, no upgrade needed. `react-native-worklets` was already present transitively via Reanimated 4.x; only `@shopify/react-native-skia` needed adding.

**Port, not a literal 1:1 parameter copy:** `PIConfetti` (the "bursts from a point, then drifts down" component) matches the old cannon's behavior. Count (100), origin (top-center), and `fadeOutOnEnd` ported directly. `gravity` (lowered to 1.5 from the library's 3.0 default) stands in for the old library's timing-based `explosionSpeed`/`fallSpeed` to preserve the "lingers, doesn't flash by" intent from that earlier speed fix - a physics-based knob approximating a timing-based one, not an exact port, so it needs an on-device pacing check before being considered final. Flake shape/size is a genuinely new customization axis the old library never exposed - given a reasonable starting default, not a ported value.

**Outcome:** Approved and implemented. Requires a native rebuild (Skia has native code) - build not triggered without separate explicit go-ahead, per the standing rule.

**Impact:** Product/UX, Architecture

---

### 2026-07-19 — Wrap-up screen final touches: green count, borderless card, CTA reward animation
**Decision:** Three small styling/animation-only changes, no logic or architecture. (1) The remaining-item count ("2" in "2 things left. No rush.," or "One" in the singular case) is now colored `BRAND.green`, matching the completed-count color - reframes both numbers as parts of the same session rather than a success/problem split. (2) The wrap-up card drops its green border in favor of a plain white card with a subtle shadow (new `wrapUpCard` style, `companionCard` itself untouched since `BatchChecklist`/`CompanionCompletedSummary` still use it) - calmer now that the border was drawing more attention to the container than the content. (3) The Continue button animates to its active green state (color fade + a small scale pop) once every item is resolved, instead of an instant enabled/disabled style swap - a small reward moment for finishing the review.

**Outcome:** Approved and implemented.

**Impact:** Product/UX

---

### 2026-07-19 — Wrap-up screen polish: leaner summary, Keep/Remove visual distinction
**Decision:** Simplifies the wrap-up screen's post-heading copy. "Nice work today!" stays as the heading; "You made meaningful progress" is dropped as redundant now that a remaining-count line and a new global explanation line carry that weight instead. "Now let's decide what to do with the remaining N items" becomes "One thing left. No rush." (singular) / "{count} things left. No rush." (plural) - warmer, matches Companion Design Principles #7's calm voice better than the old project-management-adjacent "decide what to do with" framing. A new global line - "We'll include anything you keep in a future organizing session." - renders once beneath the summary, not per item, only while something's still pending.

Keep and Remove buttons are now visually distinct: Keep is filled `BRAND.green` (the expected default action), Remove is outlined (transparent background, green border/text) - reusing the existing `changeBtn`/`changeBtnText` outline convention already established elsewhere in the app rather than inventing a new visual language. Remove stays equally easy to tap, just visually secondary to Keep.

**Held for a separate session, not built here:** restructuring each item's text into a bold title + smaller explanatory sentence. Investigated first - this needs either an AI-prompt schema change (both `analyzePhoto`'s `firstActionBatch` and `generateNextAction`'s `nextBatch` currently emit single strings, not `{title, detail}`) or a client-side derivation, and client-side splitting can't reliably produce a well-formed short title + full sentence from an arbitrary AI-generated sentence - it needs real generation, not string manipulation. The AI-prompt route is the right one, but it's a genuinely bigger change than anything else in this polish round: the item shape threads through 3 separate construction sites converting AI responses into `batchItems`, the exclusion-list/prompt-context builders, both render sites, and raises a real backward-compatibility question for plans already persisted with plain-string items. Deliberately scoped out of tonight's work for its own discovery pass.

**Outcome:** Approved and implemented (items 1/2/4/5 of the approved scope).

**Impact:** Product/UX, Companion Design Principles

---

### 2026-07-19 — Completion celebration collapsed to one screen, override gets a static headline
**Decision:** Removes the "project-complete" transitional stage (the brief "You did it" / "See your finished plan" card) entirely. `handleCompanionChooseFinish` now sets `companionStage` directly to `"finished"`, so tapping "This feels finished" (or the "I like it as-is" override) leads in one motion straight into the full celebration - progress bar at 100%, badge, headline/accomplishments, before/after, confetti - rather than requiring a second tap to get there. Per Companion Design Principles #2 ("celebrate progress... before it asks for anything else"), the extra tap was itself a small piece of friction between the user's decision and the actual celebratory payoff.

Manual-override completions (no real AI completion judgment behind them) now get a static, non-AI-generated headline - "You created a space that works better for you." - instead of no headline at all. Still zero accomplishment bullets for this path: simple beats fabricating specifics the app can't actually verify.

**Verified before removing, not assumed:** traced every reference to `"project-complete"` and `handleCompanionAcknowledgeComplete` first - the stage was set in exactly one place (this handler) and read in exactly one place (the now-deleted `CompanionCard` branch), and the reopen-from-History path (the `[results]` effect) already set `"finished"` directly for an already-completed plan, never routing through `"project-complete"` - confirming the removal has no effect on that path or on `justCompletedThisSession`'s confetti gating (which depends only on `companionCompletedProject` being set, not on which stage follows it).

**Outcome:** Approved and implemented.

**Impact:** Product/UX, Companion Design Principles

---

### 2026-07-19 — Unresolved-items wrap-up: full-screen redesign, Pause rejoins the flow
**Decision:** Retires `UnresolvedItemsReview`'s `Modal` in favor of `CompanionWrapUp`, a full-screen page reusing the existing `unresolvedReview` state as its render gate (early-return inside the Companion screen, matching how every other screen transition in this file works - no router in this app, so "new screen" means "new conditional branch," not a new route). Reframed tonally and structurally: leads with an unconditional celebration ("Nice work today! X tasks completed - You made meaningful progress.") before any mention of what's unresolved, replacing "What should I do with these?" / "these are unchecked" framing and dropping the old single-vs-multi-item special case (the celebration-first structure reads fine at any count). "Keep it for next time"/"Skip it" become "Keep"/"Remove" - same underlying `carried`/`skipped` data model, presentation only. Reason capture moves from a native `Alert.alert` to an inline expandable selector under the item, with relabeled reasons (Already done / Don't want to do this / Not worth the effort / Other) - same downstream purpose (feeds the AI's per-item context and the whole-project skip-exclusion list), avoids a popup-on-a-page feel. The bottom CTA is now a deliberate final tap (enabled only once every item is resolved) rather than auto-advancing the instant the last decision lands, befitting a real page instead of a quick popup.

**Pause rejoins this flow - a deliberate, scoped update, not a silent revert.** The 2026-07-18 entry below made Pause a single tap with no review and no required photo. This adds the review step back for Pause specifically when something's unresolved (mirrors Continue's existing "skip the screen if nothing's unresolved" shortcut when there's nothing to review) - but the "no required photo" half of the original decision holds regardless: Pause's post-resolution path is still just a `currentBatch.items` save and `goHome()`, never the photo sheet. `unresolvedReview.source` (`"continue"|"pause"`) carries this distinction through, branching only the CTA copy and what happens after resolution.

**Stale references cleaned up from the earlier slider retirement** (2026-07-18, below): `CompanionRevealModal`'s leading comment still described "drag to compare"/dragging a slider across the screen, and the `completedSliderArea` style name still implied a slider, despite both wrapping `BeforeAfterStack` since that redesign shipped. Neither was ever updated when the underlying code changed - fixed alongside this work since it's exactly the class of thing that caused genuine confusion about what was actually live before this session's Task 1 discovery pass.

**Outcome:** Approved and implemented.

**Impact:** Product/UX, Companion Design Principles

---

### 2026-07-18 — "I like it as-is": explicit user override for project completion
**Decision:** Adds a permanent, always-available override on the batch-active screen - a quiet tertiary text link ("I like it as-is", `BRAND.mist`, no underline, no confirmation step) below Pause, visually subordinate to both Continue (primary) and Pause (secondary/common-case) so it doesn't read as a third competing primary action. Calls the same `handleCompanionChooseFinish` the existing `completion-choice` "This feels finished" button uses, now taking a `source` parameter (`"completion_choice"` default, `"user_override"` for this new path) so both share the same Firestore write / celebration-screen logic without duplicating it.

**Reason:** Right now the finish button only ever appears when the AI itself recommends completion (`completion-choice` stage) - if the AI never reaches that recommendation, the user has no way to declare the project done. This is a real, evidenced gap, not a hypothetical: a debug-log session the same day showed `completionRecommended: false` across 5 consecutive rounds despite genuinely progressive visible organization. Connects directly to this project's existing completion philosophy ("completion is a user decision, informed by AI, not imposed" - `CompanionDesignPrinciples.md` principle 8) - previously only the "informed by AI" half could actually reach the UI; this closes the "user decision" half. Distinct from Pause: Pause is a temporary exit (nothing marked complete, resume later with the same checklist intact); this is permanent and explicit, the user overriding the AI's ongoing suggestions rather than just stepping away.

**Two correctness issues caught before implementing, not after:**
- `companionCompletionReason`/`companionCompletionHeadline`/`companionCompletionAccomplishments` reflect the AI's *last* completion judgment - on the override path, by definition, that judgment was `completionRecommended: false`, meaning its `reason` text explains why the space *isn't* finished. Reusing it unmodified would show contradictory text on the very screen celebrating that the user just declared it finished. The override path skips all three fields entirely (celebration screen renders gracefully with just the badge, task count, and photos - honest, given there's no real AI judgment behind this completion, rather than fabricated).
- `handleCompanionChooseFinish` unconditionally fired `batch_completion_accepted`, whose documented meaning (Analytics.md) is specifically "user agreed with a completion recommendation" - its absence is used elsewhere to infer "chose continue instead." Firing it for an override with no recommendation to agree with would corrupt that signal. A new `batch_completion_overridden` event is fired instead on the override path, logged separately in Analytics.md with its own business question (how often users override vs. wait for a recommendation - a direct signal on whether the completion threshold is too conservative).
- Also fixed in passing: the `completion-choice` "This feels finished" button was wired as `onPress={onChooseFinish}` directly - `TouchableOpacity`'s `onPress` passes a `GestureResponderEvent` as the first argument, which would have landed in the new `source` parameter instead of its `"completion_choice"` default. Changed to `onPress={() => onChooseFinish()}`.

**Outcome:** Approved and implemented.

**Impact:** Product/UX, Companion Design Principles

---

### 2026-07-18 — Completion screen redesign: retire the before/after slider, celebrate instead of compare
**Decision:** The draggable before/after slider (`PanResponder`-based) is deleted entirely, including the rejected "curtain" alternative (also `PanResponder`-based, inherits the same bug class). Replaced by two zero-gesture components: `BeforeAfterStack` (default side-by-side view, plain `Image`s, no interaction required) and `BeforeAfterInspector` (fullscreen, opt-in via tapping either image - a segmented Before/After toggle crossfading via `Animated.timing` opacity, `useNativeDriver: true`). `CompanionRevealModal` (fires after every batch) gets only the image widget swapped - its existing per-session `visibleChange` copy is unchanged, it's not a celebration screen. `CompanionCompletedSummary` (shown on finish, and on reopening a finished plan from My Plans) gets the full treatment: a photo-grounded celebratory headline, a short accomplishments list, task count demoted to small supporting text below (not the headline), and a one-time confetti burst (`react-native-confetti-cannon`) gated on `justCompletedThisSession` so it never replays on a later reopen.

**Reason:** The slider was the single most bug-prone UI in the app this session (frozen-closure bug, gesture-stealing parent ScrollView) - reliability requires eliminating drag-gesture handling entirely, not making it more forgiving. Separately, the completion screen's actual job is celebrate → show progress → encourage another session; photo comparison is supporting evidence for that, not the goal, so the redesign leads with the accomplishment.

**No new AI call:** the whole-project `celebrationHeadline`/`accomplishments` fields are generated by extending the *existing* completion-judgment prompt in `submitCompanionProgressPhoto` (which already compares original vs. now-photo to judge `completionRecommended`) rather than firing a new Cloud Function call at finish time - no spinner between "This feels finished" and the celebration screen, and zero backend changes (`generateNextAction` is a generic 3-image+prompt proxy). Fields are requested on every round-trip (harmless, cheap, unused when completion isn't recommended), same treatment as the existing `completionReason` field, which stays untouched since it serves a different job (explaining *why* completion is recommended, still shown on the `completion-choice` screen) than the celebratory headline (declaring *what* got accomplished).

**Task count - real staleness risk found and fixed during implementation:** `results` (the locally-held plan object) is only set once per session and never locally patched after `submitCompanionProgressPhoto`'s Firestore `batchHistory` write, so `results.batchHistory` goes stale the moment a second batch is archived in the same sitting - reading it directly at finish time would have silently undercounted the common case of a multi-batch session completed in one sitting. Fixed with a local running accumulator (`completedTaskCountRef`), seeded from `results.batchHistory` when a plan loads, incremented by that batch's checked-item count each time a batch is actually archived. Same category of gap as the My Plans `history`-staleness bug fixed earlier this session, caught proactively this time instead of by a bug report.

**Confetti library tradeoff:** a hand-built `Animated`-only version would have kept this fully OTA-eligible (no build required); `react-native-confetti-cannon` was chosen instead for better out-of-box physics, explicitly accepting that this feature now requires a full `eas build` rather than shipping via `eas update` - approved tradeoff, not an oversight.

**Outcome:** Approved and implemented (Session 2). Requires a full build before any of this reaches a device, per the confetti dependency above - a staging build needs an explicit go-ahead per the standing build rule.

**Impact:** Product/UX, Reliability, Architecture

---

### 2026-07-16 — Staging environment: final model
**Decision:** A dedicated staging Firebase project and a dedicated staging bundle ID (`com.mharrison.uncluttrd.staging`), separate from production (`com.mharrison.uncluttrd`, unchanged), structurally close the backend/frontend mismatch class of bug behind the `2026-07-15` outage below.

Three EAS build profiles, mapped as:

| Profile | Firebase | Bundle ID | Purpose |
|---|---|---|---|
| `development` | Staging | Staging | Local dev with dev client |
| `preview` | Staging | Staging | Internal testing build |
| `production` | Production | Production | Real App Store app |

`development` and `preview` deliberately share the staging bundle ID — they never need to coexist installed simultaneously with each other, only with `production`, which they never touch. **Rule: only the `production` EAS profile may resolve to the production bundle ID or the production Firebase project**, enforced via `app.config.js` reading a build-time env var, not a runtime toggle — the same reasoning as the `2026-07-15` rule above: no build should be able to decide at runtime which backend it's talking to.

Visual distinction on a staging build, all three signals together, not just one: a distinct display name (`Uncluttrd Staging`), a visually distinct app icon (clearly marked, e.g. an "STG" badge), and a persistent in-app "STAGING" banner. Redundant on purpose — a build sitting on a real device for days should never be mistaken for production by anyone glancing at a home screen or a screenshot.

**Setup, confirmed:**
- A new Apple App ID for the staging bundle ID, and a near-empty App Store Connect entry that is never published and never submitted for review — it exists solely so Apple can sign builds against that bundle ID.
- RevenueCat: no new project. A second app (`iOS Staging`) added under the existing Uncluttrd RevenueCat project, sharing entitlement configuration with production — RevenueCat apps are keyed to bundle ID, not backend, and sandbox-vs-production purchase routing is already handled automatically by RevenueCat per-receipt, independent of which Firebase project is behind it.
- A new staging Firebase project, replicated per the discovery pass's Phase 1 findings: `firestore.rules`, `storage.rules`, all six Cloud Functions (`analyzePhoto`, `generateNextAction`, `generateVisualization`, `recordUserDocDeletion`, `checkOrphanedUserDeletions`, `analyzePhotoCanary`), and their secrets (`ANTHROPIC_KEY`, `OPENAI_KEY`, `CANARY_TEST_UID`).

**Reason:** A shared bundle ID between staging and production was considered and rejected (see below) specifically because it would leave open exactly the ambiguity this whole effort exists to remove — "which backend is this install actually talking to" needs to be answerable by the OS's own app identity, not by trusting that the right build profile was used. A separate bundle ID also lets `development`/`preview` genuinely never touch production even by accident, since they're a different installed app entirely, not just a different runtime configuration of the same one.

**Alternatives considered:**
- Same bundle ID for staging and production, differing only by which Firebase config is bundled at build time (the original discovery-pass default assumption). Rejected — two builds with the same bundle ID can't be installed side-by-side on one device, and nothing at the OS level distinguishes them once installed; the whole safety property would rest entirely on build-profile discipline, the same category of human-process trust that the `2026-07-15` outage already demonstrated isn't sufficient on its own.
- A separate RevenueCat project for staging. Rejected — RevenueCat apps are scoped to a bundle ID/store listing, not a backend; a second app under the existing project is sufficient, and splitting projects would mean maintaining duplicate entitlement/product configuration for no isolation benefit.
- Single visual signal (just a banner, or just an icon) to distinguish staging. Rejected — redundant signals were preferred deliberately, since any single one is the kind of thing a screenshot or a glance can miss.

**Outcome:** Approved. Proceeding to Phase 1 (staging Firebase project, Apple App ID/App Store Connect placeholder, RevenueCat staging app) before Phase 2 (the `app.config.js` migration implementing bundle-ID/name/icon/banner switching and the corresponding `eas.json` changes).

**Impact:** Architecture, Process, Reliability, Build/Release

---

### 2026-07-17 — Staging environment: Firebase JS SDK isolation failure and fix
**Issue:** The `2026-07-16` staging-environment work above correctly branched every *native* identity signal by `APP_ENV` — bundle ID, `GoogleService-Info.plist`/`google-services.json`, app icon, display name, in-app banner — all verified correct via direct binary inspection of an installed build. It was not enough. Discovered when a user signed into a staging build, showing all three visual staging signals (banner, STG icon, "Uncluttrd Staging" name), using real production account credentials, and it succeeded with Pro status showing.

Root cause: `App.js`'s Firebase JS SDK initialization (`firebase/app`/`firebase/auth`/`firebase/firestore`/`firebase/storage`/`firebase/functions` — what the app's `auth`, `db`, `storage`, and `functions` instances actually are, and what every Auth/Firestore/Storage/Functions call in the app goes through) read from a `firebaseConfig` object that was a hardcoded literal, always pointing at `cluttrd-3e335`, and `initializeApp(firebaseConfig)` ran *before* `APP_ENV` was even read further down the file. The native config swap governs only the native `@react-native-firebase/*` module (used solely for Analytics) — it has no effect on the JS SDK. So every "staging" build, regardless of correct bundle ID/icon/banner, was silently talking to real production Auth, Firestore, Storage, and Cloud Functions the entire time.

Two further hardcoded-production references were found in the same audit, both inside `functions/index.js`'s `analyzePhotoCanary`: `FIREBASE_WEB_API_KEY` was a plain literal holding production's Identity Toolkit API key (breaking the staging canary's custom-token exchange with a project mismatch when deployed to `cluttrd-staging`), and the `analyzePhoto` call URL was a hardcoded `https://us-central1-cluttrd-3e335.cloudfunctions.net/analyzePhoto`, meaning the canary would call production's `analyzePhoto` regardless of which project it was actually deployed to.

**Decision:** `App.js` now computes `APP_ENV`/`IS_PRODUCTION` at the top of the file, before Firebase initializes, and selects `firebaseConfig` between `productionFirebaseConfig` (unchanged) and a new `stagingFirebaseConfig`, backed by a Firebase Web app newly registered under `cluttrd-staging` (`firebase apps:create WEB`) specifically because one had never existed — only the iOS/Android native apps were registered in Phase 1. `functions/index.js`'s `FIREBASE_WEB_API_KEY` is renamed `CANARY_WEB_API_KEY` (the `FIREBASE_` prefix is reserved by Cloud Functions and fails deployment) and converted to a `defineString` param, project-scoped via `.env`/`.env.cluttrd-staging` the same way `CANARY_TEST_UID` already was. The `analyzePhoto` call URL now derives from `process.env.GCLOUD_PROJECT` instead of a literal.

A separate, orthogonal prerequisite surfaced during the same investigation: `cluttrd-staging`'s default compute service account had never been granted `roles/iam.serviceAccountTokenCreator` on itself — the same self-grant gotcha production required earlier (done manually via Console at the time), never replicated for staging. Without it, `analyzePhotoCanary`'s `createCustomToken` call failed outright. Granted via `gcloud projects add-iam-policy-binding`.

**Verification, all direct evidence, not inference:** (1) Downloaded and inspected the actual installed IPA's compiled JS bundle and embedded `EXConstants.bundle/app.config` — confirmed the correct config branch and `APP_ENV` value were genuinely present in the shipped binary, not just the source. (2) Added temporary runtime debug logging (`FIREBASE_INIT_DEBUG` at the point Firebase initializes, `FIREBASE_CALL_DEBUG` immediately before the `analyzePhoto` call) to catch any remaining runtime-only divergence between source and behavior. (3) Direct Firestore reads via REST API (read-only) confirmed a real end-to-end analysis from a fresh test account landed in `cluttrd-staging` (`analysisCount` incremented) and was absent (404) from `cluttrd-3e335`.

**Reason:** Same reasoning as the `2026-07-16` and `2026-07-15` entries above, sharpened by this incident specifically: a visually-correct staging build is not proof of backend isolation, because the native identity layer and the JS SDK's own config are two independent code paths that can silently diverge. "The icon/banner/name are right" was already treated as necessary, not sufficient, in the `2026-07-16` decision — this incident is the concrete case that necessity claim was protecting against. Isolation now has to be verified against the compiled artifact and live runtime behavior, not just source review, given how completely correct native config alone reads while investigating this.

**Alternatives considered:**
- Trust the `2026-07-16` fix as complete once native config was verified. This was the actual initial assumption, and it was wrong — recorded here specifically so "native config is correct" is never treated as sufficient isolation proof again in this project.
- Share a single Firebase Web app config between environments, swapping only via a runtime flag read at call time rather than at SDK init. Rejected — reintroduces exactly the "isolation depends on a runtime toggle, not a build-time/structural guarantee" pattern already rejected in `2026-07-16`.

**Outcome:** Approved and fixed. Verified end-to-end with direct Firestore proof (uid present in `cluttrd-staging`, absent in `cluttrd-3e335`). Temporary debug logging (`FIREBASE_INIT_DEBUG`, `FIREBASE_CALL_DEBUG`, and an earlier `AUTH_DEBUG` round from the initial investigation) is being stripped now that isolation is confirmed.

**Impact:** Architecture, Reliability, Security, Process

---

### 2026-07-18 — Companion batch workflow: deliberate exception to Principles 1 and 7
**Decision:** The Companion loop shifts from single-step generation (one action at a time via `generateNextAction`) to session-based batches — `analyzePhoto`/`generateNextAction` return a balanced session's worth of checklist items instead of one action, worked through and resolved together before the next photo-grounded generation. This is an explicit, acknowledged exception to two of `CompanionDesignPrinciples.md`'s principles, not a silent departure:

- **Principle 1** ("show one decision at a time") — a batch surfaces several items at once, not one.
- **Principle 7** ("avoid checklist/backlog framing" among its explicit "Avoid" examples) — the batch UI is, unavoidably, a checklist.

Per that document's own closing instruction — "if a feature only survives by treating one of these as optional, that's a decision to surface and discuss explicitly, not to route around silently" — this entry is that surfacing. A corresponding amendment note is added directly to `CompanionDesignPrinciples.md`.

**Reason:** Single-step generation breaks down for large projects — a messy basement could represent dozens of distinct sub-tasks, and one-action-per-photo-round-trip is too slow for a real organizing session, while a full upfront plan (all steps generated once) is too rigid and loses the adaptive, photo-grounded accuracy that makes suggestions trustworthy. The batch model keeps the exact same photo-grounded architecture, just chunked to session size instead of a single action — a deliberate identity shift from "one tiny win" toward "one productive session" as the product matures beyond first-action onboarding.

Mitigations that keep this in the spirit of both principles, even while bending their letter:
- No numeric progress counters ("3 of 5") anywhere in the batch UI — avoids exactly the project-management framing Principle 7 warns against.
- No AI time/duration estimation of any kind — batches are sized qualitatively ("a balanced session's worth"), never against a promised time bound.
- An intro framing line ("Let's make a little more progress. Start wherever you'd like — you don't need to finish everything today.") precedes the checklist every time a new batch is shown, carrying the low-pressure tone Principle 1 protects even though the screen itself surfaces multiple items at once.
- The checklist is never treated as the progress metric — the photo is. Completion is acknowledged with specific, photo-grounded language ("I can see you've cleared the bookshelf and grouped the games"), never a completion count.
- Items are toggled freely, in any order, with no forced sequencing or per-item start/stop ceremony — closer to "mark what's true against the photo" than "choose your next task from a list," which keeps the interaction itself simpler than a literal to-do app even though the visual surface resembles one.

**Alternatives considered:**
- Leave single-step generation as-is and address large-project slowness some other way (faster generation, a separate "big project" mode). Rejected — doesn't solve the actual mismatch between real session pace and one-action-per-photo-round-trip; a messy basement genuinely needs several things addressed in one sitting, not one.
- A full upfront plan, generated once with no re-grounding per session. Rejected — this is exactly the rigidity Companion's photo-grounded architecture exists to avoid; it can't adapt to what a progress photo actually shows.

**Outcome:** Approved as a deliberate, scoped exception — not a redefinition of the principles themselves. `CompanionDesignPrinciples.md` is amended with a corresponding note rather than rewritten, so the North Star Principle and every other principle continue to apply at full strength everywhere else in the product, including everywhere else in Companion. Implementation plan for Session 2 to follow, pending approval.

**Impact:** Architecture, Product/UX, Companion Design Principles

---

### 2026-07-18 — Onboarding-completion (`hasSeenTutorial`) becomes account-scoped, not device-scoped
**Decision:** `hasSeenTutorial` moves to the Firestore `users/{uid}` doc as the source of truth (checked in `onAuthStateChanged`, alongside `isPro`/`analysisCount`), with the existing `AsyncStorage` flag kept as a fast local cache only, backfilled from Firestore when they disagree. This reverses the earlier design decision that `skipOnboarding` should be "intentionally device-scoped, not account-scoped" — a reinstall or new device for an existing account is now a real, tested scenario (surfaced by build-10/11 staging testing), and showing the full tutorial again to an established Pro user reads as broken, not as a fresh-install courtesy.

**Impact:** Architecture, Product/UX

---

### 2026-07-18 — EAS Update (OTA) setup: fingerprint runtimeVersion, staging/production channels
**Decision:** `expo-updates` installed and configured for pure-JS/React Native changes to be pushable via `eas update` without a full `eas build`. `runtimeVersion` uses the **fingerprint** policy, not `appVersion` — derived from the actual resolved native project (which already differs between staging/production via the existing `APP_ENV` branching), so an incompatible update is never offered to a build rather than depending on someone remembering to bump `version` (currently shared, unbranched, across both environments). Channels mirror the existing Firebase/bundle-ID table exactly: `development`/`preview` → `staging`, `production` → `production`, set alongside each profile's existing `APP_ENV` in `eas.json` so both are always baked in together with no runtime coupling.

**Mental model going forward:** any `app.config.js`/`eas.json` edit, any new native dependency, or *any* version change to an existing dependency (treated as build-required across the board, not judged per-package) requires a full build. Pure JS/component/copy/logic changes in `App.js` with no dependency diff are OTA-eligible. `functions/index.js` and `firestore.rules` are separate pipelines entirely (`firebase deploy`), not part of EAS Update either way.

**Reason:** Matches the structural-guarantee-over-manual-discipline reasoning already established for the rest of this staging effort (`2026-07-16`, `2026-07-17` above) — an incompatible OTA update should be structurally incapable of reaching a build it doesn't match, not prevented by someone remembering a step.

**Bootstrapping note:** no currently-installed build (including staging build 13) has `expo-updates` baked in yet, so nothing can receive an OTA push until one new full build per environment is made and reinstalled — these two builds require explicit go-ahead per the standing build rule, same as any other build.

**Impact:** Architecture, Build/Release, Process

---

### 2026-07-18 — Pause reversed to a single-tap action, no photo/review required
**Decision:** "That's enough for today" (Pause) no longer requires a progress photo or the unresolved-items review. It's now a single tap: log `batch_session_paused`, write the current checklist's checked/unchecked state to `currentBatch.items` (nothing else — no `generateNextAction` call, no batch archival, no new batch generated), then navigate straight to Home. This reverses the original batch-workflow design (DecisionLog.md 2026-07-18, "Companion batch workflow" entry above), where Pause went through the same review-then-photo-then-generate flow as Continue, just with different framing copy.

**Reason:** Both entry points back into an existing plan (the Home resume banner and My Plans) already route directly to the Companion screen, showing whatever is currently persisted in `currentBatch.items`. Continue already carries the review and a required photo, which is what actually grounds the *next* session against a real photo. Requiring the same grounding at the moment the user is *leaving* was solving a problem Continue already solves when they come back — the checklist state itself is what needs to survive a pause, and a single lightweight `updateDoc` accomplishes that without asking for a photo the user has no reason to take right when they're stepping away. Nothing is lost; the session-grounding photo simply happens on return (via Continue) rather than preemptively on exit.

**Verified before implementing, not assumed:** confirmed `toggleBatchItem` was purely local React state with no Firestore write at all - meaning a literal "zero writes" Pause would have actually lost mid-session checkbox progress, contradicting the "nothing is lost" reasoning above. The single `currentBatch.items` write closes that gap; without it the claim wouldn't have held.

**Cleanup:** the `isPause`/`batchPauseRef` plumbing threaded through `submitCompanionProgressPhoto`, `CompanionRevealModal`, `handleCompanionRevealContinue`, `openBatchPhotoSheet`, and the photo-capture functions was removed rather than left in place unreachable - Pause no longer calls any of that code, so keeping the parameter/branches around would have been dead code, not generality. `UnresolvedItemsReview` similarly dropped its `mode` prop and pause-specific copy branches, since only Continue opens it now.

**Impact:** Product/UX, Architecture

---

### 2026-07-18 — My Plans: whole-plan deletion, no soft-delete
**Decision:** Users can delete a saved plan from My Plans. Deletion is whole-plan only (Firestore doc + every Storage object under `plans/{uid}/{planId}/` and `viz/{uid}/{planId}/`, deleted permanently) — no per-session/per-batch deletion within a project, no soft-delete/trash/undo. Entry point is a "Delete Plan" (destructive) option added to the existing My Plans row action sheet (alongside "View Full Plan"/"Share as PDF"), behind a second confirm alert. List-only for v1 — no delete affordance on the Results/Companion detail screens.

**Reason:** Free-tier history is uncapped and only ever grows (the 3-plans/month limit caps creation, not retention), and these are photos of people's actual homes — cluttered closets, messy garages — that a user may reasonably want removed once a project is done and organized. Per-session deletion inside an active project (`currentBatch`/`batchHistory`) was considered and rejected for v1: it raises real complexity (does deleting one archived batch orphan a later batch's carried-forward items?) for a use case far rarer than "I'm done with this project entirely." No soft-delete for the same reason — added complexity for a recovery need not yet demonstrated; revisit only if users actually ask for it.

**Storage cleanup is list-based, not doc-based:** `vizImages` on the plan doc is a map of only the 3 *current* tier URLs, but regenerating a visualization never deletes the previous file — every regeneration mints a new timestamped object (App.js `generateVisualization`). Deleting only the 3 URLs on the doc would leave stale regenerations orphaned in Storage, so `deletePlan` lists and deletes everything under the `viz/{uid}/{planId}/` prefix instead of walking the doc's own fields. Same reasoning applies to `plans/{uid}/{planId}/progress/`, which grows via timestamped filenames with no fixed count on the doc.

**Delete order:** Firestore doc first, then Storage. Opposite tradeoff from account deletion's Storage-before-Auth ordering (which exists because Auth deletion ends the session `firestore.rules` needs) — here there's no such constraint, so the order is chosen for user-visible failure safety instead: if Storage cleanup fails partway after the doc is gone, the result is an orphaned-but-harmless Storage object; if the doc were deleted last and *that* failed, the plan would still show in the list pointing at now-missing images (broken thumbnails).

**Rules:** no `firestore.rules` change needed. `users/{userId}/plans/{planId}` already grants `allow read, write` scoped to `auth.uid == userId`, and Firestore's `write` already covers `delete` — confirmed via discovery before implementing, not assumed.

**Known gap, deliberately out of scope:** account deletion's existing Storage cleanup only walks `viz/{uid}/**` and has never cleaned `plans/{uid}/**` — a pre-existing orphaned-Storage gap this feature doesn't fix, since it's bigger scope (whole-account) than plan-level delete requires. Logged as a separate item in `BACKLOG.md`.

**Impact:** Product/UX, Architecture

---

### 2026-07-15 — analyzePhoto build-15 compatibility outage
**Issue:** `85168f3` (2026-07-14, free-plan server-enforcement work) made `analyzePhoto` require `request.auth` and a client-sent `analysisId` as hard preconditions, and deployed that straight to `cluttrd-3e335` — the same Firebase project the live public App Store app uses, with no staging split. Confirmed via App Store Connect that **build 15**, the live public version at the time, predates `analysisId` entirely and calls `analyzePhoto` without it. Every real production user's photo analysis was rejected outright with `invalid-argument`/`unauthenticated` for hours before this was caught, discovered via a real user report rather than any automated signal.

**Decision:** `analyzePhoto`'s base request validation is restored to its exact pre-`85168f3` shape (`imageBase64`/`prompt` only, no auth requirement). Free-plan enforcement (idempotency + count check/increment) now only engages when both a uid and an `analysisId` are present — the shape the Companion-era client sends; a request missing either is processed with no count check and no idempotency protection, same as this function behaved before `85168f3`. This is a deliberate temporary compatibility shim, not a reversion of the enforcement work — see `BACKLOG.md`.

Also added, directly because of this incident:
- A permanent process rule (see above) requiring backward-compatibility review against the live build before any Cloud Function request-shape change deploys.
- `analyzePhotoCanary`, a scheduled Cloud Function (every 15 minutes) that calls `analyzePhoto` end-to-end using a dedicated test account, alerting via a Cloud Monitoring log-based metric on failure — built specifically so this class of regression is caught within one run interval instead of however long it takes for a real user to notice and report it.

**Reason:** A backend change tied to an unreleased client feature should never be able to break the currently-live app, and if it does anyway, it should be caught by monitoring in minutes, not discovered by a user hours later. Restoring exact pre-`85168f3` behavior for the base call (rather than something stricter) was chosen because that's the proven-working shape build 15 already depends on — inventing a new, untested compatibility behavior mid-incident would have been a second unverified change layered on top of the one that caused the outage.

**Alternatives considered:**
- Keep the auth/analysisId requirement and roll back the entire `85168f3` free-plan enforcement change instead. Rejected — throws away correct, tested work (Firestore-based count, transaction logic, `firestore.rules`) to fix a problem that's actually scoped narrowly to the request-shape mismatch, not the enforcement logic itself.
- Require a client App Store update before restoring service. Rejected — App Store review timelines are hours-to-days; real users need service restored immediately, and the fallback path costs nothing extra for users on the current client once it ships.

**Outcome:** Approved and shipped same-day. Hotfix deployed and live-verified with a request shaped exactly like build 15's client (no `analysisId`, no auth header) before this entry was written.

**Impact:** Architecture, Process, Reliability

---

### 2026-07-13 — Companion Analytics: Event Catalog, Philosophy, and Commerce Reuse
**Decision:** Ship two event groups for the Companion feature: a nine-event Free Funnel (`first_action_viewed`, `first_action_started`, `first_action_completed`, `first_action_failed`, `progress_photo_prompted`, `progress_photo_started`, `companion_paywall_viewed`, `companion_upgrade_clicked`, `subscription_started`) and a nine-event Pro Continuation group (`companion_session_started`, `companion_action_viewed`, `companion_action_started`, `companion_action_completed`, `companion_action_failed`, `companion_progress_photo_uploaded`, `companion_next_action_generated`, `companion_session_completed`, `companion_session_resumed`). Every event in both groups carries a stated Business Question in Analytics.md, and a new Analytics Philosophy statement now governs all future event additions: "Every analytics event must answer a future product or business question. We collect events to improve the user experience, validate hypotheses, and understand engagement. We do not collect data simply because we can."

Commerce engagement during the companion loop is tracked by extending the existing `product_clicked{product}` event with a `companionActionIndex` property, not by adding parallel `recommendation_viewed`/`recommendation_clicked` events. Room-level and budget-level breakdowns are backend queries against shipped events, not new client events — this required adding `tier` to the existing `plan_started` event and `spaceType` to the existing `plan_completed` event (replacing an undocumented `room`/`budget` placeholder that was never implemented), since neither chosen tier nor space type was previously captured anywhere joinable — `selectedRoom` was confirmed to be dead client state, never sent to the AI prompt, Firestore, or analytics.

The free funnel has no `planId` to correlate against, since free-tier plans are never persisted. A new client-side-only, non-persisted `analysisId` is introduced purely as an analytics correlator, threaded through all nine free-funnel events, so one analysis's funnel can be reconstructed per-user even across multiple free analyses in a month.

`companion_session_completed` fires on an explicit user action ("Finished for today"), confirmed to exist in the approved UX — not inferred from inactivity. Inferred abandonment is intentionally left as a future backend query against `companion_action_completed` timestamps, consistent with the same derive-don't-collect discipline applied to the 7-day cohort and the room/budget breakdowns above.

**Reason:** A stated business question per event is the concrete mechanism for the Analytics Philosophy, not just a slogan — it forces every event to justify its own existence before it ships. Reusing `product_clicked` avoids double-counting the same click and matches every existing precedent for adding context to an event (`plan_failed{reason}`, `tier_selected{tier}`) rather than forking a new one. `companionActionIndex`, not `companionActionId`, was chosen because the approved schema has no per-action document ID — `companionAction` is a single map field distinguished by `actionIndex` — and a property name implying an ID that doesn't exist would misrepresent what's actually queryable. Preferring backend derivation over new events keeps the client-side event surface minimal, applying the Companion Design Principles' cognitive-load discipline to engineering effort as well as UI.

**Alternatives considered:**
- New `recommendation_viewed`/`recommendation_clicked` events for companion commerce engagement. Rejected — would require new impression-tracking instrumentation that doesn't exist for any product row today, and would create two overlapping click events for the same user action.
- Client-fired `room_started`/`room_completed`/`room_abandoned` events. Rejected — fully derivable from `plan_started{tier}` / `plan_completed{spaceType}` plus existing timestamps once those two properties existed; no new event type was needed, only two property additions.
- Correlating the free funnel via `userId` + timestamp proximity instead of a new `analysisId`. Rejected — fragile for users running multiple free analyses in a short window, and precision is the entire point of this funnel.
- Firing `companion_session_completed` from an inferred inactivity threshold. Rejected once confirmed an explicit close action exists in the UX — the client can't reliably distinguish "done for now" from "hasn't come back yet," and that class of metric belongs in a backend query, not a client event.

**Outcome:** Approved. Analytics and DecisionLog design work for the Companion feature (Session 1) is finalized as of this entry.

**Impact:** Analytics, Architecture, Commerce

---

### 2026-07-13 — Companion Experience (Session 1): Free/Pro Split and Design Principles
**Decision:** Ship a guided "Companion" loop after Organize's analysis and visualization: the app surfaces one personalized action ("Let's Start Here"), the user starts and completes it, celebrates, and is invited to submit a progress photo. Free users get one complete cycle of this, in-memory only, not persisted. Pro users get the continuing loop — subsequent actions, saved progress, session continuity, and future session history. The Companion-specific paywall appears only after a free user finishes their first full cycle (action + progress photo), not before they've experienced any of it. Time/effort estimates (`estMinutes`, `difficulty`, or similar) are excluded entirely from the AI response schema, Firestore model, analytics payloads, and UI. All Companion copy is written in the voice of a calm, encouraging professional organizer, with an explicit avoid-list (no "Next Action," "Task," "Project," "Complete," "Complete Task," "Task Complete," "Complete Session," or productivity/project-management vocabulary generally). Visualization keeps its established place immediately after analysis and before the tiered plan — generated once per analysis, not per tier — with "Let's Start Here" appearing directly after it and above the entire budget-tier/product section. `secondsSinceStarted` (elapsed time between starting and completing the first action) is tracked as a measured analytics-only value, never surfaced to the user, and treated as distinct from the banned effort-*estimation* fields since it's observed, not predicted.

**Reason:** The free tier already doesn't persist Organize plans (`savePlanToHistory` no-ops for `!isPro`), so gating the whole Companion loop behind Pro would have meant free users get a truncated, half-finished feature — weaker for both trust and upgrade motivation than letting them feel the full loop once and then asking. Asking to upgrade only after that first win puts commerce at the moment it's earned, not before, per the Companion Design Principles ("commerce appears only when it helps"). Time estimates were cut because they add a number to evaluate before acting (more cognitive load, not less) and because the AI has no reliable way to size a task from a single photo — the same accuracy risk already logged for the visualization feature's transformation intensity. The coaching voice keeps the product feeling like a professional organizer, not a to-do app, consistent with Vision.md's positioning. Visualization's position and mechanism were left exactly where they already work, rather than risk regressing a proven moment while adding a new one.

**Alternatives considered:**
- Gating the entire first-action experience behind Pro, matching the existing History/Visualization boundary exactly. Rejected — leaves the free tier with nothing to point to as "this is what Companion feels like," which weakens the upgrade case rather than strengthening it.
- Showing an AI-estimated time per action for clarity. Rejected — conflicts with the decision-fatigue-reduction goal and introduces an estimation-accuracy risk with no way to validate it.
- Paywall shown immediately alongside the first action, before any Companion interaction. Rejected — asks before it has demonstrated value; conflicts with the Companion Design Principles' commerce placement rule.

**Implementation constraint (standing, not just this feature):** Preserve backward compatibility with the existing Uncluttrd experience wherever practical. The Companion experience layers on top of existing AI analysis, visualization, and commerce — it does not replace them. Existing functionality continues to work unless a change has been explicitly approved; if implementation requires removing or fundamentally changing existing behavior, stop and explain the tradeoffs before proceeding.

**Outcome:** Approved. Session 1 architecture is final. Reference: `Uncluttrd Core Documents/CompanionDesignPrinciples.md`, created alongside this decision as the standing filter for evaluating this and future features.

**Impact:** Product, Architecture, Monetization, Brand voice

---

### 2026-07-31 — Provenance Addendum
**Addends:** 2026-07-13 — Companion Experience (Session 1): Free/Pro Split and Design Principles.
The full Single-Trustworthy-Action Principle investigation (2026-07-31) found that this entry's Decision field — "the app surfaces one personalized action" — no longer matches shipped code at the UI-presentation level: BatchChecklist's first reveal (firstActionBatch) presents a multi-item checklist, not a single action, per the 2026-07-18 batch-workflow decision, which took no exception for this founding entry. This entry's other content (the guided-loop structure, the progress-photo invitation, the Free/Pro split, the standing implementation constraint) is unaffected by this finding and remains current. This addendum corrects only the "one personalized action" presentation claim. It does not propose replacement wording — the investigation found that "single-trustworthy-action" names at least four distinct claims (UI rendering, session-scope boundary, interaction pacing, cognitive load) that have drifted apart since 2026-07-18, at different rates and to different degrees; a full restatement, if warranted, is deferred to its own separate session, not undertaken here.

---

### 2026-07-01 — Original Photo Persistence
**Issue:** Generating a visualization from a previously saved plan could use the wrong source photo, because the original image was not reliably associated with the saved plan. This also exposed a potential null-photo crash path.

**Decision:** Persist the original photo with each plan (Firebase Storage, URL on the plan document — same pattern as existing vizImages) and retrieve that specific photo whenever a saved plan is reopened. Update Firebase Storage rules to support the new access pattern. Add application-level validation before generating a visualization, plus a clear-then-restore pattern with a ref guard so a late-resolving photo download can never overwrite the wrong plan's state.

**Reason:** A plan should be self-contained. It must never depend on transient in-memory state from another plan.

**Result:**
- Fixed incorrect visualization source image
- Eliminated potential crash
- Improved data integrity
- Established a clearer ownership model for plan assets

**Root cause callout — security rules had no local source of truth:** the fix initially appeared broken in testing even after the code was correct. Cause: Firebase Storage rules existed only in the Firebase Console, with no storage.rules file in the repo, so the new plans/{uid}/{planId}/... path had no matching rule, and every photo upload failed with permission-denied — silently, because the upload was wrapped in a try/catch that only logged to console. Fixed by adding the missing rule and creating a local storage.rules file (wired into firebase.json) so rules are now version-controlled and deployable via CLI, not console-only. Open follow-up: Firestore rules should get the same treatment; noted in BACKLOG.md. Also worth watching for the broader pattern — silent catches around Storage/Firestore writes elsewhere in the app could be hiding similar failures with no visible signal.

**Impact:** Architecture, Security, UX
**Outcome:** Approved and verified on device (two-plan cross-contamination test passed after the fix).

---

### Claude Code adopted for direct file edits; claude.ai chat remains for planning and architecture
**Decision:** Architecture discussions, debugging reasoning, document strategy, and research happen in this chat. Direct edits to App.js, Cloud Functions, and markdown documentation happen through Claude Code, which has live read/write access to the local project folder.
**Reason:** The prior workflow (generate a file here, download it, manually replace the local copy) was the single biggest source of friction across every session. Claude Code eliminates that cycle for mechanical work while this chat remains better suited for longer reasoning and research.
**Impact:** Architecture, Product
**Outcome:** Approved. Proven same-day on the photo persistence bug above, including Claude Code independently identifying two race conditions and a missing dependency beyond the original scope.

---

## 2026-06

### Analytics moved from Phase 8 to Phase 2 (Commerce)
**Decision:** Instrument commerce click/conversion tracking from the first Commerce build, not after the engine matures.
**Reason:** Lost click data can never be recovered. Every click before instrumentation is a permanently missing data point for the learning engine.
**Alternatives considered:** Leave analytics until later phases once the core recommendation flow works.
**Outcome:** Approved. Analytics.js is Phase 2 in CommerceImplementation.md.

---

### Commerce.md split into strategy and implementation
**Decision:** Split the single Commerce.md into Commerce.md (strategic blueprint) and CommerceImplementation.md (engineering spec).
**Reason:** A single document exceeded one responsibility — it was serving investors/product thinking and engineers/Claude Code simultaneously. Documents over ~500 lines stop being read front-to-back and start being searched; each should have a single responsibility.
**Alternatives considered:** Keep as one document, rely on headers for navigation.
**Outcome:** Approved. Same split pattern as Architecture.md / Vision.md.

---

### Memories promoted from a Find subcategory to a standalone module
**Decision:** Memories is not a category inside Find. It is a standalone top-level platform module.
**Reason:** User intent differs fundamentally. Find answers "I need something" (utility). Memories answers "I want to find someone" (emotional, preservation-driven). Forcing Memories into Find's item-centric workflow would dilute both.
**Alternatives considered:** Memories as a category within Find's inventory types (Items, Collections, Documents, Memories).
**Outcome:** Approved. Ownership domains simplified to three pillars: Spaces (Organize), Things including Documents (Find), Memories (Memories).

---

### Documents folded into Find, not a separate ownership domain
**Decision:** Documents (passports, insurance, manuals, receipts) are a category within Find, not their own platform pillar.
**Reason:** "Where's my passport?" and "Where's my drill?" are the same question — same user intent, locate something I own. The distinction that matters is user intent, not object type.
**Outcome:** Approved. Three ownership domains, not four.

---

### Memories is a digital archive, not just a physical-location index
**Decision:** Memories stores actual digital copies of cropped/described photos in Firebase Storage, not just metadata pointing to a physical location.
**Reason:** The digital copy is the core value — it survives floods, fires, estate sales, and deteriorating albums. An index alone doesn't protect anything.
**Alternatives considered:** Index-only (location + description, no stored image).
**Outcome:** Approved. Memories is Pro-only given the storage cost and trust implications.

---

### Memories: freeze, never auto-delete, on Pro cancellation
**Decision:** If a user cancels Pro, their Memories archive is frozen (read-only) after a 90-day grace period, never silently deleted.
**Reason:** Storing irreplaceable family photos creates an obligation that a payment lapse must never violate. "Your memories are safe, even if you cancel" is a trust promise worth the storage cost.
**Outcome:** Approved. See Architecture.md Storage Lifecycle section.

---

### User data is never used for AI model training without explicit opt-in
**Decision:** Hard rule, no exceptions, across all modules.
**Reason:** Users storing irreplaceable photos in Memories have a reasonable expectation their data serves only them. Violating that expectation is existential for trust, even if anonymized.
**Outcome:** Approved. Architecture.md Data Ethics Policy.

---

### TypeScript for all new architecture; App.js migrates gradually
**Decision:** Find, Memories, and all new modules/services are built in TypeScript from day one. The existing App.js monolith is not mass-converted.
**Reason:** Find introduces the ownership graph (Location, Item, Document, Action) that every future module depends on. Getting those types right once avoids double work later. Mass-converting a working 1,861-line file risks introducing bugs for no immediate benefit.
**Alternatives considered:** TypeScript only for shared types.ts (original plan); full mass conversion.
**Outcome:** Approved, revised from original narrower plan.

---

### Visualization quality set to "low," not "standard"
**Decision:** OpenAI gpt-image-2 quality parameter set to `low`.
**Reason:** `standard` is not a valid value for gpt-image-2 (caused a production error). `quality: "high"` runs a 4-stage pipeline 30-50x slower than `low`. Testing showed no noticeable quality degradation at `low`.
**Alternatives considered:** `medium` (untested, reserved as fallback if `low` proves insufficient in production).
**Outcome:** Approved. Cut visualization time from ~60s to ~25-30s.

---

### Account deletion: Firestore/Storage cleanup before Auth deletion, not after
**Decision:** Delete order is re-authenticate → Firestore → Storage → Auth (last).
**Reason:** Firestore/Storage security rules require `auth.uid == userId`, which only holds while the user is still authenticated. Deleting Auth first (the initially-chosen "safer" order) caused cleanup to silently fail due to permission denial.
**Alternatives considered:** Delete Auth first on the theory that a failed cleanup afterward is a "safer" failure mode since the account is already inaccessible. Rejected after testing showed it left orphaned data with no error surfaced.
**Outcome:** Approved. Client-side deletion is a known interim solution — see BACKLOG.md for the future Cloud Function / Admin SDK approach that would avoid this constraint entirely.

---

### Retailers are data, not fixed tiers
**Decision:** RetailRegistry is a Firestore-backed registry with computed priority, not a hardcoded Tier 1/2/3 list.
**Reason:** A fixed tier list requires a code release to change. A registry with a priority score can be adjusted by editing Firestore. This is more consistent with the "everything is data" principle applied elsewhere in Commerce.
**Outcome:** Approved.

---

*Add new entries at the top of the current month's section, or start a new month heading. Keep entries short — decision, reason, alternatives considered, outcome. This is a memory aid, not a design document.*
