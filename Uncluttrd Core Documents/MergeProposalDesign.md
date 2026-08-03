# Merge Proposal Design — §12 Migration, Part 3

Status: Draft
Version: 0.2 (2026-08-02: N-way selection model resolved as Model 1/adopted; candidate IDs corrected to hash-based; history path corrected to follow candidate ID; `decisionRevision` retracted in favor of `confirmationEventId`; reconciliation algorithm corrected to preserve pairwise-not-global dismissal semantics)
Audience: Everyone implementing merge-candidate surfacing/resolution, and later, merge execution
Purpose: Defines the complete user-decision lifecycle for Space merge candidates detected by §12 Migration Part 2, and the exact contract handed to future merge execution
Depends on: SpaceMemoryModel.md §12 (Migration Invariant, Restartability Principle), the §12 Migration Part 1/Part 2 implementation (`shared/spaceMigration.js`, `scripts/runSpaceMigration.js`), ArchitecturalReasoningStandard.md (claim notation used throughout this document)

This document does not implement UI, modify candidate records, or design the merge-execution transaction itself. It is the scoping record produced before Part 3 implementation begins, following ArchitecturalReasoningStandard.md's claim-classification notation — every substantive claim below is marked `[Observation]` (directly verified against real code), `[Inference]` (reasoning drawn from observations), or `[Decision]` (a choice made).

---

## 1. Decision Philosophy (governing principle)

[Decision] Merge proposals help users recognize the same physical Space. They do not ask users to approve database operations.

The user's question is: *"Are these the same place?"*
The system's later question is: *"Can I safely execute the merge you already approved?"*

These are separate layers and must remain so. Every screen and every transition in this design must pass this test: is it asking an identity question, or an execution question? If the answer is both, the design has mixed two layers that should stay separate.

[Inference] This principle is what makes stale-confirmed candidates (Section 6) work correctly at all: the identity answer the user already gave remains valid even after the execution context underneath it changes. If identity and execution were the same layer, a stale-confirmed candidate would have no coherent way to be presented without implying the user's original judgment was wrong.

Three places this principle governs decisions made later in this document, stated here so the test can be checked against them directly:

- [Decision] Execution eligibility (`expectedSpaceState`, Section 8) is evaluated fresh at merge-execution time, never stored as a precomputed flag on the candidate record. Storing an "eligible: true" bit would let an execution-layer fact leak backward into the confirmation record as though it were part of the identity answer.
- [Decision] The stale-confirmed action set (Section 6) contains exactly one identity-layer action (a reversal of the original claim) and one non-question action (an acknowledgment that closes out an execution-layer notification). No "reconfirm and re-merge" action exists, because that would be an execution-layer request disguised as an identity one.
- [Decision] Comparison-screen copy (Section 4) never references document IDs, versions, or any other execution-layer state. It only ever asks the identity question, framed around the detection signal that produced the proposal.

---

## 2. Candidate State Machine

[Observation] The real, currently-persisted schema for `users/{uid}/mergeCandidates/{spaceType}` (verified directly against `shared/spaceMigration.js` and `scripts/runSpaceMigration.js`, not reasoned from memory of prior turns) is:

```
{
  tier: "1",
  spaceType: string,
  planIds: string[],
  detectionVersion: number,
  detectedAt: Timestamp,
  resolutionStatus: "pending" | "dismissed" | "confirmed-merge" | "stale-confirmed",
  resolvedAt: Timestamp | null,
  staleReason: string | null,
  staleDetectedAt: Timestamp | null,
}
```

[Observation] `resolvedAt` exists in the schema and is initialized to `null` at creation, but no code path in the repository writes it to a non-null value — confirmed by grep across `App.js`, `shared/*.js`, and `scripts/*.js`. It is present but currently dead; Part 3 is the first work that would actually write it.

[Inference] The four existing `resolutionStatus` values do not, on their own, distinguish every state a surfacing UI needs. Two of the states below require schema additions; one requested state cannot exist under the current design at all.

