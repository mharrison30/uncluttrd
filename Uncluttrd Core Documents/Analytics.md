# Uncluttrd Analytics

Last updated: Jul 2026
Status: Living document — contract, not a changelog.

**Rule: This document lists every analytics event the app tracks or will track, its purpose, and whether it's implemented and visualized on a dashboard. No analytics event gets added to the app without being documented here first — same discipline as the feature-documentation rule in BACKLOG.md.**

**Analytics Philosophy: Every analytics event must answer a future product or business question. We collect events to improve the user experience, validate hypotheses, and understand engagement. We do not collect data simply because we can.** Every event added below carries a stated Business Question for exactly this reason — if a proposed event can't be given one, it doesn't ship.

---

## Events

| Event | Purpose | Business Question | Properties | Implemented? | Dashboard? |
|---|---|---|---|---|---|
| `app_open` | Measures return engagement — how often users come back to the app | — | TBD | NO | NO |
| `signup_completed` | Measures signup conversion — how many visitors become registered users | — | TBD | NO | NO |
| `photo_uploaded` | Measures top-of-funnel engagement — how many users get far enough to upload a photo | — | TBD | NO | NO |
| `plan_started` | Measures how many uploaded photos actually kick off an analysis | — | `tier` | YES | NO |
| `plan_completed` | **NORTH STAR METRIC** — the core value moment: a user received a complete organization plan | — | `spaceType`, `time_to_complete` | YES | NO |
| `visualization_viewed` | Measures how many completed plans lead to a user viewing an AI visualization | — | TBD | NO | NO |
| `pdf_exported` | Measures how many plans are valuable enough for a user to save/share as a PDF | — | TBD | NO | NO |
| `product_clicked` | Measures affiliate purchase intent — how many recommended products get clicked | — | `product`, `companionActionIndex` | YES | NO |
| `subscription_started` | Measures paywall engagement — how many users begin the Pro upgrade flow | Where in the native purchase flow itself do users drop off, distinct from whether they clicked "upgrade" at all? | `analysisId`, `source` | NO | NO |
| `subscription_completed` | Measures actual Pro conversion — how many started upgrades convert to paying subscribers | — | TBD | NO | NO |
| `app_store_button_clicked` | Measures how many users click through to leave an App Store rating/review | — | TBD | NO | NO |
| `referral_source` | Measures which channel (Instagram, Facebook, etc.) a user reports as how they found the app | — | `source` | NO | NO |
| `room_selected` | Measures which room types users organize most, to prioritize product/content decisions | — | `room` | NO | NO |
| `budget_selected` | Measures which budget tier users engage with most, to validate pricing/tier design | — | `budget` | NO | NO |

### Companion — Free Funnel

Correlated via `analysisId`, a client-generated, analytics-only identifier (never persisted to Firestore) minted once per analysis and threaded through every event below, since free-tier plans are never saved and therefore never get a `planId` to join against.

| Event | Purpose | Business Question | Properties | Implemented? | Dashboard? |
|---|---|---|---|---|---|
| `first_action_viewed` | Measures how many completed analyses reach the Companion's first personalized action | Of completed analyses, what share of users actually see their personalized first action? | `analysisId` | NO | NO |
| `first_action_started` | Measures how many viewed first actions the user actually begins | Of users who see it, what share begin it — does a single action actually prompt action? | `analysisId` | NO | NO |
| `first_action_completed` | Measures how many started first actions the user finishes | Of users who start it, what share finish, and how long does it take? | `analysisId`, `secondsSinceStarted` | NO | NO |
| `first_action_failed` | Measures how often the first-action experience fails | How often does the AI return a usable plan but fail to produce a usable first action, and why? | `analysisId`, `reason` | NO | NO |
| `progress_photo_prompted` | Measures how many completed first actions reach the photo invitation | Of users who complete their first action, what share reach the photo invitation? | `analysisId` | NO | NO |
| `progress_photo_started` | Measures how many prompted users attempt to share a progress photo | Of users invited to share progress, what share attempt it — how much friction does this specific ask add? | `analysisId` | NO | NO |
| `companion_paywall_viewed` | Measures how many free users reach the Companion-specific paywall | How many free users who finish a full first loop reach the Companion-specific upgrade moment? | `analysisId` | NO | NO |
| `companion_upgrade_clicked` | Measures Companion-specific paywall engagement | Does an upgrade prompt shown after a completed experience convert better than the general paywall? | `analysisId` | NO | NO |

### Companion — Pro Continuation

Correlated via the existing `planId` (solid, since Pro plans are persisted synchronously right after analysis).

| Event | Purpose | Business Question | Properties | Implemented? | Dashboard? |
|---|---|---|---|---|---|
| `companion_session_started` | Measures how many Pro users move from a single first action into an ongoing companion relationship | What share of Pro users move from one completed first action into an ongoing companion relationship? (the Pro north star for this feature) | `planId` | NO | NO |
| `companion_action_viewed` | Measures view-through as users progress deeper into the loop | Does view-through hold steady across action 2, 3, 4…, or decay? | `planId`, `actionIndex` | NO | NO |
| `companion_action_started` | Measures start rate across successive actions | Does start rate hold or decay across successive actions? | `planId`, `actionIndex` | NO | NO |
| `companion_action_completed` | Measures completion rate across successive actions | Where in the ongoing loop does completion actually drop off? | `planId`, `actionIndex`, `secondsSinceStarted` | NO | NO |
| `companion_action_failed` | Measures how often generation or action state fails mid-loop | How often does generation or action state fail once a user is mid-loop, and why? | `planId`, `actionIndex`, `reason` | NO | NO |
| `companion_progress_photo_uploaded` | Measures how many completed actions result in a submitted photo | Of completed companion actions, what share result in a submitted photo — how many iterations actually continue? | `planId`, `actionIndex` | NO | NO |
| `companion_next_action_generated` | Measures how many submitted photos successfully produce a new action | Of submitted photos, what share successfully produce a new action? | `planId`, `actionIndex` | NO | NO |
| `companion_session_completed` | Measures explicit session closes | How often do users explicitly close a session ("Finished for today") vs. quietly going quiet, and does explicit closing correlate with a higher or faster return rate than silent abandonment? | `planId` | NO | NO |
| `companion_session_resumed` | Measures how many Pro users resume a paused session | Does the Home banner (or My Plans) actually bring users back into a paused loop — which entry point works better? | `planId`, `source` | NO | NO |

---

*Add new events at the bottom of the relevant table when a new feature needs tracking, with a stated Business Question — no exceptions, per the Analytics Philosophy above. Update Implemented?/Dashboard? to YES only once the event is actually firing in code / actually visualized somewhere — this is a contract, not an aspiration.*

*Note on `plan_started`/`plan_completed`/`product_clicked`: these three pre-existing events were updated as part of the Companion work (Jul 2026) — `tier` added to `plan_started`, `spaceType` added to `plan_completed` (replacing an earlier undocumented placeholder), and `companionActionIndex` added to `product_clicked` — specifically so room/budget/commerce breakdowns are answerable via backend queries without new event types. See DecisionLog.md, 2026-07-13.*
