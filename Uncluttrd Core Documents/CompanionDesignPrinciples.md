# Uncluttrd Companion Design Principles

Last updated: July 2026
Status: Living document. Principles only — no code, no schema, no implementation detail belongs here. This is the standard every future Companion feature is evaluated against, and the intended direction for the rest of Uncluttrd's product decisions more broadly.

---

## Why this document exists

Organize v1 proved that a photo and a plan are enough to earn trust. The Companion experience is built on a different hypothesis: that people struggling with clutter make more progress when the app removes decisions, not when it adds features. That hypothesis is fragile. It is easy to erode it one reasonable-sounding addition at a time — one more stat, one more option, one more thing to read before acting — until the product quietly becomes the thing it was built to be the antidote to.

This document exists so that six months from now, when someone (human or Claude Code) proposes the next Companion feature, there is a written standard to check it against, rather than a vibe to reconstruct from memory.

---

## The North Star Principle

**Every interaction should reduce the user's cognitive load, not increase it. Whenever there is a choice between showing more information or simplifying the next decision, choose simplification.**

This is the single filter every other principle below is a specific case of. When two principles seem to conflict, this is the one that wins.

---

## The Principles

### 1. Show one decision at a time
A screen with three good options is a worse experience than a screen with one good default and a way to go deeper if the user wants to. The Companion loop exists because the Organize results screen — three tiers, four suggestions each, three products each — is a lot to hold at once right after a photo. Don't recreate that density inside the Companion loop itself. If a moment in the flow seems to need two decisions, that is a signal to ask which one actually matters right now, not to present both.

### 2. Celebrate progress, don't just log it
A completed action is an emotional moment before it is a data point. The product should notice out loud — warmly, briefly — before it asks for anything else (a photo, a rating, an upgrade). Logging without celebrating turns a win into a chore. Celebrating without logging loses the data. Do both, celebration first.

### 3. Never overwhelm
If a screen needs a scroll to find the thing the user is supposed to do next, it has already overwhelmed them. This applies to information density, to the number of things asking for attention at once, and to how much is asked of the user before they get something back. A feature that is individually reasonable can still make the whole additive experience worse — evaluate additions against the full screen they land on, not in isolation.

### 4. Commerce appears only when it helps
Product recommendations, affiliate links, and upgrade prompts are valuable when they show up at the moment they solve a problem the user already has. They erode trust when they show up because it was our turn to ask. Commerce has a place in this product — see Commerce.md — but it earns its placement by being useful in that instant, not by being present.

### 5. Every screen should answer "what should I do next?"
A user should never have to figure out what the app wants from them. If a screen doesn't have an obvious next action, it either doesn't need to exist as a distinct screen, or it's missing the one thing that would make it a Companion screen instead of a report.

### 6. Reduce decision fatigue over completeness
Feature-complete and decision-fatigue-free pull in opposite directions more often than they don't. When they conflict, completeness loses. This means some real, useful capability will sit in the backlog longer than it technically needs to, on purpose, because shipping it now would cost more in cognitive load than it returns in value. That trade is intentional, not a compromise to fix later.

### 7. Speak like a calm, encouraging professional organizer
The voice is warm, specific, and never anxious. It sounds like someone who has helped hundreds of people through exactly this moment and knows it's going to be fine. It does not sound like a project manager, a productivity coach, or a gamified habit tracker.

**Use:** "Let's Start Here," "Nice work," "Great progress," "Finished for today," "Show me what you accomplished," "Ready to keep going?"

**Avoid:** "Next Action," "Task," "Project," "Complete Task," "Task Complete," "Complete Session," and productivity/project-management vocabulary generally (sprints, milestones, streaks, progress bars framed as metrics, checklists framed as backlogs). If a phrase would feel at home in a to-do app, it doesn't belong here.

---

## How to apply this document

Before building a new Companion feature, or any feature that touches the post-analysis experience, run it against the North Star Principle first, then the seven principles above. If a feature only survives by treating one of these as optional, that's a decision to surface and discuss explicitly — not to route around silently. This is the same discipline Architecture.md's guiding principles already apply to structural decisions; this document is that same kind of filter, scoped to how the product feels rather than how it's built.

---

## Origin

This document was written alongside the Session 1 Companion Experience design (July 2026) — the guided loop that follows Organize's photo analysis and visualization with one personalized action at a time. See DecisionLog.md for that decision's full record once logged.
