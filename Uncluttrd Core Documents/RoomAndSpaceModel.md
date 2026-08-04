# Room and Space Model

Status: Draft
Version: 0.1 (2026-08-04)
Audience: Everyone who builds Uncluttrd, especially anyone touching AI output format, the Home screen recognition flow, or the Room Detail screen
Purpose: Locks the foundational user-facing nouns (Room, Space) and maps them onto the existing architecture (ObjectModel.md) and the existing code (`shared/spaceMigration.js` and friends), before more production data accumulates under an unlocked vocabulary.
Depends on: ObjectModel.md (Space, Project, Location Reference), RememberedHomeDesign.md (Room-facing product language, already shipped), SpaceMemoryModel.md

Notation as established in this codebase's other design docs: `[Observation]` (verified against current source), `[Inference]` (reasoning from observations), `[Decision]` (a choice made).

---

## 0. A naming collision, named explicitly before anything else

**This document uses the word "Space" to mean something the rest of the codebase does not.**

- In the **code** (`shared/spaceMigration.js`, the Firestore `spaces` collection, `canonicalSpaceId`, `spaceType`, `spaceName`, `getSpaceDisplayName`) and in **ObjectModel.md** (the `Space` object, Section 4), "Space" means the top-level saved organizing target — one per real-world room. That concept is now called **Room** in every place a user sees it (My Rooms, Rename Room, "these rooms currently share the name..." — the rename shipped and is committed).
- **In this document**, "Space" means something smaller and not yet built: a specific sub-area *within* a Room (a coffee station, an under-sink cabinet, a workbench). This is a new sense of the word, introduced here for the first time.

These are two different concepts sharing one word, in two different eras of this codebase's documentation. `[Decision]` Not resolved by renaming either one — the code's internal `Space` naming (collection name, field names) is exactly the kind of implementation detail this project's own convention leaves alone once it's shipped and working (see every migration this session: `canonicalSpaceId`, `spaceType`, `getSpaceDisplayName` all stay as-is, deliberately, even after the user-facing rename to Room). Instead: **going forward, new product/design prose should say "Room" for the top-level object and reserve bare "Space" for the sub-area concept this document defines** — the collision only bites when a reader mixes an old document's "Space" (= Room) with this document's "Space" (= sub-area) without noticing which one is in play. Anyone citing `spaceType`/`canonicalSpaceId`/etc. directly is citing a code identifier, not using the product noun, and should read it as such.

---

## Section 1 — Define the concepts

### Room

- The physical place: kitchen, garage, dining room, home office.
- One Room per distinct physical room.
- The top-level saved object a user sees. Every screen already shipped this session (My Rooms, Room Detail via "Organize Again," rename, merge review) operates at this level.
- Maps 1:1 onto the code's existing `Space` object (Firestore `spaces` collection) — no new object, no migration. See Section 2.

### Space (sub-area)

- A specific area *within* a Room: a coffee station, an under-sink cabinet, a workbench, a closet shelf.
- One Room may contain many Spaces.
- **Not yet visible to users.** No UI surfaces this today; no field on any plan document distinguishes it from the Room itself today.
- Maps 1:1 onto ObjectModel.md's `Location Reference` object — Settled at the architecture-document level, never implemented, never activated. See Section 2.

### When does a Space become visible?

`[Decision]` Only when a Room contains **2 or more** distinct, user-confirmed or AI-identified sub-areas. A Room with zero or one identified sub-area shows nothing extra — the user just sees the Room, exactly as today. This mirrors the same threshold logic already used elsewhere in this feature set (a merge candidate cluster needs 2+ plans before it's shown at all — a single plan never proposes anything about itself).

### Can a Project belong to the whole Room?

**Yes — and this is not a new decision.** `[Observation]` ObjectModel.md's `Project` object already settles exactly this, under its own "Space" vocabulary (= this document's Room): *"A Space may have either one active Space-scoped Project, or several concurrent active Location-Reference-scoped Projects (each covering a distinct Location Reference within that Space), but never both simultaneously covering overlapping ground."* (ObjectModel.md §4, Project). Translated into this document's nouns: **a Room may have either one active Room-scoped Project, or several concurrent active Space-scoped Projects (one per distinct sub-area), never both on overlapping ground.**

