# Uncluttrd Architectural Reasoning Standard

Last updated: July 2026
Status: Living document. Defines how architectural claims are classified, how evidence is weighed, and how conclusions are scoped. This is the standard every future architectural claim, citation, and reconciliation is evaluated against.

---

## Why this document exists

The Journey 1 provenance investigation asked for a faithful transcription of a "V1 wireframe" previously believed to exist as a verified, directly inspected artifact. A direct search of the repository found no such file, anywhere. A later blind inventory across all six Journeys found the same pattern repeated, in different forms: artifacts believed "verified" for Journeys 1, 2, and 6 could not be located as files at all. Journey 4, believed to be a standalone document, turned out to be only an embedded example inside an unrelated Decision Log entry. Meanwhile artifacts that were genuinely verified (Journey 5) and artifacts that were honestly understood as discussion-only (Journey 3) had been tracked correctly the whole time.

The near-miss was not that an artifact went missing. It was that "verified" had been carried forward as if it were still true, across enough conversation turns and documents, that nobody could point to the moment it stopped being checkable. This document exists so that a claim's type - and the strength of its evidence - travels with the claim itself, not with how many times it has been repeated.

---

## The North Star Principle

**Confidence must never travel further than the evidence that earned it. A claim is only as strong, and only as broad, as what was actually checked - not what was assumed, referenced, or repeated.**

This is the single filter every principle below is a specific case of. When two principles below seem to conflict, this is the one that wins.

---

## The Principles

### 1. Claim Classification

Every substantive architectural statement is one of exactly three kinds: an Observation, an Inference, or a Decision.

- **Observation** - a fact directly verified by inspecting a real artifact: a file that was opened and read, a line of code that was found, a document confirmed to exist at a specific path. An observation is checkable by anyone who repeats the same inspection.
- **Inference** - a conclusion drawn from one or more observations, but not itself directly verified. An inference can be well-supported or poorly supported, but it is never itself a fact - it is reasoning applied to facts.
- **Decision** - a choice made about what the project will do, independent of whether the evidence behind it was strong or weak. A decision can be well-reasoned or poorly reasoned, but it is not an observation or an inference - it is an act of choosing.

Claim type is not recoverable from sentence structure. An observation, an inference, and a decision can all be written as the same kind of plain declarative sentence - "The wireframe was verified" reads identically whether it means "I opened the file and read it" (observation), "the file probably still matches what was described" (inference), or "we are treating it as verified going forward" (decision). Nothing in the grammar of a finished sentence can tell these apart after the fact. This is exactly the failure the Journey 1 provenance investigation surfaced: "verified" had been written down as though it were self-evidently an observation, and by the time it needed re-checking, nobody could tell from the sentence alone which of the three it had actually been.

Because claim type cannot be reconstructed from a finished sentence, it must be assigned prospectively - at the moment the claim is written - not inferred later by a reader trying to guess what was meant.

**Notation:** mark every substantive architectural claim with a bracketed prefix at the point it is written: `[Observation]`, `[Inference]`, or `[Decision]`. This document uses that notation from here forward, so the standard demonstrates itself rather than only describing itself:

- [Observation] `Journey5.md` exists at `Uncluttrd Core Documents/Journey5.md` and was read in full.
- [Inference] Because `Journey5.md`'s header states "Status: Frozen," its content should be treated as settled rather than in-progress.
- [Decision] This document adopts the bracketed-prefix notation above, rather than a heavier scheme, because CompanionDesignPrinciples.md does not already establish one and a lightweight convention is more likely to actually be used going forward.

Future architecture documents, journey specifications, reconciliation documents, implementation documents, and Decision Log entries should use this notation for their substantive claims, unless an explicit Decision Log entry records an exception.

**Notation scope.** This document demonstrates the claim-classification notation only in the worked examples above, including the definitions of Observation, Inference, and Decision themselves. The normative principles in Sections 2 through 8 are governance decisions by definition and are therefore not individually prefixed with [Decision]. Other project documents, where observations, inferences, and decisions genuinely coexist, should use the notation throughout.

### 2. Evidence Confidence Hierarchy

Not all evidence deserves the same confidence, even when it points the same direction.

**Level 1 - Resemblance.** Two things appear similar.
- Supports: hypothesis generation - resemblance is a legitimate reason to look closer.
- Does not support: validation - resemblance alone never confirms a claim, since similar-looking artifacts can share a common source or template instead of genuinely corroborating each other.

**Level 2 - Independent Convergence.** Two independently developed artifacts arrive at the same conclusion.
- Supports: increased confidence.
- Still vulnerable to: hidden influence between the two artifacts - "independently developed" is itself a claim that needs its own evidence, not an assumption made in passing.