| Requested state | Representable today? | Notes |
|---|---|---|
| Fresh pending | Partially | `resolutionStatus: "pending"` exists, but nothing distinguishes "never shown" from "shown and deferred." |
| Deferred pending | No | Requires new fields `lastShownAt: Timestamp \| null` and `deferredCount: number`, both sub-states of `pending` — not a new `resolutionStatus` value, since deferral must not be conflated with rejection (Section 5). |
| Confirmed awaiting execution | Yes | `resolutionStatus: "confirmed-merge"`. |
| Rejected | Yes | `resolutionStatus: "dismissed"`. |
| Stale-confirmed | Yes | `resolutionStatus: "stale-confirmed"` — built and tested in Part 2. |
| Stale pending | **Cannot exist, by design** | [Observation] Verified directly against Part 2's actual reconciliation logic: a `pending` candidate that drops below 2 valid members is deleted outright, never marked stale. [Inference] This is correct as designed — nothing was ever decided about a pending candidate, so there is nothing worth preserving when it stops qualifying. |
| Successfully merged | No — future state only | Requires a new `resolutionStatus` value once merge execution exists. Not designed here. |
| Failed merge execution | No — future state only | Same. |

### State-transition table

| Current state | Trigger | Next state | User-facing consequence |
|---|---|---|---|
| *(no document)* | Part 2 detects 2+ same-labeled plans | Fresh pending | Nothing yet — not surfaced until next relevant app open |
| Fresh/deferred pending | User opens the comparison view | Pending, `lastShownAt` set | Evidence displayed |
| Fresh/deferred pending | "Same Space" | Confirmed awaiting execution | Confirmation recorded; no merge has happened yet |
| Fresh/deferred pending | "Keep Separate" | Rejected (terminal) | Stops surfacing; not auto-reconsidered |
| Fresh/deferred pending | "Not Now" / "I'm not sure" | Deferred pending | Reappears next session, not immediately (Section 3) |
| Confirmed awaiting execution | Part 2 re-run, cluster still valid | *(unchanged — frozen)* | Nothing |
| Confirmed awaiting execution | Part 2 re-run, member invalidated | Stale-confirmed | Distinct flow, Section 6 |
| Stale-confirmed | "Understood, no longer applicable" | *(unchanged — terminal)* | Acknowledged, stops resurfacing, retained in history |
| Stale-confirmed | "Actually, I don't think these are the same" | Rejected | An explicit reversal, recorded distinctly (Section 7) |
| Rejected | *(none — terminal by default)* | *(unchanged)* | Only reconsidered if the user manually seeks it out again |
| Confirmed awaiting execution | *(future)* execution succeeds | *(future)* Merged | Out of scope |
| Confirmed awaiting execution | *(future)* execution fails | *(future)* Merge-failed | Out of scope |

---

## 3. Surfacing Location and Cadence

[Observation] This app has no React Navigation stack — navigation is a hand-rolled set of boolean `showX` state flags on the main component, each rendering a distinct full-screen early return (verified by direct investigation of `App.js`).

[Observation] `App.js:4515-4524` — the existing `resumablePlan` Home banner: a small, non-modal inline card (icon, title, one-line subtitle, chevron) sitting in the Home screen's normal scroll flow, tapped to deep-link into an existing plan's detail state.

[Observation] `App.js:3877-4022` — the existing "Space Inspector" dev screen: header-with-back + a single `ScrollView` of stacked `SectionCard` components, reached via a menu item and also closable back to the menu from its own header.

[Decision] The primary surfacing model is a hybrid: a Home banner reusing the exact `resumablePlan` visual pattern, leading to a dedicated comparison screen reusing the Space Inspector's header + `ScrollView` + `SectionCard` shape. The destination screen is also independently reachable via its own menu entry, so it is never *only* reachable through the banner.

[Inference] This recommendation is not adopted from the working hypothesis without verification — it is confirmed against the real, already-proven precedent for both halves (the banner shape and the destination-screen shape both already exist and are already in production use elsewhere in this app), which is why it is preferred over a banner-only or inline-History-badge model: neither of those can hold enough evidence (Section 4) or the stale-confirmed nuance (Section 6) on their own.

