# Uncluttrd Product Philosophy

Status: Adopted
Version: 1.0
Audience: Everyone who builds Uncluttrd
Purpose: Defines what Uncluttrd believes and the principles that guide product decisions
Change policy: Changes require a Decision Log entry, a version increment, and a revision-history note

This document describes why Uncluttrd exists and how the product should behave. It should change rarely.

It does not define product objects, technical architecture, implementation details, pricing, or business-model mechanics. It sits separately from the future Object Model, Architecture.md, and DecisionLog.md.

---

## Why This Document Exists

Features change.

Interfaces evolve.

Technology moves quickly.

The philosophy behind the product should change much more slowly.

This document helps future builders make decisions that feel consistent with Uncluttrd, including decisions about problems that do not exist yet.

If two reasonable solutions exist, this document should help explain why one feels more like Uncluttrd.

---

## Mission

Audience: Internal

Build the operating system for ownership.

A home is more than a collection of rooms.

It contains possessions, memories, responsibilities, improvements, maintenance, purchases, and history.

Uncluttrd exists to help people understand and care for everything they own throughout its lifecycle.

This mission guides long-term product direction. It is not customer-facing marketing copy.

---

## Product Promise

Audience: External guidance

Help people build the memory of their home.

People often struggle because their home gradually becomes harder to understand.

Things become difficult to find.

Projects remain unfinished.

Purchases are forgotten.

Storage becomes inconsistent.

Uncluttrd helps people gradually build a home that is easier to understand tomorrow than it is today.

This promise should guide customer-facing language, even if these exact words are never shown to customers.

---

## Values

Values describe what we believe about people and their homes. They explain why the Design Principles exist.

### Homes are emotional, not logistical

People do not organize merely because they enjoy categorization.

They organize because they want their home to feel calmer and easier to live in.

### Progress matters more than perfection

A small improvement today is more valuable than an ideal plan that never happens.

### Technology should reduce mental load

People should spend less time managing information and more time living in their homes.

### Calm is a feature

Reducing stress is not a side effect.

It is one of the primary outcomes the product exists to create.

---

## Design Principles

These principles describe how the product behaves.

When an individual feature conflicts with these principles, the principles win.

### Calm over productivity

We help people make progress.

We do not make them feel behind.

The product should reduce pressure rather than create it.

### Honest over persuasive

We never fabricate certainty.

We never exaggerate confidence.

We explain uncertainty when it exists.

Every honest interaction makes future recommendations more believable. Every exaggerated claim weakens trust.

Trust is difficult to earn and easy to lose, so we choose honesty even when certainty would sound more impressive.

### Encourage, never judge

The product should feel supportive.

Never demanding.

Never disappointed.

### AI should disappear

Users should remember what they accomplished, not which AI generated it.

AI should reduce friction without becoming the center of the experience.

### The home is the center

People care about their home, not our features, terminology, or technology.

The experience should begin with the places they actually live.

### Simplicity creates confidence

We should not ask people to learn our system before it helps them.

If an experience requires lengthy explanation, simplify the experience before improving the documentation.

---

## Things We Intentionally Do Not Do

- We do not shame users.
- We do not create artificial urgency.
- We do not reward speed over care.
- We do not fabricate confidence.
- We do not overwhelm people with metrics.
- We do not optimize engagement at the expense of trust.
- We do not introduce concepts people do not naturally think in.
- We do not ask people to learn our system before it helps them.

These are intentional product boundaries, not temporary omissions.

---

## Evaluating New Features

Every meaningful product decision should answer the following questions.

### Does it support the mission?

Does it help people understand and care for what they own?

### Does it reduce mental load?

Technology should quietly remove work, not create more.

### Does it make the home calmer?

Success is measured by how the home feels after using the product, not by how much time someone spends inside the app.

### Does it help version 1.5, or only version 5.0?

Long-term vision should guide current decisions.

It should not justify premature complexity.

### Is it consistent with our values?

A feature that works technically while violating the philosophy should be reconsidered.

---

## Relationship to Other Documents

- **Product Philosophy:** What do we believe?
- **Object Model:** What exists?
- **Architecture:** How is it implemented?
- **Decision Log:** Why was one option chosen over another?
- **Business Model:** How is value created, delivered, and captured?

The future Object Model will define concepts such as:

- Space
- Session
- Snapshot
- Item
- Identity
- Event
- Their plain-English relationships

The Product Philosophy must not resolve those definitions.

It must also not resolve:

- The January-versus-May Session lifecycle question
- How Find queries or stores Items
- Firestore schemas or write behavior
- AI-session pricing
- Subscription entitlements
- Migration mechanics

Those belong in later documents.

---

## Governance

After adoption, do not casually edit this document.

Any future amendment requires:

- A Decision Log entry explaining the proposed change and its rationale
- A version-number increment
- A dated entry in the revision history
- Review for consistency with the rest of the philosophy

### Revision History

- **v1.0 (2026-07-25)** — Initial adoption. See DecisionLog.md.

---

## Closing

Technology will change.

AI will change.

Features will change.

The product should continue to feel unmistakably like Uncluttrd.

If future decisions become easier because this document exists, it has done its job.
