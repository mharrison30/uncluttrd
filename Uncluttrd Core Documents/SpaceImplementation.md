# Space — Implementation Contract

Status: Draft
Version: 0.1
Audience: Everyone who implements the persistent Space object
Purpose: Defines the implementation-facing contract for Space as a persistent first-class object - fields, ownership, Firestore topology, lifecycle flows, and migration requirements
Depends on: ObjectModel.md, SpaceMemoryModel.md, DecisionLog.md ("Space Promoted to Persistent First-Class Object," 2026-07-29)

This document answers: **what does implementing Space actually require?** For the settled architecture - why Space exists, and its invariants - see ObjectModel.md. For what persists about a Space and why, see SpaceMemoryModel.md.

---

## 1. Purpose

This document defines the implementation contract for Space as a persistent first-class object. It bridges the settled Object Model and future implementation.

It does not define Journey UX, screen layouts, or UI copy. It does not select an implementation where the underlying architecture has not made a choice - unresolved questions are recorded as unresolved (Section 10), not answered here for convenience.

---

## 2. How to Read This Document

This document reuses ObjectModel.md's confidence tiers (Section 2 of that document):

- **Settled** - an architectural conclusion that has been reached, restated here for implementation purposes.
- **Provisional** - a working assumption, adopted for practical use, not yet tested against real usage or a fuller model.
- **Open** - a question the architecture has not yet answered, recorded explicitly rather than resolved.
- **Explicitly Rejected** - an approach that was considered and excluded.

Content in this document that is not explicitly marked Settled should be read as Provisional or Open, even where it is written with implementation-ready specificity (field names, collection paths). Specificity is not the same as confidence.

---

## 3. Settled Invariants

The following are restated from ObjectModel.md (Section 4, "Space") and the DecisionLog.md entry "Space Promoted to Persistent First-Class Object" (2026-07-29). They are recorded here for implementation reference, not re-decided.

- A Space is a persistent, user-owned representation of a physical area.
- Space has identity, ownership, lifecycle, and relationships independent of any photo, analysis, plan, recommendation set, Companion Session, or progress record.
- Every new analysis is associated with a Space through explicit user confirmation: select an existing Space or create a new one.
- The system may suggest a likely Space but may not establish or merge Space identity through inference.
- Visual similarity, room type, name, recency, AI confidence, device/capture location, and "only one Space of that type" do not establish identity.
- A newly created Space has distinct identity even when another Space has the same name or type.
- Continuing an existing Space adds to its history and does not overwrite prior records.
- The data model must permit a future correction workflow in which an analysis can be reassigned to another Space without deleting the analysis or merging Spaces.
- Space association is separate from the Decision-Dimension Taxonomy.

---

## 4. Ownership and Relationship Model

### 4.1 Terminology note (read before the diagram)

The terms "Analysis," "Plan," "Companion Session," and "Progress Record" are used below because they were specified for this document. **None of the four is a canonical term already defined in ObjectModel.md.** The canonical terms that do exist, and how they compare, are:

| Term used below | Canonical ObjectModel.md term | Status |
|---|---|---|
| Companion Session | **Session** (Section 7, Temporary Concepts) | Match, different label. ObjectModel.md's "Session" is explicitly *not* a durable graph member - see 4.3. |
| Analysis | *(none)* | No Settled or Provisional object represents a single analysis event. |
| Plan | *(none)* | No Settled or Provisional object represents "Plan" as a concept distinct from Space. In the current implementation, "plan" is the literal Firestore document (`users/{uid}/plans/{planId}`) that product UI now labels "Space" (see Section 8). SpaceMemoryModel.md ยง12 already states a decided migration principle - "every existing Plan becomes exactly one Space" - which bears directly on whether "Plan" survives as a distinct concept once migration completes. See Section 11 for why this is flagged as a tension, not resolved here. |
| Progress Record | *(none)* | No Settled or Provisional object matches this term precisely. The closest existing candidates are **Persistent Work** (Settled - Space-owned, has lifecycle states pending/deferred/completed/removed) and **Snapshot** (referenced in the Ownership Graph and Open Questions, but never given a Settled definition - "Snapshot is provisionally Space-owned, but deletion and historical consequences have not yet been tested"). Which one, if either, "Progress Record" maps to is not resolved by any existing document. |

Per instruction, these terms are used as given rather than replaced with invented alternatives, with the mismatch noted here rather than silently resolved.

### 4.2 Relationship diagram

