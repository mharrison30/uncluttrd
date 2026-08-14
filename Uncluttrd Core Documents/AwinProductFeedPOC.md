# Awin Product Feed — King Koil Proof of Concept

**Run 2026-08-14 against the real `.gz` export and live Awin endpoints.**

**Outcome: B — USABLE WITH LIMITATIONS.**

Read-only. `App.js`, Firebase Functions, Firestore and `ProductIntelligenceDesign.md`
are untouched. No feed ingested, no resolver built, no credentials added to the repo,
nothing deployed.

**The headline: this is the first affiliate source in this investigation that
actually produces a monetizable product link.** After CJ returned zero joined
advertisers and zero retrievable products across two POCs, the King Koil export
contains 29 rows each carrying a publisher-specific Awin tracking URL with our
publisher ID embedded. Retrieval is also genuinely automatable — the documented
endpoints are live and were verified.

**The limitation, equally real: this feed cannot be ranked.** The fields Product
Intelligence would need to *choose* a product — `product_type`, `keywords`,
`colour`, `dimensions`, `specifications`, `last_updated`, ratings — are 0%
populated. Awin delivers catalog retrieval. It does not deliver anything to rank on.

---

## 1. The actual King Koil feed

Parsed from `C:\Users\mharr\Downloads\115216-101819-en_US-Default.csv.gz`.
The filename encodes `{merchant_id}-{data_feed_id}-{locale}-{template}`.

### Archive

| Property | Value |
|---|---|
| Compressed | 3,763 bytes |
| Magic | `1f8b08` — gzip, deflate |
| FLG | `0x0` — **no inner filename, no MTIME set** |
| Inflated | 60,229 bytes (16.0× ratio) |
| Inner format | CSV, RFC4180-quoted, **LF** line endings, no BOM |

The gzip header carries **no modification time**. Combined with §7, this matters:
the archive itself cannot tell you when it was built.

### Structure