[Decision] Cadence rules:
- First surfaced on the next authenticated app-open after Part 2 persists the candidate (mirroring the existing `reconcileActivePlanShadow` app-start-trigger pattern — non-blocking, cheap).
- Shown at most once per app session, at the same visual weight every time. No escalation by elapsed time.
- "Not Now" dismisses for the current session only; it reappears next session because nothing was decided.
- Always reachable manually via the menu regardless of banner state — this, combined with the once-per-session cap, is what avoids both nagging and permanent invisibility without any time-based escalation logic.
- Tier 2 candidates are never proactively surfaced in the banner or in any notification. They remain on-demand only, computed live inside the destination screen, never from a persisted record.

---

## 4. Comparison Experience

[Observation] `App.js:1356-1422` — the existing `BeforeAfterStack`/`BeforeAfterInspector` components: labeled side-by-side thumbnails, tap either to open a fullscreen tap-to-toggle crossfade modal. Not a drag slider (a prior slider implementation was explicitly replaced due to gesture bugs, per an in-file comment).

[Decision] A simple yes/no card is not sufficient. The comparison screen must show, for both candidate plans: space type/label, creation dates, starting photo, latest/current photo if available, Project or plan-level completion status, and the detection signal that produced the proposal (e.g., "Both are labeled 'Kitchen'"), reusing `BeforeAfterStack`/`BeforeAfterInspector` for the photo comparison rather than inventing a new widget.

[Inference] Photos are the primary evidence a person actually uses to recognize a physical space; text labels and dates are supporting context, not a substitute.

[Decision] If a candidate's plans have not yet completed Part 1 structural migration, Project-level status will not exist. The comparison must fall back to reading the equivalent facts directly from the plan document (`companionComplete`, `currentBatch`) rather than block or error, since Part 2 detection is already independent of structural migration completion.

[Decision] Copy must always attribute the proposal to the stated signal ("labeled the same," "created around the same time") and must never imply the system has verified identity ("we found a duplicate"). This is the Section 1 governing principle applied directly to comparison-screen language.

---

## 5. User Actions and Exact Semantics

- **Same Space** — [Decision] persists `resolutionStatus: "confirmed-merge"` and writes `resolvedAt` (existing, previously-dead field — see Section 2). Does not execute anything. Full payload defined in Section 8.
- **Keep Separate** — [Decision] persists `resolutionStatus: "dismissed"` and `resolvedAt`. Terminal by default, matching Part 2's own already-built behavior (dismissed clusters are frozen, never re-derived automatically). [Inference] The only realistic path back to reconsideration is the user manually seeking it out again via the Tier 2 on-demand view — not an automatic system-driven re-evaluation, since none exists in Part 2's design.
- **Not Now** — [Decision] `resolutionStatus` stays `"pending"`, `resolvedAt` stays `null`. Only `lastShownAt`/`deferredCount` change. These are disjoint fields from what "Keep Separate" touches, which is what makes deferral genuinely un-conflatable with rejection at the schema level, not just by convention.
- **"I'm not sure"** — [Decision] persisted identically to "Not Now." The difference between the two is copy/tone only, offered because forcing "Not Now" on someone honestly uncertain reads as more pressuring than necessary. An optional `lastDeferralReason` field could distinguish them for future analytics; not required for Part 3's core function.

---

## 6. Stale-Confirmed Handling

[Decision] A stale-confirmed candidate is never presented inside the ordinary fresh-proposal queue. It is shown as its own distinct notice.

[Decision] Framing preserves the original identity claim explicitly: *"You confirmed these were the same space on [date]. Since then, [staleReason, already persisted by Part 2] — so this specific merge can no longer be completed as confirmed. Your assessment isn't in question; the situation underneath it changed."*

[Decision] Exactly two actions, both consistent with the Section 1 test:
1. **"Understood, no longer applicable"** — not a question; closes out the notification. `resolutionStatus` remains `"stale-confirmed"` permanently. Records `acknowledgedAt` (new field).
2. **"Actually, I don't think these are the same space"** — a genuine identity-layer reversal, distinct from an ordinary "Keep Separate." Transitions to `dismissed`, recorded in history (Section 7) explicitly as a reversal-of-confirmed, not merged into ordinary rejection records.

[Decision] No "reconfirm and re-merge" action is designed. If the staleness cause is deletion, there is nothing left to merge against. If the cause is a relabel, forcing immediate reconfirmation would conflate identity-reconsideration with execution-context, which Section 1's test exists to prevent.