```
Space
 ├── Analyses / Plans            (association - not yet a Settled owned object; see 4.1)
 ├── Companion Sessions          (not a durable graph member - see 4.3; historical
 │    │                           traces persist through what a Session produces)
 │    └── Recommendations        (owned by the Session, not by Space - see 4.4)
 ├── Progress Records            (unresolved mapping - see 4.1)
 ├── Persistent Work             (direct ownership - Settled, ObjectModel.md ยง4)
 ├── Location References         (direct ownership - Settled, ObjectModel.md ยง4)
 ├── Durable Memory              (direct ownership - Settled, ObjectModel.md ยง4)
 └── Remembered Statements       (direct ownership - Settled, ObjectModel.md ยง4)
```

This diagram extends, and does not replace, ObjectModel.md Section 3's Ownership Graph. Persistent Work, Location References, Durable Memory, and Remembered Statements are reproduced here unchanged from that graph.

### 4.3 Why Companion Session is not shown as directly owned

ObjectModel.md Section 3 states: "Sessions and Observations interact with this graph and may affect its contents, but are not themselves durable members of it." A Companion Session is therefore not recorded here as directly owned by Space, the way Persistent Work or Remembered Statement are. Its relationship to Space is one of **temporary association during its lifetime**, plus **historical/inherited relationship** afterward, through whatever durable records it produced (a Recommendation that became Persistent Work via Keep, or a structured response that became a Remembered Statement).

Section 5 of this document requires that "historical completed or paused Sessions remain associated with the Space." Read alongside ObjectModel.md ยง3's "not durable members" statement, the consistent interpretation is: the Session's *durable traces* remain associated with Space; the live Session interaction boundary itself is not claimed to persist as an ongoing object. This reading is not contradicted by any existing document, but it is also not stated by one - see Section 11.

### 4.4 Recommendation

Per instruction, Recommendation is **not** represented as directly Space-owned. It remains owned by the Companion Session that generated it (ObjectModel.md ยง4: "Has stable identity within the Session that owns it"). Its relationship to Space is **inherited**, through two paths already settled in ObjectModel.md:

- An explicit Keep decision creates Persistent Work (Space-owned) from the Recommendation.
- A structured response to the Recommendation Change Affordance may establish a Remembered Statement (Space-owned).

A Recommendation that is never acted on leaves no durable trace on Space at all - this is a direct consequence of the existing settled model, not a new rule introduced here.

### 4.5 Relationship classification summary

| Relationship | Classification |
|---|---|
| Space → Persistent Work | Direct ownership |
| Space → Location References | Direct ownership |
| Space → Durable Memory | Direct ownership |
| Space → Remembered Statements | Direct ownership |
| Space → Analysis/Plan | Association (explicit user confirmation, not ownership in the graph sense used elsewhere - terminology unresolved, see 4.1) |
| Space → Companion Session | Temporary association during the Session's lifetime; not durable membership |
| Companion Session → Recommendation | Direct ownership |
| Space ↔ Recommendation | Inherited, via Session ownership and via Keep/Remembered-Statement outcomes only |
| Space → completed/paused Companion Sessions | Historical membership, via the Session's durable traces (see 4.3) - not the Session object itself |
| Space → Progress Record | Unresolved (see 4.1) |

---

## 5. Space Fields

The following is a **proposed** minimum field set, not a Settled schema. No existing document constrains Space's fields at this level of detail - SpaceMemoryModel.md ยง12 explicitly defers "Firestore schema and migration mechanics." If a future document does constrain this list, this section should be reconciled against it rather than treated as authoritative on its own.

| Field | Category | Notes |
|---|---|---|
| Space ID | Required | Stable, permanent identity. Never reassigned, never reused after deletion. |
| Owner / user ID | Required | Matches the existing `users/{uid}` ownership pattern used throughout the app. |
| User-visible name | Required | Set at creation (user-provided or defaulted); renamable without changing identity, per the Settled invariant that identity is independent of name. |
| Space type | Optional | E.g. a room-type label. Explicitly must never be used to establish or match identity (Section 3, Settled Invariants). Useful only as a suggestion signal and as display metadata. |
| Created timestamp | Required | Set once, at creation. |
| Updated timestamp | Required | Server-set on every write to the Space document itself. |
| Last activity timestamp | Derived | Reflects the most recent associated analysis, Session, or progress record - derived from associated-record activity, not independently authored. |
| Representative / most recent photo reference | Denormalized convenience | A pointer to a photo that lives on an associated record (analysis/plan or progress record). Convenience only - the authoritative photo record lives elsewhere. See Section 10 for whether this is stored directly or computed on read. |
| Lifecycle / status | Required | Vocabulary not yet defined - see Section 10. |
| Active Companion Session reference | Optional, denormalized | See Section 6 for the constraint that this must not become the sole source of Session history. |

