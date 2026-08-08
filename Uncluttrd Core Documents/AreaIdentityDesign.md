# Area Identity + Visual Recognition — Scoping Pass

Status: Draft (read-only design pass — no implementation)
Version: 0.1 (2026-08-08)
Audience: Anyone building the Area/sub-area layer, Room Detail's grouped view, or any AI-vision recognition mechanism
Purpose: Design durable identity for organizing Areas inside a Room, so repeat visits to the same physical sub-area roll up together instead of appearing as unrelated flat visits — without ever silently merging two different physical places or discarding history.
Depends on: `ObjectModel.md` (Location Reference), `RoomAndSpaceModel.md` (Room/Space naming, ownership invariant, visibility trigger — treated here as settled prior art, extended rather than re-litigated), `RememberedHomeDesign.md`, `DecisionLog.md` (2026-08-01 Persistent Work matching entries), `LegacyReclassificationDesign.md` / `MergeExecutionDesign.md` (structural precedent for phased, idempotent operations)

Notation: `[Observation]` (verified against current source), `[Inference]` (reasoning from observations), `[Decision]` (a choice made this pass).

---

## Naming, settled before anything else

This document uses **Area** as the product/design term for a durable sub-location inside a Room. This is the same concept `RoomAndSpaceModel.md` called **Space (sub-area)** and mapped onto `ObjectModel.md`'s **Location Reference**. Equivalence chain, stated once so it never needs restating:

**Area (this document) = Space (sub-area), `RoomAndSpaceModel.md` = Location Reference, `ObjectModel.md` §4**

"Area" is used here specifically because it has no collision with the existing "Space" naming (which already means two different things across two eras of documentation — see `RoomAndSpaceModel.md` §0). `Room` is unchanged throughout: the top-level saved object, the code's `Space`/`spaces` collection, `canonicalSpaceId`, `getSpaceDisplayName`.

---

## Section 1 — Audit: what already exists

A full codebase audit (grep across `App.js`, `shared/spaceMigration.js`, `functions/index.js`, every script, every Core Document) found:

**Documented, never implemented:**
- `ObjectModel.md` §4 `Location Reference` — "A Space-owned identity for a recurring, user-recognizable sub-location... May be recognized through spatial, functional, visual, content-based, or user-provided evidence — not keyed to any one anchor... Does not require promotion into an independent Area object." Zero fields enumerated, zero code.
- `RoomAndSpaceModel.md` (2026-08-04) is the direct prior art for this entire document. It already: named the collision, defined Room vs. Space (sub-area), mapped Space (sub-area) → Location Reference, set the ownership invariant (**"A Space cannot exist without a Room. A Room may exist without any visible Spaces."**), set a 2-or-more visibility trigger for showing sub-area UI, and sketched (not specified) a future two-field AI schema (`{roomType, spaceName}`) to eventually replace flat `spaceType`. It explicitly deferred "Location Reference activation" and "the actual prompt wording" as Build Later. **This document is that deferred activation pass.**
- `DecisionLog.md`, 2026-08-01, "Persistent Work Item Identity and Matching" — a structurally identical problem one layer down (matching a new AI-generated recommendation against existing Persistent Work items). Its governing rule is worth quoting verbatim, because it is exactly this document's own governing principle, already committed to by this codebase for an analogous case: *"Semantic or visual similarity between a new Recommendation and existing Persistent Work may only PROPOSE a match — it may not merge histories, inherit status, reopen completed work, or resurrect accepted-as-is work without structured user confirmation."* Its matching-inputs list even names *"current visual evidence"* as one signal among several, text similarity alone declared insufficient — the same conclusion Section 5 below reaches independently for Areas. **Grep confirms zero code implements this decision either** — it is policy, not running code.
- `DecisionLog.md`, 2026-08-01, "Project Scope Model — Space or Location Reference, Not Space-Only," quoting `ObjectModel.md` §4 directly: *"A Space may have either one active Space-scoped Project, or several concurrent active Location-Reference-scoped Projects (each covering a distinct Location Reference within that Space), but never both simultaneously covering overlapping ground."* Translated into this document's nouns: **a Room may have either one active Room-scoped Project, or several concurrent active Area-scoped Projects, never both on overlapping ground.** This rule is inherited, not reinvented (Section 3).

