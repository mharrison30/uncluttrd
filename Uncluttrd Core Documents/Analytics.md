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
| `pdf_exported` | Measures how many plans are valuable enough for a user to save/share as a PDF | — | Approach-format plans: `format` (`comprehensive`), `has_selected_approach`, `selected_approach` (only when committed), `approach_count`, `visualization_count`. Legacy tier plans: none | YES | NO |
| `product_clicked` | Measures affiliate purchase intent — how many recommended products get clicked | — | `product`, `companionActionIndex` | YES | NO |
| `subscription_started` | Measures paywall engagement — how many users begin the Pro upgrade flow | Where in the native purchase flow itself do users drop off, distinct from whether they clicked "upgrade" at all? | `analysisId`, `source` | NO | NO |
| `subscription_completed` | Measures actual Pro conversion — how many started upgrades convert to paying subscribers | — | TBD | NO | NO |
| `app_store_button_clicked` | Measures how many users click through to leave an App Store rating/review | — | TBD | NO | NO |
| `referral_source` | Measures which channel (Instagram, Facebook, etc.) a user reports as how they found the app | — | `source` | NO | NO |
| `room_selected` | Measures which room types users organize most, to prioritize product/content decisions | — | `room` | NO | NO |
| `budget_selected` | Measures which budget tier users engage with most, to validate pricing/tier design | — | `budget` | NO | NO |
| `plan_deleted` | Measures how often users delete a saved plan from My Plans | How many saved plans get deleted, and does deletion rate correlate with project completion (a "done, don't need this anymore" signal) vs. early abandonment? | `planId` | YES | NO |

### Companion — Free Funnel (RETIRED 2026-07-18)

**Retired, not deleted, per this document's own discipline of recording history.** Superseded entirely by "Companion — Batch Workflow" below, per the batch workflow redesign (DecisionLog.md 2026-07-18). These events depended on the single-step first-action model and the `analysisId`/`planId` dual-correlator split that existed specifically because free-tier plans were never saved. Both of those are now gone: the whole loop is batch-based from the first analysis onward, and free plans save immediately with real `planId`s (see the free-tier History persistence work, also this session) — so every batch event below uses `planId` uniformly, free and Pro alike.

| Event | Properties |
|---|---|
| `first_action_viewed` / `first_action_started` / `first_action_completed` / `first_action_failed` | `analysisId`, ... |
| `progress_photo_prompted` / `progress_photo_started` | `analysisId` |

### Companion — Pro Continuation (RETIRED 2026-07-18)

**Retired, not deleted** — same reason as above. The first-action-vs-continuing-loop distinction these events were built around no longer exists; every batch, including the first, uses the same mechanism.

| Event | Properties |
|---|---|
| `companion_session_started` | `planId` |
| `companion_action_viewed` / `companion_action_started` / `companion_action_completed` / `companion_action_failed` | `planId`, `actionIndex`, ... |
| `companion_progress_photo_uploaded` / `companion_next_action_generated` | `planId`, `actionIndex` |
| `companion_session_completed` | `planId` |

`companion_session_resumed` is **not** retired — see the Batch Workflow section below, unchanged in behavior.

### Companion — Batch Workflow

