# Awin — Mosaic Weighted Blankets Feed Validation

**Run 2026-08-18. Read-only. No app code modified, no program applied to, no
ingestion pipeline or adapter built.**

Feed retrieved live via the same path validated for King Koil
(`AwinProductFeedPOC.md`), using the existing datafeed credential at
`C:\Users\mharr\.uncluttrd-awin.env`. The key was never printed, never written
to an artifact, and never passed as an argv. **No `aw_deep_link` was ever
fetched** — doing so would register a real affiliate click.

Prior work: `AwinMosaicFeedComparison.md` (2026-08-14) downloaded this same
feed and reached "BUILD INGESTION NEXT". This validation re-downloads it, and
adds the thing that document could not have: **the feed run through Uncluttrd's
actual matcher against the real 54-recommendation corpus.** That changes the
answer.

---

# VERDICT: **NOT USEFUL**

Not because the feed is technically poor — mechanically it is the best Awin
feed we have seen — but because **Mosaic sells one product category, and it is
a category Uncluttrd has never once recommended.**

The decisive measurement:

| Test | Result |
|---|---|
| Corpus recommendations mentioning *blanket, throw, weighted, duvet, bedding, pillow, wrap, lap pad, comforter, quilt, sensory* | **0 of 54** |
| Matcher runs producing a Mosaic match | 4 of 54 |
| Of those 4 matches, how many are correct | **0 of 4** |

Every match was a false positive. Details in §7.

---

## 1. Identification and access

| | |
|---|---|
| **Advertiser** | Mosaic Weighted Blankets |
| **Advertiser ID (MID)** | **87403** |
| **Feed ID** | **105766** |
| **Membership** | **active** — approval confirmed |
| Region / language | US / English |
| Feed origin | `sftp://datafeeds.shareasale.com/Awin/64644/feed.zip` — a **ShareASale feed relayed into Awin** |
| Publisher ID in links | `a=2963149`, distinct = 1 across all rows |

Located by filtering the live feed list (`node scripts/awinFeedList.js --filter
mosaic`) — 1 match of 589 visible feeds. Download returned **HTTP 200 in
1,149 ms**, 35,617 bytes gzipped → 1,149,506 bytes CSV.

## 2. Feed contents

| Measure | Value |
|---|---|
| **Total rows** | **496** |
| **Distinct products** | **46** (by `merchant_deep_link` path, ignoring `?variant=`) |
| **Variant rows per product** | **10.8** |
| Columns requested | 75 |
| **Columns carrying any data** | **19 (25%)** |
| Empty columns | 56 |

Populated: `aw_deep_link`, `merchant_product_id`, `merchant_image_url`,
`description`, `search_price`, `merchant_name`, `merchant_id`, `aw_image_url`,
`currency`, `merchant_deep_link`, `display_price`, `data_feed_id`, `in_stock`,
`is_for_sale`, `merchant_thumb_url`, `aw_thumb_url`, `product_name` (all
496/496), plus `rrp_price` (91/496, 18%) and `model_number` (81/496, 16%).

### Field-by-field

**Titles** — 496/496 populated, **46 distinct**. Clean and human-readable
("Kensington Plaid Weighted Blanket").

**Descriptions** — 496/496, **46 distinct**, genuinely written marketing prose
averaging ~1,100 characters. This is Mosaic's one real advantage over King Koil
(1 distinct description) — and, as §8 shows, also the source of a serious
problem.

**Categories / subcategories — NONE. Every category column is 0% populated:**
`merchant_category`, `category_name`, `category_id`, `product_type`,
`keywords`, `merchant_product_category_path`,
`merchant_product_second_category`, `merchant_product_third_category`,
`brand_name`, `colour`. **A Mosaic-backed `CatalogProduct.category` would have
no source at all.**

**Prices / currency** — `search_price` 496/496, **USD** on every row,
**$9.95–$344.94**, median $206.94, only **30 distinct price points** across 496
rows. `rrp_price` on 18%.

**Availability** — `in_stock = 1` and `is_for_sale = 1` on **all 496 rows**.
`stock_quantity` and `stock_status` empty. Everything is nominally in stock,
which means the field carries **no discriminating information** — it cannot
distinguish an available product from an unavailable one because it never says
"no".

**Image URLs** — `merchant_image_url` and `aw_image_url` 496/496, 46 distinct,
Shopify CDN. Thumbs also present.

**Product URLs** — `merchant_deep_link` 496/496, 46 distinct
(`mosaicweightedblankets.com/products/...`).