**Level 3 - Historically Verified Independent Convergence.** Independent development is demonstrated, not assumed, through provenance and timeline evidence showing the two artifacts genuinely could not have influenced each other.
- Supports: genuine corroboration.

Level 3 is falsifiable: discovering timeline overlap, a shared author working on both at once, or any other undocumented channel of influence between the two artifacts demotes the claim back to Level 2, regardless of how confident it previously felt.

### 3. Scope Discipline

**Evidence validates only the claim it directly supports.**

Strong evidence for a narrow claim does not extend to a broader one just because the broader claim contains the narrow one. A verified artifact that supports one specific correspondence - one screen matching one description, one field matching one requirement - validates that correspondence and nothing wider. It does not validate the object model, journey, or implementation that correspondence happens to belong to. Extending confidence from the part that was actually checked to the whole it sits inside is a scope error, not a stronger form of the same evidence.

### 4. Sticky Claim Classification

A claim's classification travels with it. Restating a claim never changes what kind of claim it is.

An [Observation] quoted in a second document is still an observation - and still only as strong as the original inspection that produced it, not strengthened by being repeated. An [Inference] does not become an [Observation] simply because it is quoted as though it were settled fact; citing it does not perform the verification it was missing. A [Decision] does not become evidence for anything just because the project went on to implement it - implementation demonstrates that a decision was made, not that the reasoning behind it was correct.

Losing this distinction across citations, quotations, summaries, and document boundaries is how epistemic drift happens: a claim that started as a cautious inference gets quoted as fact somewhere else, then cited as settled precedent somewhere after that, until no one restating it can point back to what was actually checked. A claim's classification must be carried forward explicitly every time it moves, not re-derived from how confidently the new sentence happens to be written.

### 5. Artifact Promotion Rule

**Any artifact cited as evidence for an architectural Observation, Inference, or Decision must be promoted to durable project storage before that citation becomes part of the project's permanent documentation.**

This applies only to artifacts that become architectural evidence - a wireframe a specification is transcribed from, a screenshot a correspondence is drawn against, a document a decision cites. It does not apply to operational or transient materials: build logs, deployment screenshots, debugging output, and temporary operational images are not architectural evidence and are not subject to this rule.

Promotion is not correction. Promoting an artifact preserves verified evidence by giving it durable provenance - a real file path someone can point to later - so a future reader isn't left checking whether "verified" still means anything. Promotion does not validate or change the architectural conclusions already drawn from that evidence; it only ensures the evidence itself remains checkable.

### 6. Corroboration Methodology

The objective of a corroboration search is to evaluate whether corroboration exists - not to find it.

A search framed around finding corroboration tends to produce it, whether or not it is really there, simply by treating a negative result as an incomplete search rather than a real answer. All four possible outcomes of a corroboration search are equally valid conclusions:

- Historically Verified Independent Convergence
- Independent Convergence
- Resemblance only
- No meaningful correspondence

A negative result - no meaningful correspondence found - is a successful outcome, in exactly the same sense a positive result is. It should be reported as the answer, not treated as a failed search that needs to keep going until something turns up.

The same confidence hierarchy defined in Section 2 applies to the corroboration finding itself, not only to the artifacts being compared: a claim that corroboration exists is itself an Observation, an Inference, or a Decision, and is only as strong as whichever level of evidence actually supports it.

### 7. Relationship Between the Principles

The principles above are not independent rules to apply in any order. They are a workflow, and each step guards against a different failure.

**Step 1 - Classify the claim.** Question: *What kind of statement is this?* Prevents: category drift - an inference quietly being treated as an observation, or a decision quietly being treated as evidence.

**Step 2 - Evaluate provenance.** Question: *How much confidence should this evidence receive?* Prevents: misplaced confidence - resemblance being treated as though it were verified independent convergence.

**Step 3 - Constrain the conclusion.** Question: *What does this evidence actually establish?* Prevents: overgeneralization - a narrow, well-supported correspondence being read as validating something much broader than what was actually checked.

These three safeguards address three independent failure modes. Getting one right does not compensate for getting another wrong - correctly classifying a claim as an observation does not prevent overgeneralizing its scope, and correctly scoping a conclusion does not prevent misclassifying it in the first place. All three have to hold at once.

---

## Applicability

This document is normative project governance, not a suggestion. Unless an explicit Decision Log entry records an exception, every future architecture document, journey specification, reconciliation document, implementation document, and Decision Log entry should follow this reasoning standard - claim classification, the evidence confidence hierarchy, scope discipline, sticky classification across citations, artifact promotion before permanent citation, and corroboration evaluated rather than sought.

---

## Origin

This document arose from the Journey 1 provenance investigation and the six-Journey blind inventory that followed it (July 2026) - not as a history of either, but as the standing standard both surfaced the need for. See DecisionLog.md for that record once logged.
