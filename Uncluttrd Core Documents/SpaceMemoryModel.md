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
- Firestore schema and migration *implementation* mechanics - still deferred. The migration *invariant* (what a correct migration must produce, as distinct from how to build it) is no longer deferred as of 2026-08-01; see "Migration Invariant" immediately below. This bullet now refers only to implementation mechanics, not to the ownership shape migration must satisfy.

None of these questions should be considered accidentally resolved by any example or wording used elsewhere in this document.

### Restartability Principle (Settled 2026-08-02)

[Decision] Migration must be restartable at any arbitrary point without requiring knowledge of previous runs.

[Rationale] This is stronger than idempotency. It means: no resume-from-checkpoint tracking, no "last processed user" state, no migration ledger, no ordered dependency between users or plans. This is the direct architectural consequence of separating checkMigrationCompleteness (determines whether work is needed) from forceFullReprojection (performs the work when explicitly told to): if every plan can be independently evaluated against reality and acted on only if incomplete, migration never needs to know what happened in any prior run - it only needs to know the current true state of each plan, which it can always determine fresh.

[Consequences] The migration execution model is exactly: for every plan, if checkMigrationCompleteness reports complete, skip; otherwise, invoke forceFullReprojection. This holds regardless of whether this is the first run, a retry after partial failure, or a rerun days later. No coordination between plans or users is required or should ever be introduced - a future implementer adding "track which users have been processed" for efficiency would silently violate this principle and should be pointed back to this decision.

### Migration Invariant (Settled 2026-08-01)

[Decision] This is no longer an open migration design question - it is an invariant the migration implementation must satisfy, established as a direct consequence of this session's Project/Persistent Work/Session ownership decisions. The ownership model is authoritative; migration conforms to it, it does not redefine it.

Migration invariant: Every migrated legacy plan SHALL become exactly one active Project within exactly one migrated Space. Migration SHALL preserve ownership by assigning the legacy plan's Starting Evidence, Persistent Work, currentBatch, and companionComplete state to that Project - not directly to the Space. Migration SHALL further reconstruct Session boundaries from the legacy plan's existing batchHistory timestamps wherever they are distinguishable, rather than collapsing all historical activity into one undifferentiated record.

[Rationale] After tonight's ownership decisions, a migrated Space without a Project would be structurally incomplete - Persistent Work, Starting Evidence, and Sessions all belong to a Project, not directly to a Space, so a Space alone cannot honestly hold a legacy plan's state. This is not synthesizing a new object during migration: a legacy plan was already someone's ongoing transformation effort, it simply didn't have that name yet. Migration makes the implicit explicit, it does not invent something that wasn't conceptually there.

[Consequences] §12's actual implementation must be scoped and resolved once persistent Space's implementation shape is concrete - this invariant defines what a correct migration must produce, not how to build it. Flag this explicitly as blocked on persistent Space's implementation, not something that can be finalized independently of it.

[Decision] Merge-proposal capability is REQUIRED as part of the initial Space implementation, not a deferred follow-up. This supersedes any earlier assumption that "one Space per legacy plan, no merging" was an acceptable initial default.

[Rationale] A direct count against production Firestore (2026-08-01: 159 plans, 16 users) found 13 of 16 users have 2 or more plans (81%); excluding one confirmed developer-testing account, 12 of the remaining 15 real users still have 2+ plans (80%). This is not a rare edge case - most real users have multiple plan documents on record, some plausibly representing the same physical space revisited over time. Shipping migration with no merge path would visibly fragment history for the majority of real users at launch.

[Consequences] Migration must, for any pair of plans belonging to the same user with similar characteristics (matching or similar spaceType label, plausible timeframe - exact matching criteria to be determined during implementation, not specified here), propose a candidate merge to the user rather than silently creating separate permanent Spaces. This reuses the same propose-then-user-confirms pattern already established for Persistent Work item matching (this session's earlier work) - applied here at Space-identity level. Plans cannot be confidently auto-merged today: no existing field or mechanism links separate plan documents as the same physical space, so any merge must be proposed and confirmed by the user, never silently automated.

Candidate detection (implementation), the full candidate state machine, surfacing/resolution UX, and the handoff contract to merge execution are specified in **MergeProposalDesign.md**, not restated here.

---

## Closing

This document should be revisited once ObjectModel.md exists and once real product usage exists to test these categories against. It is describing a durable relationship, and that relationship should stay open to revision as understanding of the product itself deepens.
