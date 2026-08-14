# Awin Mosaic Feed — Comparative Product Intelligence Test

**Run 2026-08-14. Read-only. No implementation.**

Baseline: `AwinProductFeedPOC.md` (King Koil). Comparison: Mosaic Weighted
Blankets, downloaded live from the Awin datafeed API.

**Decision: A — BUILD INGESTION NEXT**, scoped to the source/normalization layer
and a catalog-sizing tool. Not ranking.

**The core question — are sparse fields an Awin limitation or an advertiser
limitation? — has a two-part answer, and both parts matter:**

- **A hard Awin-wide floor exists.** `product_type`, `keywords`,
  `specifications`, `dimensions`, `colour`, `last_updated`, all rating/review
  fields, and every additional-image field are **0% populated in both feeds**.
  These are not advertiser choices; they are structurally absent.
- **Above that floor, everything is advertiser-dependent — and it varies in
  *both directions*.** King Koil populates `brand_name`, `merchant_category`,
  `mpn` (100% each); Mosaic populates none of them. Mosaic populates
  `rrp_price` (18%) and `merchant_thumb_url` (100%); King Koil populates
  neither.

Mosaic is **not** simply "a better feed." It has **worse structured metadata**
(23% of columns carry data vs King Koil's 29%) and **dramatically better text**
(46 distinct product descriptions vs 1). That inversion is the most important
finding here.

---

## 0. Correcting the feed ID, and a credential note

The download attempt failed with:

```
"Invalid fid format: 101819,F3656. Must be digits and commas only."
```

`F3656` is not a valid feed ID. Resolved authoritatively against the live feed
list: **no feed with ID `3656` exists** among the 590 visible to this account.
Mosaic's actual feed is:

```
Feed ID 105766 | Advertiser ID 87403 | Mosaic Weighted Blankets
496 products | US | status: active
Feed Name: sftp://datafeeds.shareasale.com/Awin/646
```

Note the feed name: Mosaic's catalog is a **ShareASale feed piped into Awin**.
Worth remembering — it may explain the missing `brand_name`/`merchant_category`,
since those are Awin-native columns a relayed feed need not fill.

**Credential handling.** The datafeed API key was pasted into chat. It has been
moved to `C:\Users\mharr\.uncluttrd-awin.env` (outside the repository, mode 600),
is redacted from every script's output, and appears nowhere in this document or
any artifact. **It should still be rotated**, because it exists in conversation
history. `.gitignore` line 34 remains `.env*.local` only — a repo-root `.env` is
still committable, unchanged since the CJ POC.

---

## 1. Mosaic feed audit

| | King Koil | Mosaic |
|---|---|---|
| Compressed / inflated | 3,763 B → 60,229 B (16.0×) | 37,190 B → 1,160,531 B (**31.2×**) |
| Columns | 86 | 86 |
| Rows | 29 | **496** |
| **Distinct products** | **1** | **46** |
| Variant rows per product | 29.0 | **10.8** |
| merchant_id / data_feed_id | 115216 / 101819 | 87403 / 105766 |
| Currency | USD | USD |
| Categories represented | 1 (`Mattresses`) | **0 — no category field populated at all** |

**Duplicate IDs: none in either feed.** `aw_product_id` and
`merchant_product_id` are 496/496 distinct in Mosaic. `mpn`, `ean`, `upc` and
`product_GTIN` are **entirely empty** in Mosaic (King Koil had `mpn` at 100%).

**Variant families — 41 names carry more than one row.** `parent_product_id` is
empty in both feeds, so families cannot be grouped by the intended field.
However, **`merchant_deep_link` path (ignoring `?variant=`) yields exactly 46
distinct paths — matching the 46 distinct product names precisely.** That is a
reliable grouping key, and it is the practical answer to "determine variant
families rather than treating every row as a candidate."

Largest families and their real shape:

| Product | Variants | Price range |
|---|---:|---|
| Minky Dot Duvet Cover | 36 | $149.95–$199.95 |
| Light Aqua / Navy Blue / Gray Cotton Weighted Blanket | 19 each | $172.44–$344.94 |
| Weighted Blanket (generic) | 18 | $172.44–$340.34 |
| Ocean Blue / Lavender / Navy / Latte / Royal Blue / Purple / Pink Minky | 15 each | $160.94–$321.94 |
| ~18 patterned blankets (Kensington Plaid, Americana, Dia de los Muertos…) | 11 each | $149.44–$229.94 |
| Minky Weighted Shoulder Wrap | 8 | $57.44 |
| Weighted Wrist Rest | 5 | $14.89 |

**Data-hygiene finding: the catalog contains non-products.** `Gift Wrapping`
($9.95, 3 rows), `Shipping Insurance` ($9.95), and `Shipping Protection` ($9.95)
are feed rows indistinguishable from merchandise by any structured field. This
matters in §4.

**Variant attributes are encoded in the SKU**, not in any attribute column:

```
KENSPL-50-5   -> Kensington Plaid, 50", 5 lb    $172.44
KENSPL-50-8   -> Kensington Plaid, 50", 8 lb    $172.44
KENSPL-60-12  -> Kensington Plaid, 60", 12 lb   $201.19
```

`{pattern}-{width}-{weight}`. Legible to a human, and parseable — but it is a
per-merchant convention, not a schema. Mining free text recovers a similar
amount: size words in 341/496 rows, weight-in-lbs in 387/496, material in
332/496 — versus **0/496 from the structured `colour`, `dimensions` and
`product_type` columns**.

---

## 2. Field-population comparison

### The Awin-wide floor — 0% in BOTH feeds

`product_type` · `keywords` · `specifications` · `dimensions` · `colour` ·
`last_updated` · `reviews` · `average_rating` · `rating` · `store_price` ·
`saving` · `savings_percent` · `delivery_cost` · `stock_status` ·
`stock_quantity` · `large_image` · `alternate_image` ·
`alternate_image_two/three/four` · `product_GTIN` · `upc` · `isbn` ·
`parent_product_id` · `basket_link` · `brand_id` · `condition` ·
`product_short_description` · `promotional_text` · `base_price*` ·
`product_price_old` · `valid_from/to` · `web_offer` · `pre_order` ·
`warranty` · `delivery_weight` · `commission_group` ·
`merchant_product_category_path` · `merchant_product_second/third_category` ·
`number_available` · `custom_2`–`custom_9`

**Two independent advertisers, in different verticals, on different upstream
platforms (Shopify-native vs ShareASale-relayed), agree exactly on all of the
above.** That is strong evidence these are Awin-level absences, not
advertiser-level ones.

### The shared reliable core — 100% in BOTH

`aw_deep_link` · `merchant_deep_link` · `product_name` · `description` ·
`aw_product_id` · `merchant_product_id` · `merchant_id` · `merchant_name` ·
`data_feed_id` · `search_price` · `display_price` · `currency` ·
`merchant_image_url` · `aw_image_url` · `aw_thumb_url` · `in_stock` ·
`is_for_sale`

**17 fields.** Every one of them populated 29/29 and 496/496.

### Where the two feeds diverge

| Field | King Koil | Mosaic | Direction |
|---|---|---|---|
| `brand_name` | **29/29 100%** | 0/496 0% | King Koil only |
| `merchant_category` | **29/29 100%** | 0/496 0% | King Koil only |
| `category_name` / `category_id` | **29/29 100%** | 0/496 0% | King Koil only |
| `mpn` | **29/29 100%** | 0/496 0% | King Koil only |
| `delivery_time` | **29/29 100%** | 0/496 0% | King Koil only |
| `ean` | 7/29 24% | 0/496 0% | King Koil only |
| `custom_1` | 29/29 100% | 0/496 0% | King Koil only |
| `rrp_price` | 0/29 0% | **91/496 18%** | **Mosaic only** |
| `model_number` | 0/29 0% | **81/496 16%** | **Mosaic only** |
| `merchant_thumb_url` | 0/29 0% | **496/496 100%** | **Mosaic only** |

**Summary**

| | 100% | Partial | Empty | Carrying data |
|---|---:|---:|---:|---:|
| King Koil | 24 | 1 | 61 | **29%** |
| Mosaic | 18 | 2 | 66 | **23%** |

**The advertiser with 17× more products has fewer populated columns.** Feed
richness and catalog size are independent variables.

### Answer to the key question

**Both.** There is a hard Awin-wide floor of ~30 permanently empty fields that no
advertiser fills — including every field a ranking layer would most want. Above
that floor, population is advertiser-dependent and varies in both directions, so
**no field outside the 17-field shared core may be assumed present.**

---

## 3. Affiliate readiness — Mosaic passes identically

| Check | King Koil | Mosaic |
|---|---|---|
| `aw_deep_link` populated | 29/29 | **496/496** |
| Host + path | `www.awin1.com/pclick.php` | **identical** |
| `a=` (publisher) | `2963149`, distinct=1 | **`2963149`, distinct=1** |
| `m=` matches `merchant_id` | ✓ 115216 | **✓ 87403** |
| `p=` distinct | 29/29 | **496/496** |
| `p=` equals `aw_product_id` | 29/29 | **496/496** |
| `merchant_deep_link` | 29/29, 29 distinct | 496/496, **46 distinct** |
| **Monetizable without a second call** | **true** | **true** |

Sample: `https://www.awin1.com/pclick.php?p=41892303638&a=2963149&m=87403`

Tracking links were **not fetched** — firing them would register real affiliate
clicks. Structure was analysed instead.

Note the asymmetry in the last row: Mosaic has 496 distinct *affiliate* links but
only 46 distinct *merchant* URLs, because variants share a product page and are
distinguished by `?variant=`. **The affiliate link is variant-precise even where
the merchant URL is not** — a point in Awin's favour, and a reason to always use
`aw_deep_link` rather than reconstructing from `merchant_deep_link`.

---

## 4. Product diversity and rankability

### The discrimination ceiling

| | King Koil | Mosaic |
|---|---:|---:|
| Searchable fields with data | 5 | **2** (`product_name`, `description`) |
| **Distinct searchable text** | **1/29** | **46/496** |
| Distinct `product_name` | 1 | **46** |
| Distinct `description` | 1 | **46** |
| Distinct `search_price` | 9 | 30 |
| Vocabulary | 107 terms | **794 terms** |
| **Terms that discriminate** | **0** | **794** |

King Koil had *more* searchable fields but **zero** discriminating terms — every
row shared identical text. Mosaic has *fewer* fields but **every one of its 794
vocabulary terms appears in some rows and not others.**

**Lexical retrieval is viable on Mosaic and impossible on King Koil.**

### Query matrix

| Query | King Koil | Mosaic (rows) | Mosaic (distinct products) |
|---|---|---|---|
| weighted blanket | none | 479/496 | 39 |
| queen weighted blanket | none | 36/496 | — |
| cooling weighted blanket | none | **none** | 0 |
| throw blanket | none | 315/496 | 25 |
| bedroom blanket | none | 133/496 | — |
| cotton blanket | none | 182/496 | — |
| minky blanket | none | 149/496 | — |
| duvet cover | none | 42/496 | 2 |
| gray | none | 47/496 | 4 |
| storage basket | none | **none** | 0 |
| mattress | **ALL 29 (no discrimination)** | none | 0 |

`cooling weighted blanket` correctly returns nothing — Mosaic sells no cooling
line, and the search does not hallucinate one. `storage basket` correctly returns
nothing. **Negative controls behave properly, which is what makes the positive
results trustworthy.**

### Where naive ranking fails

Ranking the "weighted blanket" candidates by price ascending — the only numeric
signal available — puts these first:

```
1. Gift Wrapping              $9.95    <- not a product
2. Grab Bag Weighted Lap Pad  $35.99   <- mystery/blind item
3. Letters Cotton Weighted Blanket $124.95
```

**The top result is gift wrapping.** It matched because its description contains
"weighted blanket", and it won because it is cheapest. With `product_type` empty
there is no structured way to exclude it. Any ranking layer must therefore
defend against non-merchandise rows using text heuristics — a real, concrete
requirement this test surfaced that the King Koil feed could never have revealed.

### Fields responsible for matches, and what ranking evidence exists

Every Mosaic match is driven by `product_name` + `description` **only**. For a
typical result set:

```
price        478/478 populated
brand        ABSENT      category     ABSENT      productType  ABSENT
colour       ABSENT      dimensions   ABSENT      rating       ABSENT
reviews      ABSENT      keywords     ABSENT
freeTextDesc 39 distinct across 478 rows
```

**Two rankable signals exist: price, and free text.** Nothing else.

**Where semantic/AI ranking adds value — and where it cannot.** On Mosaic it adds
real value: the descriptions are genuinely distinct, so "calm, neutral bedroom"
can be matched against *"Gray Marble Weighted Blanket – Neutral, Calming, and a
Bestseller"* in a way keyword matching cannot. That is a legitimate use of an
embedding or LLM layer. On King Koil it adds **nothing** — 29 identical strings
produce 29 identical vectors. The conclusion from the first POC holds and is now
better specified: **semantic ranking helps exactly where descriptions differ, and
that is an advertiser-by-advertiser property.**

---

## 5. Simulated Uncluttrd recommendation resolution

Using only data present in the feed. Candidate counts are **distinct products**,
after collapsing variants by `merchant_deep_link` path.

### Intent 1 — Bedroom / Polished & Practical / "visible bedding feels visually inconsistent"

Query `weighted blanket` → 478 rows → **39 distinct candidates.**
Price ✓ · image ✓ · affiliate link ✓ · evidence = free text only.
**Verdict: too broad to be useful.** 39 candidates with no attribute to filter on
means the choice is effectively arbitrary. And the naive top result is Gift
Wrapping (above). Retrieval succeeded; resolution did not.

### Intent 2 — Bedroom / Elevated / "colour scheme feels busy" → neutral tone

Query `weighted blanket` + `gray` → 47 rows → **4 distinct candidates:**

| Candidate | Price | Variants |
|---|---|---|
| Charcoal Gray Plush Duvet Cover | $172.44–$206.94 | 6 |
| Dove Gray Batik Weighted Blanket | $172.44–$229.94 | 11 |
| Gray Cotton Weighted Blanket | $172.44–$344.94 | 19 |
| Gray and Pink Batik Weighted Blanket | $172.44–$229.94 | 11 |

**This is the one that works.** Four genuinely distinct, on-intent candidates,
each with a real price, a working 200×200 image, and a variant-precise affiliate
link. "Gray Marble Weighted Blanket – Neutral, Calming" is defensibly the best
match for "calm a busy room" — and that judgment comes from Uncluttrd's context
plus the description text, not from any feed attribute. **Note the colour filter
worked by matching the word "gray" in free text; the `colour` column is empty.**

### Intent 3 — Living Room / Simple / "sofa reads unfinished" → throw blanket

Query `throw` → 315 rows → **25 candidates.** All are weighted blankets; Mosaic
sells no throws. "throw" appears in size descriptions. **Verdict: false positive
at scale.** A category the merchant does not serve produced 25 confident-looking
candidates. This is the failure mode that matters most for user trust, and it is
invisible without a category field.

### Intent 4 — Bedroom / Polished / "mismatched bedding layers" → duvet cover

Query `duvet cover` → 42 rows → **2 candidates** (Minky Dot $149.95–$199.95;
Charcoal Gray Plush $172.44–$206.94). Clean, precise, fully resolvable.

### Intent 5 — Kitchen / Simple / "counter clutter" → storage basket (negative control)

**0 rows, 0 candidates.** Correctly falls through to Amazon search. The fallback
path is exercised correctly.

**Across five intents: 2 clean resolutions, 1 too-broad, 1 false-positive, 1
correct rejection.** The failures are all attribute-driven — no category, no
product type — not retrieval failures.

---

## 6. ProductCandidate normalization

| Candidate field | Source column | King Koil | Mosaic | Class |
|---|---|---|---|---|
| `source` | constant | ✓ | ✓ | **core** |
| `retailer` | `merchant_name` | 100% | 100% | **core** |
| `merchantId` | `merchant_id` | 100% | 100% | **core** |
| `sourceFeedId` | `data_feed_id` | 100% | 100% | **core** |
| `productId` | `aw_product_id` | 100% | 100% | **core** |
| `merchantProductId` | `merchant_product_id` | 100% | 100% | **core** |
| `title` | `product_name` | 100% | 100% | **core** |
| `description` | `description` | 100% | 100% | **core** (but may be non-distinct) |
| `imageUrl` | `aw_image_url` | 100% | 100% | **core** |
| `price.amount` | `search_price` | 100% | 100% | **core** |
| `price.currency` | `currency` | 100% | 100% | **core** |
| `availability` | `in_stock` | 100% | 100% | **core** (binary only) |
| `merchantUrl` | `merchant_deep_link` | 100% | 100% | **core** |
| `affiliateUrl` | `aw_deep_link` | 100% | 100% | **core** |
| `brand` | `brand_name` | 100% | **0%** | advertiser-dependent |
| `category` | `merchant_category` | 100% | **0%** | advertiser-dependent |
| `attributes.mpn` | `mpn` | 100% | **0%** | advertiser-dependent |
| `attributes.gtin` | `ean` | 24% | 0% | advertiser-dependent |
| `productType` | `product_type` | **0%** | **0%** | **unsupported** |
| `attributes.color` | `colour` | **0%** | **0%** | **unsupported** |
| `attributes.dimensions` | `dimensions` | **0%** | **0%** | **unsupported** |
| `lastUpdated` | `last_updated` | **0%** | **0%** | **unsupported** |
| ratings / reviews | — | **0%** | **0%** | **unsupported** |

**King Koil: 16/21 fully populated. Mosaic: 13/21.**

- **Reliable common core (14 incl. `source`)** — safe to mark required.
- **Advertiser-dependent enrichment (4)** — `brand`, `category`, `mpn`, `gtin`.
  Present in one feed, absent in the other, in *both* directions across the two
  advertisers. Must be optional.
- **Always optional / unsupported (5+)** — `productType`, `color`, `dimensions`,
  `lastUpdated`, ratings. Never assume; `lastUpdated` must be nullable with our
  own `fetchedAt` stamped at ingest.

---

## 7. Cross-advertiser conclusions

**1. Can one normalized Awin adapter support both feeds?**
**Yes, without special-casing.** Identical 86-column schema, identical CSV/gzip
transport, identical `awin1.com/pclick.php?p=&a=&m=` link grammar, identical
`a=2963149`. The same parser handled both with no per-advertiser branching. The
only adapter logic the difference demands is *"treat non-core fields as
optional"* — which is a contract property, not a code path.

**2. Does feed quality vary materially by advertiser?**
**Yes, materially — and not on a single axis.** Mosaic has 17× the products, 46×
the distinct descriptions, and 794 discriminating terms vs zero; it also has
*fewer* populated columns and no brand, category, or MPN. Quality is at least
two independent dimensions — **structured completeness** and **text
distinctiveness** — and an advertiser can be strong in one and weak in the other.
King Koil is the degenerate case of good structure over useless text; Mosaic is
the inverse.

**3. Can PI assume a small required core and treat the rest as optional
evidence?**
**Yes — and this is now evidence-based rather than defensive.** The 14-field core
held at 100% across two structurally different advertisers on different upstream
platforms. Everything else must be optional, because the two feeds disagree about
enrichment fields in both directions.

**4. Does Mosaic provide substantially better rankability?**
**Yes, decisively — but only textually.** 46 distinct candidates vs 1; 794
discriminating terms vs 0; intents 2 and 4 resolved cleanly, which was impossible
on King Koil. But the *structured* rankability is no better and arguably worse:
no category, no type, no colour, no brand. Ranking on Mosaic means ranking on
prose, and prose is what LLM evaluation is good at — which is convenient, but
should be recognised as the only option rather than a design choice.

**5. Are two advertisers enough to justify building ingestion?**
**Yes for ingestion and normalization. No for ranking.** See §9 — and note that
"wait for DHgate" is not an available plan: **DHgate returns 0 matches across all
590 feeds visible to this Awin account.** The Awin advertiser directory lists it,
but no feed exists here, and the CJ path remains blocked at `partnerStatus:
JOINED = 0`. Waiting for it means waiting indefinitely for something with no
observed route.

### What the feed list revealed about breadth

Retrieving the feed list (1 request, 1.7 s, 590 rows) gives **product counts and
import timestamps for every feed, joined or not** — including the 588 not joined.
That is a catalog-sizing tool available *before* applying to anything:

- **142 US feeds**, ~1.9M US products visible in aggregate.
- **Only 29 of 142 imported within 7 days. 105 of 142 (74%) are 30+ days stale.**
- Only 16 US feeds have ≥5,000 products; only **7** are both large and fresh.
- The largest US feeds are print-on-demand and apparel — Printerval (542,455, 91
  days stale), Gotodirect (488,296), Alberto Nardoni (250,001), Emensuits,
  PandaHall — **not home organization**.
- Home-relevant and fresh: **Black Canyon Home & Body** (6,470 products, imported
  today), **Regina Andrew Detroit** (2,751, 1 day), **Super Area Rugs** (2,254,
  but 91 days stale).

**The stale-feed risk found on CJ is present on Awin at scale** — 74% of US
feeds. The feed list's `Last Imported` column is the guard, and it works.

---

## 8. Architecture recommendation

The hybrid stands, with the layer boundary now empirically justified rather than
asserted:

```
recommendation intent (Room + Area + approach + problem + grounding + ambition)
        │
        ▼
┌─── SOURCE / CATALOG LAYER ────────────────────────────────────┐
│  AwinFeedSource      gz/CSV pull, aw_deep_link, a=2963149,    │
│                      feed-level freshness from the feed list  │
│  CJProductSource     GraphQL, linkCode(pid:) — blocked        │
│  AmazonSearchSource  search-URL construction, tag=…           │
│  → emits ProductCandidate[]  (14 required, rest optional)     │
└───────────────────────────────────────────────────────────────┘
        │  network-agnostic candidates
        ▼
┌─── PRODUCT INTELLIGENCE LAYER ────────────────────────────────┐
│  retrieval / filtering                                        │
│  contextual evaluation & ranking against Room, Area,          │
│  approach, problem, solution intent, grounding, ambition      │
│  → chosen candidate, or none                                  │
└───────────────────────────────────────────────────────────────┘
        │
        ├── candidate chosen → open candidate.affiliateUrl (opaque)
        └── no suitable candidate → context-aware Amazon affiliate search
```

**Source layer owns:** retrieval and transport; source-specific identifiers;
**all affiliate-URL construction**; source freshness semantics; and — new from
this test — **variant-family collapsing**, since that is source-specific
(`merchant_deep_link` path on Awin) and the intelligence layer must never see
496 rows where there are 46 products.

**Intelligence layer owns:** relevance, suitability, ranking, context matching.
It must never contain `awin1.com`, `a=2963149`, `pclick.php`, `linkCode`, or
`tag=uncluttrd20-20`. Two feeds now confirm this is achievable: an identical
`ProductCandidate` came out of two advertisers whose raw data disagreed about
half their columns.

**Three requirements this test adds:**

1. **Variant collapsing belongs in the source adapter.** 496 → 46 must happen
   before ranking. Awin's intended field (`parent_product_id`) is empty in both
   feeds; the working key is the `merchant_deep_link` path, which is an
   Awin-specific detail and therefore must not leak upward.
2. **Non-merchandise filtering is required.** Gift Wrapping and Shipping
   Insurance are structurally indistinguishable from products. With
   `product_type` empty Awin-wide, this must be a text heuristic in the source
   adapter, and it must be assumed necessary for every advertiser.
3. **Category confidence must be explicit.** Intent 3 produced 25 confident
   candidates for a category Mosaic does not sell. Where `merchant_category` is
   empty (Mosaic: always), the adapter cannot assert category, and the
   intelligence layer must be able to decline and fall back rather than pick the
   best of a bad set.

---

## 9. Decision — **A. BUILD INGESTION NEXT**

Based on evidence, not potential.

**What the evidence supports building now:**

- **The adapter is validated.** One parser, zero special-casing, two advertisers
  in different verticals on different upstream platforms (Shopify-native vs
  ShareASale-relayed). The 14-field core held at 100% in both.
- **Monetization is validated twice.** 525 links across two merchants, all
  carrying `a=2963149`, all product-specific, none needing a second call.
- **The freshness design is now solved, not theorised.** The feed list returns
  product counts and `Last Imported` for all 590 feeds in one 1.7 s request. The
  previous POC could only recommend this pattern; it is now measured, and it
  immediately exposed that 74% of US feeds are 30+ days stale.
- **Waiting has no defined end.** DHgate does not appear in any of the 590 Awin
  feeds, and the CJ route remains at `JOINED = 0`. Option B is conditioned on an
  event with no observed path.

**What the evidence says NOT to build:**

- **Not the ranking layer.** `product_type`, `colour`, `dimensions`, ratings and
  `last_updated` are 0% across both feeds — an Awin-wide floor, so a third
  advertiser will not supply them. Ranking will have to run on price and prose,
  and that should be designed against real recommendation text, not guessed at
  now.
- **Not a user-facing product card.** Two single-category advertisers — air
  mattresses and weighted blankets — serve close to zero of what Uncluttrd
  actually recommends (trays, baskets, shelving, cable management). Shipping a
  `kind: "product"` result today would surface blankets for kitchen clutter.

**The smallest next phase, revised from the previous POC:**

1. Rotate the exposed datafeed key; fix `.gitignore` line 34 first.
2. **Build the feed-list poller before the downloader.** It is one request,
   needs no per-advertiser configuration, and is immediately useful for BD: it
   sizes and freshness-checks any advertiser *before* applying. This is the
   highest-value, lowest-risk component and it was not visible before this test.
3. Build the downloader + normalizer to the 14-field core, with variant
   collapsing and non-merchandise filtering in the adapter. Ingest King Koil and
   Mosaic.
4. **Then measure coverage against real Uncluttrd recommendation text** before
   any ranking work. That measurement is the gate on whether a `kind: "product"`
   branch ships at all.

**Why not B:** B is right that two narrow advertisers cannot validate *ranking* —
and this report agrees, which is why ranking is excluded from the phase. But B
would also defer the ingestion and feed-list work, which two independent feeds
have now validated and which is the prerequisite for finding a broad catalog in
the first place. Waiting for breadth without the tool that measures breadth is
the wrong order.

**Why not C:** Mosaic disproves it. 46 distinct products, 794 discriminating
terms, and two intents resolving cleanly to real priced, imaged, monetizable
candidates. The data is weak in structure, not absent.

`ProductIntelligenceDesign.md` is unchanged, per instruction.

---

## Artifacts

`awinCompare.js`, `awinSetup.js`, `awinList.js`, `awinFetch.js`, `awinIntent.js`
and parsed output in the session scratchpad under `awin-poc/`
(`mosaic-105766.csv.gz`, `feed-list.csv`, `field-report.json`). Nothing was
written into the repository. The API key is redacted from every artifact and
appears in no output. Awin tracking links were not fetched.
