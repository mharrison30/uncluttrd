# CJ Product Feed API — Shelving Inc. Proof of Concept

**Status: COMPLETE. Live queries run against `https://ads.api.cj.com/query`
on 2026-08-14 with a real Personal Access Token and CID.**

**Outcome: D — Shelving Inc. does not expose a usable product catalog.**
Its CJ feed exists but is empty (`productCount: 0`, `lastUpdated: null`).
Separately, and more consequentially: this publisher account is joined to
**zero** advertisers with product feeds, so *no* product from *any* advertiser
currently carries an affiliate link.

Read-only investigation. Nothing was wired into Uncluttrd. `App.js`, Firebase
Functions, Firestore, and `ProductIntelligenceDesign.md` are untouched, as
instructed.

---

## 0. Security findings — still current

The credential lives at `C:\Users\mharr\.uncluttrd-cj.env`, outside the
repository entirely, so no `git add` run from the project can capture it. Every
harness script passes all output through a replacer that substitutes the token
with `<REDACTED_PAT>` before printing. The token was never printed, never
written to an artifact, and never entered chat.

Two pre-existing repository issues were found while choosing that location.
**Neither was fixed** — they are flagged for a deliberate decision:

### 0a. `functions/.env` and `functions/.env.cluttrd-staging` are TRACKED IN GIT

Verified with `git ls-files --error-unmatch`. They are committed files holding
`CANARY_TEST_UID`, `CANARY_WEB_API_KEY` and `REVENUECAT_PROJECT_ID`. A web API
key is already committed to the repository. Note that `firebase deploy` reads
both files, so they are functional config and cannot simply be deleted.

### 0b. `.gitignore` does not cover `.env`

Line 34 is `.env*.local` only:

```
git check-ignore -v .env        ->  no match   (a root .env would be committable)
git check-ignore -v .env.local  ->  .gitignore:34  (ignored)
```

A root `.env` is **not** protected either.

---

## Step 1 — The actual CJ API contract (introspected, not remembered)

Public docs render the schema through a client-side app that returns nothing to
a fetcher, so the contract below was obtained by live introspection against the
account's own entitlements. It is authoritative for this account.

| Item | Finding |
|---|---|
| Endpoint | `https://ads.api.cj.com/query` (GraphQL, POST) |
| Auth | `Authorization: Bearer <PAT>` — worked first try, ~650 ms |
| Publisher ID | `companyId` is a **query argument**, not a header |
| Latency | 650 ms – 1.6 s per query, consistently |

**Root queries available (10):** `products`, `shoppingProducts`,
`travelExperienceProducts`, `productsFromApplication`,
`shoppingProductsFromApplication`, `travelExperienceProductsFromApplication`,
`shoppingProductFeeds`, `financeProducts`, `financeCreditCardProducts`,
`productFeeds`.

**There is no advertiser-lookup root query.** Advertisers can only be
discovered by enumerating `shoppingProductFeeds` — this matters, and is why the
first pass of this POC wrongly concluded Shelving Inc. was absent (see
"Correction" below).

**`shoppingProducts` arguments:**
```
companyId, adIds, googleProductCategoryIds, googleProductCategoryNames,
keywords, partnerIds, partnerStatus, gtin, offset, limit, productIds,
advertiserCountries, highPrice, lowPrice, currency, itemListId, itemListIds,
includeDeletedProducts, availability, serviceableAreas
```
`keywords` is `[String!]`. `partnerIds` is the advertiser filter. `PartnerStatus`
enum = `JOINED, NOT_JOINED`. Pagination is `offset`/`limit` and is **hard-capped
at 10,000 records** — `offset + limit > 10000` is a server-side error.

**Two product types exist.** `products` returns `Product` (36 fields).
`shoppingProducts` returns `Shopping` (84 fields) — the retail type, and the
only one worth using. It carries `gtin`, `mpn`, `googleProductCategory`,
`productType`, `color`, `material`, `size`, `availability`, `condition`,
`productDetail`, `productHighlight`, `joinedStatus`, and
`linkCode(pid:) { html clickUrl imageUrl }`.

**No ratings or reviews field exists anywhere in the schema.** This is a
material gap versus what `ProductIntelligenceDesign.md` assumed a product
source could provide.

---

## Step 2 — Shelving Inc.: found, but empty

### Correction to the first pass

The initial probe searched `keywords: ["Shelving Inc"]` and got 3.6M results
from Wayfair, OnBuy and Tesco — the keyword matched the *word* "shelving" in
product titles, not the advertiser. `keywords: ["shelvinginc"]` returned 0.
On that evidence I recorded "no Shelving Inc. advertiser found." **That was
wrong.** `keywords` searches product text only; advertiser names are not
searchable.