[Observation] Because Part 2's current candidate documents are keyed by `spaceType` alone, and its reconciliation logic never reprocesses a `stale-confirmed` document, that key is permanently occupied once a candidate goes stale-confirmed — a genuinely new cluster later sharing the same label could never get a fresh document under that scheme. Resolved in Section 10.

---

## 7. Resolution History and Auditability

[Observation] Part 2's current implementation has no history mechanism at all — every `.set()`/`.update()` call mutates the one current-state document in place. There is nothing to read back "what did the detector originally propose vs. what did the user decide vs. what changed later." This is a real gap, not something already handled.

[Decision] An append-only subcollection: `users/{uid}/mergeCandidates/{candidateId}/history/{eventId}`. The main document remains the cheap current-state pointer; every transition (detector creation/refresh, every user action, every staleness event, future execution result) appends an immutable record instead of overwriting.

[Decision] `{candidateId}` in this path is explicitly the content-derived hash ID from Section 10, not Part 2's original `spaceType`-only key. This matters concretely: a `spaceType`-keyed history path would have meant every candidate ever detected for, say, "Kitchen" shared one history subcollection forever, mixing unrelated confirm/dismiss decisions about entirely different plan combinations into one undifferentiated log. Under the corrected path, each distinct plan-combination gets its own history, which is what makes "what did the detector originally propose vs. what did the user decide about *this specific group*" actually answerable.

[Decision] Each history entry carries an `actor: "detector" | "user" | "system" | "execution"` field, so a later reader can distinguish what the detector proposed, what the user decided, what later changed, and what merge execution actually did, without inferring it from a single mutated status field.

[Decision] Evidence shown at decision time (photo URLs, signal shown) is recorded in the relevant history entry, not added as fields on the main candidate document — keeping the current-state document lean and the audit detail append-only.

### Lineage across a split (Section 9/10)