**Live and implemented — none of it is image/visual-based:**
- Room-First Identity recognition (`shared/spaceMigration.js`, `resolveRecognitionCandidates`/`dedupeToKnownRooms`/`routeRoomConfirmation`) is **exact-string comparison** of `getSpaceDisplayName` output (`plan.spaceName?.trim() || plan.spaceType`) against the AI's `suggestedRoomName`. No fuzzy matching, no embedding, no image comparison anywhere in this path.
- Tier-1 merge-candidate clustering (`detectMergeCandidates`) uses the identical exact-string mechanism, one more place.
- `RememberedHomeDesign.md` §5 states this as a known, accepted limitation in its own words: *"No true visual recognition. Matching stays exact-string `getSpaceDisplayName` comparison... Actual image-based room recognition is out of scope entirely — not attempted, not partially built."*
- `analyzePhoto` (`functions/index.js`) and `generateNextAction` **do** send multiple raw photos to Claude in one call today — but only for **prompt enrichment after identity is already known** (Remembered Home's "what's changed since last time" narration, or before/after progress judgment), never for identity *determination*. This is the one live mechanism most directly reusable for Area recognition (Section 6).
- `areaName`/`areaScope` are confirmed plan-level, AI-generated-then-user-confirmed **descriptive** fields (`App.js`, `shared/spaceMigration.js`, two admin scripts). Never queried against, never a matching/dedup key anywhere. Room Detail's own current visit-row rendering explicitly documents this: *"NOT grouped by areaName. areaName is AI-generated."*

**Does not exist at all, confirmed by dependency/lockfile grep:** any content hash, perceptual hash, embedding, checksum, EXIF extraction, or vision-API package beyond the Anthropic SDK already used for `analyzePhoto`/`generateNextAction` and the OpenAI SDK already used only for image *editing* (`generateVisualization`). No such field is stored on any photo document today.

**Conclusion governing everything below:** there is no parallel mechanism to avoid duplicating — Location Reference is real, settled architecture with zero implementation, and every "recognition" mechanism that exists today is text-based. This document activates Location Reference (as Area) and, separately, proposes the first real visual-recognition mechanism this codebase would ever have.

---

## Section 2 — The durable Area object

`[Decision]` **Location Reference becomes the internal representation of Area, exactly as `RoomAndSpaceModel.md` §2 already concluded: "no extension to Location Reference's architectural definition is needed. What's needed is implementation."** This section is that field enumeration.

**Firestore shape:** `users/{uid}/spaces/{roomId}/areas/{areaId}` — a subcollection sibling to the Room's existing `spaces/{roomId}/projects/{projectId}` subcollection, not nested inside it. `[Inference]` Keeping Projects flat (not moved under `areas/{areaId}/projects/`) means every existing query — Room Detail's plan-loading query, `computeRoomSummaryFields`'s `spaces/{spaceId}/projects` scan, `checkMigrationCompletenessAdmin` — is completely unaffected by Area's existence. Minimal blast radius, matching this codebase's own additive-only discipline.

**Fields:**

| Field | Source of truth | Authoritative Area state, or historical/derived? |
|---|---|---|
| `id` | Firestore doc id, assigned at creation, never reassigned | Authoritative — carries identity per Location Reference's own definition ("this ID carries the identity, not any single attribute") |
| `roomId` | Set once at creation, immutable | Authoritative — the ownership invariant (below), never re-derived |
| `displayName` | User-owned, set at first confirmation, changed only via explicit rename | Authoritative — never recomputed from visits, protected exactly like `Space.displayName` already is |
| `createdAt` | Set once at creation | Authoritative |
| `retired` / `redirectTo` / `retiredAt` | Written once by a future Area-merge execution (not built in v1) | Authoritative lifecycle fields, present from day one per this codebase's own "schema stability, activated later" pattern (the exact same pattern Location Reference itself already demonstrates) |
| `latestPhotoUrl` | Recomputed fresh from this Area's own Projects | **Derived/historical-summary** — mirrors `computeRoomSummaryFields` exactly, scoped to `project.areaId === thisAreaId` instead of every Project under the Room |
| `lastOrganizedAt` | Recomputed fresh | Derived, same mirror |
| `visitCount` | Recomputed fresh (never incremented) | Derived, same mirror — same idempotency-by-construction guarantee already proven for `updateSpaceRoomSummary` |

No other fields are genuinely required for v1. A `latestAreaScope`-equivalent isn't needed — once a Project has a real `areaId`, its scope is definitionally "this Area," not something to re-derive.

**Ownership invariant, restated for Area specifically:** an Area always belongs to exactly one Room (`roomId` is required, non-nullable, immutable). An Area can never exist independently of a Room — there is no entry point, in this design or any future one, that creates an Area before its Room exists. This is `RoomAndSpaceModel.md`'s own invariant, inherited verbatim, not re-derived.

---

## Section 3 — Hierarchy: Room → Area → Project → Session → Batch

`[Observation]` Today, `computeShadowIds(planId, plan)` returns `{spaceId, projectId, sessionId}`, and every Project is written with `scopeType: "Space", scopeId: ids.spaceId` — i.e. every Project today is Room-scoped; the Location-Reference-scoped case `ObjectModel.md` §4 already describes has never been written by any code.

`[Decision]` Activate it with the smallest possible additive change: **`Project.areaId: string | null`**, carried straight from `plan.areaId` exactly the way `Project.scopeId` is already carried from `computeShadowIds(...).spaceId`. No path change, no new required field on existing documents, no rewrite of `deriveFullReprojectionDocs`'s core shape beyond adding this one field.

**A plan's Area-identity state is exactly one of three, distinguished by `areaId` + `areaScope`:**

1. **Whole-Room visit.** `areaId` absent/null, `areaScope` absent or not `"sub-area"`. The Project is Room-scoped, full stop — **no fake Area is ever created for this case.** This is `ObjectModel.md`'s already-settled "a Room-scoped Project" concept; Room Detail's own current visit rendering already handles this correctly today (no "Whole room" label rendered at all) and needs no change for this case.
2. **Legacy sub-area visit.** `areaId` absent/null, `areaScope === "sub-area"`, `areaName` present (a descriptive string only). This is every sub-area visit that exists in production today. It stays exactly this way forever unless a human explicitly associates it with a real Area (Section 9/12) — never auto-promoted.
3. **Durable Area-identified visit.** `areaId` present, pointing at a real `spaces/{roomId}/areas/{areaId}` document. `areaName`/`areaScope` may still be carried on the plan for display/history purposes, but `areaId` is now the authoritative link; the Area's own `displayName` is what's shown, not the plan's historical `areaName` string (same "current source wins over historical plan field" rule already established for Room names via `resolveResultsRoomName`).

**Project-scoping rule, inherited unmodified:** a Room may have either one active Room-scoped Project, or several concurrent active Area-scoped Projects (one per distinct Area), never both covering overlapping ground — `ObjectModel.md` §4's own rule, translated. No new logic needed to enforce this; it falls out of the same "does this Room/Area already have an active Project" check the existing flow already performs at the Room level.

Session and Batch are entirely unaffected — they remain Project-owned exactly as today, one level below whichever thing (Room or Area) the Project is scoped to.

---

## Section 4 — Area recognition entry paths

**A. Existing-Area entry (identity established by navigation, mirrors Room's own "Organize Again" exactly).** User opens Room Detail → an Area section → "Organize Again" scoped to that Area. `organizeAgainContext` gains an optional `areaId` alongside its existing `spaceId`. When the resulting plan saves, `savePlanToHistory` gets a new optional `areaId` option — mirroring `canonicalSpaceId`'s exact existing shape (read the target, validate it belongs to the claimed Room, inherit its current `displayName`) — and **Area recognition is skipped entirely**, exactly as Room recognition is already skipped for Room-level Organize Again today. Identity was established by the tap, not inferred.

**B. Generic/new photo within a confirmed Room.** Room identity is already resolved (fresh analysis that just matched/confirmed a Room, or any returning-visit flow that already knows its Room) before this branch is reached — it slots in as a fourth question alongside the existing three-question `roomAreaInstruction` prompt (organizing target → parent room → scope), not a separate screen upstream of Room confirmation.

**Branch point**, evaluated only when `areaScope === "sub-area"` (a whole-room answer skips this entirely, Section 3 case 1):
- If this Room has **zero** existing durable Areas → no candidates to compare against → **create a new Area immediately, no confirmation screen** (Section 7; this is deliberately the same "no-friction first case" Room identity itself already uses for a first-time Room via outcome (c)).
- If this Room has **one or more** existing durable Areas → run recognition (Section 5/6) against exactly those Areas' representative photos, and only those — **never any Area outside this Room**. Present results via the proposal UI (Section 7); the user's answer is what actually sets `areaId`, never the recognition step alone.

---

## Section 5 — Recognition signals, evaluated

| Signal | v1 or deferred | Reasoning |
|---|---|---|
| **Room membership** | **v1 — hard filter, mandatory, not a similarity signal** | Bounds the entire candidate set before anything else runs. This alone is what makes visual comparison tractable and safe — never compares across Rooms, by construction, not by policy. |
| **Visual similarity (today's photo vs. prior Area photos)** | **v1 — the real signal** | The actual mechanism needed to catch "same physical spot, new photo." Section 6 evaluates implementation. |
| **AI-generated `suggestedAreaName`** | **v1 — weak co-signal only, never sufficient alone** | Real evidence this session (`"Display Wall"` / `"Trophy Wall Display"` / `"Entertainment Center"` / `"TV Console & Media Center"`, all the same physical spot) already proves exact-string or even fuzzy-string matching on this field is unsafe as a standalone signal. Useful only as: a plausible default name for a brand-new Area, or a tiebreak/pre-filter alongside visual similarity — never as proof by itself, matching the explicit instruction. |
| **Prior user confirmations** | **v1 — authoritative once given, never re-asked** | Directly mirrors the 2026-08-01 MatchCandidate precedent (`confirmed_same`/`confirmed_different` persist; a `deferred` answer doesn't re-prompt mid-session). |
| **Exact photo fingerprint/asset identity** | **Deferred** | Answers a different, narrower question — "is this literally the same file" (retry/duplicate-submission dedup) — not "is this the same physical place." Low value for the actual product problem; trivial to bolt on later if retry-dedup ever becomes a real issue. |

---

## Section 6 — Visual recognition implementation options

| Approach | Reliability for THIS problem | Cost/latency | Storage | New infra? |
|---|---|---|---|---|
| **Exact content hash** (MD5/SHA256 of bytes) | Catches only byte-identical files — does not solve "new photo, same place" at all | Free, instant | Negligible | None |
| **Perceptual hash** (pHash/dHash) | **Likely inadequate for the real problem.** pHash is built to detect near-duplicate images (recompression, minor crop) — it is not built for "same physical scene, different day, different angle, different clutter state, different lighting," which is exactly this use case. High false-negative risk on the actual target. | Cheap, on-device or in-function, no network call | A few bytes per photo | A small hashing library (new dependency) |
| **Image embedding / vector similarity** | Architecturally the "right" tool — robust to lighting/angle/clutter drift, genuine scene-level semantic match | Needs an embedding-generation call per photo (hosted API or in-function model) plus a similarity computation | A small vector per Area (not per photo) — with only a handful of Areas per Room, cosine similarity over ≤10 stored vectors needs **no external vector database** | A new embedding-generation dependency/API; no vector DB required given the scale |
| **Multimodal AI comparison against a small candidate set** | Good — leverages a modern vision model's actual scene reasoning, which handles the messy-real-world case better than pHash | **Marginal** — this is a mechanical extension of `analyzePhoto`'s already-live `priorPhotoBase64` multi-image mechanism and `generateNextAction`'s already-live 3-image comparison. Can ride the SAME API call already happening for the plan's own analysis, or a lightweight follow-up. | None new — no vector/hash field needed at all, just the Area's existing `latestPhotoUrl` | **None** — zero new dependencies, zero new libraries |

`[Decision]` **Recommend multimodal AI comparison against a small, Room-scoped candidate set, reusing the exact existing multi-image mechanism (`analyzePhoto`'s `priorPhotoBase64` pattern) rather than building anything new.** This is the smallest practical v1 by a wide margin: zero new dependencies, zero new storage beyond a field the Area object needs for display purposes anyway, cost/latency bounded by Room-scoping to a handful of candidate photos, and it is measurably better suited to the actual problem than perceptual hashing. Embeddings are a reasonable future optimization if per-Room Area counts ever grow large enough to make repeated AI-vision calls costly — not justified at v1's expected scale (a Room realistically has a handful of Areas, not hundreds). **No external vector database is warranted at this scale, per the task's own caution — the evidence doesn't support one.**

Privacy/mobile feasibility: identical to the existing `analyzePhoto` call already in production (same photo upload path, same base64-over-HTTPS-to-Anthropic pattern) — no new privacy surface, no new mobile-side processing burden beyond what already ships today.

---

## Section 7 — Proposal UI

Recognition moment, reached only when Section 4B's branch point finds one or more existing Areas in the confirmed Room:

**"Have we worked on this area before?"** — side-by-side LAST TIME / TODAY photos, reusing `BeforeAfterStack`, the same component already used for Room-level recognition confirmation and Merge Review's evidence cards. No new photo-comparison UI component needed.

**Actions**, mirroring Room confirmation's own already-shipped shape:
- **"Yes, same area"** — sets `areaId` to the matched Area, no new Area created.
- **"No, different area"** — if only one candidate was shown, creates a new Area (Section 4B's no-friction path, now reached from a rejection rather than a zero-candidate state). If multiple candidates existed, falls through to "Choose another area."
- **"Choose another area"** — shown whenever more than one candidate exists (or as an explicit escape hatch always). Lists every candidate Area with its own photo, **no auto-select** — directly mirrors the already-shipped Room picker (`openRoomPicker`, "Actually, it's an existing Room").

**No-candidate case** (Section 4B's first branch): creates a new Area immediately, no screen shown at all — the explicit governing rule from the task, and consistent with how a first-time Room already works today.

---

## Section 8 — Naming and user control

`[Decision]` **Once an Area identity exists, its name is user-owned and never automatically replaced by a later AI suggestion — the identical protection `Space.displayName` already has.** `deriveFullReprojectionDocs`'s own field-ownership comment states this principle for Rooms verbatim: *"user-owned (displayName — updated only through the explicit rename path... never through ordinary projection sync — an unrelated Project syncing later with its own stale spaceType/spaceName must never silently revert a rename)."* Area's `displayName` inherits this rule unmodified.

- **Initial name:** the first confirmed suggestion — either the AI's `suggestedAreaName` the user implicitly accepted by confirming "no, different area" / "yes, new area" with that name showing, or a name the user typed explicitly.
- **Rename:** a UI parallel to Room's existing rename pencil, writing **only** `Area.displayName` — never touching any Project or plan's own historical `areaName` field, mirroring `renameSpace`'s exact contract one-to-one.
- **Later AI suggestions:** never overwrite an established Area's name. A later visit's `suggestedAreaName` is descriptive metadata on that visit's own plan only (same as it is for Rooms today) — it may inform which Area gets *proposed* as a match (Section 5), but confirming a match never renames the Area to the new suggestion.

---

## Section 9 — Existing legacy visits

`[Decision]` **Coexist, do not migrate.** Every existing plan with `areaName` but no `areaId` stays exactly as it is, forever, unless a human explicitly associates it with a real Area. This is the identical "additive-only, old documents never rewritten" discipline `RoomAndSpaceModel.md` §3/§4 already committed to for its own analogous Room/Space distinction, applied here without modification.

Using the real evidence already gathered: `"Display Wall"`, `"Trophy Wall Display"`, `"Entertainment Center"`, and `"TV Console & Media Center"` may all describe the same physical spot — or may not. **No automated process, including exact-string matching, ever silently turns any of these into a shared Area identity.** The only path from a legacy `areaName` string to a real `areaId` is explicit human action (Section 12).

---

## Section 10 — Room Detail after durable Areas exist

Directly extends `RoomAndSpaceModel.md` §5's own sketch (2+ Areas trigger, `EvidenceCard`-style rendering — not reinvented here). Once a Room has 2+ durable Areas, its visit list becomes a **three-way partition**, not a two-way one:

1. **Whole-Room visits** — rendered exactly as today, ungrouped, no label (Section 3 case 1).
2. **Durable-Area visits** — grouped under their Area's real `displayName`, each Area its own section: representative photo, date range, visit count, unfinished-work indicator (mirroring the Room's own summary-field pattern, scoped to that Area). Tapping opens **Area Detail** — structurally a smaller mirror of Room Detail itself: header, photos, unfinished-work CTA, "Organize Again" scoped to just this Area, prior-visits list for this Area only.
3. **Legacy descriptive-only visits** — continue to render flat and ungrouped, exactly as the already-shipped "no grouping by areaName" Room Detail behaves today (Section 9's coexistence rule in practice).

A Room with 0 or 1 durable Area shows none of this — the current, already-shipped flat list, unchanged. This is `RoomAndSpaceModel.md` §5's visibility trigger, unmodified.

---

## Section 11 — Interaction with existing systems

- **`canonicalSpaceId`** — unaffected. Area sits strictly below Room; Room resolution (`computeShadowIds`) never depends on whether an Area is also identified.
- **Shadow Synchronization** — one additive field, `Project.areaId`, carried from `plan.areaId` exactly as `Project.scopeId` is already carried from `computeShadowIds(...).spaceId`. No other change to `deriveFullReprojectionDocs`'s shape.
- **Room summary fields (`computeRoomSummaryFields`)** — unaffected. Continues to summarize across every Project under the Room regardless of `areaId`, so the Room's own aggregate status stays meaningful even once Areas exist — `RoomAndSpaceModel.md` §1's own explicit answer to "can a Project belong to the whole Room," unchanged.
- **`reclassifyLegacyPlan`** — Case A/B operate at the Room level only. An eventual Area-level equivalent ("move this visit to a different Area in the same Room," or across Rooms) is out of v1 scope, but the *structural pattern* — durable execution record, phased idempotent functions, an explicit self-move guard — is the template to reuse when it's built, not something to design fresh.
- **Room merge execution (`executeMerge.js`)** — `[Decision]` when two Rooms merge, their Areas are **not** auto-merged even if two look similar — the governing principle applies at every level, not just Room level. Concretely: reprojection already carries every confirmed plan's fields through to the survivor Room; once `areaId` exists, it rides along for free, meaning the survivor Room simply ends up with the union of both Rooms' Area sets. No new code needed in `executeMerge.js` itself.
- **Room deletion (Phase C, not yet built)** — `[Decision — flagged, not resolved here]` a real Room-delete implementation must also delete or tombstone that Room's Areas, or it recreates exactly the orphaned-Space problem just cleaned up this session (`seed-garage-2`). **Area v1 does not require Phase C to exist, but Phase C's eventual scope must explicitly include Area cleanup once Area v1 has shipped.**
- **Plan deletion (`deletePlan`)** — today, deleting a Project triggers a Room summary recompute if the Room survives. Once Areas exist, it must also recompute the *owning Area's* summary the same way (if `plan.areaId` was set), via an `updateAreaSummary` mirroring `updateSpaceRoomSummary`. **Open question, not resolved here:** should an Area whose last visit was just deleted (now `visitCount: 0`) persist as a dormant, named Area, or be removed? Recommend persisting (never auto-delete a user-confirmed, user-named object — the same "nothing lost" principle, and consistent with how a Room isn't auto-deleted for having zero remaining visits either) — but this deserves explicit product confirmation before building, not treated as silently settled.
- **Companion carry-forward** — unaffected. It already operates per-plan off `currentBatch`/unresolved-item status, never per Room or Area.
- **Results** — `[Decision]` extend `resolveResultsRoomName`'s exact pattern: once `plan.areaId` is set, Results' existing sub-area subtitle line (`results.areaName && results.areaScope === "sub-area"`) should source from the durable Area's current `displayName`, not the plan's historical `areaName` string — same "current source wins over historical field" rule already governing the Room-name heading.
- **Rename Room** — unaffected; only ever touches `Room.displayName`. Area rename is independent (Section 8).
- **Future "Correct Room"** (scoped in an earlier pass, not yet built) — `[Decision — flagged for that design to account for]` because Area is strictly Room-owned, a Room correction that moves a plan into a *different* Room **must** clear that plan's `areaId` — the old Area cannot follow across the ownership boundary. The plan re-enters Area recognition fresh in its new Room, same as a brand-new photo there. This doesn't need building now (Correct Room isn't built either), but the two designs must agree on this consequence.

---

## Section 12 — Migration / backfill strategy

`[Decision]` **New code owns future correctness. Migration repairs the past, if and when a human decides to run it. User identity decisions are never manufactured.**

- New plans get `areaId` from day one, via Section 4's two entry paths only.
- Historical plans (`areaName` string, no `areaId`) are **never** auto-migrated or auto-associated — no backfill script, no exact-string grouping, no fuzzy matching. This is `RoomAndSpaceModel.md` §3/§4's own explicit "no backfill" default for its analogous case, applied identically here.
- **Manual legacy association** (in v1 scope, Section 13) is the *only* path from an old `areaName` string to a real `areaId` — an explicit human decision (the user, or an operator running a human-reviewed tool), never an automated heuristic acting alone. `RoomAndSpaceModel.md` §4 already modeled the right shape for this kind of decision: heuristics may *propose* a grouping for review, they must never *assert* one silently for the ambiguous cases — and per Section 9's real evidence, sub-area labels are exactly this ambiguous.

---

## Section 13 — v1 scope boundary

**In scope**, all designed above: durable Area object (Section 2), existing-Area Organize Again (Section 4A), photo-assisted proposal inside a known Room (Sections 4B, 5, 6, 7), user confirmation as the only thing that establishes identity (Section 5/7's governing rule), visits rolling up under one Area once confirmed (Section 3), Area rename (Section 8), manual legacy association (Section 12).

**Deferred, explicitly not designed further here:** whole-home visual search (recognition never crosses Room boundaries in this design, full stop), automatic Area merging (Areas may gain `retired`/`redirectTo` fields per Section 2, but no write path uses them in v1), cross-Room recognition, a semantic home map, and any automatic backfill from AI guesses (Section 12).

One structural note carried forward from Section 11: Area's schema includes lifecycle fields (`retired`/`redirectTo`/`retiredAt`) whose write paths aren't exercised until Room-merge/Room-deletion consequences are actually built — the same "additive field, activated later" pattern Location Reference itself already demonstrated for eighteen months before this document. This is intentional, not scope creep.

---

## Section 14 — Required staging evidence

To be run once implementation exists (none of this is built yet):

1. Two visits to the same Area (via Section 4A, Organize Again) roll up under one Area — `visitCount: 2`, one Area document, not two.
2. Two visits to genuinely different areas are never auto-merged, even when their AI labels are textually similar.
3. The same physical Area, revisited with a different AI-generated label than last time, is still *proposed* as a match via visual comparison (Section 6/7) — proving `suggestedAreaName` alone is correctly not required for a correct proposal.
4. Two different physical Areas that happen to share the same AI label remain two separate Areas — proving string-label equality is correctly not used as the matching key.
5. Existing-Area Organize Again (Section 4A) bypasses the recognition/proposal flow entirely — no screen shown, `areaId` set directly by navigation.
6. Generic/new photo in a Room with existing Areas → proposal shown → user confirms → correct `areaId` written, correct Area summary recomputed.
7. A whole-Room visit creates no Area document at all, under any condition.
8. Renaming an Area does not rewrite any historical plan's own `areaName` field, and does not retroactively change what any past visit's Results screen showed at the time.
9. A legacy visit (real production example: `"Display Wall"` vs. `"Trophy Wall Display"`) can be manually associated with a real Area without touching any other plan.
10. Room Detail groups visits by durable `areaId`, never by `areaName` string — two visits with identical `areaName` but no shared `areaId` render as separate, ungrouped legacy entries, not one group.
11. Retrying the "confirm same Area" action (network retry, double-tap) never creates a duplicate Area for the same confirmed match.

---

## Cleanup performed this session

Before this scoping pass: `seed-garage-2`, an orphaned Space (`displayName: "Garage"`) for uid `ZYe7h9hM25UB7Pk6YRbPysg2cGC3` on `cluttrd-staging`, was deleted. Verified read-only first (no matching plan document, no plan with `canonicalSpaceId` pointing at it — genuinely orphaned leftover seed data, not a live Room), then its one leftover Project subdocument and the Space document itself were deleted. Post-delete read confirmed removal. No other document touched.