`[Inference]` This is precisely "the hierarchy collapses" rule the task asked me to define — ObjectModel.md already defined it, eighteen months of architecture-doc-time before this document, for a reason unrelated to Remembered Home (it was written to let a broad first-time Kitchen effort later narrow into a focused Coffee Station effort, per ObjectModel.md's own rationale). Locking Room/Space onto Space/Location-Reference means this feature **inherits that rule for free** rather than needing its own version of it.

### Ownership invariant

**A Space cannot exist without a Room. A Room may exist without any visible Spaces.**

This answers three questions directly:
- **Can someone create a Space first?** No. A Space is Room-owned (Section 2's `Location Reference` mapping carries this — "a Space-owned identity" — not an independent object with its own creation path). There is no entry point, today or planned, that creates a sub-area before the Room it belongs to exists.
- **Can a Room have zero Spaces?** Not truly zero — internally, a Room always has one implicit organizing area (the whole room, undifferentiated), which is what every Project scoped to the Room itself already operates on. The UI simply hides this implicit Space until there's a second one to distinguish it from — "zero Spaces" is a UI statement, not a data statement. This is consistent with Section 3's `spaceName: null` case: a null sub-area name doesn't mean "no Space," it means "the Space is the whole Room, unnamed because undifferentiated."
- **When does the Space layer appear?** Only once a second, distinct, meaningful Space exists — restating Section 1's 2-or-more trigger from the ownership side rather than the visibility side: the layer isn't "turned on," it becomes worth *showing* once there's more than one thing for the user to distinguish between.

---

## Section 2 — Map to existing architecture

| This document | ObjectModel.md | Code (`shared/spaceMigration.js` and callers) |
|---|---|---|
| **Room** | `Space` (§4) | Firestore `spaces` collection; `canonicalSpaceId`, `spaceType`, `spaceName`, `getSpaceDisplayName()` |
| **Space** (sub-area) | `Location Reference` (§4) — Settled, never activated | Does not exist. No collection, no field, no query. |
| **Project, Session, Batch** | Unchanged | Unchanged (`Project`/`Session`/`Batch` shadow documents, already shipped) |

### Is Location Reference, as defined, sufficient?

`[Decision]` **Sufficient as an object definition; not yet sufficient as an implementation, because it was never given fields or activated — which is expected, not a gap.**

Checked point by point against ObjectModel.md §4:
- *"A Space-owned identity for a recurring, user-recognizable sub-location."* — matches exactly: a Space (this doc) is Room-owned, and "recurring, user-recognizable" is precisely what distinguishes a real sub-area (the coffee station you organize every few months) from a one-off framing choice in a single photo.
- *"Has a stable internal ID; this ID carries the identity, not any single attribute."* — matches Section 1e's own existing discipline (a rename never breaks identity elsewhere in this codebase); no extension needed.
- *"May be recognized through spatial, functional, visual, content-based, or user-provided evidence — not keyed to any one anchor."* — matches: the future `spaceName` AI field (Section 3) is one instance of "content-based evidence," not the only mechanism this object was designed to support. Nothing here needs to change to accommodate that field.
- *"Does not require promotion into an independent Area object."* — directly confirms this document's approach: Space (sub-area) does not need to become its own top-level saved thing, the way Room is. ObjectModel.md §8 separately, explicitly rejected a standalone `Area` object for this exact reason ("the demonstrated requirement is satisfied by a Space-owned Location Reference").

What's genuinely missing, and why it's not a defect in Location Reference's definition:
- **No field enumeration.** ObjectModel.md states behavior, not a field list (contrast Session, which gets `id`, `projectId`, timestamps, `status` explicitly). When Location Reference is actually built, it will need at minimum a stable id and a display name — a small, mechanical extension, not a conceptual one.
- **No UI visibility threshold.** ObjectModel.md's own stated purpose (§1) is explicit that it "does not define how these objects behave over time" or at the UI layer — the 2-or-more trigger (Section 1, above) is exactly the kind of product-layer decision ObjectModel.md correctly leaves to a document like this one, not something missing from it.
- **Lifecycle is already flagged open, inherited as-is.** ObjectModel.md §9 already lists "Location Reference lifecycle: what makes a reference inactive... whether it can reactivate, and whether reappearance reactivates the same identity or creates a new one" as an open question. This document does not resolve it — it's explicitly Build Later (Section 6).

**Conclusion: no extension to Location Reference's architectural definition is needed. What's needed is implementation (fields, Firestore shape, activation) — deferred to Section 6.**

---

## Section 3 — AI output format (future target, not implemented yet)

**Current:** one field, `spaceType` — a single free-text label ("Kitchen" or "Kitchen Counter Workspace" indiscriminately, whichever the model happens to produce).

**Future target:**
```json
{ "roomType": "Kitchen", "spaceName": "Counter Workspace" | null }
```
`spaceName` is explicitly nullable — a photo of a whole, undifferentiated room should produce `roomType` with `spaceName: null`, not an invented sub-area name. The prompt would need to say this directly (something like: "only set spaceName if the photo clearly shows one specific, nameable sub-area rather than the room as a whole") — otherwise the model will do what LLMs do with an optional-looking field and fill it in more often than the room actually warrants, silently manufacturing sub-areas that don't deserve to exist. This is the same "don't let the model assert more than it can support" discipline already applied to every existing prompt in this codebase (e.g. `analyzePhoto`'s own "verify the specific problem is genuinely visible... not a common decluttering trope").

**When should this ship?** `[Decision]` **Not until the Space (sub-area) UI itself is being built — not before.** Shipping the two-field format earlier would mean writing `roomType`/`spaceName` to new plan documents that nothing yet reads, and — worse — creates exactly the situation Section 4 has to untangle for the *old* single-label data, except for newly-created data instead. There is no benefit to having the field early; there is a real cost (undefined behavior for what `spaceName` even means before Section 5's visibility rule exists to consume it). Ships as one unit with the visibility trigger, not ahead of it.

**What happens to existing single-label plans?** `[Decision]` **Nothing. No backfill, no migration, no schema change to old documents.** `spaceType` stays on every existing plan exactly as it is today, forever — this is the same additive-only discipline this session has applied to every other schema change (`canonicalSpaceId`, `shadowSourceVersion`, `migrationVersion`): old documents are never rewritten to fit a new shape. `getSpaceDisplayName`-equivalent logic for a plan created before this ships simply has no `roomType`/`spaceName` fields to read and falls back to `spaceType`, exactly as it already does today for every plan that predates *this* feature. A plan is never retroactively reinterpreted by code — only, optionally, by the human-reviewed process in Section 4, and only if that process is ever actually run.

---

## Section 4 — Existing data interpretation

`[Observation]` I ran a fresh, read-only query against production (`cluttrd-3e335`) rather than rely on an earlier figure cited elsewhere in this session ("159 plans/16 users") — that count no longer matches current production state (likely due to merges and deletions since it was taken). **Current real count: 71 plans, 56 distinct display-name labels**, across all users. No writes were made; this was a plain read across `users/*/plans`.

Categorizing a representative sample of the real labels found:

**Clearly Rooms** (a recognized room-type noun, standing alone, no fixture/zone qualifier):
`Living Room` (5), `Home Office` (3), `Bathroom` (2), `Basement Storage Area` (2), `Entryway`, `Laundry/Utility Room`, `Sunroom / Enclosed Porch`, `Commercial Restroom`.

**Clearly sub-areas** (a room-type root plus a specific fixture/zone noun):
`Bathroom Cabinet Under Sink` (3), `Home Office Workstation` (3), `Living Room Corner` (3), `Kitchen Counter & Windowsill`, `TV Console & Media Center`, `Bathroom Linen Cabinet`, `Bedroom Corner Storage Area`, `Kitchen Island Workspace`, `Bathroom Vanity & Countertop`, `Home Office Desk`.

**Ambiguous** (genuinely unclear without seeing the photo, or outside the model entirely):
`Living Room / Multi-Purpose Space` (the AI's own label literally contains the word "Space," unprompted — a small, telling data point that this ambiguity is native to how the model already talks about rooms, not something this document is inventing), `Bedroom Closet` / `Overflowing Walk-In Closet` (closets vary from room-scale to shelf-scale in reality), `Retail Beauty Display`, `Retail Candle Display`, `Restaurant Service Station`, `Restaurant Bar Area` (commercial contexts don't map cleanly onto a household "room" at all), `Outdoor Patio Dining Area`, `Outdoor Fire Pit Area`, `Exterior Front Yard & Entry` (outdoor areas have no clean indoor-room analog to anchor "whole Room vs. sub-area" against), `Two-Story Entry & Living Area` (spans multiple physical rooms/levels — doesn't fit *either* Room or Space; ObjectModel.md's rejection of a standalone `Area` object means this case has no defined home at all yet), `Community Entrance Landscaping` (not a private household room in any sense the model assumes elsewhere).

Roughly a third of the real distinct labels fall into this last bucket — not a rounding error, a real, sizable minority.

**Can interpretation be automated, or does it require user confirmation?**

`[Decision]` **A heuristic can safely auto-classify the clear majority; the ambiguous minority must not be silently auto-classified.**

- **Auto-classify as Room:** label is a bare recognized room-type noun (optionally with a simple location modifier like "Front" or "Basement"), no fixture/zone qualifier attached.
- **Auto-classify as sub-area of an existing Room:** label structurally decomposes into `[recognized room-type root] + [fixture/zone noun from a closed-ish vocabulary: Cabinet, Corner, Counter, Console, Nook, Shelf, Display, Workstation, Desk, Vanity, Drawer, Windowsill, Station, Island]`, **and** a Room with that root type already exists for the same user. Absent that second condition, don't guess which Room it belongs to.
- **Everything else — commercial/retail context, outdoor areas, multi-room spans, closets, or a label the heuristic can't decompose — requires either a new, explicit AI reclassification pass (asking directly, structured, the way the future prompt in Section 3 will) or user confirmation before being assigned a category.** `[Inference]` This is the governing principle (RememberedHomeDesign.md) applied one layer down: automated interpretation may *propose* a category, it must never *assert* one for the ambiguous third of real data — silently mis-sorting "Restaurant Bar Area" as a Room or a sub-area of some invented "Restaurant" Room would be exactly the kind of false confidence this whole feature set exists to avoid.

This interpretation work is **not scheduled** — it only matters if/when the Space layer is actually built and someone decides existing plans should be retroactively categorized rather than simply starting clean from the ship date forward (also a legitimate option, and arguably the simpler one, given Section 3's "no backfill" default). Locking the *plan* here, not committing to running it.

---

## Section 5 — When the Space layer becomes visible

**Trigger:** exactly Section 1's rule, restated as a UI condition — a Room's Room Detail screen shows Space-level UI only once that Room has 2 or more distinct Spaces (sub-areas), each either explicitly user-confirmed or AI-identified with enough confidence to display (a decision this document doesn't need to fully specify — it inherits whatever confidence bar Section 3's future prompt sets).

**One Space, or none identified — collapsed:** the user sees exactly what they see today. Room Detail (already shipped: photo, name with rename pencil, status, history, "Organize Again") shows no sub-area chrome anywhere. This is the current, default, and by far most common state for the real data surveyed in Section 4.

**Two or more Spaces — visible:** `[Decision, design sketch only — not an implementation spec, per Section 6]` Room Detail gains a new section, a list of the Room's Spaces (e.g., "Coffee Station," "Under-Sink Cabinet"), each rendered the way Merge Review's own `EvidenceCard` already renders a plan today (photo, name, one-line status) — reusing an established visual pattern rather than inventing a new one. Each Space in the list behaves as its own lightweight sub-home: its own status, its own "Organize Again"-equivalent action scoped to just that sub-area's own Project, nested one level under the Room it belongs to. The Room itself keeps its own aggregate status and its own "Organize Again," which — per Section 1's "can a Project belong to the whole Room" answer — remains meaningful even after Spaces exist, as long as no Space-scoped Project is currently active on overlapping ground.

---

## Section 6 — Lock now vs. build later

**Lock now:**
- Noun definitions (Section 1): Room = the physical place, one per real-world room, the user's top-level saved object. Space = a sub-area within a Room, not yet visible, visible only once a Room has 2+ identified sub-areas.
- Architecture mapping (Section 2): Room = ObjectModel.md's `Space` = code's `Space`/`spaces` collection. Space (sub-area) = ObjectModel.md's `Location Reference`, confirmed sufficient as an object definition, not yet implemented.
- Future AI output format decision (Section 3): `{ roomType, spaceName: string | null }`, ships only alongside the visibility trigger, never before it; zero backfill of existing `spaceType`-only plans.
- Data interpretation plan (Section 4): heuristic auto-classification for the clear majority, mandatory confirmation (human or a new explicit AI pass) for the ambiguous minority — never silent automation for the ambiguous case. Not scheduled to run.

**Build later:**
- Sub-area UI (Section 5's Room Detail Spaces list — sketched, not specified).
- AI prompt changes (Section 3's two-field format — the actual prompt wording, especially the "only set spaceName when it's clearly warranted" instruction, needs its own design pass when this is actually built).
- Location Reference activation — turning a Settled-but-inert ObjectModel.md object into real Firestore documents, fields, and queries. Explicitly deferred; this document takes no position on collection shape, IDs, or write paths for it.
- Location Reference's own already-flagged open question (ObjectModel.md §9: lifecycle, reactivation) — inherited, not resolved here.

---

## Relationship to other documents

- **ObjectModel.md** — defines `Space`, `Project`, `Location Reference` at the architecture level; this document maps user-facing nouns onto those objects without amending them.
- **RememberedHomeDesign.md** — the already-shipped Room-facing product language (My Rooms, Organize Again, recognition) this document's "Room" term is consistent with throughout.
- **SpaceMemoryModel.md** — Durable Memory categories, referenced but not restated here.