[Decision] When an N-way candidate is replaced by two new independent records (Section 10's write sequence), each new document's first history entry includes a `splitFrom: candidateId` field naming the original, now-deleted document's ID. This is the only place that provenance is recorded — the new documents do not inherit or copy any of the original's history entries, only a pointer back to where they came from.

[Observation] Per Section 10, Firestore does not cascade-delete the original document's own `history` subcollection when the parent document is deleted, so that original history remains fully readable at its original path (`users/{uid}/mergeCandidates/{originalCandidateId}/history/*`) even though `users/{uid}/mergeCandidates/{originalCandidateId}` itself no longer exists. [Inference] Combined with `splitFrom`, this means the full lineage is reconstructible by a reader — walk forward from the orphaned original history via `splitFrom` references on the two children — without requiring the original document to still exist as a live record.

---

## 8. Handoff Contract to Merge Execution

[Decision] Reconciled field-by-field against the real, verified Part 2 schema (Section 2) — not designed as a clean slate.

| Required field | Status |
|---|---|
| Canonical candidate ID | [Observation] Exists — the document ID. Under the content-derived scheme (Section 10), this remains the canonical identifier. |
| Both Space IDs | [Observation] Exists, derivable — `planIds` already gives both, via the established `spaceId === planId` invariant proven throughout this codebase. [Decision] No redundant `spaceIds` field, consistent with the "one source of truth" principle already applied when Part 2's schema was designed. |
| User ID | [Observation] Exists, implicit in the `uid` path segment. [Decision] Added as an explicit field only on history entries (Section 7), since `collectionGroup` queries cannot read path segments directly. |
| Confirmation timestamp | [Observation] Exists but dead — `resolvedAt`, never written by any current code path (Section 2). Part 3 is the first code that writes it. |
| Decision revision | [Decision] **Retracted.** Originally proposed as a new field; superseded by `confirmationEventId` below, which answers the same underlying need (which specific decision does execution act on) more precisely than a revision counter would have. |
| Confirmation event reference | [Decision] New field required — `confirmationEventId: string`, the ID of the exact immutable history entry (Section 7) that recorded the "Same Space" confirmation. This is the field that actually replaces the retracted `decisionRevision`: rather than a counter tracking *how many times* a decision changed, execution is handed a direct pointer to *which specific, immutable event* it is honoring. Combined with `confirmedPlanIds`, `expectedSpaceState`, and `resolvedAt` (confirmation timestamp), this gives execution everything needed to know precisely what was confirmed, by which action, and when — without needing to re-derive any of it from the mutable current-state document, which could theoretically have moved on by the time execution runs (e.g., gone stale-confirmed). If the current-state document's status no longer matches what `confirmationEventId` recorded, that mismatch itself is a signal execution should route into the staleness path rather than proceed. |
| Evidence references shown | [Decision] New — but belongs in the history subcollection (Section 7), not as a new field on the main `mergeCandidates` document. |
| Confirmation scope | [Decision] New field required — `confirmedPlanIds: string[]`. Necessary because Part 2's clusters are N-way (Section 9); `planIds` (the full cluster) is not sufficient to express which specific subset the user is confirming together. |
| Expected Space versions/fingerprints | [Decision] New field required — `expectedSpaceState: { [planId]: { sourceVersion, migrationVersion } }`, snapshotting each Project document's already-existing version fields at confirmation time. |
| Execution eligibility state | [Decision] Not a stored field. Evaluated fresh at execution time (`resolutionStatus === "confirmed-merge"` AND current versions still match `expectedSpaceState` AND both plans still exist), per the Section 1 governing principle. A mismatch routes into the same staleness path as any other invalidation. |

---

## 9. N-Way Comparison Design (Model 1 — adopted)

[Observation] Part 2's clustering groups by `spaceType` with no upper bound on cluster size — a cluster can contain 3 or more plans, not just 2. Sections 4 and 5 above were designed against a pairwise assumption and needed this correction.

[Decision] All N members are presented together as one set (a grid/list of the same evidence cards defined in Section 4), not as sequential pairwise comparison screens. [Inference] A person reasoning "which of these are duplicates of each other" needs to see the whole set at once; forced pairwise comparisons scale combinatorially (6 screens for a 4-plan cluster) and don't match how people actually recognize a place across multiple photos.

### Interaction semantics

[Decision] For a candidate set `{A, B, C, D}`, the user's task is framed explicitly as: **"Select every record shown that belongs to the same physical space."** Selecting `{A, B}` and confirming establishes three distinct facts at once, none of them hidden:

- A and B are the same Space.
- C and D are **not** members of that selected identity group.
- **Nothing has been decided about whether C and D match each other.**

[Decision] This is the direct reading of what the user did, with full information, in response to an explicit question — not a hidden inference the system draws on the user's behalf. The screen's copy must carry this meaning *before* the user acts:
- Instruction: *"Select all of the records that belong to the same physical space."*
- Action label: *"These are the same space"* (or equivalent).
- Supporting copy: *"Records you leave unselected will not be included in this group. You can review the remaining records separately."*
- **"Not sure yet"** remains available at all times, so a user is never forced into the exclusion claim ("C and D are not part of this group") when they are genuinely uncertain about C or D specifically, not just about the group as a whole.

[Decision] Governing principle for this interaction, stated as its own sentence for later reference:

> Selecting a subset from an N-way candidate establishes that the selected records are the same Space and that the unselected records are not members of that selected identity group; it does not resolve relationships among the unselected records themselves.

### Remainder handling

[Decision] After confirming `{A, B}` from a 4-member cluster `{A, B, C, D}`:
- The confirmed identity group `{A, B}` becomes its own candidate document, content-derived ID (Section 10).
- The remainder `{C, D}` becomes its own, **separate** candidate document if 2+ members remain; if only 1 member remains, it reverts to being an ordinary plan with no lingering candidate document (unchanged from the prior draft of this section).

[Decision] The confirmed group and the remainder are **two different candidate identities** — not two statuses of one document. See Section 10 for the exact write sequence and why the original N-way document is never mutated into either outcome.

### "Keep Separate" for an N-way cluster

[Decision] "Keep Separate," applied to whatever set is currently open, means precisely: **"None of the records currently shown represent the same physical Space as another record currently shown."** This claim is scoped to the displayed set only.

[Decision] It does **not** prevent any member from matching a genuinely new record discovered later — a plan that was part of a rejected group is not retired from future clustering. This is preserved in candidate history as **pairwise separation among the members actually reviewed together**, never as a global "never match this plan again" rule. Section 10's reconciliation logic is written to this exact requirement, correcting a gap the prior draft of this document had (see Section 10's note on the correction).

