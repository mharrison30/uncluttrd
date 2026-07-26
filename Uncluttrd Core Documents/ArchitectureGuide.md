# Architecture Guide

Status: Adopted
Version: 0.1
Audience: Everyone who builds Uncluttrd
Purpose: Defines how architecture documents are organized, how responsibilities are divided between them, and how they evolve over time

---

## Purpose

### Why This Guide Exists

Uncluttrd's architecture is described by a family of long-lived design documents rather than a single specification. Each document exists to answer a different architectural question, but together they define one coherent product.

This guide establishes how those architecture documents are organized, how responsibilities are divided between them, and how they should evolve over time.

It defines the architecture of the documentation itself.

It does not define product behavior.

---

## Scope

### What This Guide Governs

This guide applies to all long-lived architecture documents describing the design of Uncluttrd.

Examples include:

- ProductPhilosophy.md
- SpaceMemoryModel.md
- ObjectModel.md
- Journey.md
- Analytics.md
- Future architecture documents

Implementation plans, coding tasks, feature specifications, and project management artifacts are intentionally outside the scope of this guide.

---

## Document Hierarchy

### How Architecture Documents Relate

Architecture documents have different responsibilities.

Higher-level documents establish principles.

Lower-level documents apply those principles within their own domain.

This relationship describes conceptual dependency, not implementation order or revision sequence.

```
                    Product Philosophy
                            |
                            v
                     Architecture Guide
                            |
        +-------------+----------+-------------+
        |             |          |             |
        v             v          v             v
  Space Memory    Object Model  Journey     Analytics
     Model
        |             |          |             |
        +-------------+----------+-------------+
                            |
                            v
                  Implementation Plans
```

Architecture may evolve from observations made anywhere within this system.

Lower-level documents may expose design pressure that results in revisions to higher-level documents.

Authority flows downward.

Learning flows in every direction.

---

## Writing Standards

### How Architecture Documents Communicate

Architecture documents should prioritize clarity over completeness.

Each document should exist because it answers a question that no other document owns.

Each section should answer one primary question before moving to the next.

Sections should generally follow this progression:

- Principle
- Reasoning
- Examples (when helpful)

Examples illustrate principles.

They do not establish them.

Architecture documents should explicitly identify:

- Decisions
- Working hypotheses
- Open questions
- Deferred questions

Readers should never have to infer which category a statement belongs to.

---

## Reasoning Standards

### How Architecture Documents Express Confidence

Architecture documents should distinguish between:

- Verified facts
- Reasoned inferences
- Open uncertainty

Confidence should never exceed the available evidence.

When uncertainty exists, it should be stated explicitly rather than presented as settled fact.

Architecture should prefer honest boundaries over persuasive certainty.

---

## Responsibility Boundaries

### How Documents Avoid Overlap

Every architecture document owns a specific class of decisions.

A document should exist because it answers a question that no other document owns.

Examples:

- **ProductPhilosophy.md** - Owns the product's guiding beliefs.
- **SpaceMemoryModel.md** - Owns what it means for the AI to understand a Space.
- **ObjectModel.md** - Owns the persistent structures that implement that understanding.
- **Journey.md** - Owns how users experience the product.
- **Implementation documents** - Own how architecture is realized in software.

When a document reaches a question owned elsewhere, it should explicitly defer that decision rather than silently expanding its own scope.

---

## Revision Philosophy

### How Architecture Evolves

Architecture should evolve in response to real design pressure.

Rather than anticipating every future need, recurring solutions should be promoted into architectural principles when experience demonstrates that they improve the coherence of the system.

Architecture should emerge from evidence rather than aspiration.

New standards should solve real problems.

They should not be added simply because a template appears incomplete.

When architecture documents are revised:

- Revisions should be intentional.
- Significant changes should be recorded in DecisionLog.md.
- Existing documents should be reconciled against newer standards only when those standards produce meaningful improvements.

The goal is not uniformity.

The goal is a document family that becomes more coherent over time.

---

## Success Criteria

### How This Guide Should Be Judged

This guide is successful if applying it measurably improves existing architecture documents without forcing artificial consistency.

The value of a standard is demonstrated when it reveals meaningful improvements in work that already exists, not merely when new documents are written to comply with it.

Architecture standards should earn their place through evidence.

---

## Out of Scope

This guide intentionally does not define:

- Product behavior
- User experience
- AI behavior
- Object structures
- Database schemas
- Implementation details
- Coding standards

Those responsibilities belong to other documents.