Sweeping `shoppingProductFeeds` and matching `/shelv/i` on `advertiserName`
found it immediately:

| Advertiser | advertiserId |
|---|---|
| **Shelving Inc.** | **5434019** |
| Speedy Shelving.com | 5314756 |

The sweep covered 10,000 of 15,524 feed rows (the pagination cap), yielding
**3,620 distinct advertisers** exposing a shopping feed to this account.

### Shelving Inc.'s feed row

```json
{"advertiserId":"5434019","advertiserName":"Shelving Inc.","adId":"14096347",
 "feedName":"2020 Feed","productCount":0,"lastUpdated":null,
 "currency":"USD","advertiserCountry":"US","language":"en","sourceFeedType":"GOOGLE"}
```

**`productCount: 0` and `lastUpdated: null`.** The feed is registered but has
never been ingested, or was purged. Both product surfaces confirm it:

```
shoppingProducts(partnerIds:["5434019"])  ->  totalCount = 0
products(partnerIds:["5434019"])          ->  totalCount = 0
```

**Control — the filter itself works.** Same query, Zoro:

```
shoppingProducts(partnerIds:["4683856"])  ->  totalCount = 6,889,382
```

So 0 is a real 0, not a broken filter.

**Corroborating control — `productCount: 0` means "dead feed" generally.**
Zoro has three feed rows: one with `productCount 0` / `lastUpdated null`, and
two live ones (6.79M and 6.89M, updated today). Wayfair North America has seven,
including a `Wayfair Canada Product Feed` at 0/null alongside six live ones.
The 0/null pattern is how CJ represents a dormant feed, and Shelving Inc. has
*only* that row.

### Speedy Shelving.com — also unusable

```json
{"advertiserId":"5314756","feedName":"Speedy Shelving Product Feed",
 "productCount":3037,"lastUpdated":"2022-03-10T11:50:50.879Z",
 "currency":"GBP","advertiserCountry":"GB"}
```

Nonzero count, but **last updated March 2022** and GBP/UK. Querying it returns
`totalCount = 0` on both surfaces — the metadata count is historical; the
products are not retrievable. Worth recording as a schema caveat: **a nonzero
`productCount` does not guarantee queryable products.**

---

## Steps 3 & 4 — What the catalog *does* contain, and search quality

Since Shelving Inc. is empty, the sample was taken from the catalog at large so
the data-quality question could still be answered.

Unfiltered, this account can see **728,609,919 shopping products** — Wayfair,
Zoro, OnBuy, Tesco, Groupon, TicketNetwork and ~3,600 others.

### Field fill rate — 25 products, `keywords: ["wire shelving"]`, `advertiserCountries: ["US"]`

**Populated 25/25:** `id`, `title`, `description`, `brand`, `link`, `imageLink`,
`price`, `availability`, `condition`, `gtin`, `mpn`, `identifierExists`,
`productType`, `color`, `advertiserId`, `advertiserName`, `catalogName`,
`targetCountry`, `shipping`, `lastUpdated`.

**Empty on all 25 (18 fields):** `salePrice`, `discountPercentage`,
`additionalImageLink`, `googleProductCategory`, `material`, `pattern`, `size`,
`sizeType`, `productLength`, `productWidth`, `productHeight`, `productWeight`,
`shippingWeight`, `productDetail`, `productHighlight`, `itemGroupId`,
`availabilityDate`, **`linkCode`**.

Representative record:

```
id             G022796346
title          Wire Shelving
description    Wire Shelving          <- identical to title
price          92.35 USD
brand          METRO
mpn            2436NK4
productType    ["Shelving & Racks","Wire Shelving","Wire Shelf Units"]
availability   in stock
link           https://www.zoro.com/c/i/G022796346/
imageLink      https://www.zoro.com/static/cms/product/full/57d0…jpeg
shipping       {"price":{"amount":"0.00","currency":"USD"}}
advertiserName Zoro
catalogName    ZoroCJ
lastUpdated    2026-08-14T03:16:15Z
joinedStatus   false
linkCode       (empty)
```

**Search quality is poor for Uncluttrd's use case.** `"wire shelving"` returned
five near-identical results all titled exactly `Wire Shelving` from Zoro, with
`description` byte-identical to `title`. `"storage shelf"` returned 10.6M hits
skewed to GBP/EUR advertisers. There is no relevance ranking exposed and no
ratings signal to rank by. Matching a recommendation like "3-tier rolling cart
for under-sink storage" against this would be guesswork.

**Data freshness is excellent** where feeds are live — `lastUpdated` values are
same-day.

---

## Step 5 — Affiliate links: the real blocker

The schema *does* mint publisher-specific deep links directly. No separate Link
Search API is needed:

```graphql
linkCode(pid: $pid) { html clickUrl imageUrl }
```

