# Uncluttrd Backlog

Last updated: June 2026
Status: Living document. Add items as they are identified. Close them when shipped.

**Rule: If an idea will take more than 15 minutes to implement or requires future consideration, it belongs in this backlog before the discussion ends.**

**Rule: No feature gets built until it's documented in Vision.md, Architecture.md, Commerce.md, CommerceImplementation.md, Analytics.md, or DecisionLog.md. See DecisionLog.md for the full project document map.**

Priority levels:
- 🔴 **Critical** — blocks launch or causes data loss
- 🟡 **High** — meaningful user or business impact, ship soon after launch
- 🟢 **Medium** — improvement, ship when bandwidth allows
- ⚪ **Low / Future** — good idea, no timeline

---

## Open Items

### 🔴 analyzePhoto compatibility shim for build 15 (live App Store version)
**Context:** `85168f3` (Jul 14, 2026 free-plan server-enforcement work) made `analyzePhoto` require `request.auth` and a client-sent `analysisId` as hard preconditions, and was deployed straight to `cluttrd-3e335` - the same Firebase project the live public App Store app (confirmed via App Store Connect to be **build 15**, which predates `analysisId` entirely) also uses. There is no staging/production project split (`.firebaserc` has one alias) and no separate EAS build profile for internal testing (every build this whole session, including TestFlight ones, used the `production` profile). Every real production user's photo analysis was being rejected outright with `invalid-argument`/`unauthenticated` - a live outage on core functionality, not a single-user report.

**Hotfix shipped (Jul 15, 2026):** `analyzePhoto` no longer requires `request.auth` or `analysisId` as base preconditions - restored to its exact pre-`85168f3` validation (`imageBase64`/`prompt` only). Free-plan enforcement (idempotency + count check/increment) now only engages when **both** a uid and an `analysisId` are present - the shape the Companion-era client sends. A request missing either is processed with no count check and no idempotency protection, exactly like this function behaved before `85168f3`. Deployed and live-verified with a build-15-shaped request (no `analysisId`, no auth header) - confirmed it now reaches the Anthropic call instead of being rejected at the precondition check.