A user who believes part of an open set *is* the same uses multi-select "Same Space" to peel that subset out first, per the interaction semantics above; "Keep Separate" then resolves whatever remains, as a separate action, under the same "displayed set only" scoping.

---

## 10. Content-Derived Candidate IDs

### ID derivation: hash-based, not raw-joined

[Decision] Candidate IDs are a bounded deterministic hash, not raw joined plan IDs placed directly in the Firestore document ID:

```
candidateId = hash(normalizedSpaceType + "|" + sortedPlanIds.join("|"))
```

[Decision] The document itself stores the readable inputs separately — `spaceType`, `planIds`, and a new field `candidateKeyVersion: number` — so the derivation scheme can evolve explicitly later (a different hash function, different normalization, different join delimiter) without anyone needing to reverse-engineer a hash to recover what a document is about. `candidateKeyVersion` is a new, third version field in this schema, parallel in purpose to `detectionVersion` (Part 2's clustering ruleset) and `MIGRATION_VERSION` (structural projection) — but tracking the ID-derivation scheme specifically, distinct from both.

[Observation] This codebase already has one precedent for a lightweight, non-cryptographic hash — `debugHashBase64` (`App.js:53-60`) — but it is explicitly a debug-only fingerprint that *samples* every 37th character of its input, tolerating occasional collisions because the cost of a collision is a slightly-wrong debug log line. That tolerance is inappropriate here: a candidate-ID collision would silently clobber one candidate's Firestore document with another's write, a real correctness bug, not a debug inconvenience. [Decision] `computeMergeCandidateId` must hash the *full* input string, not sample it — candidate-ID inputs (a label plus a handful of short plan IDs) are short enough that full hashing is cheap, unlike the large base64 payload `debugHashBase64` was built to handle affordably. The existing function is precedent for the *style* (lightweight, non-cryptographic, already an accepted pattern in this codebase), not something to reuse as-is.

[Decision] `normalizedSpaceType` must use the exact same normalization (currently: none — `detectMergeCandidates` uses the raw `plan.data.spaceType` string as its clustering key with no trimming or case-folding) as whatever `detectMergeCandidates` uses to group plans in the first place. If the two ever disagree on what counts as "the same spaceType," detection and ID derivation could describe two different realities. If normalization (trimming/case-folding) is ever added to one, it must be added to both in the same change.

[Inference] A revision counter was considered for the ID scheme itself and rejected: a counter requires tracking "what's the next number" somewhere, which is a small ledger — directly in tension with the Restartability Principle this system is built on. A content-derived ID needs no memory of prior runs: the same real plan-set always produces the same ID, and a different plan-set always produces a different one, deterministically, matching every other ID scheme already in this codebase (e.g. `computeShadowBatchId`).

### Correction: the reconciliation shell's "claiming" logic

[Observation] The prior draft of this document's reconciliation algorithm subtracted *all* of every non-`pending` document's `planIds` from the raw cluster to compute the pending remainder — including `dismissed` documents. This directly contradicts Section 9's own stated principle: a dismissed pair `{C, D}` would have permanently removed both C and D from all future pending consideration, even against a completely different future partner. That is exactly the global "never match this plan again" rule Section 9 explicitly rejects. This is a genuine correction to the previously-published design, not a restatement of it.

[Decision] The corrected reconciliation shell (`detectAndPersistMergeCandidatesForUser`) treats each `resolutionStatus` differently when deciding what remains eligible for a pending candidate:

- **`confirmed-merge`** — its `confirmedPlanIds` are permanently committed. These specific plans, as this specific group, are done being proposed; they are excluded from all future pending consideration for that `spaceType`.
- **`dismissed`** — represents "this specific combination is not all the same," not "these plans are retired." Its members remain fully eligible to be proposed again as part of a *different* combination. Dismissed members are **not** subtracted from the raw cluster.
- **`stale-confirmed`** — the original confirmed relationship is dead (a member no longer exists or no longer qualifies); any still-existing, still-qualifying member is not blocked from a fresh proposal either. Not subtracted.

[Decision] Corrected algorithm, per `spaceType`:
1. Compute the full raw cluster (`detectMergeCandidates`, unchanged).
2. Query all existing candidate documents for that `spaceType` (`.where("spaceType", "==", spaceType)`, not a single fixed-key `.get()`).
3. Run the existing, unchanged `evaluateCandidateInvalidation` against every non-`pending`, non-`stale-confirmed` document independently, exactly as before.
4. Compute the pending-eligible set: raw cluster minus only the union of `confirmed-merge` documents' `confirmedPlanIds`.
5. If the pending-eligible set, taken exactly as-is, matches an existing `dismissed` document's `planIds` exactly (the identical combination, not a superset), do not recreate a pending candidate for it — that exact question was already answered. If even one plan has been added or removed, it is a different combination and is eligible for a fresh pending candidate, which may re-include previously-dismissed members alongside the new one.
6. If the pending-eligible set has 2+ members, upsert a `pending` document keyed by `computeMergeCandidateId(spaceType, pendingEligibleSet)`. If a previous `pending` document exists whose ID no longer matches (because membership changed), delete it — superseded, the same way a shrink-below-2 invalidation already deletes a stale pending document today.

[Decision] `detectMergeCandidates` (pure) and `evaluateCandidateInvalidation` (pure) are both **unchanged** by this correction — the fix is entirely in the reconciliation shell's own set-arithmetic, not in either pure function's logic.

### Write sequence when a user confirms a subset (Section 9)

[Decision] Confirming `{A, B}` out of an open `{A, B, C, D}` candidate performs, as one logical action:
1. Create a new document at `computeMergeCandidateId(spaceType, [A, B])` with `resolutionStatus: "confirmed-merge"`, `confirmedPlanIds: [A, B]`, `planIds: [A, B]`, `resolvedAt` set — a genuinely new, independent record, never the original document with its status flipped.
2. If 2+ plans remain (here, `{C, D}`), create a new `pending` document at `computeMergeCandidateId(spaceType, [C, D])`. If fewer than 2 remain, no new document is created for the remainder.
3. Delete the original `{A, B, C, D}` document — it is replaced by the two new records above, never mutated into either outcome. [Decision] This is deliberate: it prevents anyone from later attempting to write "confirmed" and "still has an open remainder" onto the same document at once, which is logically incoherent for a single `resolutionStatus` field.
4. Each new document's first history entry (Section 7) records the originating candidate ID as provenance, since the original document is deleted and its own lineage would otherwise be undiscoverable from the new records alone.

[Observation] Firestore does not cascade-delete subcollections when a parent document is deleted — the original document's `history` subcollection (Section 7) becomes orphaned but remains fully present and readable at its own path; nothing is silently lost, it simply no longer has a current-state document above it. [Inference] A `"split"` terminal `resolutionStatus` value, left in place instead of deleted, would avoid this orphaning and keep the original document independently discoverable — this is a real, worthwhile refinement, but it is *my own* recommendation, not something requested this round, and is recorded here as a flagged option rather than adopted, so it is not confused with a settled decision.

---

## 11. Open Items — not resolved by this document

[Decision] The "growing cluster after **dismissal**" case is now resolved, not open. Section 10's corrected reconciliation logic settles it directly: a dismissed pair's members are not subtracted from future pending-eligibility, so a new plan joining the label produces a fresh pending candidate (a different plan combination, with its own content-derived ID) rather than being blocked or silently absorbed into the old dismissed document. This closes the part of the original open item that concerned dismissal.

[Observation] The "growing cluster after **confirmation**" case remains genuinely open. Concretely: a new plan `E` appears, same `spaceType` as an already-`confirmed-merge` pair `{A, B}`. Section 10's reconciliation correctly excludes `A` and `B` from all future pending consideration (they are permanently committed), so `E` alone — with no second same-labeled plan — never becomes a pending candidate at all under the current design. [Inference] Whether `E` should ever be proposed as "does this belong with the already-confirmed-and-presumably-already-merged `{A,B}` Space" is a materially different question from anything Part 2/Part 3 answer today: it would mean proposing a merge against a Space that (once execution exists) already has real content, not against another bare, unmigrated plan. That is a question for merge-execution's own design, not for detection or surfacing, and is explicitly left open here rather than guessed at.

---

## 12. User-Managed Space Identity

[Design principle] User naming defines Space identity. The AI's original classification (`spaceType`) is preserved as historical metadata — it is never overwritten by a rename. The user's `spaceName`, when set, is the canonical name for all product behavior: display, detection, comparison, and merge-candidate grouping. The AI label is never shown to the user as the "real" name once a user-chosen name exists.

[Invariant] Merge-candidate detection must always operate on the same display value the user sees. Any function that groups, compares, or invalidates candidates must read the same computed name the UI displays. These must never diverge.

[Decision] The Firestore field is **not** renamed from `spaceType` to `aiSpaceType`. `spaceType` is kept as the literal field name (avoids a migration across every existing plan document, avoids dual-field reads everywhere, and avoids invalidating the `mergeCandidates` schema's own `spaceType` field / `computeMergeCandidateId`'s hash inputs, which already key off this exact name) — its *meaning* becomes "the AI's original classification," which is already exactly what it has always held. A new nullable field, `spaceName: string | null`, is added alongside it.

[Decision] Single pure derivation, `getSpaceDisplayName(planData)` (`shared/spaceMigration.js`, callable from both the client and the admin migration runner, same "one shared function, never reimplemented twice" discipline as `computeShadowIds`/`computeMergeCandidateId`):
```js
function getSpaceDisplayName(planData) {
  const trimmed = typeof planData.spaceName === "string" ? planData.spaceName.trim() : "";
  return trimmed || planData.spaceType || null;
}
```
Named for what it returns (the name to display), not how it's computed. Every UI display site, `detectMergeCandidates`' clustering key, and `evaluateCandidateInvalidation`'s continued-validity check all call this same function — enforcing the Invariant above by construction, not by convention.

[Observation] `mergeCandidates` documents' own `spaceType` field is **not** renamed either. Its stored *value* is now `getSpaceDisplayName`'s output at detection time, not the raw AI label — the field name stays the same for full schema/rules/ID-derivation compatibility; only what populates it changes.

[Decision] Rename is just another authoritative mutation, following the exact same contract already proven at five existing plan-mutation call sites (batch pause/wrap-up/completion/next-batch/retroactive-save): write `spaceName` on the authoritative plan document, increment `shadowSourceVersion`, fire `syncPlanToSpaceGraph` without awaiting it. No new mechanism, no dual writes, no special-cased sync path.

[Observation] This required exactly one necessary code change inside the sync pipeline itself, not zero: `syncPlanToSpaceGraph`'s (and the migration runner's `deriveFullReprojectionDocs`'s) shadow `displayName` derivation had to switch from reading `plan.spaceType` directly to calling `getSpaceDisplayName(plan)`. The transaction shape, version-guard, and fire-and-forget trigger mechanism required no changes.

[Inference] Since `spaceName` is user-typed rather than AI-controlled, trivial whitespace/casing differences ("Kitchen " vs "kitchen") are a materially more likely real-world occurrence than they ever were for AI output. `getSpaceDisplayName` trims whitespace; case-folding was deliberately **not** added, to stay consistent with `computeMergeCandidateId`'s existing "no normalization" contract (Section 10) — revisit both together if this becomes a real problem, not independently.

[Decision] UI placement: the comparison card's rename affordance (a small "✎ Rename" link, opening a bottom sheet — pre-filled current name, suggestions drawn from the user's own other plan names via `getSpaceDisplayName`, Save/Cancel, 50-character limit) is the essential surface, since that is where users actually discover a wrong label. A second entry point was added to the existing History row's `Alert.alert` action list (opening the identical bottom sheet), as an interim stand-in for a real plan/Space detail page — [Observation] no such page currently exists in this app; "View Plan" only reopens the existing Results/Companion screen. Building a real detail page is deferred as a fast-follow, not attempted in this pass.

---

## Closing

This document should be revisited once Part 3 implementation exists to test these decisions against, and once merge execution's own design (explicitly out of scope here) surfaces requirements this document did not anticipate.
