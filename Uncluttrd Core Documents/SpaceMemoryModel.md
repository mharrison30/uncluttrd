# Uncluttrd Space Memory Model

Status: Draft
Version: 0.2
Audience: Everyone who builds Uncluttrd
Purpose: Defines what persists about a Space, why, and how that understanding changes over time
Depends on: ProductPhilosophy.md

---

## 1. Purpose

This document defines the durable relationship between Uncluttrd and a Space - what it means for the product to "know" a place in someone's home, what persists, what doesn't, and how that understanding changes over time.

---

## 2. Scope Boundary

This document answers what Uncluttrd remembers about a Space and why - not how that memory is technically stored or structured.

It does not define the object hierarchy: whether a sub-unit like "Area" exists inside a Space, what it would be called, or how Observations attach to anything. That remains open for ObjectModel.md. It also does not resolve session/plan naming, billing mechanics, or Firestore schema.

---

## 3. Core Principle

**"A Space is not a database record. It is the AI's evolving understanding of a real place in the user's home."**

Thinking of a Space as a record asks "what fields do we store." Thinking of a Space as an understanding asks "what should the AI know, what should it forget, and how should that understanding evolve." This document is written from the second frame.

---

## 4. Guiding Philosophy

- The user organizes their home. The AI organizes the information.
- Every interaction should make the AI's understanding of a Space more accurate.
- Memory exists to improve future coaching, not simply to preserve history.
- Users remain in control of what is remembered and what is forgotten.

These are the lens every later decision in this document - and future related decisions - should be evaluated through.

---

## 5. What It Means to Know a Space

**"To know a Space is to hold a durable, evolving understanding of it - not a single analysis frozen in time."**

"Uncluttrd knows your Kitchen" should not mean that a single photo was analyzed once and the results were saved. It should mean something closer to what a person means when they say they know a place: a durable, evolving understanding built up over repeated interaction, not a single analysis frozen at one point in time. Each visit to a Space adds to that understanding rather than replacing it, and the product's coaching should reflect everything learned so far, not just what was seen most recently.

The following are strong working categories for what persists about a Space, not a final or locked list:

- **Physical understanding** - what's actually in the space (e.g. "pantry exists," "junk drawer exists"). Persists until the AI is told otherwise.
- **Organizing history** - what's been addressed, what hasn't, and how many times.
- **User preferences and constraints** - e.g. "I hate clear plastic bins," "don't organize my husband's workbench," typical session length, sell vs. donate preference.
- **Purchases and owned organizing products** - changes future recommendations.
- **Behavioral patterns over time** - e.g. "this drawer becomes cluttered every few months."

These categories can be tested, refined, combined, or expanded during future implementation. They are a strong starting point, not a final locked list.

---

## 6. Temporary Coaching Context

Not everything Uncluttrd needs during a single coaching session should automatically be treated as permanent truth about a Space.

**Memory should be intentional, not exhaustive. The goal isn't to retain everything. The goal is to retain the information that improves future coaching while allowing temporary context to naturally fade.**

- "I'm organizing with my daughter today" (temporary/incidental) vs. "This cabinet belongs to my daughter" (durable fact about the space).
- "I only have 15 minutes today" (temporary) vs. "I usually only organize in 15-20 minute sessions" (potentially durable pattern).

---

## 7. How Memory Changes

Understanding accumulates over repeated interactions with the same Space. Each new interaction should refine what's already known, not simply append to it - a fresh observation can confirm, adjust, or override an earlier one, and the product's picture of the Space should converge toward accuracy over time rather than growing into an unstructured log of everything that was ever seen or said.

---

## 8. Correction, Contradiction, and Forgetting

A mature memory system does four things:

- It remembers what matters.
- It revises what turns out to be wrong.
- It forgets what is no longer useful.
- It does not collect information simply because it can.

Memory must be able to be corrected - a preference changes, an inferred pattern turns out wrong - and must support deliberate forgetting, such as a user asking to forget something. It is not a system that only accumulates indefinitely.

---

## 9. Applying Memory Months Later

Photographing the same drawer four months later is a direct application of Sections 5-8, not a case requiring its own separate rules. The AI compares the new observation against existing memory - what's changed, what habits returned, what was previously accepted or rejected - rather than starting over.

---

## 10. Privacy and User Control

Users should be able to see and control what's been remembered about their home. This is a direct extension of the "Honest over persuasive" and "Encourage, never judge" principles from ProductPhilosophy.md, applied to accumulated personal data about someone's living space.

---

## 11. Decisions Made

- A Space is an evolving understanding, not a static record.
- The four Guiding Philosophy statements (Section 4).
- The five durable memory categories, as strong working categories, not a final list (Section 5).
- The "intentional, not exhaustive" memory principle (Section 6).
- Memory must support correction and deliberate forgetting (Section 8).
- Users have visibility and control over their own Space's memory (Section 10).

---

## 12. Questions Intentionally Deferred

- Whether a smaller persistent object exists inside a Space.
- Whether that object is called an "Area."
- Whether every photo creates an "Observation."
- Whether Observations belong to a Space, an Area, or begin unattached.
- Whether Areas (if they exist) are user-created, AI-inferred, or gradually discovered.
- How much of memory is stored as structured fields versus a summarized AI-generated understanding.
- Session/Plan naming and lifecycle mechanics.
- Billing/pricing mechanics.
- Firestore schema and migration mechanics - though the migration principle "every existing Plan becomes exactly one Space, no customer loses data, history, or access" is already decided and belongs in the future Object Model/migration plan. It does not need to control this document's content.

None of these questions should be considered accidentally resolved by any example or wording used elsewhere in this document.

---

## Closing

This document should be revisited once ObjectModel.md exists and once real product usage exists to test these categories against. It is describing a durable relationship, and that relationship should stay open to revision as understanding of the product itself deepens.
