# Remembered Home v1 — Space Association Design

Status: Draft
Version: 0.1 (2026-08-03)
Audience: Everyone implementing Remembered Home v1
Purpose: Designs how a new organizing session becomes associated with a Space, and how that association immediately improves the experience — not recognition for its own sake.
Depends on: Remembered Home v1 — Design Investigation (prior pass, unsaved, chat-only — the current-state audit this document builds on), MergeExecutionDesign.md (`canonicalSpaceId`), MigrationSyncAlignmentDesign.md (`syncPlanToSpaceGraph`/`deriveFullReprojectionDocs` alignment)

Notation as established in this codebase's other design docs: `[Observation]` (verified against current source), `[Inference]` (reasoning from observations), `[Decision]` (a choice made).

Governing principle, stated once here for reference throughout: **recognition may propose identity; only navigation from an existing Space or explicit user confirmation establishes it.** Ground rule, checked against every recommendation in Section 4 explicitly: every screen must answer "what became easier because the app remembered something?"

**Recognition is a convenience, never a requirement.** The user should never need recognition to receive the benefits of Remembered Home. Recognition reduces friction by proposing an existing Room when appropriate. Navigation from My Rooms remains the primary, explicit way to continue organizing an existing Room. If recognition fails, is declined, or is unavailable, the user proceeds through the normal fresh-start flow with zero loss of functionality.

---

## Section 1 — Existing-Space entry

### 1a. Where does this entry point live?

[Observation] Verified directly: today, tapping a row in the History/"My Spaces" list (`App.js:4326`) opens an `Alert` with exactly four options — "View Plan" (→ `openSpaceResults`, straight to Results), "Rename", "Share as PDF", "Delete Plan". **There is no fifth option, and nothing on the Results screen itself, that starts a new organizing session against an existing Space.** This entry point does not exist in any form today — Section 1 is genuinely new design, not a relabeling of something already there.

[Observation] The Space Detail screen (`App.js:4381` onward) already exists in the codebase, fully built — header, photo, status, history, and (per its own header comment) a "Continue Organizing"/"View Full Plan" button pair — but was deliberately taken off the default tap path in an earlier pass this session, kept "in the codebase for future use." Its own header comment (`4381-4394`) is now stale (still says "reached only from My Spaces ('View Plan')" — that's no longer true, "View Plan" goes straight to Results now), which is worth fixing whenever this screen is reactivated, not a design blocker.

[Decision] **Reactivate Space Detail as the home for this action**, rather than adding a fifth item to an already-crowded Alert or inventing a new screen. This is the smallest change with the best fit: the screen already exists, was explicitly preserved for exactly this kind of future use, and its shape (photo, status, prior work) is already what Section 1c needs to show. Concretely:
- History row's "View Plan" **stays exactly as-is** (straight to Results — that's the "I want to see my last plan" path, unchanged).
- A new "Organize Again" action is added to the History row's `Alert` (a fifth option) **and** to Space Detail's own button row, both routing to the same new flow. Two entry points to the same one flow, not two different flows — consistent with this codebase's existing pattern of reusing one mechanism from multiple call sites (the rename bottom sheet is the precedent: one `renderRenameSheet()`/`openRenameSheet()`, called from four places already).

### 1b. What does the flow look like?

[Decision] **Brief summary first, camera second — never camera-immediately.** Tapping "Organize Again" opens Space Detail (if not already there) showing: the Space's photo, last-organized date, and prior batch status, with a single primary button — "Take a new photo." This is a deliberate, small friction: [Inference] a user who just tapped "Organize Again" already knows which Space this is (they navigated here), so the summary isn't identity-confirmation, it's *priming* — one glance at "last time: 2 items still open" before the camera opens is the first moment memory pays off, not a data dump gating the action. Camera-immediately would skip that entirely and feel identical to a first visit, failing the ground rule outright (nothing became easier, because nothing was shown).

### 1c. What prior context is carried automatically?

Because the Space is already known (navigation-established, not inferred), everything already queryable is available with zero new reads for the fields already on `history` items, per the prior audit:

- Display name (`getSpaceDisplayName`), original photo, last-organized date — all directly on the plan document, already in the `history` array that's loaded for this Space's most recent plan.
- Prior batch items and completion status (`batchHistory`, `currentBatch`, item `status`) — same source, no new query.
- Most recent progress photo (`progressPhotos[]`) — same source.

