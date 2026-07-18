# Uncluttrd Decision Log

Last updated: July 2026
Status: Living document. Add an entry whenever a meaningful architectural, product, or business decision is made. Lightweight version of an Architecture Decision Record (ADR) — enough context to remember why, months later.

**Rule: No feature gets built until it's documented in Vision.md, Architecture.md, Commerce.md, CommerceImplementation.md, Analytics.md, or here. This prevents half-implemented ideas and gives any future developer, including Claude Code, clear guidance before writing code.**

**Rule: Any Cloud Function change that alters a required request shape (new required fields, new auth requirements, or anything the client must send differently) must be explicitly checked for backward compatibility with the currently-live App Store/Play Store build before deploying — not just the branch currently in development. Record the current live build number somewhere visible (a pinned line at the top of BACKLOG.md, updated on every release) so this can be checked quickly, not looked up under pressure during an incident. Added 2026-07-15 after `85168f3` made `analyzePhoto` require an authenticated user and a client-sent `analysisId`, and was deployed straight to `cluttrd-3e335` — the same Firebase project the live public App Store build (build 15, which predates both requirements) also uses. There is no staging project and no separate build profile for internal testing, so every real production user's photo analysis was rejected outright for hours before this was caught. See the `2026-07-15 — analyzePhoto build-15 compatibility outage` entry below and `BACKLOG.md` for the incident and the hotfix.**

---

## 2026-07

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