**Affiliate URLs** — `aw_deep_link` **496/496, all 496 distinct**, shape
`https://www.awin1.com/pclick.php?p={id}&a=2963149&m=87403`. **Variant-precise
affiliate links even where merchant URLs are not** — 496 distinct affiliate
links against 46 distinct product pages. This is the feed's strongest property
and it works exactly as King Koil demonstrated.

**Identifiers** — `merchant_product_id` 496/496, all distinct, human-parseable
SKUs (`KENSPL-50-5` = pattern-size-weight). `model_number` 81/496 with only 4
distinct values. **`mpn`, `ean`, `upc`, `isbn`, `product_GTIN`,
`parent_product_id`: all 0%.** No standard product identifier of any kind.

**Freshness** — `last_updated`, `valid_from`, `valid_to` **all 0% populated**.
The feed carries no per-row date. The only freshness signal is feed-level, from
the feed list: **Last Imported 2026-05-15 — 94 days stale.**

## 3. Variant structure — mostly variants, but not a single product

King Koil was 29 rows of **one** product. Mosaic is 496 rows of **46**. That is
a real improvement in kind, not just degree.

But the 46 are not 46 *categories*. Grouped by what they actually are:

| Group | Distinct products | Note |
|---|---|---|
| **Weighted blankets** | **40** | Colour/pattern variants: Navy, Lavender, Kensington Plaid, So Many Dogs, Dia de los Muertos… |
| Duvet covers | 2 | Minky Dot, Charcoal Gray Plush |
| Weighted shoulder wraps | 2 | Minky, Coolmax |
| Weighted stuffed animals | 2 | Leo The Pup, Mel The Pig |
| Weighted wrist rest | 1 | $14.89 |
| Weighted lap pad | 1 | Grab bag |
| **Non-merchandise** | **3** | **Gift Wrapping, Shipping Insurance, Shipping Protection** — feed rows indistinguishable from products by any structured field |

**87% of the distinct catalog is one product in 40 colourways.** The variant
axis simply moved up a level: King Koil varied by size within one product,
Mosaic varies by pattern within one category.

The 3 non-merchandise rows matter operationally: nothing in the feed marks them
as non-products, so any ingestion must filter them by name. They would
otherwise be rankable, purchasable-looking catalog entries.

## 4. Uncluttrd relevance taxonomy

Run against the actual rows, without forcing fits:

| Uncluttrd demand category | Mosaic depth | Assessment |
|---|---|---|
| **Weighted blankets** | 40 products | Deep — but see below |
| **Throws / blankets** | 40 (same items) | Genuine, single-vendor |
| **Bedding / textiles** | 2 duvet covers | Negligible |
| **Sensory / comfort** | 5 (wraps, lap pad, wrist rest, stuffed animals) | Thin |
| **Pillows / bedroom accessories** | **0** | Absent |
| **Storage / home / organizing** | **0** | **Absent — this is Uncluttrd's core demand** |

Uncluttrd's recommendation surface is **organizing and finishing a visible
space**: trays, bins, baskets, shelving, cable management, drawer organizers,
wall art, lighting, decor objects, bath textiles. A weighted blanket is a
**sleep and sensory-regulation product**. It is not something a photo of a
cluttered room produces a recommendation for — and empirically, across 54 real
recommendations spanning bathrooms, pantries, bookshelves, dining rooms and
credenzas, it never did.

Even the one adjacent category — textiles — is the wrong kind. The corpus asks
for `hand towel`, `luxury bath towel set`, `plush bath mat`. Mosaic sells duvet
covers.

## 5. Ten representative products, normalized

Fields we could realistically use, exactly as they would populate
`CatalogProduct`:

| # | name | price | id | category | availability |
|---|---|---|---|---|---|
| 1 | Kensington Plaid Weighted Blanket | $172.44 USD | `KENSPL-50-5` | **none** | in_stock |
| 2 | Indigo Ocean Waves Weighted Blanket | $172.44 USD | `INDOCE-50-5` | **none** | in_stock |
| 3 | Leo The Pup Mosaic Weighted Stuffed Animal | $79.95 USD | `DGGYPP` | **none** | in_stock |
| 4 | Minky Dot Duvet Cover | $149.95 USD | — | **none** | in_stock |
| 5 | Charcoal Gray Plush Duvet Cover | $206.94 USD | — | **none** | in_stock |
| 6 | Minky Weighted Shoulder Wrap | $57.44 USD | — | **none** | in_stock |
| 7 | Weighted Wrist Rest | $14.89 USD | — | **none** | in_stock |
| 8 | Grab Bag Weighted Lap Pad | $35.99 USD | — | **none** | in_stock |
| 9 | Coolmax Weighted Shoulder Wrap | $45.94 USD | — | **none** | in_stock |
| 10 | Navy Blue Weighted Blanket | $172.44 USD | — | **none** | in_stock |