**This is temporary, not the real fix.** The actual fix is getting a `feature/companion`-based build (with `analysisId`) approved and released as the new live App Store version, at which point every real user will be sending `analysisId` again and this compatibility shim becomes dead code for organic traffic (though it's harmless to leave in indefinitely as a defensive fallback).

**Follow-up actions:**
- Track App Store review/release status for the next build containing `analysisId` support: once it's live, free-plan enforcement is fully restored for all real users again.
- Consider whether a staging Firebase project (separate from `cluttrd-3e335`) and/or a non-`production` EAS profile for internal/TestFlight builds is worth setting up, so a backend change tied to an unreleased client feature can never again be deployed live to the same project real App Store traffic hits before that client ships.

---

### 🟡 Launch Metrics Dashboard
**Context:** Once users arrive, these metrics become more important than features. Set up monitoring before public launch so data is available from day one.

**Track after public launch:**
- Daily Active Users (DAU)
- Plans Generated
- Visualizations Generated
- Average Plan Generation Time
- Average Visualization Time
- Pro Conversion Rate
- Account Deletions
- Crash-Free Sessions
- Affiliate Link Clicks

**Tools:** Firebase Analytics (already installed), RevenueCat dashboard for subscription metrics, Firebase Functions logs for timing data.

---

### 🟡 App Store Review Management
**Context:** App Store reviews will become one of the biggest product inputs after launch. Every review is a data point.

**Goal:** Respond to every review.

**Track:**
- Common feature requests
- Reported bugs
- Praise (what's working)
- Ratings trend over time

**Action:** Check reviews weekly. Respond within 48 hours. Log recurring themes in this backlog as new items.

---

### 🟡 Social Media Accounts
**Context:** This is a business task, not just a marketing task. Social media presence is required for:
- Lowe's Creator Program (up to 20% commission, requires Instagram/Pinterest)
- Affiliate program credibility during manual reviews
- Brand presence for future user acquisition

**Action:** Create `@uncluttrd` on Instagram and Pinterest immediately. Even with no posts, claiming the handle prevents squatting and satisfies affiliate program requirements.

**Priority upgrade rationale:** Lowe's and other affiliate approvals depend on this. It is blocking revenue, not just marketing.

---

### 🟡 Ship Second Android Closed-Test Update (~Day 10-11)
**Context:** PrimeTestLab CS advised via WhatsApp that Google Play's closed-testing review favors apps that show iterative updates during the 14-day test — it signals the developer is actively engaging with tester feedback, which is part of what the requirement is designed to surface.

**First update:** Shipped ~Day 3 (Jul 1, 2026) — included Delete Account, pinch-to-zoom fix, paywall Terms/Privacy links, performance improvements. Good timing, substantive change.

**Second update:** Target ~Day 10-11 of the closed test (around Jul 8-9, 2026, if testers opted in ~Jun 28-29). Content matters less than timing — PrimeTestLab said it doesn't matter what the change is, just that an update happens. Good candidates:
- Loading tip message improvements (see Perceived Performance Improvements item — low risk, visible)
- Any small, safe fix accumulated in BACKLOG.md by that date
- Confirm first/last name placeholder fix made it into the build if not already verified

**Action:** Check calendar around Jul 8-9. Ship whatever small, low-risk, real fix is ready by then.

---

### 🟡 Android Testing Report (v1.0.0 baseline)
**Context:** PrimeTestLab tester feedback received on an OPPO CPH2127, Android 12, testing app version v1.0.0 — not the current version. Several issues may already be fixed by work done since v1.0.0 (the safe-area/status-bar fix via react-native-safe-area-context, and the existing My Plans/History screen). Each item needs re-verification on the actual current build before being treated as a real bug — don't rebuild blind against stale feedback.

**Likely already fixed — verify on latest build, don't rebuild blind:**
- Signup screen text overlapping status bar — likely fixed by the react-native-safe-area-context change (SafeAreaProvider/useSafeAreaInsets fix).
- Header text too close to status bar on every page — same root cause/fix as above.
- Onboarding "Next" buttons under safe area on gesture-nav devices — likely the same safe-area fix; confirm it extends to onboarding screens specifically, since onboarding wasn't the direct focus when that fix was made.
- "No history page for past analyses" — the app already has a My Plans/History screen (extensively tested last week for the photo-restoration bug). Likely the tester was on a build old enough not to have it yet, or missed it in the UI. Verify it's present and discoverable in the latest build.

**Real, valid issues — worth fixing regardless of version:**
- No password visibility toggle (eye icon) on signup — cheap, standard UX expectation, worth adding.
- Android hardware/gesture back button closes the app entirely instead of navigating back through screens — real navigation bug, needs a proper back-stack handler (likely via React Navigation's back handling or a custom `BackHandler` listener).
- Wrong/random app launcher icon showing — **confirmed root cause:** `adaptive-icon.png` (and `splash-icon.png`, byte-identical) are a generic placeholder bullseye graphic, never replaced with the real Uncluttrd brand mark. Android's launcher icon is built from `android.adaptiveIcon.foregroundImage`, which points at this placeholder, not `icon.png` (which correctly shows the real brand mark). Fix: generate a proper adaptive-icon foreground from `icon.png` with correct safe-zone padding per Android's adaptive icon spec, replacing the placeholder file.

**Action:** Re-test every item in the "Likely already fixed" section on the current build before doing any work — do not fix blind against v1.0.0-era feedback. Every item in "Real, valid issues" (including the launcher icon, now root-caused) can be worked on directly, since none of them are tied to the safe-area fix or the History screen.

---

### 🟡 Password Reset / Forgot Password Flow
**Context:** There is currently no way for a user who forgets their password to regain access to their account. This is a standard, expected feature for any app with email/password authentication, and its absence is both a support burden (users will email hello@uncluttrd.app for help) and a real churn risk (users who can't recover access may simply abandon the app rather than ask for help).

**Fix:** Firebase Auth has a built-in `sendPasswordResetEmail()` function — this is not a build-from-scratch feature, it's wiring up an existing Firebase Auth capability. Add a "Forgot Password?" link on the sign-in screen that calls `sendPasswordResetEmail(auth, email)` and shows a confirmation message. Firebase handles sending the actual reset email and the reset flow itself.

---

### 🟡 Account Deletion — Cloud Function approach
**Context:** Current client-side account deletion works correctly for launch but has a known limitation: the client Firebase SDK is subject to security rules, which requires a specific deletion order (Firestore → Storage → Auth). A Cloud Function using the Firebase Admin SDK would bypass security rules and allow a fully transactional deletion from a trusted backend.

**Current state:** Client-side deletion is working. Order is: re-authenticate → delete Firestore → delete Storage → delete Auth. Critical errors stop the process. Non-critical storage errors (object not found) are logged and skipped.

**Future improvement:**
```
User
  ↓
Re-authenticate (client)
  ↓
Call Cloud Function (deleteAccount)
  ↓
Firebase Admin SDK
  ├── Delete Firestore
  ├── Delete Storage
  └── Delete Auth
```

**Why not now:** Would delay launch. Current implementation is solid for v1.
**When to do it:** First major post-launch update or when account deletion complaints arise.

**Update (Jul 2026), raises the priority:** this is no longer purely an architecture nicety. Locking down `firestore.rules` so clients can never touch `analysisCount`/`analysisCountMonth` (see the free-plan server-enforcement work) surfaced that client-side `deleteDoc` on `users/{uid}` is also a real exploit path: a client could delete its own user doc without also calling `deleteUser` afterward, then let `ensureUserDocument` recreate a fresh doc (count reset to 0) on the same still-authenticated session. Fully blocking client delete would close this but breaks the account deletion feature outright, so it was deliberately left open for now rather than shipped broken. Moving deletion server-side (as already planned above) closes this exploit as a side effect, which is the real trigger to prioritize this sooner rather than "when complaints arise."

---

### 🟡 RevenueCat Webhook → Cloud Function → Firestore Sync for isPro
**Context:** The free-plan server-enforcement work (Jul 2026) needed `analyzePhoto` to know a user's Pro status without a RevenueCat API call on every single analysis request (cost/latency tradeoff, deemed disproportionate at current scale). The interim solution: the client writes its own `isPro` value to `users/{uid}` whenever RevenueCat's entitlement changes, and `firestore.rules` restricts client updates to touching only that one field.

**Known limitation, accepted deliberately for now:** a sufficiently determined client could still fake its own `isPro: true` write to Firestore, since the client remains the source of the value being trusted. The actual paid features (visualization, PDF export, plan history) are separately gated behind real RevenueCat checks, so the blast radius today is limited to the free-analysis-count limit specifically, not real payment bypass - judged proportionate for now, not indefinitely.

**Future improvement:** replace the client write entirely with a RevenueCat webhook that calls a trusted Cloud Function (Admin SDK) on every entitlement change, which writes `isPro` to Firestore server-side. Removes client write access to `isPro` from `firestore.rules` completely once shipped.

**When to do it:** before this matters at meaningful scale or spend - not urgent at launch volume, but shouldn't be forgotten once it is.

---

### 🟡 Perceived Performance Improvements
**Context:** Analysis takes 15-20 seconds, visualization takes 25-30 seconds. Backend speed and the user's perception of speed are two different things. Both matter independently.

**Backend improvements (see also: Analysis Prompt Optimization) — still open:**
- Remove `searchQuery` and `icon` from analyze prompt (saves tokens, reduces latency)
- Benchmark Haiku vs Sonnet (see separate item)

**Perceived performance improvements — done, verified in App.js Jul 9, 2026:**
- `LOAD_MESSAGES` (analysis tips) and `VIZ_TIPS` (visualization tips) already contain the specific progress copy below, not generic tips.
- `VIZ_TIPS` already rotates every 4000ms.
- `LOAD_MESSAGES` steps forward every 2500ms and holds on the last message ("Almost ready...") rather than wrapping — left as-is, no change needed.

**Analysis tips:**
```
"Studying your space layout..."
"Identifying what needs to stay and what can go..."
"Selecting storage solutions for your budget..."
"Building your three-tier organization plan..."
"Almost ready..."
```

**Visualization tips:**
```
"Analyzing your space dimensions..."
"Reimagining your layout..."
"Placing furniture and storage solutions..."
"Adding finishing details..."
"Your transformation is almost ready..."
```

**Target:** 12-15s for analysis, 20-25s for visualization feels like meaningful work without testing patience.

---

### 🟡 Analysis Prompt Optimization
**Context:** Claude is currently generating `searchQuery` and `icon` fields for every product recommendation. These fields will eventually be handled by the Commerce Service, not the AI. Every extra field costs tokens and adds latency.

**Action:** Remove `searchQuery` and `icon` from the analyze prompt. Commerce Service will generate search queries based on product names. Icons can be derived from product category.

**Dependency:** Commerce Service V1 must be built before removing `searchQuery` or product links will break.

**Expected impact:** 3-5 second reduction in analysis time.

---

### 🟡 Haiku vs Sonnet Benchmark
**Context:** `claude-sonnet-4-5` is used for photo analysis. `claude-haiku-4-5` is significantly faster and cheaper. The quality difference for structured JSON generation from a home organization photo is unknown.

**Action:** Run a blind comparison.
- Take 20 photos across different space types (garage, closet, kitchen, bedroom, home office)
- Run each through both Sonnet and Haiku
- Compare: overview quality, recommendation accuracy, budget realism, product specificity
- If you honestly cannot tell the difference, switch to Haiku

**Do not switch without the benchmark.** The analysis is the heart of the product. Benchmark first. Decide from data.

---

### 🟡 Transformation Intensity Control
**Context:** The AI visualization currently has no concept of how much change a space needs — it applies aggressive transformation (swapping furniture, adding new products) even to spaces that are already organized and just need light refinement. Example: a corner shelving unit that was already tidy got replaced with an umbrella stand, decorative storage boxes, and a wall organizer, when what was wanted was a small enhancement like a wooden riser to elevate one item.

**Two possible directions:**
1. **User-selected mode** — let the user choose "Organize" (current behavior, for cluttered spaces) vs "Enhance" (lighter touch, for spaces that are close but need refinement) before generating.
2. **AI-detected intensity** — have the AI assess how organized the space already is and calibrate automatically.

**Leaning toward option 1 (user-selected)** since it's more predictable and doesn't rely on the AI correctly inferring intent from a single photo.

**Related, separate hypothesis to test:** `quality: "low"` (set for speed) may be reducing the AI's fidelity to the original photo's structure, causing more aggressive/less precise transformations than `quality: "high"` would produce. Worth comparing the same photo at both quality settings before committing to a fix direction.

---

### 🟢 Affiliate Programs
**Context:** Affiliate program status and pipeline has grown into its own operational track. See **AffiliatePipeline.md** for the full pipeline, network status, pending approvals, and retailer strategy.

**Summary status:**
- CJ Affiliate: Active
- Amazon Associates: Active (ID: uncluttrd20-20)
- Impact: Active (Marketplace declined, reapply post-launch)
- Awin: Active
- FlexOffers: Pending approval

---

### 🟢 Commerce Service V1
**Context:** Product recommendations previously opened a Google Search link, giving away high purchase-intent traffic.

**Phase 1 — done (Jul 2026):** `openProduct` in App.js now redirects directly to a tagged Amazon Associates search URL instead of Google Shopping:
```
https://www.amazon.com/s?k={productName}&tag=uncluttrd20-20
```
Click tracking is live via the `product_clicked` analytics event (see Analytics.md).

**Still open — full V1 scope, not yet built:**
- A `getProductLink` Cloud Function (or equivalent service layer) resolving real SKUs/prices/images per product, rather than today's client-side search-URL redirect
- In-app product cards (image, real price, availability) instead of linking out to a search results page
- Multi-program routing (Amazon today; CJ, Awin, Impact, FlexOffers per AffiliatePipeline.md as each comes online)

**Do after launch.** Full Commerce architecture in Commerce.md.

---

### 🟢 Crashlytics
**Context:** Firebase App Check is planned but crash monitoring via Crashlytics is not yet configured. When crashes happen in production, you'll want stack traces, not just user complaints.

**Action:** Add Firebase Crashlytics to the project.

**Monitor:**
- JS crashes
- Native crashes
- Cloud Function failures

**When to do it:** Before significant user growth. Simple to add, invaluable when needed.

---

### 🟢 App Check Setup
**Context:** Firebase App Check protects Cloud Functions from abuse (unauthorized API calls, cost inflation attacks). Not currently configured.

**Action:** Set up Firebase App Check with the App Attest provider for iOS and Play Integrity for Android. Enforce on `analyzePhoto` and `generateVisualization` Cloud Functions.

**When to do it:** Before significant user growth. Low urgency at launch scale.

---

### 🟢 iOS Pro Subscription — AppState Refresh
**Context:** On iOS, if a user upgrades to Pro and backgrounds the app for an extended period, Pro status may not reflect current entitlement when they return. RevenueCat's `getCustomerInfo()` should be called when the app returns to the foreground.

**Note:** Confirmed as sandbox subscription expiry (sandbox subscriptions last ~5 minutes), not a real production bug. Monitor in production before implementing.

**Action:** Add an `AppState` change listener that calls `getCustomerInfo()` when app returns to foreground.

---

### 🟢 Tablet Responsive Layout
**Context:** First tablet testing pass (iPad, Build 6) surfaced that the app's layout was designed phone-first and doesn't adapt well to tablet width/height. This is a running item — add specific screens below as they're found during testing.

**Cause (general):** Fixed-width content columns and flex-wrap grids sized for phone dimensions don't redistribute intelligently at tablet widths (820px+), leaving large unused areas rather than looking intentionally spacious.

**The pattern:** Content designed to stretch (full-width cards, buttons, lists) looks fine on tablet since it fills available width with consistent padding. Content in fixed-width grids (specifically the room icon grid) does not stretch and leaves a visible gap. Vertical whitespace below short screens is a secondary, lower-priority issue present on nearly every screen, since content height was tuned for phone screens.

**Screens observed so far (iPad, Build 6):**

1. **Home screen.** Room icon grid (Living Room, Closet, Garage / Kitchen, Bedroom, Home Office) is left-aligned in a fixed 3-column layout, leaves a visible gap on the right. By contrast, the budget tier cards and upload box on the same screen stretch full-width correctly and look fine — confirms the issue is specific to the fixed-width grid, not the whole screen.

2. **Paywall ("Go Unlimited") screen.** Content column doesn't grow to use available tablet width. Large empty area below "Restore Purchases" since vertical spacing was tuned for phone screen height.

3. **Account screen.** Profile card and settings rows stretch full-width correctly and look fine. Large empty area below "Delete Account" — same vertical whitespace issue as paywall, lower priority.

4. **FAQ screen.** Best-behaved of all screens tested — FAQ list cards stretch full-width and read naturally as a list on tablet. Same minor vertical whitespace below "Contact Support."

**Action:** Two separate fixes, different priority:
- **Higher priority within this item:** fix the room icon grid specifically — make it genuinely responsive (recalculate columns/spacing based on screen width) rather than a fixed phone-sized grid. This is the one true "broken-looking" layout found so far.
- **Lower priority:** address vertical whitespace on short-content screens (Account, Paywall, FAQ) — likely not worth dedicated work; may resolve naturally as more content/features are added to these screens over time.

**Action:** Add responsive layout logic — likely a max-content-width constraint with the whole column centered on wide screens, plus responsive grid math (recalculate columns/spacing based on screen width) rather than fixed phone-sized tiles. Apply consistently across all screens once the pattern is established, rather than fixing screen-by-screen.

**Priority rationale:** Most users are on phones; tablets are a smaller fraction of usage for a photo-based app. Real polish item, not a launch blocker. Keep adding screens to this item as more tablet testing surfaces them, rather than creating a new backlog entry per screen.

**Reference: mockup received Jul 1, 2026**
A mockup was reviewed (`Uncluttrd Core Documents/mockups/tablet-home-mockup.png`) showing a possible tablet redesign direction. Useful, extractable pieces worth keeping as reference for when this item is actually implemented:

- Breakpoints: phone <600px, tablet portrait 600-900px, tablet landscape >900px
- Room grid column counts per breakpoint: 3 columns (phone) / 3 columns (tablet portrait) / 6 columns (tablet landscape) — this directly addresses the room grid issue already documented above
- General principle worth keeping: controls (buttons, cards) stay comfortable/human-sized as screen grows; content area (photo upload, grids) grows to use available space

Two things NOT adopted from the mockup, flagged as separate decisions to make deliberately later, not bundled into this fix:
- A persistent bottom tab bar (Home/My Plans/History/Account) — this would be a navigation model change beyond the current hamburger menu, out of scope for a layout-density fix
- Budget tier cards changing from stacked to a centered row on tablet — reasonable but a second UI pattern change beyond the room grid specifically; worth its own decision rather than adopting by default from a mockup

This is reference material for the eventual implementation, not an approved spec. Revisit when actually implementing this item.

---

### 🟢 Attribution & Growth Tracking Roadmap
**Context:** Phased plan for install/referral attribution, developed after investigating what's currently missing (no referral capture exists at all today).

**Phase 1 (now, under ~1,000 users) — build this:**
- UTM parameters on every marketing link (Facebook, Instagram, Pinterest, LinkedIn, email, Nextdoor) pointing to uncluttrd.app, tracked via existing GA4
- A self-reported "How did you hear about Uncluttrd?" question added to the signup flow
- A weekly Growth Dashboard (spreadsheet): Post | Platform | Impressions | Website Clicks | App Downloads | Pro Upgrades — accuracy improves over time as more tracking layers are added, doesn't need to be perfect from day one

**Phase 2 (1,000-10,000 users) — add Branch (branch.io):**
- Chosen over AppsFlyer (overkill, priced for large-scale spend) and Adjust
- Reasons: excellent docs, mature deep linking, good free tier at this scale, industry standard
- Requires: SDK integration in App.js, iOS Associated Domains capability, Android App Links/intent filters, regenerating marketing links through Branch's dashboard
- This is genuine engineering work (roughly half a day), not a quick add — don't build until the trigger below is hit

**Phase 3 (paid acquisition):** Branch becomes effectively mandatory once real ad spend starts, since that's when proving ROI on specific channels/campaigns matters.

**Key principle:** nothing built in Phase 1 gets thrown away when Phase 2 happens — Branch layers on top of the same UTM/GA4/self-reported foundation rather than replacing it.

---

### ⚪ Impact Marketplace Reapplication
**Context:** Impact Marketplace application was declined due to insufficient traffic as a new publisher. Blocks Target, Wayfair, and Container Store affiliate programs through Impact.

**When to reapply:** 60-90 days post-launch with real download numbers and Google Analytics traffic data.

**Programs blocked until reapproval:**
- Target (5-8% commission, home category)
- Wayfair (7%, available on FlexOffers as alternative)
- The Container Store (highest relevance for home organization)

---

### ⚪ Find Module — MVP
**Context:** Find is the next platform module after Organize. Photo-based home inventory with recursive location hierarchy (House → Room → Furniture → Shelf → Container → Item). TypeScript from day one. Architecture in Architecture.md.

**When to start:** After iOS and Android are publicly live and stable.

---

### ⚪ Memories Module
**Context:** Standalone Pro module for digitizing and preserving physical photographs, keepsakes, and family history. Full vision in Vision.md and Architecture.md.

**When to start:** After Find module ships and proves itself.

---

### ⚪ Commerce Module — Full Build
**Context:** Full Commerce Service with RetailRegistry, ProductCatalog, ProductResolver, AffiliateResolver, RecommendationEngine, and Analytics. Full architecture in Commerce.md.

**When to start:** After V1 (Amazon affiliate links) is live and generating click data.

---

## Closed Items

| Item | Closed | Notes |
|------|--------|-------|
| API keys moved to Cloud Functions | Jun 2026 | analyzePhoto + generateVisualization proxy |
| Firebase Security Rules locked down | Jun 2026 | Firestore + Storage scoped to uid |
| RevenueCat iOS configured | Jun 2026 | appl_SIucLbhCtkbSMSuMrhGyxsfWmxx |
| RevenueCat Android configured | Jun 2026 | goog key in App.js |
| Android package version alignment | Jun 2026 | expo-camera 16→17, 4 others |
| Pinch-to-zoom Android fix | Jun 2026 | ImageZoom + GestureHandlerRootView |
| Visualization quality: low | Jun 2026 | 60s → 25-30s improvement |
| max_tokens reduced to 1500 | Jun 2026 | minimal impact, bottleneck is Claude API |
| Pinch-to-zoom iOS verification | Jun 2026 | ImageZoom works on both platforms |
| Account deletion feature | Jun 2026 | Required by Apple guideline 5.1.1v |
| Terms of Use link in App Store | Jun 2026 | Required by Apple guideline 3.1.2c |
| Privacy policy updated | Jun 2026 | In-app deletion replaces contact-us flow |
| First/last name placeholders fixed | Jun 2026 | Was showing "Michael"/"Harrison" |
| CJ Affiliate account | Jun 2026 | Active |
| Amazon Associates account | Jun 2026 | Active, ID: uncluttrd20-20 |
| Impact account | Jun 2026 | Active, Marketplace declined |
| Awin account | Jun 2026 | Active |
| FlexOffers account | Jun 2026 | Pending approval |
| Google Analytics on website | Jun 2026 | G-HGQZTEWKMF |
| Impact meta tag on website | Jun 2026 | For Impact affiliate verification |
| Commerce.md split into strategy + implementation | Jun 2026 | Commerce.md (strategy) + CommerceImplementation.md (engineering spec) |
| AffiliatePipeline.md created | Jun 2026 | Operational tracking split out of Commerce.md |
| DecisionLog.md created | Jun 2026 | Lightweight ADR for architectural/product decisions |