[Decision] What's *available* is broader than what's *useful* — see 1e for the deliberate cut between the two. Everything above is *available*; only a subset is passed to the AI.

### 1d. What new data is created?

[Decision] Confirmed as specified, and consistent with what's already built: a **new plan document**, created the same way `savePlanToHistory` already creates every plan (`addDoc`, not `setDoc` reopening the old one), with one new field — `canonicalSpaceId` pointing at the established Space's id. A **new Project** gets created under that existing Space (not a new Space — the Space already exists, established by navigation). The prior plan is untouched. This matches MergeExecutionDesign.md's own model exactly: one Space, multiple Projects nested under it, each Project a `sourcePlanId`-addressed, independent chapter.

### 1e. Minimum prior context that measurably improves the AI's recommendations

[Decision] Applying the stated justification requirement strictly — each item below states what specific recommendation gets better, not just that the data is available.

| Context passed to the prompt | What specific recommendation improves | Why it's included |
|---|---|---|
| **Prior batch items still unresolved** (`status: "carried"` or the last batch's unchecked items) | The model won't re-suggest "clear the counter" if that was already flagged and left incomplete last time — it can either fold it into this session's list once, correctly, or explicitly note it's still pending, instead of re-discovering it from the photo as if new. | Without this, a returning user gets a recommendation that reads exactly like a stranger's first impression — no continuity, and worse, a real risk of the model repeating the *same* item it already gave once, which reads as the app not remembering at all. |
| **The most recent progress photo (if one exists) alongside the new photo** | Lets the model reason about *change* — "you cleared the shelf since last time" — rather than describing the room as if seeing it cold, which directly informs whether new suggestions should build on visible progress or address what's still the same. | This is the same before/after comparison the Companion's own `generateNextAction` prompt already does within a session (`App.js:2637`) — extending an already-proven pattern across a longer time gap, not inventing new prompt logic. |

[Decision] **Explicitly excluded**, and why:
- **The full text of every past `overview`/`proTip`** — [Inference] this is exposition, not decision-relevant; it doesn't change what the model should suggest today, and including it risks *biasing* the new analysis toward repeating old language rather than looking freshly at the current photo, which the governing principle's "never proof, always evidence" spirit argues against extending into the prompt too: past analysis is context, not a script to follow.
- **The Space's full session/batch history across every visit** — [Inference] more history doesn't sharpen today's recommendation once the two items above are included; a growing context blob would start crowding out the model's attention on what's *actually visible in today's photo*, which the original prompt is already careful to insist on ("verify the specific problem you're describing is genuinely visible in this exact photo, not a common decluttering trope").
- **Completed items from the most recent batch** — [Inference] "this was already done" only matters if it might reappear; a *completed* item reappearing would be a photo-reading failure, not a memory failure, and telling the model about it doesn't fix that failure mode, it just adds tokens with no corresponding behavior change.

---

## Section 2 — Generic-camera entry

### 2a. Proposing candidate Spaces

[Decision] After `parsed.spaceType` returns (`App.js:3223`, the exact insertion point identified in the prior audit), compute `getSpaceDisplayName(parsed)` and compare against two sources, in order:
1. **The already-loaded `history` array** (zero new reads) — covers the common case, a user's 20 most recent plans.
2. **A targeted query** (`where("spaceType","==",label)` / `where("spaceName","==",label)`, same `query`/`where`/`collection` primitives already imported and already used at `App.js:2853` and in `queryMergeCandidatesForBanner`) — only needed to catch a Space outside the 20-plan cache. [Decision] Run this query in parallel with (or immediately after) the local check, not conditionally on the local check failing — a Space organized 6+ months ago by an active user is exactly the case the local cache would miss, and it's the scenario this whole feature is designed around; skipping the query in the common case defeats the purpose for the user with the most history to gain from it.

[Decision] Both checks use `getSpaceDisplayName`'s existing exact-match semantics — the same comparison Tier 1 detection already uses, deliberately not a new fuzzy-match algorithm. [Inference] The prior audit already found real production evidence that exact match under-recognizes (label drift like "Creative Workspace/Art Desk" vs. "Creative Workspace / Art Desk"). That's a known, accepted limitation carried forward here, not solved — see Section 5.

### 2b. Evidence shown per candidate

[Decision] Exactly as specified: candidate's prior photo next to the new photo, display name, last-organized date, one-line summary of prior work (reusing the same status-summarization logic Space Detail already has, per 1c). [Decision] Cap this at showing enough to *recognize*, not enough to *review* — a thumbnail-sized side-by-side and one line of text, matching the ground rule's anti-goal of never asking the user to study data before acting.

[Decision] Framing copy, evaluated and chosen. Options considered:
- *"This might be your Pantry"* — accurate but reads as the AI hedging about its own classification ("might be" = the AI isn't sure what it's looking at), not as the app recalling a shared history with the user. Superseded by the choice below.
- *"This looks familiar..."* — rejected outright: centers the AI's own perception ("this looks familiar *to me*"), which is exactly the AI-uncertainty framing the governing principle exists to avoid. It describes the photo, not the relationship.
- *"Welcome back? We may have organized this pantry before."* — rejected: turns "Welcome back" (already reserved as Section 4's unconditional, confident post-confirmation greeting) into a question, undercutting its warmth there; also names the specific room before the user has looked at any evidence, asserting ahead of what's actually been confirmed.
- **Chosen: "Have we organized this room before?"** — "we" frames this as shared history between the user and the app, not a classification the AI is unsure about; "organized" matches the app's own established verb throughout the product (Organize Again, "Uncluttrd can help organize it") rather than a generic "worked on"; staying generic in the headline — not naming the room yet — avoids asserting the specific match before the user has looked at the evidence below it. The proposed name appears immediately underneath, in the body, where it reads as a proposal being offered for the user's judgment, not a claim being made about them.

Exact card copy:

> **Have we organized this room before?**
> [photo: LAST TIME] [photo: TODAY]
> **Pantry** · Last organized 93 days ago · You'd cleared 2 of 4 items and left the rest for next time.
>
> [ Yes, this is my Pantry ]  [ No, this is a new room ]  [ Not sure ]

The photo pair reuses the existing side-by-side visual pattern already proven for BeforeAfterStack (App.js) — same row layout, not that component itself, since its "BEFORE"/"AFTER" labels mean progress within one ongoing project, a different concept from "the room as it looked last time vs. the new photo just taken." New labels for this context: "LAST TIME" / "TODAY".

### 2c. User actions

[Decision] Exactly the three specified, with one implementation note: "Yes, this is my [Space name]" reuses the *identical* Section 1d mechanism (new plan, `canonicalSpaceId` set, new Project) — proposal-then-confirmation and navigation-then-action converge on the same underlying operation, per Section 3. "No" and "Not sure" are **the same code path** — both simply omit `canonicalSpaceId` and proceed through today's unmodified `savePlanToHistory`. [Decision] Not distinguishing them in the data is deliberate: the governing principle already treats a declined match as "not yet established," and the existing merge-candidate flow (Keep Separate / Not Now / Not Sure) is where a *real* distinction between "definitely not" and "not sure" already lives — duplicating that distinction here would be building two answers to the same question.

### 2d. Recognition failure never blocks organizing

[Decision] Confirmed as specified and structurally free: since the proposal step is a pure *addition* before the existing `setResults`/`savePlanToHistory` call, "no match found" and "user declined" both fall through to code that is **completely unmodified** from today. This is a real, checkable property, not an aspiration: the fresh-start path doesn't get touched by this feature at all, it just sometimes gets a proposal inserted in front of it.

### 2e. Multiple similar-named candidates

[Decision] Show all matching candidates, each with its own photo/date/summary card, exactly as specified — never auto-select. [Inference] This is the direct product-level consequence of the governing principle: a label match is evidence, and *ambiguous* evidence (two Spaces sharing a label) is exactly the case where inference must not become identity without the user looking at the photos and choosing.

### 2f. No candidates match

[Decision] Confirmed: no proposal UI renders at all, zero added friction, current fresh-start flow entirely unchanged — this is the same structural guarantee as 2d, just for the "zero matches" case instead of "user declined."

---

## Section 3 — Convergence contract

[Decision] Point-by-point, checked against real source rather than accepted as stated.

**(a) New plan + `canonicalSpaceId`, new Project, not a reopened old plan.** [Observation] Confirmed consistent. `savePlanToHistory` already unconditionally creates a new document via `addDoc` (`App.js:2899`) — the only change needed is threading one new field into the `entry` object it already builds.

**(b) Prior plan(s) remain historical, untouched.** [Observation] Confirmed. Nothing in this design writes to, updates, or reads-for-mutation any existing plan document. The prior plan is only ever read (for its photo/summary), never written.

**(c) Prior history shapes the new experience but stays read-only.** [Observation] Confirmed by construction — Section 1e's prompt context is read from the prior plan and never written back to it; the new session's own history lives entirely on the new plan document.

**(d) `savePlanToHistory` unchanged in structure, enriched with `canonicalSpaceId`.** [Observation] Confirmed, and precisely scoped: the function needs one new parameter and one new key (`canonicalSpaceId: establishedSpaceId || null`) in the `entry` literal it already constructs (`App.js:2878-2898`). No restructuring.

**(e) The shadow write handles this correctly without new code — one correction.** [Observation] **The claim's outcome is right, but the named mechanism is imprecise, worth stating exactly.** `savePlanToHistory` does not call `syncPlanToSpaceGraph` at creation time — it calls **`writeSpaceShadowStructure`** (`App.js:2935`), which builds its payload via `buildShadowDocs`. This session's own earlier Part 4 work already made `buildShadowDocs` resolve `computeShadowIds(planId, entry)` — meaning **because `entry` already carries `canonicalSpaceId` from point (d), the very first shadow write already lands under the correct established Space**, with no follow-up sync required. `syncPlanToSpaceGraph` (via the now-aligned `deriveFullReprojectionDocs`) *does* correctly take over for every subsequent mutation (Pause, Wrap-up, Completion, etc.) on this new plan, exactly as the design intends — but that's the second half of the story, not the first. [Decision] No new code is needed in either function; the only change anywhere in the shadow layer is that `entry` arrives with the field already set.

**(f) The user's anchor after creation.** [Decision] **The new Project is the anchor for this session; the Space is the anchor for the relationship.** Concretely: immediately after creation, the user lands on **Results for the new plan** (unchanged navigation — Results is already "about" a single plan, i.e., a single Project, and that doesn't need to change). What *does* change is what that Results screen now sits inside: the rename pencil, the History row, and Space Detail (if reactivated per 1a) all already resolve identity through `getSpaceDisplayName`/`canonicalSpaceId`-aware Space lookups, so the *Space* becomes the durable thing the user navigates back to over time (via History → Organize Again), while each individual visit's Results screen remains scoped to that visit's own Project, exactly matching MergeExecutionDesign.md's own "N Projects, one Space" shape. This is not a new decision so much as confirming today's existing Results-is-plan-scoped navigation is already the right shape and doesn't need to become Space-scoped.

**Gaps identified, stated plainly rather than assumed away:**
1. **`savePlanToHistory`'s signature must change** — a new `establishedSpaceId` parameter, threaded from both the Section 1 (navigation) and Section 2 (confirmed proposal) call sites. Small, but real, not "free."
2. **The candidate-query path (2a's targeted query) doesn't exist today** — it's a new query using existing primitives, not existing infrastructure being reused. Worth not overclaiming this as already-built.
3. **Space Detail's own stale header comment** (1a) should be corrected when this ships, since it will become genuinely reachable again and the comment currently describes behavior that hasn't been true since an earlier pass this session.

---

## Section 4 — First-minute experience

### First 5 seconds — Recognition

[Decision] On landing (either path): a single warm line — *"Welcome back to your Pantry."* — replacing, not supplementing, whatever loading state would otherwise show. [Decision] No date, no stats, no photo comparison in this first beat — those are the next moment's job. [Ground-rule check] What became easier: the user gets an immediate, unambiguous signal that navigating/confirming worked, before they've had to look at anything else. Answer is concrete (confirms the action succeeded), not decoration.

**Companion difference, first 5 seconds**: none yet — the Companion hasn't started. This beat belongs to the transition screen, not the Companion itself.

### First 30 seconds — Orientation

[Decision] One short card, not a list: *"Last organized 93 days ago. You'd cleared the top two shelves and left the bottom shelf for next time."* — built from the same unresolved-items/progress-photo data already justified in Section 1e, now *narrated* rather than just passed to a prompt.

[Ground-rule check, item by item, exactly as required]:
- **Last-organized date**: what became easier — the user doesn't have to recall or guess whether "today" is a meaningful revisit; it's stated. Concrete.
- **What was left unresolved**: what became easier — the user doesn't have to re-discover, by staring at the shelf, what they already decided last time still needed work; it's already surfaced, so they can walk straight to it. Concrete.
- **A progress photo comparison, shown here rather than only fed to the prompt**: what became easier — the user gets the same "oh right, that's where I left off" recall a photo triggers faster than text does. Concrete, and directly serves the next moment.

[Decision] **Explicitly not included here**: a list of everything ever done in this Space, tier/budget history, or prior product suggestions. [Inference] None of these make the next 30 seconds of the user's actual task easier — they're exactly the "report about everything the app knows" the anti-goals name directly.

**Companion difference, first 30 seconds**: this is where the returning-visit and first-visit paths diverge visibly. A first visit shows nothing here (there's nothing to show). A returning visit shows this one card, then proceeds — the Companion itself doesn't change its own behavior yet at this beat; this is still the pre-Companion orientation screen from Section 1b/2b.

### First minute — Momentum

[Decision] This is where the new plan's own `firstActionBatch` (already generated by the "Analyze" call, using the Section 1e-enriched prompt) gets shown as the actual checklist — but framed specifically: *"Here's where to pick up."* rather than a generic "here's your plan" header. [Decision] The concrete mechanism is entirely the enriched prompt from 1e doing its job: because the prompt already knows what's unresolved and what's changed, the returned checklist is *already* the "given what we know, here's where to start" list — no separate momentum-generation step is needed beyond what Section 1e already specified.

**What the Companion does differently for a returning visit, stated explicitly for each sub-question asked:**
- **Does it acknowledge prior work?** Yes — via the orientation card (30-second beat), not repeated inside the Companion's own checklist screen, which would be redundant.
- **Does it avoid re-suggesting completed items?** Yes, by construction — completed items were deliberately excluded from the prompt context (Section 1e), so the model has no basis to resurface them; this is enforced by what's *not* passed in, not by a separate filter after the fact.
- **Does it pick up where the last session left off?** Yes for *unresolved* items specifically (carried into this session's list); no for the room as a whole — the photo is still read fresh each time, per the original prompt's own explicit "verify this is genuinely visible in this exact photo" instruction, which this design does not weaken or override.
- **Does it evaluate the room fresh, with the benefit of knowing what's done?** **Yes — this is the precise, correct framing.** The photo analysis itself stays photo-grounded and honest (never assumes something is fixed just because it was flagged before); the *only* thing memory changes is which of the genuinely-still-visible problems get emphasized as "pick up here" versus treated as new discoveries.

---

## Section 5 — What's deferred out of v1

[Decision] Explicit boundary, stated as exclusions:
- **No Space-organized History redesign.** The History list stays exactly as it is today, with one new Alert action added (1a). A full "Spaces as the primary navigation surface" redesign is a different, larger project.
- **No multi-Space home dashboard.** Nothing on the Home screen changes except the entry points already specified (a candidate-proposal moment after analysis, and whatever "Organize Again" affordance 1a adds inside History/Space Detail). No new Home-screen summary of "all your Spaces."
- **No cross-Space recommendations.** The AI prompt enrichment in Section 1e is scoped to the *current* Space's own prior data only. Nothing compares or aggregates across a user's multiple Spaces.
- **No true visual recognition.** Matching stays exact-string `getSpaceDisplayName` comparison, the same mechanism Tier 1 detection already uses and the same limitation the prior audit already found real evidence of (label drift under-recognizing genuine duplicates). Actual image-based room recognition is out of scope entirely — not attempted, not partially built.

[Decision] The line, stated plainly: **v1 makes the one room the user is currently standing in front of feel alive. It does not make the app's memory, as a whole, visible or navigable as its own feature.**

---

## Section 6 — Anti-goal self-check

Checking every recommendation in this document against the four anti-goals directly:

- **Not a dashboard of historical data**: no screen in this design shows more than one Space's most recent state at a time; Section 5 explicitly excludes a multi-Space view.
- **Not a timeline the user must study**: the 30-second orientation beat is one card, not a scrollable history; explicitly justified field-by-field in Section 4, with everything failing the "what became easier" test explicitly excluded (full history, tier/budget history, product suggestions).
- **Not a report about everything the app knows**: Section 1e explicitly excludes several available-but-unjustified data points (full past overviews, full session history, completed items) specifically to avoid this.
- **Not an interface requiring memory to use**: Section 2d/3's structural guarantee — every recognition/proposal step is a pure addition in front of the existing, unmodified fresh-start flow — means a user who ignores every memory feature entirely still has the identical experience the app has today. Memory is additive, never a precondition.

**Ground-rule pass, summarized**: every context item this document proposes surfacing was checked against "what became easier," not "is this available" — and several available, plausible-sounding items (full overview/proTip history, completed items, cross-session aggregation) were explicitly rejected because they didn't clear that bar. That rejection record is itself the evidence this design followed the rule rather than just citing it.
