# Product Intelligence — Matching & Ranking Architecture

**Design only. Nothing implemented, nothing deployed, no code changed.**
Written 2026-08-18. **All six Section 8 decisions recorded 2026-08-18.**

Where a recorded decision supersedes a recommendation made in the body, the
body has been reconciled to match and the change is noted at that point. The
original recommendation is preserved alongside it — a decision log that hides
what was recommended against is not a decision log.

This layer sits between the **catalog layer** (Rakuten, CJ, Awin, Amazon,
future sources) and the **recommendation card**. It is deliberately
source-agnostic: it consumes normalized catalog rows and emits a ranked list,
and it must not know which network supplied a product. That mirrors the
existing `PRODUCT_SOURCES` / `resolveProductDestination` split in `App.js`,
which already keeps affiliate URL construction inside each adapter.

Section 1 is measured against the real staging corpus, not estimated. Every
figure below was computed from the 54 recommendations currently in
`cluttrd-staging`. Read-only extraction, GETs only.

---

## 0. Three-layer separation — core architectural principle

**Three concepts must not be conflated.** Everything else in this document
depends on holding them apart, and most of the ways this system could go wrong
are a version of collapsing two of them into one.

### RECOMMENDATION — stable, belongs to the plan

> *"A Lazy Susan would solve this accessibility problem."*

- Part of the AI analysis
- **Never changes after plan creation**
- Stored on the plan document

### PRODUCT INTENT — the translation layer

- `type`: "turntable" / "rotating organizer"
- `use context`: deep-cabinet accessibility
- `intent`: make items reachable

- Derived from the recommendation
- May be **structured** (future `productNeed`, Section 9) or **unstructured**
  (current `productType` / `searchTerms`)
- **The deterministic query rewriter operates here**

### COMMERCE CANDIDATE — ephemeral, replaceable

> *OXO 11" Turntable, $24.99, Amazon, 4.7 stars*

- Matched from a catalog source
- Carries a `matchedAt` timestamp
- Price, availability, link and source **can all change**
- **Stored separately from the recommendation**
- Can be replaced without rewriting the user's plan
- Multiple sources may compete to fulfill the same intent

### What the separation buys

- Product Intelligence can replace an unavailable product **without touching
  the AI analysis**.
- Adding Amazon PA-API later **does not rewrite existing plans**.
- The recommendation **stays truthful even when commerce data is stale** — the
  claim "a Lazy Susan would solve this" does not expire when a price does.
- The UI can clearly distinguish **"what we recommend"** from **"where to buy
  it"** — which is precisely what makes the mixed matched/fallback experience
  in Section 6d coherent rather than broken.

### Why this is load-bearing, not descriptive

Each layer has a different **lifetime**, a different **owner**, and a different
**failure mode**:

| | Recommendation | Product intent | Commerce candidate |
|---|---|---|---|
| Lifetime | Permanent | Derived on demand | Hours to weeks |
| Written by | Call 2 (AI) | Rewriter (deterministic) | Matcher + catalog source |
| Storage | Plan document | Not stored — recomputed | Separate, with `matchedAt` |
| Failure mode | Wrong advice | Wrong translation | Stale or gone |
| Fix | Re-analyze the photo | Change the rewriter | Refresh or rematch |

Storing a commerce candidate *inside* the plan document would weld a
weeks-lived object to a permanent one, and every price refresh would become a
write against the user's analysis. That is the specific mistake this section
exists to prevent.

---

## 1. The matching problem, precisely stated

### Corpus

54 recommendations across 9 staging users. `productType`, `searchTerms` and
`shortReason` are present on **100%** of them — the schema is fully populated,
so nothing here is blocked on backfill.

### a. Distinct `productType` phrases

**53 distinct phrases out of 54 recommendations.** The only repeat is
`Decorative bookends`, appearing twice.

This is the single most important number in the document. The vocabulary is
**98% unique**. There is no recurring phrase set to build a lookup table
against, and there never will be — the phrases are generated per-photo. Any
design that assumes a bounded vocabulary of product types is wrong from the
first day.

### b. Vocabulary overlap between phrases

Measured as pairwise Jaccard similarity over `productType` tokens, across all
1,431 pairs:

| Metric | Value |
|---|---|
| Mean Jaccard | **0.054** |
| Pairs sharing **zero** tokens | **899 (62.8%)** |
| Pairs at Jaccard >= 0.30 | 37 (2.6%) |
| Pairs at Jaccard >= 0.50 | 12 (0.8%) |

Token-level: 260 total tokens, **112 distinct**, of which **57 (51%) appear
exactly once**. Mean phrase length 4.81 tokens.

**Similar recommendations do not use similar words.** Nearly two-thirds of all
phrase pairs share no token at all. The head-noun distribution says the same
thing: 40 distinct head nouns across 54 phrases, 31 of them singletons.

The frequency head is dominated by function words and one adjective:

```
28x or        13x decorative   7x wall    7x art        7x for
 6x set        6x objects      5x framed  5x organizer  5x niche
```

`or` is the most common token in the corpus. That is not a vocabulary fact,
it is a **structural** one, and it drives the rest of this section.

### c. Matchable by exact keyword search

**11 of 54 (20%)** are plausibly matchable by direct keyword query against a
typical home-goods catalog. These are phrases with <= 3 tokens, no disjunction,
no purpose clause, and a head noun that a catalog would actually have as a
category:

```
countertop tray          framed wall art        hand towel
tiered countertop organizer                     plush bath mat
decorative tray          Clear storage bins     Lazy Susan turntable
Tiered shelf risers      Decorative bookends    Decorative bookends
```

