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
 └── Space (durable owner: identity, metadata, Project History)
       ├── Durable Memory
       ├── Location References
       ├── Remembered Statements
       ├── Snapshots
       └── Project History (one active Space-scoped Project, OR several concurrent active Location-Reference-scoped Projects, never both on overlapping ground + many historical)
             └── Project (scopeType: Space | LocationReference; scopeId)
                   ├── Starting Evidence
                   ├── Current Evidence
                   ├── Persistent Work
                   ├── Sessions (Project-owned, stable identity - see Session, Section 4)
                   │     └── Session (id, projectId, startedAt, endedAt, status)
                   │           ├── Batches
                   │           │     └── Photos
                   │           └── Session-scoped decisions
                   └── Decision/History log (Project-scoped)
```

Observation interacts with this graph and may affect its contents, but is not itself a durable member of it (see Temporary Concepts). [Observation] Session was previously grouped with Observation in this caveat as "not themselves durable members." That is superseded as of 2026-08-01: Session is now a Settled Object with stable identity (Section 4), promoted out of Temporary Concepts - see DecisionLog.md, "Session Given Stable Identity, Project Remains the Durable Owner." This line is corrected rather than silently left inconsistent with that promotion.

Association between a new analysis and a Space is established only through explicit user confirmation (see Space, Section 4) - never inferred from the analysis itself.

---

## 4. Settled Objects

The following objects have settled architectural definitions. Each object's owner (Space, Project, or Session) is stated explicitly.

### Space

- The root object of the organizing domain.
- Owns the durable understanding and product activity associated with one real-world space.
- Has identity, ownership, and lifecycle independent of any individual photo, analysis, plan, recommendation set, Companion session, or progress record.
- Every new analysis is associated with a Space only through explicit user confirmation: selecting an existing Space or creating a new one.
- Creating a new Space always creates a distinct identity, even if another Space shares the same name or type.
- Selecting an existing Space extends that Space's history. It never overwrites or replaces prior records.

Clarifications:
- Space identity is never established through visual similarity, room type, name, recency, AI confidence, device/capture location, or "only one Space of that type."
- The system may suggest a likely Space using signals such as name, type, most recent photo, last activity date, or an existing active session, but the suggestion remains unconfirmed until the user explicitly selects it.
- Data-model requirement only: the model must not make it structurally impossible to later move an analysis from one Space to another without deleting the analysis or merging the two Spaces.
- Space association is a distinct mechanism from the Decision-Dimension Taxonomy. It establishes identity/association before any Recommendation exists and is not itself a user preference that influences recommendations.

### Project

- The long-running effort to transform a Space, spanning multiple Sessions, from Starting Evidence to a terminal state.
- A Space may have Project History: many completed, abandoned, or superseded Projects over its lifetime.
- Scope fields: `scopeType` (Space | LocationReference), `scopeId` (the identifier of the Space or Location Reference this Project covers).

Prior framing (superseded 2026-08-01): "A Space has at most one Active Project at a time (0 or 1 constraint)." This is replaced outright, not left standing alongside the new rule - see DecisionLog.md, "Project Scope Model - Space or Location Reference, Not Space-Only."

[Decision] A Space may have either one active Space-scoped Project, or several concurrent active Location-Reference-scoped Projects (each covering a distinct Location Reference within that Space), but never both simultaneously covering overlapping ground.

[Rationale] A Space is the largest addressable unit (e.g., "Kitchen"); real organizing work often happens at a finer grain (Coffee Station, under-sink cabinets) that the user may want to address independently and out of order. Scoping Project to either level, with an explicit overlap constraint, supports both a broad first-time effort before any sub-locations are identified, and later focused, independently-trackable efforts, without their memories blurring together.

Owns:
- Starting Evidence - the first evidence for this transformation specifically, not the Space's lifetime evidence.
- Current Evidence.
- Persistent Work (see Persistent Work below).
- Sessions, which own Batches, which own Photos.
- A Decision/History log scoped to this Project.

[Inference] Starting Evidence and Persistent Work share the same ownership logic: both come into existence when a Project begins and reach a terminal state when the Project does, so both are owned by the object that shares their lifecycle - the Project - not by the Space, whose own lifecycle outlives any single transformation effort.

[Consequences] Sessions, photos, Batches, Starting Evidence, and Persistent Work all inherit their owning Project's scope. A photo/batch scoped to one Location Reference must not update a different Project's Persistent Work, even within the same Space.

Narrowing from broad to focused: when a broad Space-scoped Project needs to narrow into one or more Location-Reference-scoped Projects (e.g., a general Kitchen effort splitting into a focused Coffee Station effort), this is handled through the existing Superseded mechanism - the broad Project must close (marked Superseded, with explicit user acknowledgment) as the focused Project begins. This is not a new transition type.

Terminal states (three):
- **Completed** - all Persistent Work has reached a terminal disposition (Completed or Accepted-as-is), and no unresolved memory questions remain. This is the only state that triggers full celebration ("You transformed this Space.").
- **Abandoned** - the user explicitly ends the effort without resolving everything. [Decision] Must be an explicit user statement, never inferred from inactivity or elapsed time - inferring abandonment from time alone would violate the already-adopted "Observation Does Not Establish Evaluation" principle. Uses the same "Not now"-family explicit-exit pattern already established elsewhere in the product, scoped to the Project level.
- **Superseded** - a new Project begins on a scope (Space or Location Reference) that already has an unfinished active Project on the same or overlapping ground. [Decision] Resolved 2026-08-01 (previously recorded Open in Section 9): starting a new Project on a scope that already has an unfinished active Project ALWAYS requires explicit user acknowledgment before the new Project begins - never silent, never inferred from inactivity, consistent with the same requirement already governing Abandoned.

### Persistent Work

- A Project-owned object with stable identity. [Decision] Ownership changed from Space to Project on lifecycle-alignment grounds: Persistent Work comes into existence when a Project begins and reaches a terminal state when the Project completes, so it is owned by whatever shares its lifecycle.
- The Project-owned durable record of work jointly considered by Companion and the user for this transformation effort, including disposition - not just active/unfinished items.
- Survives beyond the Session that created it, within the Project that owns it.
- Persists as the exact item, not a summarized version of it.
- Can resurface in later Sessions within the same Project.
- Status model: Active / Carried / Completed / Accepted-as-is / Needs-Review (Resurfaced). [Inference] Completed and Accepted-as-is are different claims: Completed is a physical-world claim, falsifiable by evidence; Accepted-as-is is a user-intent claim, not falsifiable by evidence alone.
- Each item retains both a concrete suggestion (what Companion actually proposed) and an abstracted goal (the underlying work, used for matching - see DecisionLog.md, "Persistent Work Item Identity and Matching").
- Deferral evidence (count/history) is preserved without yet assigning behavioral meaning to it.
- Remove terminates the exact item and prevents resurfacing. It does not, by itself, create a durable preference against similar future suggestions. [Observation] The five-state status model above does not obviously include this prior "Remove" state - whether Remove now maps onto Accepted-as-is, remains a distinct sixth state, or needs its own reconciliation is not resolved here; recorded as open in Section 9.
- Does not become globally independent merely by persisting.

Clarifications:
- Resurfacing language ("this came back around") is scoped to within one Project only. If a Project has genuinely completed and later evidence shows the same area needs attention again, that is a new Project's concern, not a contradiction of the prior one - different phrasing applies ("looks like this could use another pass"), since nothing is being contradicted; the world simply changed after a real completion.

### Session

[Decision] Session is a stable-identity, Project-owned event representing one bounded period of Companion interaction. It owns the evidence, Batches, and decisions produced during that period, but it does NOT own Persistent Work or Project completion. Multiple Sessions may advance one Project.

Fields: stable `id`, owning `projectId`, start timestamp, end timestamp (nullable while active), lifecycle status.

Lifecycle states: active | paused | ended | interrupted. [Rationale] Deliberately excludes "completed" - that word already carries a specific, weighted meaning at the Project level (all Persistent Work resolved, triggers real celebration). Reusing it for a Session simply ending for the day would recreate the exact vocabulary collision the Project/Session split was designed to fix, one level down. A Session just stops ("ended"), with no completion claim implied.

Resume-boundary rule: [Decision] A brief/technical interruption (e.g., app backgrounded briefly) may resume the SAME Session. A deliberate stop-for-now ends that Session; returning later begins a NEW Session within the same Project. [Consequences] This reconciles two mechanisms already built independently this project without requiring rework of either: Journey 3's mid-batch pause is the same-Session-continuation case; Journey 4's Return Decision interstitial (which only appears after a real departure) is the new-Session case. The exact technical threshold for "brief" vs. "deliberate stop" is left as an implementation policy, not specified architecturally here.

Clarifications - what Session identity does NOT mean, stated explicitly to prevent future misreading:
- Unfinished work does not belong to the Session - it belongs to Persistent Work, owned by the Project.
- A Session does not need to persist as an active object forever.
- Resuming later does not necessarily mean reopening the identical Session.
- Project completion never depends on any single Session completing.

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

### Recommendation

- Represents Companion's current organizing guidance.
- Has stable identity within the Session that owns it.
- Is generated from available observations.
- May be acted on, confirmed, kept, removed, or left without a confirmed outcome.
- May create Persistent Work through an explicit Keep decision. An explicit Keep decision creates Persistent Work from the Recommendation.
- May contribute to Durable Memory only when the user's structured response, through the Recommendation Change Affordance, becomes a Remembered Statement. The Remembered Statement's Evidence is established independently of the Recommendation's Basis.
- Owns its own modification behavior; screens may present that behavior but do not define it.

Contains:
- Basis
- Applies To
- Recommendation Text
- Decision Dimension (optional; value must come from the Decision-Dimension Taxonomy)
- Recommendation Change Affordance (optional and taxonomy-gated)

The Recommendation Change Affordance may exist only when:
1. A recognized Decision Dimension applies.
2. That dimension exists in the approved Decision-Dimension Taxonomy.
3. The recommendation can be changed without requiring Companion to invent an unsupported interpretation.
4. The change does not exceed what the Recommendation's Basis supports.
5. The resulting choice can be represented as a structured decision rather than free-form preference learning.

Clarifications:
- Recommendation Text is a field of the Recommendation object. It is not interchangeable with the object itself.
- Basis explains why Companion made this recommendation. It is not the Evidence of a Remembered Statement.
- Decision Dimension is optional, but when a Recommendation Change Affordance exists, the corresponding recognized dimension must be present.
- A user response to the Recommendation Change Affordance may establish a Remembered Statement. The Recommendation's Basis cannot do so by itself.

### Remembered Statement

- A Space-owned durable object representing an explicitly established user truth.
- Has stable identity independent of the Session that created it.
- Created only from an explicitly established user truth (see the two creation paths below).
- Can be deliberately forgotten through explicit user action.
- Does not arise from AI inference, repeated observation, or accumulated behavioral patterns alone.
- Contributes to Durable Memory by representing truths Companion is entitled to remember.

Contains:
- Statement Text
- Evidence
- Scope
- Decision Dimension (optional; value must come from the Decision-Dimension Taxonomy and is present only when the statement concerns a recognized structured decision)

Clarifications:
- Statement Text records the user truth that Companion is entitled to remember.
- Evidence records the independently grounded user interaction that established the Remembered Statement.
- Scope records the applicability explicitly established by what the user stated, including any limits the user expressed.
- The Recommendation may present the structured choice, but the user's response establishes the Remembered Statement. The Recommendation is not its parent and its Basis is not the Remembered Statement's Evidence.
- Durable Memory is the Space's retained understanding. Remembered Statements are one grounded source that may support that understanding; Durable Memory is not synonymous with a collection of Remembered Statements.
- How multiple Remembered Statements relate to one another, including whether one concerns the same claim as another or whether a later statement supersedes an earlier one, depends on Claim Identity. Claim Identity is deferred to Journey 5.1 and is not yet defined behavior of this object.

Two creation paths (same object, distinguished only by whether Decision Dimension is present):

| Kind | Decision Dimension | Actionable by Recommendation |
|---|---|---|
| Structured | Present | Yes |
| Volunteered | Absent | Not directly |

- A structured user response to a Recommendation Change Affordance may establish a Remembered Statement with a Decision Dimension.
- An explicitly volunteered user statement (e.g. "this room belongs to my daughter") may establish a Remembered Statement without a Decision Dimension. This is still legitimate memory - it is simply not directly actionable through the Recommendation Change Affordance mechanism.

---

## 5. Decision-Dimension Taxonomy

The Decision-Dimension Taxonomy defines the recognized categories of structured organizing decisions that Companion may present to the user and remember for future use.

A Decision Dimension is not an independent architectural object. It has no identity, ownership, or lifecycle of its own.

A Decision Dimension is a controlled value that may be referenced by:
- Recommendation, when the recommendation concerns a recognized structured decision.
- Remembered Statement, when an explicitly established user truth concerns that same recognized structured decision.

The shared value allows Companion to determine whether a Remembered Statement is potentially relevant to a later Recommendation.

A Decision Dimension does not establish applicability by itself. A match between dimensions identifies only that the objects concern the same category of decision. The Remembered Statement's Scope must still support its use in the current context.

A matching Decision Dimension establishes categorical relevance, not contextual applicability.

Only values defined in the approved Decision-Dimension Taxonomy are valid. Companion must not create new dimensions dynamically from model output, user phrasing, or inferred preference categories.

Approved Decision Dimensions:

#### Container Style

Represents a structured choice concerning the kind or style of container used to organize or store items.

#### Display vs Store Away

Represents a structured choice concerning whether items should remain visible or be stored out of sight.

Deferred Decision Dimensions:

#### Grouping Strategy

Grouping Strategy has been identified as a possible Decision Dimension but is not currently approved. It must not authorize a Recommendation Change Affordance or be stored as a Decision Dimension until its architectural meaning and permitted choices have been resolved through the appropriate discovery and review process.

Explicitly out of scope for this section: the dimension-admission process/five-question gate (governance/DecisionLog), journey-specific UI requirements (interaction specs), the precise matching algorithm (implementation architecture), and behavior when multiple applicable Remembered Statements exist (Claim Identity / Journey 5.1).

---

## 6. Architectural Language Registry

Once a term or symbol has a precise architectural meaning, it may not be reused for a different concept elsewhere in the system.

| Reserved Term | Owned By | Precise Meaning | Reuse Allowed? |
|---|---|---|---|
| Evidence | Remembered Statement | The independently grounded user interaction that justifies storing a durable truth. | No |
| Scope | Remembered Statement | The explicit boundary within which a remembered truth applies. | No |
| Decision Dimension | Decision-Dimension Taxonomy | A mutually exclusive, Companion-defined organizing decision. Legitimately referenced by both Recommendation and Remembered Statement - same concept, two references, not a collision. | No |
| Recommendation | Recommendation object | Companion's current organizing guidance for a specific item or task. | No |
| Basis | Recommendation | The current-session observation supporting a recommendation. Not the same as a Remembered Statement's Evidence. | No |
| Applies To | Recommendation | The location or object the recommendation concerns. Not the same as a Remembered Statement's Scope. | No |
| ✓ (checkmark) | Whatever object carries completed task state (e.g. a batch checklist item) | Task or capability completion. | No - must not be reused for preference-acceptance acknowledgment or any other confirmation. |
| Project | Project object | The long-running effort to transform a Space, spanning multiple Sessions, from Starting Evidence to a terminal state. | No - must not be used loosely (e.g. "the Companion project") when referring to architecture. |
| Session | Session object | A stable-identity, Project-owned event representing one bounded period of Companion interaction. | No - must not be used loosely for any interaction boundary in general prose when referring to architecture. |

Rule: Before introducing a new architectural term or symbol, verify it isn't already reserved. If an existing one seems applicable but means something different, create a new term instead of overloading it.

---

## 7. Temporary Concepts

**Session, superseded 2026-08-01:** previously recorded here as "a temporary interaction boundary... not itself durable memory." Promoted to a full Settled Object with stable identity - see Session, Section 4, and DecisionLog.md, "Session Given Stable Identity, Project Remains the Durable Owner." Left here as a marker, not deleted, so the correction is visible.

### Observation

- Evidence received or derived during an interaction.
- Ephemeral by default; may influence durable state but is not automatically durable knowledge.

### Working Interpretation

- The current interpretation assembled for a single interaction.
- Exact architectural representation is intentionally left open (see Open Questions) - do not define its structure here.

---

## 8. Explicitly Rejected Promotions

### Area

Not currently justified as an independent domain object. The demonstrated requirement is satisfied by a Space-owned Location Reference. See DecisionLog.md for the rename/relocation evidence.

### Correction

An event and a source of evidence, not an object. See DecisionLog.md for full reasoning.

### Completion

A lifecycle transition on Persistent Work and a source of evidence, not an independently owned object. See DecisionLog.md for full reasoning.

### Deferral

A lifecycle event recorded on Persistent Work, not a separate object. See DecisionLog.md for full reasoning.

---

## 9. Open Questions

- Location Reference lifecycle: what makes a reference inactive (if "inactive" is even the right model), whether it can reactivate, and whether reappearance reactivates the same identity or creates a new one.
- Snapshot ownership and lifecycle: Snapshot is provisionally Space-owned, but deletion and historical consequences have not yet been tested.
- Runtime understanding / working interpretation representation: not a settled three-layer model or any other specific structure - genuinely open. Once Working Interpretation is defined, revisit Recommendation's generation description.
- Whether repeated deferral of Persistent Work should independently produce behavioral memory (data is being preserved specifically to allow this to be answered later from evidence).
- Cross-cutting deletion behavior (Space deletion, account deletion) for each of the four durable responsibilities - explicitly deferred to LifecycleModel.md, not answered here.
- Claim Identity for Remembered Statements: how Companion determines whether two explicit statements concern the same claim, overlapping claims, or independently scoped claims, and what relationship, if any, exists between them. Deferred to Journey 5.1. Recency alone does not establish supersession.
- Project Superseded terminal state: whether starting a new Project on a scope with a still-Active prior Project requires the user to first acknowledge the old one is being abandoned/superseded, or whether this can happen silently. **Resolved 2026-08-01** - always requires explicit acknowledgment, never silent. See the Project entry in Section 4 and DecisionLog.md, "Project Scope Model - Space or Location Reference, Not Space-Only." Left here, marked resolved rather than deleted, so the history of this question is visible.
- Persistent Work's Remove state versus its new five-state status model (Active / Carried / Completed / Accepted-as-is / Needs-Review): whether Remove now maps onto Accepted-as-is, remains a distinct state, or needs its own reconciliation is unresolved.

---

## 10. Relationship to Other Architecture Documents

- **ProductPhilosophy.md** - why this architecture exists.
- **ArchitectureGuide.md** - how this document is structured and governed.
- **SpaceMemoryModel.md** - what Durable Memory means and its categories.
- **LifecycleModel.md (forthcoming)** - how these objects change over time.
- **PersistenceModel.md (forthcoming)** - how this model is stored.
- **SpaceImplementation.md** - the implementation-facing contract for Space specifically (fields, ownership classification, Firestore topology, lifecycle flows, migration requirements). This document states Space's settled invariants; SpaceImplementation.md translates them into an implementation contract without amending them.
- **DecisionLog.md** - the reasoning, evidence, and revisit conditions behind every decision in this document. This document states conclusions; DecisionLog.md explains why they were reached.