- **86 columns** (Select All was used, so this is Awin's full publisher schema)
- **29 data rows** — every row's column count matches the header exactly
- **1 distinct `product_name`**

### Identifiers

| Field | Distinct | Value |
|---|---:|---|
| `merchant_id` | 1 | `115216` |
| `merchant_name` | 1 | `King Koil` |
| `data_feed_id` | 1 | `101819` |
| `category_id` / `category_name` | 1 | `453` / `Mattresses` |
| `brand_name` | 1 | `King Koil Airbeds` |
| `currency` | 1 | `USD` |
| `language` | 0 | **empty** |

### `last_updated`: **0 of 29 populated**

The single most consequential finding in §1. The field exists in the schema, was
explicitly selected, and is empty on every row. There is no earliest or latest
value to report. Per-product freshness is not available from this feed.

### Duplicates and variants

| Field | Rows | Distinct | Duplicates |
|---|---:|---:|---:|
| `aw_product_id` | 29 | 29 | 0 |
| `merchant_product_id` | 29 | 29 | 0 |
| `mpn` | 29 | 29 | 0 |
| `product_name` | 29 | **1** | 28 |
| `merchant_image_url` | 29 | 16 | 13 |
| `ean` | 7 | 7 | 0 |

**No duplicate product IDs. All 29 rows are variants of one product** — "King Koil
Luxury Air Mattress with High Speed Built-in Pump" — across 9 distinct prices
($79.95–$179.95) and 16 distinct images. Each `merchant_deep_link` carries a
distinct `?variant=` matching that row's `merchant_product_id` (29/29).

Variant identity lives **only** in `mpn` (e.g. `KK13C1BG29331` = 13-inch / size C1 /
beige) and in image filenames (`20_twin_beige.webp`). There is no `size` column,
no populated `colour`, and no `parent_product_id` to group by. **29 rows is 1
product, not 29 candidates** — a row count is not a catalog size.

### Field population — all 86 fields

**Populated on all 29 rows (20 fields):**

| Field | Example | Reliable for PI? |
|---|---|---|
| `aw_deep_link` | `https://www.awin1.com/pclick.php?p=43487196554&a=2963149&m=115216` | **Yes — the money field** |
| `product_name` | King Koil Luxury Air Mattress with High Speed Built-in Pump | Yes, but identical across variants |
| `aw_product_id` | `43487196554` | Yes — stable network key |
| `merchant_product_id` | `40196727636056` | Yes — Shopify variant ID |
| `merchant_image_url` | `cdn.shopify.com/…/20_twin_beige.webp` | Yes (verified live, §4) |
| `aw_image_url` | `images2.productserve.com/?w=200&h=200…` | Yes (verified live) |
| `aw_thumb_url` | same, `w=70&h=70` | Yes |
| `description` | 1,100-char marketing copy | Present, but **identical on all 29** |
| `merchant_category` / `category_name` | `Mattresses` | Single value — no taxonomy |
| `category_id` | `453` | Awin's own category ID |
| `search_price` | `99.95` | **Yes — the normalized price** |
| `display_price` | `USD99.95` | Yes (derived, §3) |
| `currency` | `USD` | Yes |
| `merchant_name` / `merchant_id` | King Koil / 115216 | Yes |
| `merchant_deep_link` | `kingkoilairbeds.com/products/…?variant=…` | Yes — non-affiliate destination |
| `data_feed_id` | `101819` | Yes — feed provenance |
| `brand_name` | `King Koil Airbeds` | Yes (merchant-dependent) |
| `delivery_time` | `2-5` | Unitless — **do not display** |
| `in_stock` / `is_for_sale` | `1` | Binary only; no quantity |
| `mpn` | `KK13C1BG29331` | Yes — only variant discriminator |
| `custom_1` | `1` | Meaningless without merchant docs |

**Partially populated (1 field):** `ean` — 7/29 (24%). Unusable as a join key.

**Entirely empty — 65 of 86 fields.** Including every field the task called out
as important:

`store_price`, `language`, `last_updated`, `brand_id`, `colour`,
`product_short_description`, `specifications`, `condition`, `product_model`,
`model_number`, `dimensions`, `keywords`, `promotional_text`, `product_type`,
`commission_group`, `merchant_product_category_path`,
`merchant_product_second_category`, `merchant_product_third_category`,
`rrp_price`, `saving`, `savings_percent`, `base_price`, `base_price_amount`,
`base_price_text`, `product_price_old`, `delivery_restrictions`,
`delivery_weight`, `warranty`, `terms_of_contract`, `stock_quantity`,
`valid_from`, `valid_to`, `web_offer`, `pre_order`, `stock_status`,
`size_stock_status`, `size_stock_amount`, `merchant_thumb_url`, `large_image`,
`alternate_image`, `alternate_image_two/three/four`, `reviews`,
`average_rating`, `rating`, `number_available`, `custom_2`–`custom_9`, `isbn`,
`upc`, `parent_product_id`, `product_GTIN`, `basket_link`.

**Summary: 20 fields at 100%, 1 partial, 65 empty. 23% of the selected schema
carries data.** Selecting all columns cost nothing but proved that Awin's schema
breadth is not the same as merchant data breadth. **Field presence in the header
means nothing; only population counts.**

---

## 2. Affiliate-link behaviour — confirmed

> Tracking links were deliberately **not fetched**. Firing `awin1.com/pclick.php`
> registers a real affiliate click on the account and would pollute click data for
> zero informational gain. Structure was analysed instead.

```
aw_deep_link      https://www.awin1.com/pclick.php?p=43487196554&a=2963149&m=115216
merchant_deep_link https://kingkoilairbeds.com/products/king-koil-luxury-air-mattress?variant=40196727636056
```

| Check | Result |
|---|---|
| Awin tracking domain, not merchant URL | **Yes** — `www.awin1.com/pclick.php`, 29/29 |
| Publisher identifier embedded | **Yes** — `a=2963149`, **distinct=1** across all rows |
| Merchant identifier | `m=115216` — matches `merchant_id` exactly |
| Product-level, not homepage | **Yes** — `p=` is distinct on all 29 rows and equals `aw_product_id` 29/29 |
| `merchant_deep_link` is the non-affiliate destination | **Yes** — `kingkoilairbeds.com`, 29 distinct URLs, all carrying `?variant=` matching `merchant_product_id` |
| Extra link-generation call needed | **No** — the feed ships ready-to-use tracking URLs |
| `basket_link` | Empty 0/29 — no add-to-basket deep links |

**`a=2963149` is the Awin publisher ID for this account.** It should be recorded
as configuration and validated on ingest: any feed whose `aw_deep_link` carries a
different `a=` is not ours and must be rejected.

This is the decisive contrast with CJ. CJ exposes `linkCode(pid:)` but returned
an empty `clickUrl` for every product because the account had no joined
advertisers. Awin ships the resolved link **inside the feed**, with no second API
call and no runtime dependency at click time.

---

## 3. Price semantics — established empirically

| Field | Populated | Distinct |
|---|---:|---:|
| `search_price` | **29/29** | 9 |
| `display_price` | **29/29** | 9 |
| `store_price` | 0/29 | — |
| `rrp_price` | 0/29 | — |
| `saving` / `savings_percent` | 0/29 | — |
| `base_price` / `product_price_old` | 0/29 | — |
| `delivery_cost` | 0/29 | — |

**`display_price` is exactly `currency + search_price` on 29/29 rows** — zero
mismatches. It is a presentation string derived from the other two, not an
independent value, and it hard-codes the format `USD99.95` (no space, no symbol).
Uncluttrd should format from `search_price` + `currency` and ignore
`display_price`.

- **Safest normalized current price: `search_price`.** It is the only populated
  numeric price, is internally consistent with `display_price`, and ranges
  $79.95–$179.95 across 9 values that track the size/colour variants sensibly.
- **Values disagree: never** — there is only one independent price, so there is
  nothing to disagree.
- **Sale/original pricing: NOT representable.** `rrp_price`, `product_price_old`,
  `saving` and `savings_percent` are all empty. A "was $X, now $Y" treatment
  cannot be built from this merchant's feed. Whether other merchants populate
  them is unknown and must not be assumed.
- **Currency: consistently supplied**, 29/29, all `USD`.

Caveat on generality: this is one merchant. The semantics above are established
for King Koil, not for Awin. `store_price` being empty here does not establish
what it means where it *is* populated — a genuinely unresolved question flagged
rather than guessed.

---

## 4. Images — verified live

| Field | Populated | Distinct |
|---|---:|---:|
| `merchant_image_url` | 29/29 | 16 |
| `aw_image_url` | 29/29 | 16 |
| `aw_thumb_url` | 29/29 | 16 |
| `merchant_thumb_url`, `large_image`, `alternate_image`, `alternate_image_two/three/four` | **0/29** | — |

Only one image per product. No gallery.

**Live fetch results:**

| Source | HTTP | Bytes | Type | Real dimensions | Cache-Control |
|---|---:|---:|---|---|---|
| `merchant_image_url` #1 | 200 | 140,509 | image/jpeg | **1376×1143** | `public, max-age=31557600` |
| `merchant_image_url` #2 | 200 | 136,741 | image/jpeg | **1552×1210** | `public, max-age=31557600` |
| `aw_image_url` | 200 | 7,503 | image/jpeg | **200×200** | `max-age=2678400` |
| `aw_thumb_url` | 200 | 1,683 | image/jpeg | **70×70** | `max-age=2678400` |

All four resolve to real product images. Note the served type is **JPEG even
where the URL says `.webp`** — the CDN negotiates format, so do not infer
encoding from the extension.

**Recommendation for in-app product cards: use `aw_image_url` (200×200, 7.5 KB).**
It is Awin-hosted, correctly sized for a small card, ~19× smaller than the
merchant original, and its `?w=&h=` parameters are adjustable if a larger card is
needed later. `aw_thumb_url` at 70×70 is too small for anything but a list bullet.
The merchant originals are 130–140 KB at ~1400 px — wasteful on cellular for a
card, but the right choice if a full-bleed detail view is ever built.

**Stability: store references, do not copy images.** Merchant URLs are Shopify CDN
paths carrying a `?v=` cache-buster (16/16) that changes whenever the merchant
re-uploads, so a copied asset silently goes stale while the URL still works.
Awin's `productserve.com` URLs embed a `k=` integrity hash and a `feedId=`, so
they are only valid for as long as that feed generation is current. Both are
long-cached (1 year merchant, 31 days Awin) — which is exactly why caching the
*reference* and re-reading it each feed cycle is correct, and caching the *bytes*
is not.

---

## 5. Candidate schema feasibility

Against the proposed normalized shape:

**Reliably populated from this feed (11):**

| Candidate field | Source | Note |
|---|---|---|
| `source` | constant `"awin"` | — |
| `sourceFeedId` | `data_feed_id` = `101819` | Feed provenance |
| `retailer` | `merchant_name` | — |
| `merchantId` | `merchant_id` = `115216` | — |
| `productId` | `aw_product_id` | Network-stable |
| `merchantProductId` | `merchant_product_id` | — |
| `title` | `product_name` | Identical across variants |
| `price.amount` / `price.currency` | `search_price` / `currency` | — |
| `imageUrl` | `aw_image_url` | 200×200 verified |
| `merchantUrl` | `merchant_deep_link` | — |
| `affiliateUrl` | `aw_deep_link` | **Ready to use** |

**Merchant-dependent — populated here, not guaranteed elsewhere (4):**
`description` (present but identical on every variant), `brand` (`brand_name`),
`category` (`merchant_category`/`category_name`, single value), `attributes.mpn`.

**Should remain optional (3):** `availability` (`in_stock` is binary only — it can
express "in stock / not", never a quantity or a restock date),
`attributes.gtin` (`ean` at 24%; `product_GTIN` and `upc` entirely empty),
`fetchedAt` (ours to stamp, not Awin's).

**Cannot be supported by this feed (5):**
- `productType` — `product_type` is 0% populated
- `attributes.color` — `colour` is 0% populated
- `attributes.dimensions` — `dimensions` is 0% populated
- `lastUpdated` — **`last_updated` is 0% populated.** The candidate contract
  should treat this as nullable and Uncluttrd must stamp its own `fetchedAt` at
  ingest, because per-product freshness is simply not available.
- ratings / review counts — no such field is populated anywhere; the same
  structural gap found in the CJ schema.

Eleven of ~19 fields populate reliably. The five that fail are, unhelpfully,
exactly the ones a ranking layer would want.

---

## 6. Automatic feed retrieval

Awin's docs render through a client-side app that returns nothing to a fetcher
(`help.awin.com` 404s to automated requests), so the URL templates below come from
official-doc search snippets and third-party integrations. **Every endpoint was
then probed live with a deliberately bogus key** — no credential involved — to
confirm the routes exist.

### Confirmed by live probe

| Endpoint | Response | Reading |
|---|---|---|
| `https://productdata.awin.com/datafeed/list/apikey/{key}` | **HTTP 403** `<h1>Authentication error</h1><h2>Your access is disabled</h2>` | Route exists; key rejected |
| `https://productdata.awin.com/datafeed/download/apikey/{key}/…` | **HTTP 404** JSON, echoing the parsed path | Route exists and parses the path segments |
| `https://productdata.awin.com/` | HTTP 404 `{"message":"Not Found"}` | Host live, no root |
| `https://api.awin.com/publishers` | **HTTP 401** `{"error":"unauthorized","description":"Full authentication is required…"}` | Bearer-token publisher API exists |

The endpoints are real and reachable from this environment.

### Answers

**Does Awin provide a stable feed download URL?** **Yes.** Documented form:

```
https://productdata.awin.com/datafeed/download/apikey/{APIKEY}/language/en/fid/{FEED_ID}
  /columns/{COMMA_LIST}/format/csv/delimiter/%2C/compression/gzip/
```

Our feed is `fid=101819` (`data_feed_id` in the CSV) for merchant `115216`.

**Authentication?** **Embedded in the URL path** as `apikey/{key}` — not a header,
not a session. Documentation is explicit that the **datafeed API key is a
different key from the Publisher API key**. Consequence: the URL *is* the secret.
It can never be logged, committed, or placed in client-side code.

**Scheduled download without a browser?** **Yes** — plain authenticated GET.

**gzip/CSV directly?** **Yes** — `format` and `compression` are path segments;
`gzip`, `zip` and `none` are documented. Our sample confirms gzip/CSV works and
compresses 16×.

**Reuse the configured feed, or regenerate?** **Reuse.** The Create-a-Feed URL is
generated once, encodes the column selection, and is re-fetchable at any time.
Column changes require a new URL, not a new export.

**Refresh frequency?** Advertiser-controlled, not fixed by Awin. The documented
pattern is to poll the **feed list**, which carries a last-update timestamp per
feed, and download only when it has changed:

```
https://productdata.awin.com/datafeed/list/apikey/{APIKEY}
```

This is the correct freshness signal, and it matters especially here because the
per-row `last_updated` is empty (§1).

**Rate limits?** Documented: **no more than 5 requests per minute**, **no
concurrent requests to the same advertiser feed**, and a recommendation to wait a
random 10 s – 2 min before requesting to avoid peak load. Comfortably compatible
with a nightly job.

**Better API alternative?** **Possibly — the Enhanced Feed (Google Format).**
`GET` under `api.awin.com` with Bearer auth, returning **JSON Lines**, parameterised
by publisher, advertiser, vertical and locale. Structurally nicer than CSV-over-
gzip. Two unknowns must be settled before choosing it: whether it carries
`aw_deep_link`-equivalent tracking URLs (Google format natively does not), and
which advertisers publish it. **Recommendation: build on Create-a-Feed, which is
verified to carry affiliate links, and evaluate Enhanced separately.**

**Transaction Notifications "Product Feed" option?** **It is not a catalog
mechanism at all.** The Transaction Notifications setting passes back *data about
products a user actually bought* in a tracked transaction. It is neither
incremental catalog updates nor full-feed notification, and it must not be
designed around as a change feed. This corrects the natural reading of its name.

### If a real retrieval test is wanted

Nothing further is needed from you in chat. The datafeed API key would go in a
file **outside the repository**, matching the pattern already established for CJ:

```
C:\Users\mharr\.uncluttrd-awin.env
   AWIN_DATAFEED_APIKEY=...
   AWIN_PUBLISHER_ID=2963149
```

`.gitignore` line 34 is `.env*.local` only, so a repo-root `.env` is **not**
protected — the same gap flagged in the CJ POC and still unfixed. Stopping here
rather than requesting the secret.

---

## 7. Freshness and caching — recommended design (not implemented)

The `last_updated` finding drives everything: **per-product freshness is
unavailable, so freshness must be tracked at feed level.**

**Recommended: nightly conditional full-feed replacement, keyed on the feed list.**

1. **Poll the feed list** (1 request) and read each feed's last-update timestamp.
2. **Download only feeds whose timestamp advanced** since the last successful
   ingest. At 5 req/min this scales to dozens of advertisers within a nightly
   window.
3. **Parse and replace atomically per feed.** Build the new index, then swap.
   Never merge row-by-row: with `last_updated` empty there is no way to tell a
   changed row from an unchanged one, so a full replace is the only correct
   semantic.
4. **Stamp our own `fetchedAt`** per candidate at ingest — the only freshness
   value we can trust.

**Incremental updates: not available.** No delta mechanism exists (and
Transaction Notifications is not one, §6). Full-feed replacement is not a
shortcut; it is the only option.

**Disappeared products:** a row absent from the new feed is gone. Because ingest
is atomic replacement, they vanish naturally. Any Uncluttrd record referencing an
`aw_product_id` must therefore tolerate a dangling reference and fall back to
Amazon search rather than render a dead card.

**Price changes:** picked up wholesale on each replacement. Never display a cached
price older than the last successful ingest of that feed; show a price only when
its feed is fresh, otherwise degrade to the search fallback.

**Stale advertiser feeds:** the feed list timestamp is the guard. A feed not
updated within a threshold (30 days is a reasonable starting point) should be
marked stale and excluded from candidates. This is the exact failure CJ exhibited
— live-looking metadata over feeds last built 18 months ago — and it must be
designed against from day one, not discovered in production.

**Index shape:** a server-side index keyed by `{merchantId, aw_product_id}`,
holding the 11 reliable fields plus `fetchedAt` and the source feed's
last-update. Small: King Koil is 29 rows / 60 KB uncompressed. Even a hundred
comparable advertisers is trivial. Client-side caching is inappropriate — the
download URL contains the API key and must never reach a device.

---

## 8. Searchability — retrieval works, ranking does not

Of the ten fields worth searching, only **five carry any data**:
`product_name`, `description`, `merchant_category`, `category_name`, `brand_name`.
`keywords`, `product_type`, `colour`, `dimensions` and `specifications` are empty
and contribute nothing.

Keyword search over the concatenation of the populated fields:

| Query | AND matches | OR matches | Verdict |
|---|---:|---:|---|
| `mattress` | 29 | 29 | matches every row |
| `queen mattress` | 29 | 29 | matches every row |
| `firm mattress` | 29 | 29 | matches every row |
| `air mattress` | 29 | 29 | matches every row |
| `pump` | 29 | 29 | matches every row |
| `cooling mattress` | 0 | 29 | no row has both terms |
| `adjustable base` | 0 | 0 | absent |
| `twin` | 0 | 0 | **absent from searchable text** |
| `beige` | 0 | 0 | **absent from searchable text** |
| `storage basket` | 0 | 0 | correctly absent |

**The critical result: every meaningful query matches all 29 rows or none.**
"queen mattress" and "firm mattress" match everything not because the products
are queen or firm, but because the shared boilerplate description happens to
contain "queen size air mattress" and "firmness". That is a false positive on all
29 rows — worse than no match, because it looks like a hit.

Variant attributes are genuinely unreachable:

| Term | In searchable fields | In image filename |
|---|---:|---:|
| `twin` | 0/29 | 5/29 |
| `beige` | 0/29 | 9/29 |
| `black` | 0/29 | 9/29 |
| `blue` | 0/29 | 7/29 |
| `queen` | 29/29 (boilerplate) | 6/29 |

The only honest signals for size and colour are the `mpn` code and the image
filename — neither of which is a search field.

And the root cause: **`description` is byte-identical on all 29 rows, and so is
`product_name`.** There is no text that distinguishes one variant from another.

**Conclusions:**

- **Simple keyword search is adequate for the job Awin should do** — deciding
  *"does this merchant carry anything in the category the recommendation is
  about?"* That worked correctly: `storage basket` returned 0, `mattress`
  returned the catalog.
- **Simple keyword search is not adequate for choosing between candidates**, and
  neither is a semantic or vector layer. Embeddings over 29 identical description
  strings produce 29 identical vectors. **This is a data problem, not an
  algorithm problem, and no ranking layer can fix it.**
- The practical shape: use feed text for *category-level candidate retrieval*,
  and treat within-merchant variant selection as unsolvable from feed data —
  either surface the parent product at its lowest price, or let the user pick the
  variant on the merchant's own page.

This is exactly the distinction the task asked for. **Catalog retrieval: works.
Product Intelligence ranking: cannot be sourced from this feed.** Awin does not
need to be intelligent — but it does need to supply *distinguishable* candidates,
and for a variant-heavy merchant it does not.

---

## 9. Product Intelligence architecture impact

`ProductIntelligenceDesign.md` concluded v1 should be Amazon-search-first Tier A,
on the premise that real-product resolution was unreachable before Amazon
Creators eligibility. **That premise is now factually wrong** — Awin delivers real
products with working affiliate links today, which neither PA-API nor CJ could.

The proposed hybrid flow is **technically viable**, with one correction:

> intent → query sources → normalize → rank → show product → open affiliate link
> → else fall back to context-aware Amazon search

Viable, stage by stage: **query sources** (verified — stable authenticated URL,
5 req/min, gzip); **normalize** (verified — 11 fields populate reliably, §5);
**affiliate link** (verified — shipped in the feed, publisher ID `a=2963149`);
**Amazon fallback** (already exists, unchanged).

**The correction is at "rank against Room + Area + approach + problem + reason +
grounding."** That stage assumes candidates carry attributes worth matching on.
King Koil's do not — no product type, no colour, no dimensions, and one
description shared by every row. Ranking must therefore be understood as
**source selection, not product selection**: choose *which merchant* can serve
the recommendation's category, then hand over the best-priced representative
candidate. Uncluttrd's own context (Room, Area, approach, grounding) does the
category reasoning; the feed contributes almost nothing beyond category and price.

Coverage is the second constraint. King Koil is one product in one category.
Uncluttrd recommends trays, baskets, rugs, cable management and shelving across
every room. A hybrid v1 backed by a handful of Awin advertisers would resolve
real products for a **thin slice** and fall back to Amazon for the large majority
— so Amazon must stay the default path, not become a co-equal branch.

---

## 10. Source abstraction (conceptual only)

The boundary the evidence supports:

```
ProductSource (interface)
├── AwinFeedSource        gz/CSV pull, aw_deep_link, a=2963149, feed-level freshness
├── CJProductSource       GraphQL, linkCode(pid:) — blocked, no joined advertisers
├── AmazonSearchSource    search URL construction, tag=uncluttrd20-20
└── AmazonCreatorsSource  future, gated on eligibility
└── ImpactProductSource   future
                    ↓
          ProductCandidate (single normalized contract)
                    ↓
          Product Intelligence: relevance, suitability, ranking, context matching
```

**Source/resolver layer owns:** feed and API retrieval; source-specific
identifiers (`aw_product_id` vs CJ `id` vs ASIN); **source-specific affiliate URL
construction**; source freshness semantics (Awin: feed-level only, since
`last_updated` is empty; CJ: per-product `lastUpdated`; Amazon: none).

**Product Intelligence layer owns:** relevance, suitability, ranking, context
matching against Room + Area + approach + problem + grounding.

**The rule the King Koil data makes concrete:** the intelligence engine must
never contain `awin1.com`, `a=2963149`, `pclick.php`, or `tag=uncluttrd20-20`.
It receives a `ProductCandidate` with an opaque `affiliateUrl` and does not know
which network produced it. This is not a style preference — the three networks
resolve links three incompatible ways (Awin ships them in the feed, CJ mints them
per-query via `linkCode(pid:)`, Amazon builds them from a search string), and any
leakage into the ranking layer makes adding the fourth a rewrite.

One contract detail the evidence forces: `ProductCandidate.lastUpdated` must be
**nullable**, and a separate non-null `fetchedAt` must be stamped by the source
adapter. Awin cannot supply the former.

---

## 11. Business-development implications

Screened from the 974-row Awin advertiser directory export.

**First, a caveat that changes how the directory should be read:** all 974 rows
have `feedEnabled = yes`. The export is already filtered, so "Product Feed = Yes"
is **not a discriminator** within this list — and King Koil proves it is not even
a quality signal. King Koil is `feedEnabled=yes` and delivers 1 product in 29
variant rows with 65 of 86 fields empty. **Programme-level feed metadata
over-promises; only a parsed feed tells the truth.**

King Koil's own directory row, as a calibration baseline:

```
approvalRate 98.17 | conversionRate 8.23 | epc 0.97 | awinIndex 62.51
paymentStatus amber (exposurelevel4) | cookieLength 30 | launched 2025-05-06
primarySector Furniture & Soft Furnishings | US | commissionMin/Max 0
```

Note `commissionMin/Max = 0` — the directory median is also 0, so the column
appears unpopulated in this export rather than indicating zero commission. **It
is not usable for screening**, which conveniently reinforces the instruction not
to select on commission.

### Screening funnel

| Filter | Remaining |
|---|---:|
| Total in export | 974 |
| `feedEnabled = yes` | 974 (100%) |
| + home-relevant sector | 912 |
| + US (`primaryRegion`) | 903 |
| + `paymentStatus = green` | 659 |
| + `approvalRate ≥ 50%` | **512** |

Sector mix is favourable: 722 Home & Garden, 21 Furniture & Soft Furnishings,
16 Department Stores, 8 DIY. Region is 964 US / 8 GB / 1 IT / 1 NL.

### What makes an Awin programme strategically valuable

Ranked by what this POC actually demonstrated matters:

1. **Catalog breadth and distinct products** — the single biggest gap. Prefer
   merchants whose feeds contain many *distinct* products, not many variant rows.
   Only measurable by parsing a feed; the directory cannot tell you.
2. **Field population, especially `product_type`, `colour`, `dimensions`,
   `last_updated`** — determines whether candidates can be ranked at all (§8).
3. **Category fit with what Uncluttrd actually recommends** — storage,
   organisation, décor, kitchen, closet. Not "Home & Garden" as a label.
4. **Feed freshness** — a recent feed-list timestamp. Guards against the CJ
   failure mode of live-looking metadata over long-dead feeds.
5. **Approval probability** — `approvalRate`, with `paymentStatus = green` as a
   programme-health proxy.
6. **US availability and USD pricing** — King Koil is clean here; CJ's DHgate
   feeds were mostly non-US locales.
7. **Product quality / user trust** — Uncluttrd recommends into people's homes.
   A cheap-marketplace source damages trust even when it converts.
8. **Cookie length** — median 30 days; useful tiebreak, never a primary filter.

Deliberately **not** used: `epc`, `commissionMin/Max`, `conversionRate`. A
high-EPC programme with a one-product feed is worthless here — precisely the King
Koil situation.

### Who to prioritise next

**The screen exposes the real problem: only 5 of 974 advertisers are
storage/organisation-specific**, and they are weak —

| Advertiser | approvalRate | payment | Sector |
|---|---:|---|---|
| Rakks Architectural Shelving and Hardware | 100 | amber | Furniture & Soft Furnishings |
| Organic Essentia | 94.23 | green | Home & Garden |
| Eveon Containers Inc. (US) | 100 | amber | Utilities / DIY |
| Bloomcabin USA | 11.11 | amber | Home & Garden |
| Ring Binder Shop | 0 | green | Home & Garden |

None is a general home-organisation retailer. **Awin's US directory, as exported,
does not contain a broad storage/organisation advertiser** — no Container Store,
no Wayfair, no Target-equivalent. That is the finding that should drive BD, not
any individual name.

Recommended approach:

1. **Apply to 5–10 breadth-plausible Home & Garden programmes with
   `approvalRate = 100`, `paymentStatus = green`** (e.g. Quik Commerce, Boolabox,
   Amish Furniture, Sisal Rugs Direct, Commomy Decor, Royal Doulton US), then
   **parse each feed before judging it**. Approval is cheap; the feed is the
   evidence. Budget for most to be King-Koil-shaped.
2. **Chase breadth deliberately.** 61 rows carry department-store or marketplace
   signals. Notably **DHgate appears here too** (approvalRate 87.52) — the same
   advertiser CJ could not deliver. If breadth is the goal, an Awin DHgate
   relationship may succeed where the CJ one is stuck, and is worth testing
   precisely because the CJ path is blocked.
3. **Accept that Awin is an overlay, not a catalog.** Even ten good programmes
   will not cover the range Uncluttrd recommends across. This reinforces §9:
   Amazon search stays the default.

---

## 12. Conclusion

### **B — USABLE WITH LIMITATIONS**

Not **A**: the feed cannot support ranking. `last_updated`, `product_type`,
`keywords`, `colour`, `dimensions` and `specifications` are 0% populated; there
are no ratings anywhere; `description` and `product_name` are identical across
all 29 rows so every meaningful query matches everything or nothing; and 29 rows
are 1 product, not 29 candidates.

Not **C**: retrieval is genuinely automatable, and this was verified rather than
assumed. A stable URL with a path-embedded API key, gzip/CSV on demand, a feed
list carrying last-update timestamps, a documented 5 req/min limit, and live
endpoints returning 403/401 to a bogus key — all comfortably within a nightly job.

The limitations are real but designable-around: feed-level freshness instead of
per-product, atomic full-feed replacement instead of deltas, category-level
retrieval instead of product-level ranking, and Amazon fallback wherever no
suitable candidate exists.

### 1. Does this invalidate the Amazon-only Tier A v1 recommendation?

**It invalidates the premise, not the conclusion.**

The premise — that Tier B real-product resolution is unreachable before Amazon
Creators eligibility — is now demonstrably false. Awin ships working, product-level,
publisher-attributed affiliate links today.

The conclusion — Amazon-search-first for v1 — still stands, for a reason the
original document did not anticipate. It assumed the blocker was *access*. The
real blocker is *coverage and rankability*: one advertiser, one product, one
category, and no attributes to rank on. Amazon search covers everything
Uncluttrd recommends; Awin currently covers a sliver.

### 2. Should v1 become hybrid real-products + Amazon fallback?

**Yes — with Amazon as the default path and Awin as a narrow, additive overlay.**

Hybrid is now technically viable and worth building, because the *shape* is right
and the seam already exists in §4 of the design (`kind: "product" | "search"`).
But it should be scoped as "show a real product in the few categories where we
have a live feed, otherwise search" — not as a co-equal branch. Anything more
would over-fit a v1 to one 29-row mattress feed.

### 3. Smallest next implementation phase, if yes

**A server-side feed ingestion job and a normalizer. No UI change, no user impact.**

1. Store `AWIN_DATAFEED_APIKEY` outside the repo (§6) — and fix `.gitignore`
   line 34 first, since it still does not cover `.env`.
2. A scheduled function that polls the **feed list**, downloads changed feeds
   only, respects 5 req/min, and writes a normalized `ProductCandidate[]` index
   keyed by `{merchantId, aw_product_id}` with our own `fetchedAt`.
3. Ingest King Koil plus whatever 5–10 programmes get approved from §11, then
   **measure real coverage against actual Uncluttrd recommendation text** before
   writing a line of ranking code.

That third step is the real decision point. It costs little, is entirely
invisible to users, and answers the only question that matters: whether Awin can
cover enough of what Uncluttrd actually recommends to justify a `kind: "product"`
branch. Building the ranking layer before knowing that would be premature.

`ProductIntelligenceDesign.md` is unchanged, per instruction.

---

## Artifacts

`awin1.js`–`awin4.js` and parsed output in the session scratchpad under
`awin-poc/` (`kingkoil.csv`, `field-report.json`, `advertiser-screen.json`).
No credentials were used, requested, or written. Awin tracking links were
deliberately not fetched.

**Sources**

- [Downloading feeds using Create-a-Feed — Awin](https://developer.awin.com/docs/downloading-feeds-using-create-a-feed)
- [Product Feed List Download — Awin](https://help.awin.com/docs/product-feed-list-download)
- [Product Feed Publisher Guide — Awin](https://developer.awin.com/docs/product-feed-publisher-guide-intro)
- [Get Enhanced Feed (Google Format) — Awin](https://developer.awin.com/apidocs/retail-publisher-productapidocumentation-1)
- [New Enhanced Google Feeds FAQ — Awin](https://developer.awin.com/docs/new-enhanced-google-feeds-faq)
- [Receive Transaction Notifications — Awin](https://help.awin.com/apidocs/transaction-notifications)
- [Awin Data Feed — WordPress plugin](https://wordpress.org/plugins/awin-data-feed/)