Each carries `imageUrl` (Shopify CDN), `productUrl`
(`mosaicweightedblankets.com/products/…`) and a distinct `affiliateUrl`
(`awin1.com/pclick.php?p=…&a=2963149&m=87403`).

**Interface fit:** 9 of 11 `CatalogProduct` fields populate cleanly. The two
that do not are **`category`** (no source whatsoever) and
**`sourceMetadata.commission`** (`commission_group` empty).

## 6. Comparison with the King Koil POC

| | King Koil | **Mosaic** | Winner |
|---|---|---|---|
| Rows | 29 | **496** | Mosaic |
| **Distinct products** | 1 | **46** | Mosaic |
| Variant rows/product | 29.0 | **10.8** | Mosaic |
| Distinct descriptions | 1 | **46** | **Mosaic, decisively** |
| Columns populated | 29% | 25% | King Koil |
| `brand_name` | 100% | **0%** | King Koil |
| `merchant_category` | 100% | **0%** | **King Koil** |
| `mpn` | 100% | **0%** | King Koil |
| `rrp_price` | 0% | 18% | Mosaic |
| Affiliate link | ✅ working | ✅ working, variant-precise | tie |
| Feed freshness | — | **94 days stale** | — |
| **Relevance to Uncluttrd** | mattresses — none | **weighted blankets — none** | **neither** |

The 2026-08-14 comparison called the description inversion "the most important
finding". With the matcher now built, it is not. **The most important finding
is that both advertisers sell categories Uncluttrd does not recommend**, and
Mosaic's better prose does not change that — it makes it worse (§8).

King Koil's 100% `merchant_category` against Mosaic's 0% is also newly
significant: our ranker reads `category` as a scoring channel. Mosaic supplies
nothing there.

## 7. What the matcher actually did — 4 matches, 4 wrong

Running the committed pipeline (`shared/productMatching/`) over all 54
recommendations against a Mosaic-backed source:

```
MATCHED : 4/54          FALLBACK: 50/54
recommendations retrieving ANY Mosaic candidate: 27/54
```

All four matches, in full:

| Recommendation | Matched product | Score |
|---|---|---|
| `plush bath mat` | **Charcoal Gray Plush Duvet Cover** — $206.94 | 0.663 |
| `LED picture light or niche lighting` | **So Many Dogs Weighted Blanket** — $229.94 | 0.682 |
| `Pull-out bins or drawers` | **Hot Dog Weighted Blanket** — $229.94 | 0.668 |
| `Fabric storage bins or cubes` | **Americana Weighted Blanket** — $229.94 | 0.671 |

**Zero are correct.** A $207 duvet cover for a bath mat; a weighted blanket for
picture lighting; a weighted blanket for pull-out drawers.

The confidence gate (score ≥ 0.55, relevance ≥ 0.50) passed all four. That is
the gate working as specified against inputs that break an assumption behind
it — see below.

## 8. A matcher defect this feed exposed — substring matching has no word boundaries

> **FIXED 2026-08-18.** Hardened in `shared/productMatching/lexical.js` with 48
> regression tests. **Mosaic now returns 0 matches of 54**, down from the 4
> wrong ones below. The corrected MVI figures are **AND-semantics 67%** (was
> 69%) with the no-rewrite baseline collapsing to **19%** (was 37%) — so the
> rewriter's measured contribution *grew* from +17 to +26. **Zero false
> negatives** were introduced. Full detail in
> `ProductMatchingImplementation.md` §10.
>
> This section is left as written, because the diagnosis is why the fix exists.

Tracing why `"Pull-out bins or drawers"` matched a Hot Dog blanket:

```
token "bin"  -> matched "...the ideal com·bin·ation of comfort..."
token "out"  -> matched "...your nighttime r·out·ine, ensuring..."
```

`relevanceScore` and the fixture's `search` both use `String.includes()`, which
matches **anywhere inside a word**. Measured across the whole corpus against all
491 Mosaic merchandise rows:

| | |
|---|---|
| Token-product hits, substring (current) | **4,080** |
| Token-product hits, word-boundary | **1,063** |
| **False hits from substring matching** | **3,017 — 74% of all hits** |

The colliding tokens are the corpus's most common head nouns:

| Token | Actually matched |
|---|---|
| `art` | light·**heart**·ed |
| `mat` | ulti·**mat**·e |
| `led` | fil·**led** |
| `light` | de·**light**·ful |
| `bin` | com·**bin**·ation |
| `out` | r·**out**·ine |
| `table` | sui·**table** |

`art` appears **7 times** in the 54-recommendation corpus; `light`/`lighting`
appears 8 times. These are not edge cases.

**This did not surface in the MVI because my fixture's descriptions are short,
controlled sentences.** Mosaic's are ~1,100 characters of real marketing prose —
which is what every real catalog looks like. **The defect is not
Mosaic-specific: it would fire against Wayfair, Rakuten or Amazon exactly the
same way**, and Amazon's `itemInfo.features` is longer still.

The consequence for figures already reported: the MVI's **69% AND-semantics
coverage is optimistic**, and its precision is worse than measured, because
some fixture matches will have been earned by substring luck. The fix is
mechanical — word-boundary matching with a plural allowance — but it is a
change to committed matcher code and is out of scope here.

**Recommendation: fix before wiring any real source, and re-run the MVI
evaluation to get honest numbers.** This is the highest-value thing this
investigation produced.

## 9. Verdict

### **NOT USEFUL**

Not on feed quality — mechanically Mosaic is the best Awin feed validated so
far: 46 distinct products, working variant-precise affiliate links, real
descriptions, clean prices, images, stable SKUs. On any purely technical
reading it clears the bar King Koil set.

It fails on **relevance**, comprehensively and measurably:

1. **0 of 54** real recommendations mention any category Mosaic sells.
2. **0 of 4** matcher selections were correct.
3. **87% of the catalog is one product** in 40 colourways.
4. **Zero storage, organizing or home products** — Uncluttrd's entire demand.
5. **No category data at all**, so a core ranking channel is dead.
6. **94 days stale**, with no per-row `last_updated` to detect drift.

### Worth keeping as a niche source later?

**Marginally, and only conditionally — do not plan around it.**

The honest case *for*: if Uncluttrd's recommendation surface ever extends into
bedroom comfort or sensory products, Mosaic is a working, already-approved
source with monetizable links and no integration debt beyond a
category-inference step. Approval is done and costs nothing to keep.

The case *against*, which I find stronger: a source is worth carrying when it
can answer questions the system actually asks. Mosaic answers a question
Uncluttrd has never asked in 54 real recommendations across bathrooms,
pantries, bookshelves, dining rooms and credenzas. Weighted blankets are a
sleep product; Uncluttrd photographs and organizes visible surfaces. Even
"bedroom" recommendations in the corpus are wall art, storage and lighting.

Carrying it has a real cost that §7 makes concrete: a single-category source
with rich prose and no category field is a **false-positive generator**. With
substring matching it produced four confident, wrong, expensive-looking matches.
Even after a word-boundary fix, a source that can only ever be right about one
category will mostly be wrong.

**Recommendation: keep the approval, build nothing.** Revisit only if a
deliberate product decision extends Uncluttrd into bedding or sensory comfort —
and if that happens, Mosaic becomes a reasonable first source for that specific
category rather than a general one.

### Consequence for source strategy

Two Awin advertisers have now been validated end-to-end and **both sell
categories Uncluttrd does not recommend**. That is not bad luck twice; it is a
signal about how advertisers were selected. The demand-first screen in
`Retailers.md` exists precisely to avoid this, and the next Awin application
should be driven by the 54-recommendation corpus's actual head nouns — trays,
bins, baskets, shelving, organizers, wall art, lighting — rather than by which
advertisers happen to approve quickly.

---

## Provenance

Feed 105766 downloaded live 2026-08-18 via
`productdata.awin.com/datafeed/download/apikey/…` (key redacted throughout,
read from `~/.uncluttrd-awin.env`). One GET for the feed list, one for the
download — well inside Awin's 5 req/min publisher limit. No `aw_deep_link`
fetched. Analysis scripts are in the session scratchpad and were deliberately
**not** added to the repo, since this is investigation rather than tooling.
Matcher run used the committed `shared/productMatching/` pipeline at `b4b970d`
with a throwaway in-memory source wrapper; **no adapter was created and no
matcher code was modified.**