But:

```
joinedStatus true  : 0 / 25
affiliate clickUrl : 0 / 25
```

And across the whole account:

```
shoppingProducts(partnerStatus: JOINED)  ->  totalCount = 0
products(partnerStatus: JOINED)          ->  totalCount = 0
```

**Every single product visible to this account has `joinedStatus: false` and an
empty `linkCode`.** CJ mints the tracking link only for advertisers the
publisher has an approved relationship with, and this account has none.

The plain `link` field is present and works — but it is the merchant's own URL
with no tracking, so it earns nothing.

**The blocker is the advertiser relationship, not the API.** The API works,
authenticates, and returns 728M products with real prices, images, brands, GTINs
and MPNs. None of it is monetizable until advertisers approve the publisher
application.

---

## Step 6 — `ProductCandidate` suitability

| `ProductCandidate` field | CJ `Shopping` source | Verdict |
|---|---|---|
| title | `title` | Available, but often generic ("Wire Shelving") |
| price | `price {amount currency}` | **Real, current, same-day fresh** |
| image | `imageLink` | Available; `additionalImageLink` always empty |
| destination URL | `linkCode.clickUrl` | **Unavailable — empty for every product** |
| non-affiliate URL | `link` | Available, but unmonetized |
| brand | `brand` | Available |
| identifiers | `gtin`, `mpn` | Available — useful for cross-retailer matching |
| category | `productType` (array) | Available; `googleProductCategory` always empty |
| rating / review count | — | **Does not exist in the schema** |
| availability | `availability` | Available ("in stock") |

Four of ten fields Product Intelligence would want are unavailable: the
affiliate URL, ratings, review counts, and reliable category taxonomy.

---

## Step 7 — Outcome

**D — Shelving Inc. does not expose a product catalog to this publisher/API
account.** Its feed is registered but empty (`productCount: 0`,
`lastUpdated: null`), confirmed against a working control.

Two findings sit *outside* the A/B/C/D frame and matter more than the outcome:

1. **CJ as a platform is a genuine product source.** 728M products, real
   same-day prices, images, brands, GTIN/MPN. The technical integration is
   straightforward — one GraphQL endpoint, one bearer token, sub-2-second
   queries.
2. **Nothing on it is monetizable today.** Zero joined advertisers means zero
   affiliate links, universally. This is an account/relationship state, not an
   API limitation, and it is fixable by applying to advertisers — but it is a
   business-development step with approval latency, not a coding task.

---

## Should Product Intelligence v1 scope change?

**No — not on this evidence.** The Amazon-search-first Tier A plan in
`ProductIntelligenceDesign.md` stands unchanged.

The POC was run to answer one question: *can a per-category real-product branch
exist now, before Amazon Creators API eligibility?* The answer is no. Shelving
Inc. has no catalog, and even a live CJ feed would produce unmonetized links
until advertiser relationships are approved.

Three things are worth carrying forward:

- **CJ is a viable Tier B source later, if the relationship work is done
  first.** The blocker is joining advertisers, not building a resolver. Wayfair
  North America alone has 11.1M live US products; Zoro has 6.9M. If either
  approves the publisher, `linkCode.clickUrl` becomes available and a
  category-scoped resolver branch is a small amount of work on a proven API.
- **The design's rating/review assumption needs revisiting regardless of
  source.** CJ has no ratings field at all. Any "highly rated" language in
  recommendations cannot be sourced from a product feed.
- **The design's `kind: "product" | "search"` resolver shape (§4) is validated.**
  It is exactly the right seam: a CJ branch would slot in without restructuring,
  and its absence today costs nothing.

The correct next action is *not* engineering. It is deciding whether to apply
to CJ advertisers in the storage/home-organization category, which is a
prerequisite to any CJ work and independent of Product Intelligence v1.

---

## Artifacts

Harness scripts and raw JSON responses are in the session scratchpad under
`cj-poc/`. Nothing was written into the repository. Every script reads the
credential from `C:\Users\mharr\.uncluttrd-cj.env` at runtime and redacts it
from all output.

| File | Contents |
|---|---|
| `01-root-queries.json` | The 10 root queries and their arguments |
| `02-product-fields.json` | `Product` type field list |
| `05`–`08`, `11` | Product samples and fill-rate measurements |
| `10-advertisers.json` | 3,620 distinct advertisers exposing a shopping feed |

---

**Sources**

- Live introspection of `https://ads.api.cj.com/query` — authoritative for
  everything above.
- [CJ Developer Portal](https://developers.cj.com/)
- [Product Feeds — CJ Developer Portal](https://developers.cj.com/docs/data-imports/product-feeds)
- [Personal Access Tokens — CJ Developer Portal](https://developers.cj.com/account/personal-access-tokens)