Session-based batches replace single-step generation (`analyzePhoto`/`generateNextAction` now return a balanced session's worth of checklist items, not one action at a time) — see DecisionLog.md, 2026-07-18, for the full redesign, including the acknowledged exception to CompanionDesignPrinciples.md Principles 1 and 7. Every event here is correlated via `planId` alone, for free and Pro users alike.

| Event | Purpose | Business Question | Properties | Implemented? | Dashboard? |
|---|---|---|---|---|---|
| `batch_shown` | Measures how many analyzed/submitted photos successfully produce a viewable batch | Of photos analyzed or submitted, what share successfully produce a viewable batch? | `planId`, `batchIndex` | YES | NO |
| `batch_generation_failed` | Measures how often batch generation fails and why | How often does batch generation fail, and why — more important now than under the old single-step model, given the larger, more structurally complex AI response | `planId`, `batchIndex`, `reason` | YES | NO |
| `batch_step_checked` / `batch_step_unchecked` | Measures which specific suggested items users actually engage with | Which specific suggested items do users actually engage with vs. ignore? | `planId`, `batchIndex`, `itemId` | YES | NO |
| `batch_continue_tapped` | Measures how many items a user resolves before continuing | How many items does a user typically resolve per session before continuing, and does that vary by project/room type? | `planId`, `batchIndex`, `checkedCount`, `uncheckedCount` | YES | NO |
| `batch_item_skip_popup_shown` | Measures how often users leave a batch with unresolved items | How often do users leave a batch with unresolved items rather than fully completing it? | `planId`, `batchIndex`, `uncheckedCount` | YES | NO |
| `batch_item_skipped` | Measures which suggestions get skipped and why | Which suggestion types get skipped most, and does skip reason reveal miscalibrated AI suggestions (over-perfectionism, wrong difficulty)? | `planId`, `batchIndex`, `itemId`, `reason` | YES | NO |
| `batch_item_marked_not_done` | Measures how often items carry forward vs. get abandoned | Does carrying items correlate with session length or engagement drop-off? | `planId`, `batchIndex`, `itemId` | YES | NO |
| `batch_session_paused` | Measures explicit pauses ("that's enough for today"), distinct from skip | How often do users explicitly pause vs. silently going quiet, and does explicit pausing correlate with a higher or faster return rate than silent abandonment? | `planId`, `batchIndex` | YES | NO |

**Note (2026-07-19, wrap-up redesign):** `batch_item_skip_popup_shown`'s name is now a slight misnomer - the unresolved-items review moved from a `Modal` popup to a full-screen page (`CompanionWrapUp`, DecisionLog.md 2026-07-19), but the event name/properties/meaning ("user reached the unresolved-items review with N unchecked") are unchanged, so it's kept as-is rather than churned for a naming nicety. Also as of the same redesign, `batch_item_skipped` and `batch_item_marked_not_done` can now fire from a **Pause**-triggered flow, not just Continue - Pause enters the same wrap-up screen when something's unresolved (a scoped update to the 2026-07-18 "Pause is always single-tap" decision). Neither event's properties changed to reflect entry source, so downstream analysis treating all instances as Continue-originated would now be slightly wrong - worth a `source` property if this distinction becomes analytically important later, not added speculatively now.
| `batch_photo_submitted` | Measures how many shown batches result in a submitted progress photo | Of batches shown, what share result in a submitted photo — how many sessions actually continue? | `planId`, `batchIndex`, `checkedCount`, `carriedCount`, `skippedCount` | YES | NO |
| `batch_second_batch_reached` | **PRO NORTH STAR METRIC** — replaces `companion_session_started`. Measures engagement into a second session, explicitly *not* conversion | What share of Pro users move from one completed batch into a second session? A free user hitting the continuing-loop paywall never reaches this event at all, so it's engagement-only by construction — a separate paywall-conversion event may be worth pairing with this later, flagged as a known gap, not solved here. | `planId` | YES | NO |
| `batch_completion_recommended` | Measures how often the AI judges a project substantially complete | How often does the AI think a project is done? | `planId`, `batchIndex` | YES | NO |
| `batch_completion_accepted` | Measures how often users agree with a completion recommendation and finish | How often do users agree with the AI vs. continue anyway — absence of this event after a `batch_completion_recommended` implies "continue" was chosen instead. Together, these two answer which project/room types generate disagreement, and whether the completion threshold is too conservative or too aggressive. | `planId`, `batchIndex` | YES | NO |
| `batch_completion_overridden` | Measures how often users declare a project finished via "I like it as-is" without an AI completion recommendation | How often do users override rather than wait for an AI recommendation — a direct signal on whether the completion threshold is too conservative in practice, distinct from `batch_completion_accepted` (which requires a prior AI recommendation) so the two never conflate "agreed with the AI" and "the AI never got there." | `planId`, `batchIndex` | YES | NO |
| `companion_paywall_viewed` | Measures how many users reach the Companion continuing-loop paywall | How many users who finish a batch reach the Companion-specific upgrade moment? | `planId` | YES | NO |
| `companion_upgrade_clicked` | Measures Companion-specific paywall engagement | Does an upgrade prompt shown after a completed batch convert better than the general paywall? | `planId` | YES | NO |
| `companion_completion_prompt_viewed` | Measures how often the AI-recommended completion choice is actually surfaced | Pairs with `batch_completion_recommended`/`batch_completion_accepted` above — confirms the choice screen itself was reached, not just recommended server-side. *(Note: fires in code since the original completion-choice work; not previously documented here — closed as part of this update, not a new event.)* | `planId`, `batchIndex` | YES | NO |
| `companion_continued_past_complete` | Measures explicit "continue" choices past a completion recommendation | Complements `batch_completion_accepted` with a direct signal of the "continue" choice, not just its absence. *(Same documentation-gap note as above.)* | `planId`, `batchIndex` | YES | NO |
| `companion_project_finished` | Measures explicit project finishes | How often is a project actually marked finished, and after how many batches? *(Same documentation-gap note as above.)* | `planId`, `batchIndex` | YES | NO |
| `companion_session_resumed` | Measures how many users resume a paused session | Does the Home banner (or My Plans) actually bring users back into a paused session — which entry point works better? | `planId`, `source` | YES | NO |

---

*Add new events at the bottom of the relevant table when a new feature needs tracking, with a stated Business Question — no exceptions, per the Analytics Philosophy above. Update Implemented?/Dashboard? to YES only once the event is actually firing in code / actually visualized somewhere — this is a contract, not an aspiration.*

*Note on `plan_started`/`plan_completed`/`product_clicked`: these three pre-existing events were updated as part of the Companion work (Jul 2026) — `tier` added to `plan_started`, `spaceType` added to `plan_completed` (replacing an earlier undocumented placeholder), and `companionActionIndex` added to `product_clicked` — specifically so room/budget/commerce breakdowns are answerable via backend queries without new event types. See DecisionLog.md, 2026-07-13.*
