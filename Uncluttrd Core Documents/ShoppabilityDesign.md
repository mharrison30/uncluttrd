# Product Shoppability — Scoping Pass (2026-08-10)

> **Superseded by ApproachSelectionDesign.md and ProductIntelligenceDesign.md. Retained as
> historical context for the evolution from tier-based products to approach-based
> recommendations.**
>
> Committed 2026-08-12 as a historical artifact. Where this document and the current
> approach-based architecture disagree, the current architecture and the shipped
> implementation are authoritative.

Read-only design investigation. No implementation in this pass. Every code reference below was
read directly from `App.js`/`functions/index.js`, not assumed.

Guiding principle (repeated here because it should govern every judgment call below): **Uncluttrd
doesn't sell products. It recommends solutions for your home, and when a solution requires a
product, it helps you find the right one.** Problem → solution → product, never product → sale.

---

## Section 1 — Current state audit

### 1a. What the AI currently returns

The full prompt is built client-side in `App.js`'s `analyze()` (the prompt template literal,
`App.js:5430`) and sent to the `analyzePhoto` Cloud Function (`functions/index.js:113`), which
does no prompt construction of its own — it's a thin Anthropic-calling shell. The JSON schema
demanded of the model, quoted verbatim from the prompt's own tail:

```json
{
  "suggestedRoomName": "short label, e.g. Living Room",
  "suggestedAreaName": "short label for the specific zone/fixture shown, or null if whole-room",
  "areaScope": "whole-room, sub-area, or ambiguous",
  "roomReason": "one short phrase citing specific visible evidence for the room classification",
  "areaReason": "one short phrase justifying the areaScope classification",
  "overview": "2 warm sentences",
  "itemsFound": ["3-6 specific items or clutter types you can actually see in the photo"],
  "firstActionBatch": ["one or two warm sentences describing one doable-right-now step", "..."],
  "tiers": [
    {
      "id": "budget", "label": "Budget", "range": "Under $50",
      "suggestions": ["tip1", "tip2", "tip3", "tip4"],
      "products": [
        { "name": "product", "price": "$X", "searchQuery": "search", "icon": "📦" },
        { "name": "product", "price": "$X", "searchQuery": "search", "icon": "🗂️" },
        { "name": "product", "price": "$X", "searchQuery": "search", "icon": "🏷️" }
      ]
    },
    { "id": "mid", "label": "Mid-Range", "range": "$50-$200", "suggestions": [...4 tips], "products": [...3] },
    { "id": "premium", "label": "Premium", "range": "$200+", "suggestions": [...4 tips], "products": [...3] }
  ],
  "proTip": "one expert insight"
}
```