Even several of these are optimistic. `tiered countertop organizer` is in the
list because it is structurally clean, but it is exactly the case in the brief
that needs to reach `3-tier kitchen counter shelf` — clean structure does not
mean matching literal.

The other **43 (80%)** carry at least one structural feature that defeats a
literal query:

| Feature | Count | Why it breaks exact search |
|---|---|---|
| **Disjunctive** (`X or Y`) | **28 (52%)** | Not one product — a *choice*. `small potted plant or candle` is two unrelated categories in one string |
| **Non-category head noun** | **17 (31%)** | Head is `set`, `styling`, `niche`, `options`, `pieces`. No catalog has a department called "styling" |
| **Purpose-suffixed** (`for` / `with`) | **10 (19%)** | `decorative tray for cabinet surface` — the suffix is *room context*, not catalog vocabulary, and actively poisons the query |
| 4+ tokens | 43 (80%) | Relevance in every retailer search engine degrades with length |

### Intent expansion

Splitting on `or` turns **54 recommendations into 82 distinct product
intents — a 1.52x expansion.** The matcher's real unit of work is the intent,
not the recommendation. Sizing anything (cost, latency, candidate budget) per
recommendation understates it by half.

### d. Requiring semantic understanding

Classifying all 54 by what the matcher must actually *do*:

| Class | Count | Share | What it needs |
|---|---|---|---|
| **Determinate** — one clear intent | **22** | 41% | Vocabulary translation only. `tiered countertop organizer` -> `3-tier counter shelf` |
| **Disjunctive** — 2+ determinate intents | **25** | 46% | Mechanical split, then vocabulary translation per branch |
| **Genuinely underspecified** | **7** | 13% | No catalog query determines the answer |

The 7 genuinely underspecified:

```
decorative sculpture or art object
Decorative objects for display styling
Small accent decor objects
Set of decorative objects or sculptural pieces
Decorative objects and accent lamp for credenza styling
sculptural vases and decorative objects for niche
decorative objects or vases for niche styling
```

These share a signature: the head is `objects` or `styling`. A catalog query
for "decorative object" returns the entire home-decor department. Only the
photo, the `reason`, and the `grounding` narrow them — and only into a *style*,
never into a product. **These are not a matching failure to engineer away.
They are a legitimately different product mode**, and Section 7 treats them
separately rather than pretending a better matcher solves them.

### e. Vocabulary translation vs genuine ambiguity

**Roughly 87% vocabulary translation, 13% genuine ambiguity.**

Precisely: 41% is pure vocabulary translation. A further 46% becomes
vocabulary translation *after a mechanical disjunction split* — splitting on
`or` is deterministic string handling, not intelligence. Only the remaining
13% is irreducible ambiguity that no amount of catalog knowledge resolves.

**This is the central design conclusion.** The problem is overwhelmingly a
translation problem, not a reasoning problem. That argues strongly against
routing every recommendation through an LLM, and strongly for a cheap
deterministic front end that handles the 87%, with LLM effort reserved for the
13% and for re-ranking.

### The `searchTerms` field is already doing translation — for the wrong target

`searchTerms` is present on 100% of recommendations and is **not** a copy of
`productType`: only **1 of 54** has an identical token set. It adds tokens on
53 and drops tokens on 41, mean 5.57 tokens.

But **70% of `searchTerms` contain a room or location word** (`bathroom`,
`pantry`, `dining`, `credenza`, `niche`, `vanity`). That is tuned for Amazon,
where listing titles are stuffed with room words and it genuinely improves
relevance. Against a **structured catalog** with a real category tree, the
same words are noise or worse — they filter toward products whose *title*
mentions a bathroom instead of products *in* the bath category.

`searchTerms` is a real asset, aimed at the wrong target. Section 2e revisits
this.

### One non-product recommendation

`Designer pendant light or chandelier with professional installation` contains
a **service**. No product catalog satisfies it. Rare (1 of 54) but the matcher
must degrade gracefully rather than return a confidently wrong lamp.

---

## 2. Matching architecture options

Costs are order-of-magnitude estimates at current list prices, per **intent**
(82 intents per 54 recommendations), and marked as estimates.

### a. Keyword search

Extract terms, query the catalog.

| | |
|---|---|
| Latency | 50-300 ms per intent |
| Cost | ~0 (API/DB call only) |
| Accuracy | Good on the 20% clean phrases; **poor** on the 80% |
| Catalog scale | Any — the source does the work |
| Pre-ingest needed | **No** |

The measured corpus is close to a worst case for this approach: 52% disjunctive
and 51% hapax tokens. Alone it is not viable. As a **candidate generator** it
is excellent, and that is the role it should have.

### b. Embedding similarity

Embed recommendation text and catalog rows, retrieve nearest neighbours.

| | |
|---|---|
| Latency | 20-80 ms (ANN index), plus one embedding call ~30 ms |
| Cost | Query embedding negligible. **Indexing**: ~1M products x ~30 tokens ~ $0.60 one-off at small-embedding prices; storage ~2 GB at 512 dims |
| Accuracy | **Strong on exactly the failure mode we have** — synonymy and paraphrase |
| Catalog scale | Millions, with an ANN index |
| Pre-ingest needed | **Yes — this is the blocker** |

Handles `tiered countertop organizer` -> `3-tier kitchen counter shelf`
natively. It is the right tool for the 87% translation problem. But it requires
the full catalog resident and re-embedded as the catalog changes, which
Section 5 shows we cannot currently do for most sources. Note also it does
*not* fix disjunction: embedding `small potted plant or candle` as one string
lands in the average of two unrelated regions and retrieves neither well.
**Split before embedding.**

### c. LLM-assisted matching

Give the model the recommendation context plus candidates; ask it to rank.

