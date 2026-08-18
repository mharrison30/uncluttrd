# Product Matching MVI — Implementation Report

**Built 2026-08-18** against `ProductMatchingDesign.md` and the six decisions
recorded there. Fixture-only: no catalog ingestion, no SFTP, no
network-specific adapters, nothing wired into the app.

```
shared/productMatching/
  catalogSource.js       interface contract + conformance validator
  fixtureCatalog.js      202 products, implements the interface
  queryRewriter.js       RECOMMENDATION -> PRODUCT INTENT
  retrieval.js           keyword retrieval with backoff
  ranking.js             the Section 3 scoring formula
  pipeline.js            three layers + confidence gate + refresh/rematch
  evaluate.js            harness: 26 assertions, all passing
  corpus.fixture.json    54 staging recommendations, identifiers stripped
```

Run: `node shared/productMatching/evaluate.js [--full]`
No network, no credentials, no Firestore.

**Result: 26 PASS, 0 FAIL.**

---

## THE HEADLINE FINDING — my first evaluation metric was wrong

The ablation below is the single most important number produced, and the first
version of it was actively misleading.

The fixture's `search()` originally used **OR-semantics** (any query token
hitting qualifies). Measured that way, the deterministic rewriter looked
nearly worthless: raw `productType` with no rewriting at all already matched
51/54, and the full rewriter added **+1**. On that evidence the rewriter is not
worth building.