The prompt also explicitly instructs the model on **per-tier budget math** ("the three suggested
products must collectively ADD UP to fall within that tier's price range... Check your math
before responding") — this entire instruction block disappears in the new model, since there is
no price and no tier.

Confirms the user's framing exactly: **3 tiers × 3 products = 9 products**, each with
`name`/`price`/`searchQuery`/`icon` (icon is a raw emoji chosen ad hoc by the model, not a fixed
vocabulary).

Two fields already live **outside** the tier structure, at the top level of the response:
- `itemsFound` — a flat list of 3-6 visible clutter items/types. This is the closest existing
  analog to the new `problemsFound`, but it's unstructured (no `id`, no per-item reasoning) and
  is really "what's in the photo," not "what's wrong and needs a solution." `problemsFound`
  (Section 2) supersedes it conceptually, though `itemsFound` may still have independent value as
  a plain observation list — see Section 7.
- `firstActionBatch` — the "doable-right-now" checklist that becomes the plan's `currentBatch`
  and drives the entire Companion flow. **This is already fully independent of the tier system**
  — it does not live inside `tiers`, was never product-shaped, and needs zero changes for this
  redesign. Worth stating plainly: the checklist/Companion pipeline is not entangled with the
  shopping redesign at all.

### 1b. How products are rendered on the Results screen

`App.js:8924-9002`, inside the Results screen (`results && !showCompanion`). Each of the three
`results.tiers` entries renders as a `View` card (`s.tcard`):
- A header row: tier icon (`TIERS` constant, `App.js:2252-2256` — `Check`/`Sparkles`/`Diamond`
  lucide icons with per-tier brand colors), a colored pill with the tier label, the price range,
  and a "⭐ Best Match" or "✓ Your Choice" badge depending on the user's pre-analysis tier
  selection (`getBestMatch()`, `App.js:5834`, and the `tier` state set on the Home screen — see
  the "pre-analysis tier picker" finding below).
- `t.suggestions.map(...)` — each of the 4 tips rendered as a checkmark row (`s.step`), styled as
  organizing advice, no product/price attached.
- A `"SUGGESTED PRODUCTS"` label, then `t.products.map(...)` — each product a tappable row
  (`s.prodRow`): emoji icon, name, price, chevron.
- An **AI Visualization** block, keyed by `t.id` (`App.js:8966-8999`) — "See the transformation"
  (Pro-gated), which calls `generateVisualization(tier)`.

### 1c. What happens when the user taps a product

`App.js:8956` → `openProduct(p.searchQuery)` → `App.js:5810`:

```js
const openProduct = (q) => Linking.openURL(`https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=uncluttrd20-20`);
```

An Amazon **search** (not a deep link to a specific listing), opened externally via
`Linking.openURL`. An analytics event (`product_clicked`) fires first.

### 1d. How products are stored on the plan document

`savePlanToHistory` (`App.js:4385`): `tiers: plan.tiers` — the entire nested tier array
(suggestions + products, all 3 tiers) is written **verbatim, unnormalized**, directly onto the
plan document at `users/{uid}/plans/{planId}`. No separate `products` collection, no
normalization, no id assignment beyond what the AI itself returned. The shadow Project/Session/
Batch graph (`deriveFullReprojectionDocs`, `shared/spaceMigration.js`) never touches `tiers` at
all — confirmed by reading it — so the Room/Area/shadow-summary system has zero coupling to the
product system today. Good news for the redesign: nothing in `hardDeleteRoomAdmin`,
`updateSpaceRoomSummary`, merge/reclassification, or any Phase C deletion work needs to change.

### 1e. Affiliate tracking

Yes — confirmed in the `openProduct` URL above: `&tag=uncluttrd20-20`, a hardcoded Amazon
Associates tag. No other affiliate mechanism exists (no per-product/per-tier tracking id, no
click-through logging beyond the `product_clicked` analytics event).

### 1f. Non-product value audit of the tiers — the required determination

**Yes, real non-product value exists inside the tiers, and it would be silently discarded if the
tier cards are simply deleted.** Two genuinely distinct things currently live inside each tier
object:

| Field | What it is | Fate under the new model |
|---|---|---|
| `tiers[].suggestions` (4 per tier, 12 total) | Free-text organizing tips, phrased as advice, no product attached. Independent of `firstActionBatch` (the Companion checklist) — this is a *second*, budget-flavored set of tips, never surfaced anywhere else. | **Must not be silently dropped.** See recommendation below. |
| `tiers[].products` (3 per tier, 9 total) | The pricing matrix being replaced. | Replaced by 0-4 `recommendations` (Section 2). |

**Where the tiered organizing advice should live in the new Results experience**: fold it into a
single, tier-free "Organizing Tips" or "More Ways to Improve This Space" section, deduplicated
and reworded as one flat list rather than three budget-bucketed lists of near-duplicate advice
(direct inspection of real tier output shows meaningful overlap between a "budget" tip and a
"mid-range" tip describing the same underlying idea at different price points — once price is no
longer the organizing axis, that redundancy naturally collapses). Concretely: the AI prompt no
longer needs to generate three *separate* 4-tip lists; it should generate **one** organizing-advice
list not conditioned on budget at all. This content is genuinely useful and user-facing-tested
(it's been live in the product), so it should be **preserved, not removed** — see Section 7/8 for
the concrete replacement.

**Two additional dependencies found during this audit, not asked for in the task's own checklist,
but directly relevant to scope:**

1. **AI Visualization ("See the transformation") is generatively driven by tier content.**
   `generateVisualization(tier)` (`App.js:5713-5733`) builds its image-edit prompt directly from
   `tier.suggestions.join(". ")` and `tier.products.map(p => p.name).join(", ")` — "apply these
   specific changes: {suggestionList}... Add these storage solutions: {productList}." Visualization
   is currently rendered **once per tier** (`vizImage[t.id]`, three independent buttons/images per
   plan). Once there's a single organizing-advice list and 0-4 recommendations instead of three
   tiers, there is no longer a natural "one per tier" anchor. **This needs its own design decision
   before implementation** — the two reasonable options are (a) one visualization per plan, built
   from the flat advice list + all recommended `productType`s combined, or (b) keep it keyed to
   something else entirely. Flagged here as a real, concrete dependency this redesign surfaces;
   not resolved in this pass since visualization redesign wasn't asked for, but it cannot be
   ignored during implementation.
2. **The pre-analysis "Choose Your Budget Level" screen** (`App.js:9332-9352`, part of the Home/
   upload flow, *not* Results) is a whole separate UI surface built entirely around the tier
   system — three tier buttons (`TIERS.map`) plus an optional exact-dollar `budget` text field,
   both feeding `tier`/`budget` state that today only exists to (a) pick which tier gets the "Your
   Choice"/"Best Match" badge on Results and (b) drive the prompt's `budgetNote`
   ("Highlight which tier best fits their budget, but still show all three" vs. "Show all three
   tiers"). **Every consumer of `tier`/`budget` state is tier-shaped.** Once tiers are gone from
   Results, this entire pre-analysis screen section becomes vestigial — it has no destination
   left to feed. This is squarely in-scope for "replace the tier system," even though the task's
   own section headers only mention "the Results screen." Recommend removing this section from
   the Home screen entirely in the same pass that removes tier cards from Results (or, at minimum,
   explicitly deciding to keep a bare optional budget field with no tier picker) — left as an
   explicit open decision for the implementation pass, not resolved here.

**Three additional current consumers of `results.tiers`, beyond the Results screen itself** (all
would break or render blank/wrong if `tiers` simply disappears from new plans without a
compatibility path):
- **PDF export** (`App.js:5641-5699`, Pro feature) — `buildTier()` renders each tier as an HTML
  block; the 2-page PDF layout is literally built around 3 tiers (page 1: budget+mid, page 2:
  premium+proTip).
- **Native share** (`shareResults`, `App.js:5812-5828`) — plain-text share message iterates
  `results.tiers` to build the shared text.
- **FAQ copy** (`App.js:7768`) — a static FAQ entry explaining "the difference between the budget
  tiers." Not a functional dependency, just user-facing copy that will read as stale once tiers
  are gone from new plans; a documentation-only follow-up, not a data-model concern.

---

## Section 2 — New product recommendation model

Replaces the 3×3 tier/product matrix with **0-4 contextual recommendations**, each grounded in a
specific problem the AI actually identified in the photo.

**Governing rule, stated as strongly as the task states it: returning zero recommendations is a
successful outcome, not a fallback or an error state.** The AI must never invent a purchase to
populate the section. 2-4 recommendations should be typical only when the photo shows genuine,
identifiable purchase opportunities; a well-organized space, or one whose problems are purely
"rearrange what you already have," should return `recommendations: []` and nothing about the UI
should treat that as incomplete.

### Recommendation shape

```json
{
  "productType": "Cable Management Box",
  "reason": "Hides the power strip and loose cords behind your TV console.",
  "searchTerms": "large cable management box",
  "icon": "cable",
  "relatedProblemId": "visible-cords"
}
```

- `productType` — a category/type, not a specific product name (no "OXO Good Grips 3-Piece Pop
  Container Set" — no catalog data exists to back that specificity, and pretending to have it
  would misrepresent what the AI actually knows).
- `reason` — the "why," grounded in the specific visible problem, one sentence, written the same
  warm/specific voice the rest of the prompt already establishes (see Section 7 for exact
  instruction wording).
- `searchTerms` — retailer-independent. Written as what a person would type into any shopping
  search box, not an Amazon-specific query string (in practice these will look nearly identical
  to today's `searchQuery`, but the *naming* and the *intent* — "this is retailer-agnostic input
  to a resolver, not a URL fragment" — matters for Section 4).
- `icon` — **a category identifier, not an emoji chosen ad hoc by the model.** Recommend a small,
  fixed vocabulary (e.g. `cable`, `basket`, `bin`, `shelf`, `hook`, `label`, `drawer-organizer`,
  `hanger`, `bag`, `other`) that the client maps to a real lucide icon + brand color, exactly
  mirroring the already-established `getRoomTypeIcon(displayName)` pattern (`App.js:112-116`,
  keyword-matches a free-text label against a fixed rule list, falls back to a default icon) —
  this app already has a proven, low-risk precedent for "AI returns a semantic string, client maps
  it to a real icon," and reusing it here means the AI is never trusted to pick good emoji, and a
  new icon can be added to the client-side rule list without a prompt change.
- `relatedProblemId` — the load-bearing link back to `problemsFound` (below). No string matching
  between a recommendation's `reason` text and a problem's `description` text, ever — the AI
  assigns the id itself, at generation time, when it still has full context for why it's making
  this specific recommendation.

### `problemsFound` — the structured bridge

```json
{
  "problemsFound": [
    { "id": "visible-cords", "description": "Loose cords and a visible power strip behind the console." },
    { "id": "unsorted-remotes", "description": "Three remotes and loose batteries piled on the shelf." }
  ]
}
```

A problem does **not** require a matching recommendation — an organizational-only problem (e.g.
"items are scattered but you already own enough bins to sort them") appears in `problemsFound`
with no `recommendations` entry referencing it. This is deliberate: `problemsFound` is the AI's
complete inventory of what's wrong; `recommendations` is the (possibly empty, possibly partial)
subset of those problems that genuinely benefit from a purchase. The id-based link is what makes
future Companion matching (Section 5) exact instead of fuzzy — a Companion task generated from
`problemsFound[i]` can carry `relatedProblemId: "visible-cords"` forward without ever having to
re-derive "is this task about the same problem as that recommendation" from free text after the
fact.

`itemsFound` (Section 1a) is not identical to `problemsFound` and doesn't need to be removed —
`itemsFound` stays a simple visible-items list (useful as-is for the AI Visualization prompt and
plain "here's what we saw" narration); `problemsFound` is a new, richer, purchase-relevant subset
with reasoning attached. Whether both fields are worth keeping long-term is a product call outside
this pass's scope — flagged, not decided.

---

## Section 3 — Shopping action (v1: Amazon direct)

Card copy: **"Shop options →"** — deliberately future-proofed wording, even though v1 has exactly
one retailer. Per the task's own explicit instruction, **no intermediate "Shop options" screen
that shows only Amazon** — that adds a tap without offering a real choice, which is worse UX than
either a direct action or a real chooser. In v1, tapping the card does exactly what today's
`openProduct` does: builds an Amazon search from `searchTerms` + the existing Associates tag
(`uncluttrd20-20`, unchanged) and opens it via `Linking.openURL` in the external browser.

The only structural change from today's `openProduct`: the URL-building logic moves conceptually
into a named "resolver" function (Section 4) that takes retailer-agnostic input, even though v1
still hardcodes Amazon as the sole implementation. When a second retailer is added later, the same
tap handler becomes a chooser (bottom sheet / action list) instead of a direct `Linking.openURL`
call — a UI change at the tap-handler level, not a data-model change, because `searchTerms` was
never Amazon-specific to begin with.

---

## Section 4 — Retailer-agnostic data model

The recommendation object (Section 2) describes **what to buy and why**. A separate resolver
determines **where**. Nothing retailer-specific is ever stored:

```json
{
  "productType": "Cable Management Box",
  "reason": "Hides the power strip and loose cords behind your TV console.",
  "searchTerms": "large cable management box",
  "icon": "cable",
  "relatedProblemId": "visible-cords"
}
```

No Amazon URL, no retailer name, no price. Confirmed against the current schema: today's
`price`/`name` fields (Section 1a) both disappear — there is no product catalog backing either
one, and displaying a specific dollar figure the app cannot actually verify against a real listing
is worse than not displaying one.

**Resolver, v1**: a small pure function, e.g. `buildAmazonSearchUrl(searchTerms)` →
``https://www.amazon.com/s?k=${encodeURIComponent(searchTerms)}&tag=uncluttrd20-20`` — the exact
logic `openProduct` already has today, just renamed/reframed as "the Amazon resolver" rather than
"the only way to shop." Adding a second retailer later means adding a second resolver function and
a chooser UI in front of them; the stored recommendation data never needs to change or be
backfilled, which is the entire point of keeping `searchTerms` retailer-neutral from day one.

---

## Section 5 — Companion integration (data model only, not implementing)

Concept: when a Companion checklist item's own problem context matches a product recommendation's
`relatedProblemId`, a subtle, dismissable prompt could appear alongside that task:

> "Put the loose cables behind the console into one contained location."
> Need something for this? Cable management options →

**Data model this would require** (design only — none of this is being built in this pass):
- A Companion batch item would need to carry its own `relatedProblemId` (or, more precisely, be
  derivable from the `problemsFound[].id` that generated it — today's `firstActionBatch`/
  `currentBatch.items` have no such linkage at all; adding it means the prompt that generates the
  checklist would need to also emit which `problemsFound` id each checklist item addresses, the
  same id-based linkage `recommendations` already uses).
- Matching is a **plain equality check** on `relatedProblemId` — never string/semantic matching
  against task text or recommendation reason text. This is precisely why `problemsFound`/
  `relatedProblemId` exist as first-class ids rather than being inferred after the fact.
- **Guardrail (task principle a)**: the prompt (or a post-processing check) must be able to
  distinguish "this task requires a purchase to complete" from "this task is pure rearrangement of
  items already owned" — only the former should ever carry a `relatedProblemId` that has a live
  recommendation. A checklist item like "regroup the books on the shelf by size" should never
  surface a shopping prompt just because some *other* problem in the same photo happens to have a
  recommendation.
- **UI shape (task principle b)**: a small inline affordance under the relevant Companion task
  row, dismissable per-item (a `dismissed: true` flag scoped to that task/session, not a modal or
  a banner) — no new screen, no persistent nag.
- Nothing about Companion's own existing checklist rendering, batch progression, or session state
  needs to change to support this later — it is purely additive (one more optional field per
  checklist item, one more small conditional render).

---

## Section 6 — Room/Area memory integration (data model only, future)

Concept: use the existing Room → Area → Visit architecture (already fully built — Phase C's own
Area Identity/shadow-graph work) to avoid recommending the same category twice for the same Area,
and to let the user mark a recommendation as already-handled.

**Data model this would require** (design only, not implementing):
- A per-Area (or per-Room, for whole-room visits) list of `recommendedProductTypes` — e.g.
  `["Cable Management Box", "Small Storage Baskets"]` — appended to every time a new visit's
  analysis produces a recommendation for that Area. This is the natural place for it: Areas are
  already durable, already-namespaced-by-identity documents
  (`users/{uid}/spaces/{roomId}/areas/{areaId}`), and already accumulate summary data across
  visits (`visitCount`, `lastOrganizedAt`, etc. — see `computeAreaSummaryFields`,
  `shared/spaceMigration.js`) — a new array field fits the same pattern, not a new subsystem.
- A per-recommendation user disposition — `purchased` / `not-needed` / (implicit) `no action
  taken` — most naturally stored as a small map keyed by `productType` (or a normalized slug of
  it) on the Area document, since `productType` is already the stable, AI-independent identity a
  recommendation carries (unlike a raw AI-generated recommendation object, which has no id of its
  own across visits).
- The AI prompt, if this were built, would need the Area's own `recommendedProductTypes` list
  passed in as context (mirroring exactly how `priorContextNote`/`knownIdentityNote` already work
  today, `App.js:5298-5368` — this redesign would be a third instance of the same "pass prior
  visit context into the prompt" pattern already proven twice) with an instruction not to repeat
  an already-recommended category unless the photo shows the prior recommendation clearly wasn't
  acted on.
- None of this is buildable without Section 2's `productType` already being a stable, comparable
  string — which is exactly why Section 2 specifies a category/type rather than a specific product
  name: "Cable Management Box" recommended on visit 1 and visit 3 can be recognized as the same
  category; two different exact product names generated independently by the model could not be
  compared reliably at all.

---

## Section 7 — AI prompt changes

Replace the current three-tier section of the prompt (the budget-math paragraph plus the `tiers`
schema block, `App.js:5430`) with the following. Everything else in the existing prompt (the
photo-order preamble, `budgetNote` — itself revised below, the "doable-right-now" checklist
paragraph, the em-dash rule, `roomAreaInstruction`, and the `suggestedRoomName`/`suggestedAreaName`/
`areaScope`/`roomReason`/`areaReason`/`overview`/`itemsFound`/`firstActionBatch`/`proTip` fields)
is unchanged and untouched by this redesign — confirmed independent in Section 1a/1d.

**New instruction paragraph** (replaces the per-tier budget-math paragraph):

> Identify genuine problems in this space that a product could help solve. For each one, note it
> in `problemsFound` with a short, stable id (lowercase, hyphenated, e.g. "visible-cords") and a
> one-sentence description of what's actually wrong, grounded in what's visible in the photo. Then,
> separately, decide whether any of those problems would genuinely benefit from buying something
> specific - not every problem needs a purchase; many are solved by rearranging what's already
> there. For each problem that would genuinely benefit from a purchase, add ONE recommendation:
> a product category (not a specific product name or brand - you have no way to verify real
> products exist), a one-sentence reason grounded in the specific problem (not a generic benefit),
> retailer-independent search terms a person could type into any shopping search box, a category
> icon (choose from: cable, basket, bin, shelf, hook, label, drawer-organizer, hanger, bag, other),
> and the id of the problem it solves. Return between 0 and 4 recommendations - most spaces
> genuinely need 2-4, but if this space is already well organized, or every problem here is solved
> by rearranging rather than buying, return zero. Never invent a product recommendation just to
> fill the section - an empty recommendations list is a correct, complete answer, not a failure.
> Also identify a short list of general organizing tips for this space, independent of any specific
> product - practical advice the user can act on regardless of budget, not tied to any one
> recommendation above.

**New JSON schema fields** (replacing `"tiers": [...]`):

```json
{
  "problemsFound": [
    { "id": "short-hyphenated-id", "description": "one sentence, grounded in what's visible" }
  ],
  "recommendations": [
    {
      "productType": "category/type, not a brand or specific product",
      "reason": "one sentence, grounded in the specific problem",
      "searchTerms": "retailer-independent search phrase",
      "icon": "cable | basket | bin | shelf | hook | label | drawer-organizer | hanger | bag | other",
      "relatedProblemId": "must match a problemsFound id"
    }
  ],
  "organizingTips": ["tip1", "tip2", "..."]
}
```

`organizingTips` is the direct replacement for the old `tiers[].suggestions` (Section 1f) —
**one** flat list instead of three budget-bucketed lists of overlapping advice, since price is no
longer the axis anything is organized by.

**`budgetNote` revision**: today's branch (`App.js:5287-5289`, "Highlight which tier best fits
their budget, but still show all three" / "Show all three tiers") has no destination left once
tiers are gone. If the pre-analysis budget input (Section 1f's second flagged dependency) is
removed entirely, `budgetNote` is deleted outright. If some form of budget input is deliberately
kept for a different purpose, this branch needs its own new wording — left as an open decision
tied to that same UI question, not resolved here.

---

## Section 8 — Results screen changes

Replace the three `s.tcard` tier cards (`App.js:8924-9002`) with:

**"Products that could help" section** — rendered only when `results.recommendations?.length > 0`
(mirrors the exact `.length > 0 &&` gating convention this file already uses for every other
optional section — Recently Deleted Rooms/Areas, both from Phase C2, are the most recent
precedent). 0-4 cards, each:
- A category icon (client-side lookup from `recommendation.icon` via the fixed vocabulary →
  lucide icon mapping, Section 2), in a colored circle matching this file's existing icon-chip
  visual language (`s.prodIco`-style).
- `productType` as the card's title.
- `reason` as a single line beneath it — this is the "why," and per the guiding principle, it's
  the most important line on the card, not an afterthought.
- A `"Shop options →"` action (Section 3) — no price, no product photo, no product name beyond
  the category.
- No "Best Match"/tier badge — there is no tier to be the best match *of* anymore.

**Section omitted entirely, not rendered empty or with a "nothing to show" placeholder, when
`recommendations` is empty** — an empty shopping section should be visually indistinguishable from
"this screen never had one," matching the guiding principle that zero is a normal, successful
outcome, not a degraded state worth calling attention to.

**Non-product organizing advice** (Section 1f): a single `"Organizing Tips"` section (or folded
into the existing `proTip` card's visual style, one list instead of a single insight) rendering
`results.organizingTips`, positioned where the tier suggestions used to be — after the overview,
before (or after, TBD in implementation) the new Products section. This directly satisfies "ensure
non-product organizing advice from the tiers is preserved."

**Two open items surfaced by Section 1f's audit, not resolved in this pass**:
- AI Visualization's generative prompt currently depends on `tier.suggestions`/`tier.products`
  and renders once per tier. A decision is needed on what drives it once there's one flat
  `organizingTips` list and 0-4 `recommendations` instead — most likely a single per-plan
  visualization built from `organizingTips` + every `recommendation.productType`, but this is a
  visualization-feature design question outside this pass's scope.
- The pre-analysis "Choose Your Budget Level" screen has no destination left. Recommend resolving
  this in the same implementation pass (removing it, or deciding what if anything replaces it) —
  shipping the Results redesign while leaving a now-meaningless tier picker on the Home screen
  would be a visible, confusing half-migration.

---

## Section 9 — Migration / backward compatibility

**Old plans keep their old shape forever** — no backfill, no lazy migration, no dual-write. This
matches the established convention throughout this codebase's own deletion/migration work (Phase
C's own `SHADOW_SCHEMA_VERSION`/`MIGRATION_VERSION`, `shared/spaceMigration.js`) of versioning
forward rather than rewriting history.

**Detection**: add `schemaVersion` (a plain integer, top-level on the plan document, alongside the
existing `schemaVersion: 1` field `savePlanToHistory` already writes today — confirmed present,
`App.js:4380`-region entry construction already includes `schemaVersion: 1`) — bump it for any
plan carrying the new `recommendations`/`problemsFound`/`organizingTips` shape. Concretely: an
old-format plan has `tiers` and no `recommendations`; a new-format plan has `recommendations`/
`problemsFound`/`organizingTips` and no `tiers`. **The presence of `tiers` vs. `recommendations`
is itself already an unambiguous discriminator** — a plain `results.tiers ? <old layout> :
<new layout>` branch at the Results screen's own render point would work correctly without even
needing the version bump, though an explicit `schemaVersion` is still recommended as the
documented, greppable signal (matching this codebase's consistent preference for an explicit
field over inferring shape from presence/absence — see every other schema-version field already in
this file) rather than a structural sniff test as the ONLY signal.

**Rendering**: the Results screen keeps the existing tier-card rendering path (`App.js:8924-9002`)
completely intact, gated on the old-schema branch; the new "Products that could help"/
"Organizing Tips" sections render on the new-schema branch. PDF export and native share
(Section 1f's two other `tiers` consumers) need the identical branch — old plans keep generating
the existing 2-page tier PDF and tier-shaped share text; new plans generate an equivalent built
from `recommendations`/`organizingTips`. No plan a user has already saved ever looks different
after this ships than it did before.

---

## Section 10 — v1 scope boundary

**In scope:**
- New AI prompt producing 0-4 contextual `recommendations` with `relatedProblemId`, plus
  structured `problemsFound` and a flat `organizingTips` list (Section 7).
- New Results screen presentation: "Products that could help" (0-4 cards) + "Organizing Tips"
  (Section 8).
- Amazon direct search on tap — retailer-agnostic data, Amazon-specific resolver (Sections 3/4).
- Backward compatibility for every existing plan, across Results, PDF export, and native share
  (Section 9).
- Non-product organizing advice preserved, not discarded (Section 1f/8).

**Deferred (explicitly out of scope for this pass and the implementation pass that follows it):**
- Multiple retailer options / retailer chooser UI.
- Real product catalog, real pricing, real product photos.
- Companion shopping integration — Section 5 defines the data model only.
- Purchase tracking / "already recommended" memory — Section 6 defines the data model only.
- Recommendation history across visits.
- **Newly surfaced by this audit, also deferred but flagged for a near-term follow-up decision**:
  what drives AI Visualization once tiers are gone, and what (if anything) replaces the
  pre-analysis "Choose Your Budget Level" screen. Both are real, load-bearing dependencies on the
  tier system discovered during this audit, not new scope creep — but neither was asked for in
  this pass, so both are left as explicit open questions rather than silently resolved one way or
  the other.

---

## Section 11 — Required staging evidence (for the implementation pass)

a. AI returns 0-4 contextual `recommendations`, each with a `reason` and a `relatedProblemId` that
   matches a real `problemsFound` entry.
b. AI returns zero recommendations for a photo whose real problems are all rearrangement-only (not
   a forced/contrived test — a genuine photo where no purchase is warranted).
c. Each recommendation's `searchTerms` produces relevant Amazon results when manually checked.
d. "Shop options →" opens a real Amazon search URL built from `searchTerms`, carrying the existing
   `tag=uncluttrd20-20` Associates tag, in the external browser.
e. An old-format plan (real staging data with `tiers`, not synthesized) still renders its original
   three-tier layout unchanged, in Results, PDF export, and native share.
f. `organizingTips` (the non-product advice) is present, stored, and visibly rendered on a
   new-format plan.
g. The stored recommendation object on a real plan document contains exactly `productType`,
   `reason`, `searchTerms`, `icon`, `relatedProblemId` — no retailer name, no URL, no price.
h. `problemsFound` is stored on the plan and every `recommendations[].relatedProblemId` resolves
   to a real entry in it (no orphaned ids in either direction).