| | |
|---|---|
| Latency | 1-4 s per call |
| Cost | ~$0.011/intent (Opus 5, ~20 candidates); ~$0.002/intent (Haiku 4.5) — estimates |
| Accuracy | Highest; the only option that reads `reason` and `grounding` as evidence |
| Catalog scale | Cannot search a catalog — it can only rank what it is handed |
| Pre-ingest needed | No, but requires a retrieval stage to feed it |

**An LLM cannot be the matcher.** It has no catalog access. It can only be a
*re-ranker*. Used at 82 intents per plan it would also add 1-4 s per intent,
which Section 4 rules out at display time.

### d. Hybrid — keyword retrieve, then re-rank

Cheap broad retrieval to a candidate set of 20-50, then LLM or embedding
re-ranking.

| | |
|---|---|
| Latency | 300 ms (retrieve) + 1-3 s (LLM re-rank) or +50 ms (embedding re-rank) |
| Cost | ~$0.002-0.011/intent if LLM re-rank; ~0 if embedding re-rank |
| Accuracy | Near-LLM, at a fraction of the cost |
| Catalog scale | Any |
| Pre-ingest needed | **No** |

**Recommended.** It is the only option that is simultaneously accurate on the
80% hard cases and workable without pre-ingesting a catalog we do not have.
Retrieval recall becomes the bottleneck — the re-ranker cannot recover a
product retrieval never surfaced — which is why the query rewriting in (e)
matters more than the re-ranker choice.

### e. AI-generated, catalog-aware search terms

The model already emits `searchTerms`. Could it emit better ones knowing the
catalog schema?

**Yes, and this is the highest-leverage change in the document — but it should
not be done in Call 2.**

Two reasons. First, `searchTerms` is Amazon-shaped by design, and Amazon remains
the fallback for everything unmatched (Section 6); regenerating it for a
structured catalog would degrade the fallback path that currently serves 100%
of recommendations. Second, Call 2 runs once at plan creation while catalogs
and sources change independently — baking a CJ-shaped query into a stored plan
couples plan data to a catalog generation.

Instead, add a **separate, cheap query-rewriting step inside the matcher**,
downstream of the plan:

```
productType + searchTerms + reason + grounding + approachId + catalog schema
   -> [rewriter]
   -> { intents: [ {query, category_hint, must_have[], nice_to_have[]}, ... ] }
```

This is where disjunction splitting, room-word stripping, purpose-clause
removal and category mapping all belong — one place, source-aware, changeable
without touching stored plans or the analysis prompt. For the 22 determinate
cases the rewriter is pure string handling and needs no model at all; a small
model handles the residue. Empirically it is doing the work that 87% of the
corpus actually needs.