That conclusion was an artifact of my own fixture being generous. A structured
catalog API with a real category tree behaves closer to **AND-semantics** —
every token must appear — and the design already says as much ("relevance in
every retailer search engine degrades with length"). Re-running both arms
under both semantics:

| | no rewrite | with rewriter | delta |
|---|---|---|---|
| **OR-semantics** (forgiving) | 51/54 (94%) | 54/54 (100%) | **+3** |
| **AND-semantics** (realistic) | 20/54 (37%) | 37/54 (69%) | **+17** |

**Under realistic retrieval the rewriter nearly doubles coverage.** The +1 was
the fixture flattering the baseline, not a fact about the rewriter.

Two consequences worth carrying forward:

1. **Quote 69%, not 96%.** The pipeline's headline "52/54 matched (96%)" is an
   upper bound measured under the friendliest possible retrieval. Real
   coverage will land between 69% and 96%, nearer the bottom.
2. **Retrieval semantics must be a known property of any real source** before
   its numbers mean anything. `search()` now takes `strict` for exactly this,
   and both modes are evaluated on every run.

Separately: of the 51 recommendations matched by **both** arms, **23 chose a
different product**. The rewriter changes match *quality*, not only coverage —
which a binary match/no-match metric cannot see at all.

---

## 1. Fixture catalog

**202 products, 25 categories, $8.99–$8,500, median $41.** Covers every demand
category named in the brief: furniture, lighting, shelving, cable management,
drawer organizers, storage/bins/baskets, decor, trays, wall art, textiles,
hooks, plants, barware, labels, kitchen/pantry organization, bath accessories.

Names are what **retailers** call things, never what Uncluttrd's AI calls them:

| Corpus says | Catalog says |
|---|---|
| tiered countertop organizer | 3-Tier Kitchen Counter Shelf |
| decorative tray | Bamboo Serving Tray with Handles |
| Lazy Susan turntable | 11-Inch Rotating Turntable Organizer |
| Tiered shelf risers | Expandable Bamboo Shelf Riser, Set of 2 |
| plush bath mat | Memory Foam Bath Mat, Plush Gray |

This is deliberate. If the fixture used the AI's vocabulary the matcher would
score ~100% and prove nothing — the entire measured problem (62.8% of corpus
phrase pairs share zero tokens) *is* this vocabulary gap.

**17 deliberate distractors**: wrong-category items (garden hose reel, car
phone mount, treadmill desk, commercial prep table) and price outliers
($2,400 Murano sculpture, $8,500 silk rug). **0 were ever selected**, and **0
reached any intent's top 3.**

Also included: out-of-stock and unknown-availability rows, so the availability
signal and its hard filter are exercised rather than assumed.

## 2. Catalog source interface

```
metadata: { name, type: "fixture"|"api"|"feed", lastUpdated }
search(query, { maxResults, priceRange, strict }) -> CatalogProduct[]
getProduct(id) -> CatalogProduct | null
```

`CatalogProduct`: `id, name, description, category, price, currency, imageUrl,
productUrl, availability` + `sourceMetadata { source, merchantId,
affiliateUrl, commission? }`.

`validateSource()` conformance-checks any implementation — including calling
`search()` with a real query and validating the rows that come back, because
an adapter can satisfy a type signature and still return malformed data. A
future Wayfair/Rakuten/Amazon adapter passes exactly the checks the fixture
passes.

## 3. Deterministic query rewriter

**82 intents from 54 recommendations — exactly the 1.52x expansion the design
measured.** Asserted in the harness, so drift from the design's baseline fails
the run.

| Measure | Result |
|---|---|
| Split into multiple intents | 28/54 (52%) |
| Purpose clause stripped | 7/54 (13%) |
| Tokens stripped | 18 |
| **Location tokens protected** | **12** |
| Empty-after-rewrite failsafes | 0 |
| Service (unmatchable) | 1 |
| Conjunctive "and" not split | 2 (documented limitation) |

### A correction to the design document

`ProductMatchingDesign.md` Section 7 says to strip room words "using the
`QUERY_STOPWORDS` set that already exists in App.js". **Implemented literally,
that is wrong.**

In `App.js`, `QUERY_STOPWORDS` never strips anything. Its only use is inside
`buildAmazonSearchQuery`, filtering words being **appended** as context hints:

```js
if (tokens.every((t) => seen.has(t) || QUERY_STOPWORDS.has(t))) return;
```

The base query is never touched. The set conflates two jobs, and it contains
`"wall"` — which appears **7 times** in corpus `productType` values, every one
load-bearing. `"framed wall art"` would become `"framed art"`.

Fixed by splitting the set **by job** rather than reusing it **by name**:
`FUNCTION_WORDS` (always strippable) vs `LOCATION_WORDS` (strippable only
outside a protected compound), plus `PROTECTED_COMPOUNDS` — an explicit,
inspectable bigram list. A regression test asserts `"wall art"` survives.

### Nothing produced an obviously wrong query

All 82 intents inspected. No empty queries, no lost head nouns, no
false-positive location stripping. The one intent that *reads* odd —
`"decorative object accent lamp"` from `"Decorative objects and accent lamp
for credenza styling"` — is the unsplit `and` case, and it still matched a
sensible product.

### Catalog synonyms — the seam where embeddings go

Two entries, both from measured corpus failures rather than imagination:

- **`lazy susan` -> `turntable`** — retrieval found the right product; ranking
  rejected it because 2 of 3 tokens were colloquialisms in no listing anywhere.
- **`artwork` -> `art`** — substring matching is one-way; `"Framed Wall Art"`
  does not contain `"artwork"`.

Deliberately tiny. Every entry is a hand-maintained liability an embedding
index would subsume, so padding it out would be building the wrong thing
carefully.

## 4. Keyword retrieval

Queries the source, with **progressive backoff**: drop the leading modifier and
retry, head noun last to go, because the head noun is the category anchor.
Merges across a recommendation's intents by product id.

## 5. Ranking

Section 3's formula exactly: `0.55 relevance + 0.20 price_fit + 0.15
availability + 0.10 context_fit`; hard filters for no-price and out-of-stock;
commission as an epsilon=0.02 tiebreaker only.

Asserted invariants: weights sum to 1.00; all **1,748** produced scores within
[0,1]; out-of-stock never ranked; **commission never crosses an epsilon gap**;
price term auto-disables below 5 candidates; Elevated selects a pricier
product than Simple on the same intent.

### Two changes the evaluation forced

**a. Head-noun weighting.** Flat coverage rejected correct products:
`"lazy susan turntable"` vs `"11-Inch Rotating Turntable Organizer"` scored
0.300 relevance — below the gate — because the head noun matched perfectly but
counted 1/3. Relevance is now `0.45*head + 0.35*coverage + 0.20*density`. Not
a tuning knob: Section 1b identified the head noun as the category anchor.

**b. Price outlier fence — and a live interaction between decisions #2 and #3c.**

Intent `"decorative sculpture"`, Elevated, 16 candidates priced $19.99–$189
**plus a $2,400 limited-edition Murano piece — 41x the median.** The 75th
percentile target landed *on the outlier*, giving it a high `price_fit`. It
then scored 0.771 against 0.782 for a $134 sculpture — **inside epsilon** — so
the **commission tiebreak promoted it**, because it carried a 10% rate against
the default 5%.

**That is exactly the outcome decision #2 forbids: commission rescuing a
product that should not have been near the top.** The tiebreak obeyed its own
rule. The fault was upstream — letting an out-of-distribution price define what
"elevated" means.

Fixed faithfully to "the range emerges from the products": prices beyond
`Q3 + 3*IQR` are excluded from the percentile **basis** and score `price_fit =
0`. They remain rankable — excluding them outright would impose a band — but
can no longer land near the top, so the tiebreak is never consulted on them.
The fence is deliberately loose (3x IQR, not the usual 1.5) so only the
genuinely absurd is caught.

**This is worth Michael's attention as a design-level finding, not just a bug
fix.** Percentile pricing has no notion of out-of-distribution, and an
epsilon-width commission tiebreak sitting on top of it is where the two
decisions can combine into an outcome neither intended.

## 6. Pipeline and the confidence gate

Three layers, enforced structurally: `matchRecommendation()` **never mutates**
the recommendation (asserted), and the commerce candidate holds a *pointer*
back rather than a copy. Asserted: no `reason`/`grounding`/`shortReason` ever
leaks into a commerce candidate.

Gate: `score >= 0.55` **and** `relevance >= 0.50`. Two independent floors, because
a product can clear a composite score on price, availability and style
vocabulary while barely matching what was asked for — the same failure mode as
commission rescue, wearing different clothes.

**Refresh vs rematch (decision #3)** implemented as separate operations and
tested in both directions: stale age -> **refresh**; price change -> **refresh,
never rematch**; product disappeared -> **rematch**; recommendation changed ->
**rematch**.

### The underspecified class behaved better than predicted

The structural detector flags **2/54**, against the design's manual
classification of **7/54**. I did **not** tune it to close the gap — that would
be fitting the metric. The harness instead asserts **no false positives** (it
never sends a findable product to fallback) and reports the divergence.

The 5 it misses all **matched sensibly**:

| Recommendation | Matched |
|---|---|
| decorative sculpture or art object | Metal Wall Sculpture, Abstract Brass — $134 |
| Set of decorative objects or sculptural pieces | Sculptural Vase Set, 3-Piece — $78 |
| Decorative objects and accent lamp… | Small Accent Table Lamp, Brass and Marble — $96 |
| sculptural vases and decorative objects… | Set of 3 Ceramic Decorative Objects — $62 |
| decorative objects or vases for niche styling | Ceramic Sculptural Vase, Matte White — $54 |

**Disjunction splitting partially dissolves the underspecified class.** When
`"decorative objects"` is paired with a concrete alternative, the concrete
branch is matchable. Only the two with *no* concrete branch —
`"Decorative objects for display styling"` and `"Small accent decor objects"` —
correctly fall back.

This is direct evidence for decision #5's thesis that underspecification is a
**schema problem, not a reasoning problem**: better structure at the intent
layer already cut the effective rate from 13% to 4%, before structured
`productNeed` exists. It also suggests the ~3% target is reachable.

---

## What was NOT built

Per scope: no catalog ingestion, no SFTP downloader, no network-specific
adapter. Per design: no embeddings, no LLM re-ranking, no multi-source
merging, no background refresh, no visual matching.

**Nothing is wired into the app.** `grep productMatching App.js
functions/index.js` returns 0. Both 2.0.0 runtime fingerprints verified
unchanged after the work — iOS `ba713790…`, Android `620988bd…` — so the
TestFlight and Play alpha builds remain OTA-updatable.

## Honest limitations

1. **Coverage is an upper bound.** The fixture was authored by the same process
   as the matcher. 69% (AND) is the more credible figure; the truth against a
   real catalog is likely lower than both.
2. **No real-catalog recall measurement.** Exactly the one thing the design
   sequenced last, unchanged.
3. **Conjunctive `and` is not split** (2 corpus cases). `and` appears inside
   single product names far more often than `or` does, so splitting it is
   unsafe without a product-name lexicon.
4. **Relevance is lexical only.** Synonymy beyond the two-entry map is
   unhandled — the embedding-shaped hole the design already predicted.
5. **`context_fit` is a title-vocabulary proxy**, not real style metadata,
   which is why it carries only 0.10 weight.

## Suggested next steps

1. **Decide the retrieval-semantics question with real data.** It is worth
   ~30 points of coverage and is currently the largest unknown.
2. **Consider recording the outlier-fence finding in the design doc** — the
   decision #2 / #3c interaction is a design-level observation.
3. Wire a real source behind `catalogSource.js` when one becomes commercially
   live; nothing above that layer should need to change.
