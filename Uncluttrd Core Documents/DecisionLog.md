# Uncluttrd Decision Log

Last updated: July 2026
Status: Living document. Add an entry whenever a meaningful architectural, product, or business decision is made. Lightweight version of an Architecture Decision Record (ADR) — enough context to remember why, months later.

**Rule: No feature gets built until it's documented in Vision.md, Architecture.md, Commerce.md, CommerceImplementation.md, Analytics.md, or here. This prevents half-implemented ideas and gives any future developer, including Claude Code, clear guidance before writing code.**

**Rule: Any Cloud Function change that alters a required request shape (new required fields, new auth requirements, or anything the client must send differently) must be explicitly checked for backward compatibility with the currently-live App Store/Play Store build before deploying — not just the branch currently in development. Record the current live build number somewhere visible (a pinned line at the top of BACKLOG.md, updated on every release) so this can be checked quickly, not looked up under pressure during an incident. Added 2026-07-15 after `85168f3` made `analyzePhoto` require an authenticated user and a client-sent `analysisId`, and was deployed straight to `cluttrd-3e335` — the same Firebase project the live public App Store build (build 15, which predates both requirements) also uses. There is no staging project and no separate build profile for internal testing, so every real production user's photo analysis was rejected outright for hours before this was caught. See the `2026-07-15 — analyzePhoto build-15 compatibility outage` entry below and `BACKLOG.md` for the incident and the hotfix.**

---

## 2026-07

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