**DECIDED 2026-08-18 (#6) — `searchTerms` stays Amazon-shaped.** The working
100% fallback is not to be damaged; the rewriter owns catalog-specific
translation. The rewriter is also the **backward-compatibility layer** for
structured `productNeed` (Section 9): because product intent is derived and
never stored (Section 0), changing how it is derived cannot invalidate an
existing plan.

### Recommendation

**Hybrid (d), with a source-aware query rewriter (e) in front.**

```
recommendation
  -> rewriter        deterministic split + normalize; small model on the residue
  -> retrieval       keyword/API per source, N=20-50 candidates per intent
  -> re-rank         embedding first; LLM where it earns its cost
  -> ranking         Section 3
  -> card
```

Embeddings (b) are the right long-term re-ranker and should be adopted the
moment a catalog is resident enough to index. They are not a v1 prerequisite.

---

## 3. Ranking — what makes a product "right"

Matching returns candidates. Ranking decides what is shown.

### Signals

| Signal | Available today | Source | Notes |
|---|---|---|---|
| **a. Relevance** | **Yes** | Retrieval + re-rank score | The backbone |
| **b. Context fit** | **Partly** | `approachId` + product attrs | We know the ambition; feeds rarely carry style/quality |
| **c. Price** | **Yes** | Feed | Present in every feed examined |
| **d. Visual match** | **No — future** | Photo + `visualizationDirection` | Scoped only, below |
| **e. Availability** | **Source-dependent** | Feed | Awin: stale-prone. CJ: `inStock` |
| **f. Source quality** | **Largely no** | Ratings | **0% populated in the Awin feed examined** |
| **g. Affiliate value** | **Yes** | Network | Deliberately excluded — see below |

### c. Price — let the band emerge

The brief is explicit that the range must emerge from the products rather than
be imposed, and the codebase already made this decision once: `SCOPE_SPEND_TABLE`
was retired, and the comment above `APPROACH_QUERY_INTENT` in `App.js` records
why — a fixed band "would exclude the best $42 tray and steer toward a $140 one
on the authority of a table rather than of the product."

**Design: rank on price *percentile within the retrieved candidate set*, never
on absolute dollars.**

```
Given candidates C for one intent, with prices p(C):
  target_percentile = { simple: 0.25, polished: 0.50, elevated: 0.75 }[approachId]
  price_score(x)    = 1 - |percentile_rank(p(x), p(C)) - target_percentile|
```

The band is defined by what the category actually costs. In a category where
everything is $8-$15, Elevated gets the $15 item — not a $200 item that does
not exist. In a category spanning $40-$900, Simple gets the low end without a
table ever naming a number. No dollar figure is hardcoded, and the same three
constants work across every category and every source.

Guard: with fewer than ~5 candidates, percentiles are noise. Below that
threshold, drop the price term and renormalize rather than ranking on a
two-element distribution.

### Price outliers — ADDED 2026-08-18, validated by the MVI build

Candidate-relative price percentile **remains** the approach signal. Nothing
above changes. But percentile ranking has no notion of *out of distribution*,
and the MVI found the hole by hitting it:

> Intent `"decorative sculpture"`, approach Elevated, 16 candidates priced
> $19.99–$189 **plus a $2,400 limited-edition art piece — 41x the median.**
> The Elevated target of the 75th percentile landed **on the outlier**, giving
> it a high `price_fit`. It then scored 0.771 against 0.782 for a $134
> sculpture — **inside epsilon** — so the **commission tiebreak promoted it**,
> because the outlier carried a 10% rate against the default 5%.

**That is exactly the outcome decision #2 forbids.** The tiebreak obeyed its
own rule; the fault was upstream, in letting an out-of-distribution price
define what "elevated" means. Two decisions, each correct alone, combining into
an outcome neither intended.

The rule, now part of the ranking design:

1. **Exclude extreme price outliers from the percentile distribution**, using a
   **loose `Q3 + 3 x IQR` fence** — validated in the MVI build. Deliberately
   looser than the conventional 1.5x so it only ever catches the genuinely
   absurd. A merely expensive product must stay reachable, or Elevated stops
   working.
2. **Outliers may remain candidates** if otherwise relevant. They are ranked
   normally on relevance, availability and context — excluding them outright
   would impose a band, which is the thing Section 3c exists to avoid. What
   they may not do is **redefine the approach-relative price target**: an
   out-of-fence product scores `price_fit = 0` and is absent from the basis.
3. **Commission remains tiebreak-only** and **may never rescue an outlier
   created by distorted price normalization.** Fixing the basis is what makes
   this hold in practice: an out-of-fence product can no longer land within
   epsilon of the top, so the tiebreak is never consulted on it.

The general principle worth carrying: **an epsilon-width tiebreak sitting on
top of a distorted signal will faithfully amplify the distortion.** Whenever a
ranking term can be skewed by a single candidate, fix the term rather than
tightening epsilon.

### b. Context fit

`approachId` gives ambition directly. The product side is weak: most feeds
carry no style or quality attribute, and the Awin POC found the ranking fields
0% populated. Available proxies today are brand, price percentile (already in
c), and title tokens matching `APPROACH_QUERY_INTENT`'s existing vocabulary
(`simple/practical`, `modern/coordinated`, `premium/designer`).

Weight it low until a source proves it carries real style metadata. Do not
manufacture confidence from an absent field.

### g. Affiliate value — a tiebreaker, never a weight

**Recommendation: commission must not enter the primary ranking score.**

Rationale: a commission weight is undetectable to the user and directly
degrades the thing the product is for. Uncluttrd's value is that the
recommendation is honest; a ranking that quietly prefers the better-paying
product is the one failure that is unrecoverable if noticed.

Where it is legitimate: as a **tiebreaker among genuinely equivalent
products**. Formally —

```
rank by score desc
within any group whose scores differ by < epsilon (epsilon = 0.02):
    prefer higher commission
```

This never promotes a worse-matching product above a better one. It only
decides which of two equally good products is shown first.

**DECIDED 2026-08-18 — tiebreak only, epsilon <= 0.02.** Commission breaks a
tie only **after every user-relevant criterion has been applied**. At 0.84 vs
0.83 the two products are equivalent enough that economics may decide.
**Commission must never rescue a mediocre product.**

The epsilon is meaningful because the score is normalized to 0-1 by
construction: every term in the formula below is bounded to [0,1] and the
weights sum to 1.00. Epsilon = 0.02 is therefore 2% of the full scale, not an
arbitrary float. **Any future change to the weights must preserve the sum-to-1
property**, or epsilon silently changes meaning.

**Should the user know?** The existing `/disclosure` page already states
Uncluttrd "may earn a commission" on certain links, which covers a tiebreaker.
It would **not** honestly cover commission as a weighted ranking signal — that
would require disclosure at the point of ranking, not in a footer link. This is
a reason to keep it a tiebreaker, not merely a consequence of doing so.

### d. Visual match — future, scope only

The photo, `visualizationDirection` and the analysis all describe the room's
palette and materials. A future signal could embed the product image and score
it against the room's visual context. Genuinely valuable for the 13%
underspecified "decorative objects" class, where style is the *only* thing that
distinguishes candidates.

Out of scope for v1: it needs product images resident and embedded, a
room-appearance vector, and validation — none of which exist. **Do not let its
absence block v1.** It is an accuracy improvement on a class that Section 7
handles a different way.

### Proposed formula

```
score(x) = 0.55 * relevance(x)
         + 0.20 * price_fit(x)          // percentile-based, above
         + 0.15 * availability(x)       // 1.0 in stock, 0.5 unknown, 0.0 out
         + 0.10 * context_fit(x)        // low weight until metadata exists
                                        // + 0.00 * source_quality  (no data yet)
                                        // + 0.00 * visual_match    (future)

tiebreak within epsilon = 0.02: commission desc
hard filters (not weights): no price -> drop; explicitly out of stock -> drop
```

Weights are a **starting point to be tuned against real data, not a result.**
Relevance dominates deliberately: with 62.8% of phrase pairs sharing zero
tokens, retrieval quality is the dominant risk, and everything else is a
refinement on an already-relevant set.

Availability is a weight *and* a hard filter at the extremes: a confidently
out-of-stock product should never rank, but "unknown" must not be treated as
"out", or sources with sparse stock data lose every candidate.

---

## 4. When does matching happen?

| Option | Latency to user | Freshness | Infra |
|---|---|---|---|
| a. On display | 2-5 s **added to a user tap** | Always fresh | Lowest |
| b. Pre-computed at plan creation | Instant | Degrades | Moderate |
| c. Background with refresh | Instant | Good | Highest |
| d. Pre-computed + background refresh | Instant | Good | Moderate-high |

### Recommendation for v1: (b), pre-computed at plan creation — structured so (d) is a later addition, not a rewrite

Reasoning:

1. **Latency is the deciding factor.** Analysis already makes the user wait
   through Call 1 and Call 2. Adding 2-5 s to a *tap* is worse than adding it
   to a wait the user is already in — and at 82 intents per plan, on-display
   matching is not one query but a fan-out.
2. **Plan creation is already asynchronous and already tolerates cost.** The
   matcher is small next to two vision calls.
3. **Staleness is bounded by how the result is used.** Matched products are a
   *starting point* the user taps through to the retailer, where they see live
   price and availability. A stale price on the card is a mild inaccuracy, not
   a broken transaction.
4. **It is testable offline.** Pre-computation means every match is a stored
   artifact that can be evaluated against the corpus without a user present —
   which Section 7 requires.

**DECIDED 2026-08-18 — precompute plus stale *commerce* refresh.** The decision
sharpens this option in a way that matters, and it follows directly from
Section 0: **separate product identity from volatile commerce data.**

Two distinct operations, which the original wording above blurred into one:

| | **Refresh** | **Rematch** |
|---|---|---|
| Changes | Price, availability, link | *Which product* is shown |
| Cost | One lookup by product id | Full rewriter + retrieval + rank |
| Touches the plan | No | No — commerce candidate only (Section 0) |
| Triggered by | `matchedAt` older than N days | See below |

**Rematch only when:**

1. the product **disappears** from the catalog, or
2. the product becomes **unavailable**, or
3. the **underlying recommendation changes**.

**Do not rematch merely because a price changed.** A price move is a refresh,
not a re-decision. Rematching on price would make the shown product drift
under the user for no reason they could perceive, would churn commerce writes,
and would quietly turn the price percentile of Section 3c into a *selection*
signal rather than a *ranking* one — re-running the ranker every time prices
move means the cheapest-at-this-instant product wins on refresh cadence rather
than on fit.

The earlier wording here — "re-run the matcher on read if older than N days" —
described a rematch and is superseded: staleness triggers a **refresh**.
A stored price remains indicative and must be labelled as such, never as a
quote.

**Not (a)** — it puts the slowest path in front of the most engaged user action.
**Not (c)** — building refresh infrastructure before a single match has been
validated is investment ahead of evidence.

---

## 5. What the matcher needs from each source

| Source | Query interface | Product data | Latency / limits | Works without pre-ingest? |
|---|---|---|---|---|
| **Amazon** | **None.** Search-URL construction only | **None** — we send the user to browse | n/a | n/a — nothing to match against |
| **Rakuten** | Advertiser metadata only network-wide; product feeds per partnership | Feed-dependent, post-partnership | Partnership-gated | Only for partnered merchants |
| **CJ** | GraphQL `ads.api.cj.com/query` — **real search API** | name, price, image, URL, `inStock`, category | Per-token quota | **Yes** — best fit for the architecture |
| **Awin** | `.gz` CSV feed export | Working affiliate links, price, image | Batch download | **No** — must ingest |
| **Future** | — | — | — | — |

### The constraint that shapes everything

**No currently available source provides catalog + ranking metadata +
affiliate links together.**

- **Awin** gives retrieval and *real monetizable links* — the only source that
  has produced one — but the POC found `product_type`, `keywords`, `colour`,
  `dimensions`, `specifications` and ratings **0% populated**. Retrieval
  without anything to rank on.
- **CJ** gives the right *interface* — a queryable API, no ingest, structured
  fields — but the POC found the publisher account joined to **zero**
  advertisers with product feeds. Right shape, no inventory.
- **Rakuten** releases merchandising taxonomy only after partnership.
- **Amazon** has no catalog at all.

CJ is the correct architectural target; Awin is the current commercial
reality. A v1 that assumes a source with both will not ship.

### Premise check on Wayfair via CJ

The brief names Wayfair via CJ as the likely first catalog. Architecturally
that is right — CJ is the only no-ingest queryable source. But the CJ POC found
**zero joined advertisers with product feeds** on this account, meaning no
product from any advertiser currently carries an affiliate link. **Wayfair via
CJ requires an approved partnership that does not yet exist.**

**DECIDED 2026-08-18 — source-agnostic. This premise is retired rather than
answered.** v1 is **not** built against Wayfair, CJ, Awin, or any named source.
It is built against a **catalog-source interface**, and the first sufficiently
good catalog becomes the first implementation. Wayfair, Rakuten and a future
Amazon PA-API must all plug into the same interface.

This supersedes the recommendation in the original Section 8 #1 (*"pursue
CJ/Wayfair partnership approval first"*). It is the stronger position: every
source table above is a **snapshot of a commercial situation that changes
without notice**, and CJ's zero-joined-advertisers finding is exactly the kind
of fact that could reverse next month. Architecting around any single row of
that table bets the design on the least stable input available. The interface
does not care which row resolves first.

It also removes the hard precondition Section 7 previously carried — see the
revised Section 7.

---

## 6. The Amazon question

### a. Can Amazon remain primary if we build a real matcher?

**No — and it does not need to be.** With no catalog, there is nothing to
match, rank, or price-band. Every signal in Section 3 except relevance is
unavailable. Amazon is structurally incompatible with a matching engine.

That is not a reason to remove it. It is a reason to **change its job**.

### b. Should Amazon become the fallback?

**Yes.** Amazon's actual strength is that it *never fails*: a search URL can be
constructed from `searchTerms` alone, for any recommendation, with no
partnership, no feed and no matching. It has 100% coverage precisely because it
does nothing intelligent.

The clean division:

- **Catalog sources** answer "here is *the* product" — matched, ranked, priced.
- **Amazon** answers "here is *where to look*" — for everything unmatched.

This is what the existing resolver architecture was already built for.
`resolveProductDestination` picks the first source whose `canResolve` returns
true and **falls back to `AmazonSearchSource`**. Adding a catalog source is a
new entry in `PRODUCT_SOURCES` with a `canResolve` that returns true only when
a confident match exists. **No change to the resolver signature, the returned
shape, or any call site.** The fallback design predates the matcher and
accommodates it exactly.

### c. Amazon product data without PA-API / Creators API?

**No legitimate route.** PA-API is deprecated for new and low-volume accounts;
the Creators API is gated on sales volume — the same
information-released-only-after-you-qualify gate documented for Rakuten.
Scraping violates Amazon's ToS and is **not recommended and not evaluated**.

There is one legitimate unlock: Creators API access is *earned* by driving
sales. If catalog sources increase conversion overall, Amazon volume can rise
with it. That makes Amazon a **plausible later catalog, reached by succeeding
without it** — not a v1 dependency.

### d. Mixed-result user experience

Some cards will carry a real matched product; others a search link. Handled
badly this reads as broken. Three principles:

1. **Never label the difference as a deficiency.** No "no match found". The
   fallback card keeps the current, already-working behaviour, which users have
   never seen as a failure.
2. **Let the card shape carry the meaning.** A matched product legitimately
   shows name, price and image. A fallback shows type and `shortReason` with a
   "Find options" affordance — very close to today's card. The difference reads
   as *more* information where available, not *missing* information elsewhere.
3. **Never fabricate parity.** Do not show an estimated price on a fallback
   card. An invented price is the one thing here that damages trust
   irrecoverably.

Worth stating plainly: today **100%** of recommendations are fallback, and that
is the current shipped experience. Every matched product is an improvement on
that baseline. The mixed state is strictly better than the status quo, not a
compromise from an ideal.

---

## 7. Minimum viable intelligence

The smallest thing that beats generic Amazon search, works with one real
catalog, needs no precomputed embeddings, is testable against real data, and
preserves the resolver architecture.

### Scope

**1. Deterministic query rewriter — no model.**
Handles the measured structure directly: split on `or` (52% of the corpus,
1.52x intent expansion), strip purpose clauses (19%), strip room words, map the
head noun to a catalog category. This alone addresses most of the 87%
translation problem and is pure string handling.

**CORRECTED 2026-08-18 by the MVI build.** This originally said to strip room
words "using the `QUERY_STOPWORDS` set **that already exists in `App.js`**".
Implemented literally, that is **wrong**, and the correction is now part of the
design rather than a note on it.

In `App.js`, `QUERY_STOPWORDS` never strips anything. Its only use is inside
`buildAmazonSearchQuery`, as a filter on words being **appended** as context
hints:

```js
if (tokens.every((t) => seen.has(t) || QUERY_STOPWORDS.has(t))) return;
```

The base query is never touched. The set therefore conflates two different
jobs, and reusing it as a strip-list damages real product categories: it
contains `"wall"`, which appears **7 times** in corpus `productType` values,
every occurrence load-bearing. `"framed wall art"` would become
`"framed art"` — a strictly worse catalog query.

The rewriter splits the set **by job** rather than reusing it **by name**:

| Set | Rule |
|---|---|
| **`FUNCTION_WORDS`** | Pure syntax (`the`, `and`, `or`, `for`, `with`, `of`, …). **Always** strippable, no exceptions |
| **`LOCATION_WORDS`** | Room / spatial words (`bathroom`, `pantry`, `niche`, `wall`, `credenza`, …). Strippable **only outside a protected compound** |
| **`PROTECTED_COMPOUNDS`** | Explicit bigram list where a location word is part of the category itself (`wall art`, `bath mat`, `table lamp`, `picture light`, `bar cabinet`, …). Checked before any location stripping |

`PROTECTED_COMPOUNDS` is deliberately an explicit list rather than a heuristic:
a heuristic here fails silently and invisibly, and the list is short enough to
read and argue with. Measured effect on the corpus: **12 location tokens
protected** that naive stripping would have removed, against 18 tokens
correctly stripped.

**2. A catalog-source interface — not a source.** *(revised per decision #1)*
Define the contract every source must satisfy — `search(intent) -> candidates[]`
returning normalized rows (id, name, price, image, url, availability,
category) — and implement it for whichever catalog becomes sufficiently good
first. CJ, Rakuten, Awin and a future Amazon PA-API are then implementations,
not architectural choices.

This is the same shape as the existing `PRODUCT_SOURCES` adapter split in
`App.js`, one layer down: that layer already abstracts *link construction*
across incompatible mechanisms, and this abstracts *retrieval* the same way.

**3. Lexical re-rank plus the Section 3 formula.**
No embeddings. Token-overlap scoring plus percentile price fit, availability
and context fit. Percentile pricing needs only the candidate set.

**4. A confidence gate — the load-bearing piece.**
Below threshold, `canResolve` returns false and Amazon fallback serves it
unchanged. **A wrong matched product is worse than a search link**, because it
looks authoritative. The gate is what makes shipping a partial matcher safe.

**5. The 13% underspecified class — v1 non-goal, roadmap item.**
*(confirmed by decision #5)*
Send `Decorative objects for display styling` and its six siblings straight to
fallback. They need style judgment the ranker does not have, and a confident
wrong answer there is worse than the honest search link. **Do not reach for an
LLM to paper over it in v1** — that treats a schema problem as a reasoning
problem. The intended fix is structured `productNeed` at the source
(Section 9), after which the underspecified rate is **re-measured against this
same corpus**.

### Deliberately excluded from v1

Embeddings; LLM re-ranking; multi-source merging; background refresh; visual
matching; commission tiebreaking (add once ranking is trusted).

### How it gets tested

The 54-recommendation corpus is the evaluation set, and it already exists.
Because matching is pre-computed (Section 4), every match is a stored artifact
scorable offline with no user present. Concretely: run the rewriter over all
54, confirm 82 intents, retrieve, rank, and hand-score top-3 relevance. The
measured baseline — 20% clean-matchable, 87% translation, 13% irreducible —
gives a target to beat that was derived before anything was built.

### MVI results — BUILT AND MEASURED 2026-08-18

Implemented in `shared/productMatching/` against a 202-product fixture
catalog. **26 assertions, 0 failures.** Full detail in
`ProductMatchingImplementation.md`.

| Measure | Result |
|---|---|
| **Intents from 54 recommendations** | **82** — exactly the 1.52x this document predicted |
| **Coverage, AND-semantics** (meaningful figure) | **69%** (37/54) |
| Coverage, OR-semantics (forgiving) | 100% (54/54) |
| **Effective underspecified rate** | **~4%** (2/54), down from the 13% measured here |
| **Distractors selected** | **0** — and 0 reached any intent's top 3 |
| Selection changed by rewriting | **23 of 51** shared matches chose a *different* product |

**Retrieval semantics dominate every other variable, and 69% is the figure to
quote.** Running the rewriter against both retrieval models:

| | no rewrite | with rewriter | delta |
|---|---|---|---|
| **OR-semantics** (forgiving) | 94% (51/54) | 100% (54/54) | +3 |
| **AND-semantics** (realistic) | 37% (20/54) | 69% (37/54) | **+17** |

Under OR-semantics the rewriter looks nearly worthless — raw `productType`
already reaches 94%. That reading is an artifact of a generous fixture. A
structured catalog API with a real category tree behaves closer to
AND-semantics, and this document already says relevance "degrades with query
length" for exactly that reason. **Under realistic retrieval the rewriter
nearly doubles coverage.**

Two consequences:

1. **69% is the meaningful current result.** The 100% figure is an upper bound
   measured under the friendliest possible retrieval, against a fixture
   authored alongside the matcher. Real coverage will land between the two and
   nearer the bottom.
2. **Retrieval semantics must be established for any real source before its
   numbers mean anything.** It is worth roughly 30 points of coverage, which
   makes it the single largest unknown remaining.

Coverage alone also understates the rewriter: of the 51 recommendations matched
by **both** arms, **23 selected a different product**. Rewriting changes match
*quality*, not only whether a match exists — something a binary metric cannot
see.

**The ~4% effective underspecified rate is evidence for decision #5.**
Disjunction splitting partially dissolves the class: when `"decorative objects"`
is paired with a concrete alternative (`"or vases"`, `"or sculptural pieces"`),
the concrete branch is matchable and matches sensibly. Only the two with *no*
concrete branch fall back. Better structure at the intent layer cut the rate
from 13% to 4% **before structured `productNeed` exists at all**, which is
direct support for the thesis that underspecification is a schema problem
rather than a reasoning one — and suggests the ~3% target is reachable.

**The hard precondition is removed by decision #1.** The original text here
said one catalog source must be commercially live before this was worth
building. That was true of a single-source design; it is not true of an
interface-first one.

Two of the three v1 components — the **deterministic rewriter** and the
**ranking formula** — depend only on the recommendation corpus and a candidate
set. Both are fully testable against a **fixture catalog** with no commercial
relationship in place: score the rewriter by whether all 54 recommendations
produce the expected 82 intents with room words stripped and disjunctions
split, and score the ranker by feeding it hand-built candidate sets with known
correct orderings. Neither test needs a live source.

What still requires a live source is **end-to-end retrieval quality** — recall,
and whether real catalog vocabulary is reachable from rewritten queries. That
is the one measurement that must wait, and it is a reason to sequence it last,
not a reason to delay the other two.

---

## 8. Decisions — RECORDED 2026-08-18

All six decided. Nothing in this section is open.

| # | Question | Decision |
|---|---|---|
| 1 | Which catalog source is v1 built against? | **Source-agnostic — build the interface** |
| 2 | Does commission influence ranking? | **Tiebreak only, epsilon <= 0.02** |
| 3 | Precompute given staleness? | **Precompute + stale commerce refresh** |
| 4 | Ship partial coverage? | **Yes — ship partial** |
| 5 | Is the 13% underspecified class in scope? | **Roadmap item, not a v1 LLM problem** |
| 6 | Should `searchTerms` stay Amazon-shaped? | **Yes — keep it** |

---

### #1 — Source-agnostic. Do not build against a specific catalog source.

Build a **catalog-source interface** and let the first sufficiently good
catalog become the first implementation. Wayfair, Rakuten and Amazon PA-API
must all plug into the same architecture.

**Supersedes the original recommendation**, which was to pursue CJ/Wayfair
partnership approval first and build against that. The decision is the stronger
position, for a reason the original recommendation understated: every source
capability table in Section 5 is a snapshot of a **commercial situation that
changes without notice**. CJ's zero-joined-advertisers finding could reverse
next month. Architecting around any single row bets the design on the least
stable input available.

**Lands in:** Section 5 (premise check retired), Section 7 item 2 (rewritten as
an interface), Section 7 precondition (removed — see #4 below for why v1 is
still testable).

### #2 — Commission tiebreak only, epsilon <= 0.02. **DECIDED.**

Commission breaks a tie **only after all user-relevant criteria have been
applied**. Products at 0.84 and 0.83 are equivalent enough that economics can
decide. **Commission must never rescue a mediocre product.**

Epsilon assumes normalized 0-1 scores — which the Section 3 formula produces by
construction, since every term is bounded to [0,1] and the weights sum to 1.00.
Any future reweighting must preserve that, or epsilon silently changes meaning.

**Lands in:** Section 3g.

### #3 — Precompute + stale commerce refresh. **DECIDED.**

**Separate product identity from volatile commerce data.** A stale refresh
updates price, availability and link. **Rematching happens only when** the
product disappears, becomes unavailable, or the underlying recommendation
changes. **Do not rematch merely because a price changed.**

This sharpens the original recommendation rather than replacing it. The
original said "re-run the matcher on read if older than N days" — that
described a *rematch* where a *refresh* is correct, and the distinction is
load-bearing: rematching on price churn would let the cheapest-at-this-instant
product win on refresh cadence rather than on fit, quietly converting the
Section 3c price percentile from a ranking signal into a selection one.

**Lands in:** Section 4 (refresh/rematch table), Section 0 (this is the
identity/commerce split stated as principle).

### #4 — Ship partial coverage. **DECIDED.**

A specific product appears **only when Product Intelligence has enough
evidence**. Otherwise the existing "Find options →" fallback serves the user.
This is **more trustworthy than filling every slot with weak matches for
consistency**.

Confirms the original recommendation. Worth restating the baseline it is
measured against: **today 100% of recommendations are fallback.** Partial
coverage is strictly better than the shipped experience, not a compromise from
an ideal one.

**Lands in:** Section 7 item 4 (the confidence gate is what makes this safe),
Section 6d (mixed-experience principles).

### #5 — The 13% underspecified class is a roadmap item.

**Do not solve it with an LLM in v1.** After structured `productNeed` ships,
**measure the underspecified rate again**. If it drops from 13% to ~3%, the
problem was solved at the correct layer.

This is the sharpest decision of the six, because it reframes the problem. The
original Section 8 offered no recommendation here, treating it as a
product-direction question. The decision identifies it as a **schema problem
wearing a reasoning problem's clothes**: `decorative objects or vases for niche
styling` is underspecified because the *output format* forces one free-text
string, not because the model lacks the judgment to be specific. Fixing the
format is the correct layer; an LLM re-ranker would be a workaround at the
wrong one.

It also supplies a **falsifiable success criterion** — 13% to ~3%, measured
against this same 54-recommendation corpus. That is a real test, and it can
fail. If the rate does not drop, the diagnosis was wrong and the class is
genuinely irreducible.

**Lands in:** Section 7 item 5, Section 9.

### #6 — Keep `searchTerms` Amazon-shaped. **DECIDED.**

**Do not damage the working 100% fallback.** The deterministic rewriter handles
catalog-specific translation.

Confirms the original recommendation in Section 2e.

**Lands in:** Section 2e.

---

## 9. Roadmap — structured `productNeed`

**Future Call 2 enhancement. Not v1.**

Instead of:

```json
"productType": "small potted plant or candle"
```

generate:

```yaml
productNeed:
  intent: "add warmth and visual interest"
  alternatives:
    - type: "small potted plant"
    - type: "candle"
  shortReason: "Adds warmth to the styled surface"
```

### Why this is the right layer

It **eliminates disjunction-splitting at the source**. Section 1 measured 28 of
54 recommendations (52%) as disjunctive, expanding to 82 intents. Under
`productNeed` that expansion is **explicit in the schema** rather than
recovered by parsing English prose for the word `or` — and prose parsing is
inherently lossy, since `or` is also legitimate inside a single product name.

It should also **reduce the 13% underspecified rate**, because a required
`intent` field forces the model to state what the product is *for* separately
from what it *is*. Much of the underspecification in the corpus looks like the
two being compressed into one string: `Decorative objects for display styling`
is an intent (`styling this surface`) with the product type left blank.

### Backward compatibility

**The deterministic rewriter is what makes this safe to adopt later.** It
already normalizes today's unstructured `productType` / `searchTerms` into
product intents (Section 0, middle layer). When `productNeed` ships, the
rewriter gains a second input path and existing plans keep working unchanged —
no backfill, no migration, no rewriting stored analyses.

This is the Section 0 separation paying for itself: because product intent is
**derived and never stored**, changing how it is derived cannot invalidate a
single existing plan.

### Measurement

Re-run the Section 1 analysis against `productNeed`-era recommendations and
compare to this document's baseline: **53/54 distinct phrases, 52% disjunctive,
82 intents, 13% underspecified.** Decision #5 sets the target at ~3%
underspecified.

---

## Appendix — provenance

Section 1 computed from all 54 recommendations in `cluttrd-staging`
(9 users), read-only, GETs only, 2026-08-18. Jaccard over 1,431 phrase pairs.
Structural buckets from token analysis; the 22/25/7 semantic split is a manual
classification of all 54 and is the one judgement-based figure in Section 1 —
the token, overlap, disjunction and head-noun counts are all mechanical.

Source capabilities cite `CJProductFeedPOC.md`, `AwinProductFeedPOC.md` and
`AffiliatePipeline.md`. Resolver behaviour cites the `[PI-RESOLVER]` block in
`App.js`. No code, Firestore data, or deployment was modified.

**Decisions recorded 2026-08-18** (Section 8), together with Section 0
(three-layer separation) and Section 9 (structured `productNeed` roadmap).
Sections 2e, 3g, 4, 5 and 7 were reconciled to the decisions at the same time;
each carries an inline note where a decision superseded or sharpened the
original recommendation. Decisions #1 and #3 changed the design; #2, #4 and #6
confirmed it; #5 answered a question the document had deliberately left open.
Still design only — nothing implemented.