No field list beyond this is proposed. Fields implied by other settled objects (e.g. anything belonging to Durable Memory's categories) are out of scope for this table - they belong to Durable Memory, not to the Space document's own fields, unless a future document says otherwise.

---

## 6. Active Companion Session Invariant

- A Space may have at most one active Companion Session at a time.
- Multiple different Spaces may each have an active Companion Session simultaneously.
- There is no single, app-wide active Companion Session invariant.
- Historical completed or paused Sessions remain associated with the Space (see 4.3 for how this is reconciled with Session's non-durable status in ObjectModel.md).
- If an active-Session reference is denormalized onto the Space document (Section 5), it must not become the sole source of Session history. Whatever durably records Session history (see the Progress Record terminology gap, 4.1) must be independently queryable, not reconstructed only from this single pointer.

### Factual difference from the current implementation

As factual context only, not a proposed change: the current implementation's equivalent concept (`isCompanionResumable`, evaluated across the `history` array loaded from `users/{uid}/plans`) determines at most one resumable session **across the user's entire account**, not one per Space - because there is currently no Space object to scope it to. This is stated as a fact about existing behavior, not a UI or behavioral change being proposed here.

### Legacy transition period

During the period in which existing plans have not yet been associated with a Space (see Section 8), the per-Space active-session invariant above has no Space to attach to for those plans. The contract requires the following, without designing the transitional UI:

- The per-Space invariant applies only to plans that have an associated Space.
- Unassigned legacy plans are outside the scope of the per-Space invariant until they are associated with a Space.
- Whether the existing app-wide "one resumable session across the account" behavior continues to apply to unassigned legacy plans during the transition, or is scoped some other way, is an **Open** question (Section 10) - not decided here.
- Whether that transitional behavior itself constitutes a new architectural decision, or is merely an implementation detail free to be resolved at build time, is **also Open**. This document does not have enough settled architecture to classify it either way and does not attempt to.

---

## 7. Firestore Implementation Model

### 7.1 Proposed default topology

```
users/{uid}/spaces/{spaceId}
```

This mirrors the pattern already used throughout the app (`users/{uid}/plans/{planId}` is the existing precedent). Per instruction, this is treated as the default candidate because a concrete technical requirement for a different pattern has not been identified - not because it has been evaluated against alternatives and found superior.

### 7.2 How associated records would reference Space

Not resolved by any existing document. Two candidate approaches, both consistent with the Settled Invariants:

- **Reference field:** associated records (analyses/plans, progress records) carry a `spaceId` field pointing to `users/{uid}/spaces/{spaceId}`.
- **Nested subcollection:** associated records move under the Space document, e.g. `users/{uid}/spaces/{spaceId}/plans/{planId}`.

### 7.3 Whether existing records stay in place or move

Directly affects migration risk (Section 8) and is unresolved:

- If existing `users/{uid}/plans/{planId}` documents **stay in their current collection** and simply gain a `spaceId` reference field, migration is additive - no document is moved or restructured, only a new field and a new sibling `spaces` collection are introduced.
- If existing plan documents **move** into a `spaces/{spaceId}/plans/{planId}` nested structure, migration requires rewriting document paths, which is a materially different (and materially riskier) operation.

The additive (reference-field) approach is the one with the smaller blast radius against the Settled Invariant "avoid destructive rewrites" (Section 3; Section 8), but this document does not select between them - see Section 10.

### 7.4 Query implications

- A reference-field approach supports "all plans for this Space" via a query on `spaceId`, and "all Spaces for this user" via the top-level `spaces` collection - both straightforward with Firestore's existing query model.
- A nested-subcollection approach supports the same two queries structurally (via `collectionGroup` queries for the cross-Space case), but ties every associated record's path to its current Space, which has direct consequences for 7.5 below.

### 7.5 Ownership/security implications

Both candidate approaches are expressible under the existing `auth.uid == userId`-scoped security-rule pattern already used for `users/{uid}/plans/{planId}` (per DecisionLog.md, "My Plans: whole-plan deletion, no soft-delete," 2026-07-18: "`users/{userId}/plans/{planId}` already grants `allow read, write` scoped to `auth.uid == userId`"). Neither approach introduces a new ownership boundary beyond what already exists at the `users/{uid}` level.

### 7.6 Correction/reassignment implications

This is where the two candidate approaches diverge most:

- **Reference-field approach:** reassigning an analysis to a different Space is a single-field update (`spaceId`) on the analysis's own document. Consistent with the Settled Invariant that reassignment must be possible "without deleting the analysis or merging Spaces."
- **Nested-subcollection approach:** Firestore has no atomic "move a document to a different path" operation - reassignment would require creating a new document under the target Space's subcollection and deleting the original, which is a copy-and-delete, not a move. This has stronger implications for auditability and failure-mode handling (a crash mid-reassignment could leave a document in neither location, or in both) than the reference-field approach.

This document does not select between the two approaches; it records that the reference-field approach appears to more directly satisfy the reassignment invariant with fewer failure modes, without treating that observation as a decision.

---

## 8. Lifecycle Flows

### 8.A Returning to an Existing Space

Recorded as given, attributed to Journey 1:

```
Select or re-enter existing Space
  → establish the current focus
  → capture a fresh photo
  → analyze
  → create new records associated with that Space
```

**Sourcing note:** no `Journey1.md` file, and no document in the repository containing the phrase "Journey 1," exists at the time of writing (checked across every `.md` file in `Uncluttrd Core Documents/`). This ordering is recorded here exactly as specified for this document. It could not be independently verified against an authoritative Journey 1 source, because none was found. See Section 11.

No screen copy or layout is specified here, per instruction.

### 8.B Creating a New Space

Recorded as **unresolved**. No existing authoritative document settles the ordering. Two candidate orderings, with their differing consequences:

**Option A: Create/name Space, then capture photo, then analyze.**
- Space identity exists before any photo or analysis does.
- The analysis, once run, is associated with an already-identified Space from the start - no later association step is needed.
- Requires the user to name/characterize a Space before they have necessarily seen what the AI will find in it.

**Option B: Capture photo, then analyze, then create/name Space.**
- Space identity is established after the analysis exists, using the analysis (and its photo) as context for naming/creating the Space.
- Requires the analysis to exist in a state not yet associated with any Space, even briefly - which has data-model consequences (an analysis document that starts with no `spaceId` and is assigned one after the fact, rather than always being created already-associated).
- May let the user use the photo itself to help decide the Space's name, at the cost of a currently-unmodeled "unassociated analysis" state.

The two options differ architecturally in whether an analysis can ever exist, even momentarily, without a Space association. Option A never permits this state; Option B requires it. This document does not select between them.

---

## 9. Legacy Compatibility and Migration Requirements

### 9.1 Current-implementation facts

- Existing user-visible "Spaces" are actually independent `users/{uid}/plans/{planId}` documents.
- No persistent Space object or `spaceId` currently exists anywhere in the implementation.
- Multiple plans cannot currently share a Space.
- A Space cannot currently exist independently of a plan.

(These match the factual baseline established in the prior documentation-only inspection of Home, My Spaces, Results/Companion routing, and the data model.)

### 9.2 Requirements

- **Preserve access to all existing plans.** Migration must not make any existing plan document unreachable or delete it.
- **No automatic merging based on room type, name, recency, or image similarity.** This follows directly from the Settled Invariants (Section 3) and applies to migration exactly as it applies to ongoing use.
- **Legacy plans may remain unassigned until explicit user confirmation.** A plan is not required to be force-associated with a Space at migration time merely because migration ran.
- **Whether a compatibility state such as "unassigned/legacy" is required** is not resolved here - see Section 10.
- **Reversibility and auditability:** whatever migration mechanism is eventually built must be able to show, for any given plan, whether and when it was associated with a Space, and by what mechanism (explicit user action vs. any other path).
- **Avoid destructive rewrites.** No migration approach that deletes, replaces, or restructures an existing plan document in place should be treated as acceptable by default - see the additive-vs-move comparison in Section 7.3.
- **Migration must preserve user intent.** At no point may the system silently create, merge, split, or associate persistent Spaces on behalf of the user based solely on inferred evidence. This applies with the same force during migration as it does to any new analysis going forward.

### 9.3 On "each legacy plan becomes a separate persistent Space"

Per instruction, this document does not silently adopt "each legacy plan becomes a separate persistent Space" as a settled rule. It is presented here as one candidate option, not a decision:

- **Option: 1:1 migration.** Each existing plan becomes exactly one Space, with no attempt to group multiple legacy plans under one Space even if they appear to describe the same room.

This option is flagged, not decided, for a specific reason: **SpaceMemoryModel.md ยง12 already states, as a decided migration principle, that "every existing Plan becomes exactly one Space, no customer loses data, history, or access."** That is a stronger claim than this document is instructed to make on its own authority. See Section 11 - this is reported as a cross-document tension, not silently resolved in either direction here.

---

## 10. Non-Goals

This document explicitly excludes:

- Screen design
- Navigation design
- UI copy
- Search
- Recommendation taxonomy changes
- Remembered Statement redesign
- Implementation code
- Firestore migration execution
- Analytics design
- Broad visual redesign

---

## 11. Open Decisions

Genuine unresolved decisions surfaced while writing this document:

- **New-Space creation ordering** (Section 8.B) - create/name-first vs. photo/analyze-first. No authoritative document settles this.
- **Final Firestore collection topology** (Section 7) - reference-field vs. nested-subcollection association between Space and its analyses/plans, and by extension the same question for progress records.
- **Legacy-plan association strategy** (Section 9.3) - whether 1:1 migration (each legacy plan becomes its own Space) is adopted as this document's own decision, given that SpaceMemoryModel.md already states it as decided at the memory-model layer. This document defers rather than duplicates that decision.
- **Whether the representative photo is stored directly on the Space document or derived/computed from associated records** (Section 5).
- **Lifecycle/status vocabulary for Space** (Section 5) - no values have been proposed or approved.
- **Exact correction/reassignment semantics** (Section 7.6) - which of the two candidate Firestore approaches is adopted, and the precise write sequence/failure handling for a reassignment operation.
- **Whether "Progress Record" maps to Persistent Work, to Snapshot, or to neither** (Section 4.1) - a naming/mapping question with no existing settled answer.
- **Transitional behavior for unassigned legacy plans during the migration period** (Section 6) - both what that behavior should be, and whether deciding it is itself an architectural decision or an implementation detail.

---

## 12. Contradiction Check

Compared against ObjectModel.md, DecisionLog.md, the current Journey documentation available in the repository (Journey5.md; no Journey1.md exists), and SpaceMemoryModel.md. Findings are reported here, not silently reconciled:

1. **Journey 1 does not exist as a document.** Section 8.A's ordering is attributed to "Journey 1" per this document's own instructions, but no file named `Journey1.md`, and no other document in the repository, contains the phrase "Journey 1." This document records the given ordering without independent verification and flags the gap rather than presenting it as confirmed against a real source.

2. **SpaceMemoryModel.md ยง12 already states a decided migration principle** - "every existing Plan becomes exactly one Space, no customer loses data, history, or access" - that is more prescriptive than the option-only framing this document was instructed to use in Section 9.3. This document does not treat SpaceMemoryModel.md's statement as silently overriding its own instructed framing, and does not treat its own framing as silently overriding SpaceMemoryModel.md. Both are recorded; the tension is unresolved here.

3. **Terminology gap, not a contradiction:** "Analysis," "Plan," and "Progress Record" have no canonical definitions in ObjectModel.md. This is not a conflict between documents so much as an absence - noted in full in Section 4.1.

4. **Possible tension between Section 6 of this document and ObjectModel.md ยง3:** ObjectModel.md states Sessions "are not themselves durable members of" the ownership graph. This document's Active Companion Session Invariant requires that "historical completed or paused Sessions remain associated with the Space." Section 4.3 proposes a reading under which these are compatible (the Session's durable traces remain, not the Session object itself), but no existing document states this reading explicitly - it is this document's own interpretation, offered rather than asserted as settled.

No other contradictions were found between this document's content and ObjectModel.md, DecisionLog.md, Journey5.md, or SpaceMemoryModel.md.

---

## 13. Relationship to Other Documents

- **ObjectModel.md** - the settled architecture this document implements. This document restates ObjectModel.md's Space invariants (Section 3) but does not amend them; any change to those invariants belongs in ObjectModel.md and DecisionLog.md, not here.
- **SpaceMemoryModel.md** - defines what persists about a Space and why; this document defines the structural contract for the object that holds that memory. SpaceMemoryModel.md ยง12's migration principle is directly relevant to Section 9.3 of this document - see the Contradiction Check (Section 12).
- **DecisionLog.md** - the reasoning and approval record behind Space's promotion to a first-class object ("Space Promoted to Persistent First-Class Object," 2026-07-29), and the reasoning behind every other decision this document restates rather than re-derives.
- **Journey documents** - not depended on by this document beyond the Section 8.A sourcing note. This document does not draft or amend Journey content.
