# Object Model

Status: Draft
Version: 0.1
Audience: Everyone who builds Uncluttrd
Purpose: Defines what objects exist in Uncluttrd's organizing domain, what owns what, and which architectural questions remain open
Depends on: ProductPhilosophy.md, ArchitectureGuide.md, SpaceMemoryModel.md

---

## 1. Purpose and Scope

This document defines what exists in Uncluttrd's organizing domain and what owns what.

It does not define how these objects behave over time - that belongs to LifecycleModel.md. It does not define how this model is stored - that belongs to PersistenceModel.md. It does not restate the reasoning, evidence, or history behind each decision - that belongs to DecisionLog.md.

---

## 2. How to Read This Document

Every statement in this document carries one of four confidence tiers:

- **Settled** - an architectural conclusion that has been reached.
- **Provisional** - a working assumption, adopted for practical use, not yet tested against real usage or a fuller model.
- **Open** - a question the architecture has not yet answered, recorded explicitly rather than resolved.
- **Explicitly Rejected** - a concept that was considered and not promoted to an independent object.

Inclusion in this document does not imply equal confidence. Each statement's tier must be read as part of its meaning - it should never be inferred from formatting, section placement, or level of detail.

---

## 3. Ownership Graph

```
User
 └── Space
       ├── Durable Memory
       ├── Persistent Work
       ├── Location References
       └── Snapshots
```

Sessions and Observations interact with this graph and may affect its contents, but are not themselves durable members of it (see Temporary Concepts).

---

## 4. Settled Objects

### Space

- The root object of the organizing domain.
- Owns the durable understanding and product activity associated with one real-world space.

### Persistent Work

- A Space-owned object with stable identity.
- Survives beyond the Session that created it.
- Persists as the exact item, not a summarized version of it.
- Can resurface in later Sessions for the same Space.
- Lifecycle states: pending, deferred, completed, removed.
- Deferral evidence (count/history) is preserved without yet assigning behavioral meaning to it.
- Remove terminates the exact item and prevents resurfacing. It does not, by itself, create a durable preference against similar future suggestions.
- Does not become globally independent merely by persisting.

### Location Reference

- A Space-owned identity for a recurring, user-recognizable sub-location.
- Has a stable internal ID; this ID carries the identity, not any single attribute.
- May be recognized through spatial, functional, visual, content-based, or user-provided evidence - not keyed to any one anchor.
- Can retain identity across renaming and across relocation, when continuity is explicitly or sufficiently supported by evidence.
- Movement alone does not prove continuity; silent/inferred movement should not automatically merge or split references.
- Does not require promotion into an independent Area object.

### Durable Memory

- Space-owned retained understanding, supported by available evidence.
- Not identical to raw evidence; must not claim more certainty than the evidence warrants.
- Categories (physical understanding, organizing history, preferences/constraints, purchases, behavioral patterns) are defined in SpaceMemoryModel.md - do not restate or expand them here.

---

## 5. Temporary Concepts

### Session

- A temporary interaction boundary.
- Consumes evidence and existing understanding, produces immediate guidance, and may create or update persistent records.
- Is not itself durable memory.

### Observation

- Evidence received or derived during an interaction.
- Ephemeral by default; may influence durable state but is not automatically durable knowledge.

### Working Interpretation

- The current interpretation assembled for a single interaction.
- Exact architectural representation is intentionally left open (see Open Questions) - do not define its structure here.

---

## 6. Explicitly Rejected Promotions

### Area

Not currently justified as an independent domain object. The demonstrated requirement is satisfied by a Space-owned Location Reference. See DecisionLog.md for the rename/relocation evidence.

### Correction

An event and a source of evidence, not an object. See DecisionLog.md for full reasoning.

### Completion

A lifecycle transition on Persistent Work and a source of evidence, not an independently owned object. See DecisionLog.md for full reasoning.

### Deferral

A lifecycle event recorded on Persistent Work, not a separate object. See DecisionLog.md for full reasoning.

---

## 7. Open Questions

- Location Reference lifecycle: what makes a reference inactive (if "inactive" is even the right model), whether it can reactivate, and whether reappearance reactivates the same identity or creates a new one.
- Snapshot ownership and lifecycle: Snapshot is provisionally Space-owned, but deletion and historical consequences have not yet been tested.
- Runtime understanding / working interpretation representation: not a settled three-layer model or any other specific structure - genuinely open.
- Whether repeated deferral of Persistent Work should independently produce behavioral memory (data is being preserved specifically to allow this to be answered later from evidence).
- Cross-cutting deletion behavior (Space deletion, account deletion) for each of the four durable responsibilities - explicitly deferred to LifecycleModel.md, not answered here.

---

## 8. Relationship to Other Architecture Documents

- **ProductPhilosophy.md** - why this architecture exists.
- **ArchitectureGuide.md** - how this document is structured and governed.
- **SpaceMemoryModel.md** - what Durable Memory means and its categories.
- **LifecycleModel.md (forthcoming)** - how these objects change over time.
- **PersistenceModel.md (forthcoming)** - how this model is stored.
- **DecisionLog.md** - the reasoning, evidence, and revisit conditions behind every decision in this document. This document states conclusions; DecisionLog.md explains why they were reached.
