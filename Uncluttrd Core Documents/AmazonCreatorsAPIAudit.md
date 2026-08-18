# Amazon Creators API — Compatibility Audit against the Matcher Contract

**Read-only research, 2026-08-18. No API calls made, no adapter built,
no code changed.** Audited against the `CatalogSource` interface committed in
`shared/productMatching/catalogSource.js` (commit `03fcbb6`).

Sources are Amazon's own Creators API documentation and the Associates Program
Policies. Where a figure could not be verified from Amazon directly it is
marked **UNVERIFIED**. One widely-repeated third-party claim was checked and
found **wrong** — see §3d.

---

## Verdict

**Creators API can implement `CatalogSource` without architectural change.**
The interface holds. Every required `CatalogProduct` field has a source, and
`search()` / `getProduct()` map cleanly onto SearchItems / GetItems.

**But three constraints break assumptions the MVI currently encodes**, and one
of them is a decision-level conflict, not an implementation detail:

| Constraint | Our current assumption | Conflict |
|---|---|---|
| **24-hour data retention cap** | `staleDays: 7` default in `planRefresh` | **Decision #3's precompute model must run on a ≤24h refresh cycle** |
| **Max 10 results per request** | `maxResults: 40` in retrieval | Ranking's price distribution gets 10 candidates, not 40 |
| **Images may not be stored at all** | `imageUrl` stored on the commerce candidate | Only the *link* may be held, and only for 24h |

None require redesigning the three-layer separation. All require the
Amazon adapter to declare tighter policy than the fixture does.

---

## 1. SearchItems compatibility

### a. AND-semantics — **UNDOCUMENTED. This is the single largest open question.**

Amazon's SearchItems reference documents `keywords` only as *"A word or phrase
that describes an item i.e. the search query."* **It does not state whether
multiple keywords are ANDed or ORed**, and no page reachable in the public
documentation does.

This matters more than anything else in this audit. The MVI's headline figure —
**69% coverage** — was measured under AND-semantics, against **37%** for the
un-rewritten baseline. Under OR-semantics the same rewriter contributes almost
nothing (94% → 100%). **A ~30-point swing in expected coverage rides on an
undocumented behaviour.**

It is empirically testable in minutes *once credentials exist* (issue a
deliberately over-specified query and see whether recall collapses), and not
before. Until then it stays unknown, and any coverage forecast for Amazon
should be quoted as a range, not a number.

### b. Refinements and filters — **strong, better than the interface requires**

| Parameter | Values | Maps to |
|---|---|---|
| `searchIndex` | Product category, default `All` | Category narrowing |
| `browseNodeId` | Amazon category node id | Category narrowing (see §1e) |
| `minPrice` / `maxPrice` | Lowest currency denomination (cents) | `options.priceRange` |
| `availability` | `Available` \| `IncludeOutOfStock` (default `Available`) | Availability hard filter |
| `condition` | `Any` \| `New` (default `Any`) | — |
| `deliveryFlags` | `Prime`, `FulfilledByAmazon`, `FreeShipping`, `AmazonGlobal` | Prime eligibility |
| `minReviewsRating` | Positive integer < 5 | Would enable `source_quality`, currently weighted 0 |
| `minSavingPercent` | Positive integer < 100 | — |
| `sortBy` | `Relevance`, `Price:LowToHigh`, `Price:HighToLow`, `AvgCustomerReviews`, `NewestArrivals`, `Featured` | — |

Two notes.

`minReviewsRating` would light up **`source_quality`**, which Section 3 of the
design currently carries at weight 0.00 because no examined source populated
ratings (the Awin feed had them 0% filled). Amazon would be the first source
able to support it.

**Do not use `minPrice`/`maxPrice` to implement the approach price band.**
Section 3c is explicit that the band must *emerge from* the candidate set, and
`SCOPE_SPEND_TABLE` was retired for imposing one. Pushing an approach-derived
price filter into the query would reintroduce it as a server-side parameter —
worse, because it would be invisible. `priceRange` should stay a caller-supplied
override, not something the ranker generates.

### c. Results per request — **10, with 10 pages reachable**

- `itemCount`: **1 to 10, default 10**
- `itemPage`: **1 to 10**
- **Maximum reachable per query: 100 items** (10 × 10)

Each page is a separate request and therefore a separate transaction against
the rate limit.

**This is a real constraint on ranking, not just on volume.** The MVI retrieves
`maxResults: 40`. With Amazon a single call yields 10, and the ranker's price
machinery has thresholds against candidate-set size:

- `MIN_CANDIDATES_FOR_PRICE = 5` — met by a single page.
- Outlier fence needs ≥ 4 priced candidates — met.
- But percentile targets computed over **10** candidates are far coarser than
  over 40. With 10 items the 25th/50th/75th percentiles land on roughly the
  3rd, 5th and 8th cheapest — workable, but each approach tier is separated by
  only two or three products.

Paging to 30–40 candidates costs 3–4 transactions per intent. At the initial
1 TPS that is 3–4 seconds per intent. **Recommendation: one page (10) per
intent for v1**, and revisit only if evaluation shows tier separation is too
coarse.

### d. Fields returned, mapped to `CatalogProduct`

| `CatalogProduct` | Creators API source | Status |
|---|---|---|
| `id` | ASIN | ✅ |
| `name` | `itemInfo.title` | ✅ |
| `description` | `itemInfo.features` (bullet array), `itemInfo.productInfo` | ⚠️ **array, not prose** — adapter must join |
| `category` | `browseNodeInfo.browseNodes` (+ `ancestor`) | ⚠️ **node tree, not a flat label** — adapter must flatten |
| `price` | `offersV2.listings.price` | ✅ |
| `currency` | `offersV2.listings.price` / `currencyOfPreference` | ✅ |
| `imageUrl` | `images.primary` (small/medium/large) | ⚠️ **link only, 24h — see §6c** |
| `productUrl` | `detailPageURL` | ✅ |
| `availability` | `offersV2.listings.availability` | ✅ maps to our tri-state |
| `sourceMetadata.source` | constant `"amazon-creators"` | ✅ |
| `sourceMetadata.merchantId` | `offersV2.listings.merchantInfo` | ✅ |
| `sourceMetadata.affiliateUrl` | `detailPageURL` (**pre-tagged**) | ✅ see §4 |
| `sourceMetadata.commission` | **not returned** | ❌ absent |

**Every required field has a source.** Three need adapter-side transformation
and one — `commission` — is simply unavailable.

`commission` being absent is **harmless and arguably ideal**. Decision #2 makes
commission a tiebreak-only signal; with a single Amazon rate schedule that
varies by category rather than by product, there is nothing per-product to
break ties with. The ranker already treats missing commission as `0` and
degrades to pure score ordering. **Amazon therefore cannot produce the
outlier-rescue failure documented in Section 3c of the design** — the mechanism
does not exist for this source.

The `description` mapping deserves care: `features` is a bullet array written
for shoppers, and joining it produces long text. Our `relevanceScore` weights
description matches lowest (1 vs 3 for title), so this mostly adds recall
without distorting ranking — but a very long joined string inflates the
`density` term. The adapter should cap it.

### e. Browse-node / category search — **yes, and it is the highest-value lever**

`browseNodeId` narrows a search to an Amazon category node, and `GetBrowseNodes`
resolves node metadata.

This is the natural home for the rewriter's **head-noun → catalog category**
mapping, which the MVI currently performs only as a token. Section 1b measured
the head noun as the category anchor across 40 distinct heads; mapping those to
browse node ids would convert a soft lexical signal into a hard server-side
filter — plausibly the largest single accuracy gain available on this source,
and a genuine mitigation for the AND/OR uncertainty in §1a, since a correct
node filter reduces how much the keyword string has to carry.

It requires building and maintaining a head-noun → node-id table. That is real
work and it is **not** in the MVI.

---

## 2. GetItems — product lookup

**a.** Yes. `itemIds` accepts **up to 10 ASINs per call**, and — importantly —
*"if you send 10 ASINs in the request parameter of a GetItems() call, it counts
as a single transaction."*

**b.** Same resource groups as SearchItems: `itemInfo`, `images`,
`offersV2.listings` (availability, price, merchantInfo, buy-box), `browseNodeInfo`,
`parentASIN`. `detailPageURL` is returned.

**c. Suitability for stale-commerce-refresh: excellent — this is the single
best fit in the whole audit.**

Decision #3 separates *refresh* (price, availability, link) from *rematch*
(which product). GetItems is precisely a refresh primitive: look up by stored
ASIN, take the new price and availability, never re-run retrieval or ranking.
And the 10-ASINs-per-transaction batching means **an entire plan's products
refresh in one request**.

`planRefresh()` in `pipeline.js` already has the right shape — it calls
`source.getProduct(candidate.productId)` and returns `{action, updates}`. An
Amazon adapter would want a batched variant to exploit the 10-per-call
allowance, but the *contract* is unchanged.

---

## 3. Rate limits and cost

**a. Limits** (verified from Amazon's API Rates page):

- New credentials: **1 TPS**, **8,640 requests/day**, for the **first 30-day
  period**.
- Then scaling on the preceding 30 days of *shipped item revenue*:
  **+1 TPD per $0.05**, and **+1 TPS per $4,320, capped at 10 TPS**.
  Recalculated daily.
- Exceeding: **HTTP 429 `TooManyRequests`**.
- **Limits are per Associates account**, and require the primary account
  credentials for correct attribution.

**b. Cost.** No per-request fee is documented anywhere reachable, and the
entire capacity model is gated on *referred revenue* rather than payment —
strong evidence it is free, as PA-API was. **UNVERIFIED** as an explicit
statement; the docs simply never mention a price.

**c–d. Interaction with precompute — comfortable, with one caveat.**

The brief's "82 intents" is the whole 54-recommendation corpus across 9 users,
not one plan. **Per plan**, 6–8 recommendations expand at the measured 1.52x to
**~9–12 intents**.

| Operation | Requests | Time at 1 TPS |
|---|---|---|
| Match one plan (1 page/intent) | ~9–12 | **~9–12 s** |
| Match one plan (4 pages/intent) | ~36–48 | ~36–48 s |
| Daily refresh, one plan (batched) | **1** | 1 s |

At the initial floor of 8,640/day:

- **~720 plans/day** could be matched at 12 requests each, or
- **8,640 plans/day** refreshed at 1 batched request each, or
- realistically both, since refresh is ~1/12th the cost of matching.

Against current production scale — 42 user documents total — this is not close
to binding. **The rate limit is not the constraint. Eligibility is.**

The caveat is **1 TPS is serial**: 12 requests take 12 seconds of wall-clock
regardless of how little quota they consume. That is fine for background
precompute at plan creation (decision #3 chose precompute precisely so latency
lands where the user is already waiting) and would be **unacceptable on a tap**,
which is decision #3's reasoning arriving independently at the same answer.

---

## 4. Affiliate attribution — **cleanest part of the audit**

**a.** `partnerTag` is a **required request parameter** on both SearchItems and
GetItems. The returned `detailPageURL` comes back **pre-tagged**:

```
https://www.amazon.com/dp/B0199980K4?tag=xyz-20&linkCode=ogi&language=en_US&th=1&psc=1
```

**b. Fully compatible with `uncluttrd20-20`.** That tag *is* the `partnerTag`
value. No new identifier, no migration.

**c. URLs already carry attribution — nothing to construct.** This is a genuine
simplification over the current `AmazonSearchSource`, which builds
`/s?k=…&tag=…` by hand. The adapter would pass `partnerTag` in and read
`detailPageURL` out.

This fits the existing architecture exactly: `App.js`'s resolver comment
already states that each adapter "builds its own links its own way," and notes
`AMAZON_ASSOCIATES_TAG` lives in exactly one constant. An
`AmazonCreatorsSource` reads that same constant and passes it as a parameter
instead of appending it — a different mechanism inside the same seam, which is
what the adapter layer was built for.

---

## 5. Access requirements

**a. Threshold: 10 qualifying sales in the trailing 30 days.** Confirmed
verbatim on the Creators API introduction page: *"Have at least 10 qualifying
sales within the past 30 days to access the PA API through the Creators API."*
Unchanged from the earlier finding in `ProductIntelligenceDesign.md`.

**b. Per Associates account**, not per API key. Amazon additionally requires
the **primary account credentials** — the same Amazon login that created the
Associates account — for correct attribution.

**c. NOT permanent, and this is newly established here.** Access is **lost**
if an account *"has not generated qualified referring sales for a consecutive
30-day period"*, and **regained within two days** after qualifying sales ship.

This is a materially different risk profile from a one-time gate. Amazon is not
a source you qualify for once and then build on — it is a source that can
**silently revoke itself after a quiet month**, and the adapter must treat
credential failure as an expected runtime state rather than an incident. In
practice: `canResolve` must fail closed to the existing search-URL fallback on
auth error, which the resolver architecture already supports.

**d. Our current status: UNKNOWN, and I cannot determine it.** Associates
Central is not reachable from this environment, and Associates *sales* (Amazon
purchases via our links) are tracked there, not in Firestore or Firebase
Analytics. `ProductIntelligenceDesign.md` flagged the same gap on 2026-08-12
and it remains open.

What can be said from data I do have: production holds **42 user documents**,
with the first real Pro conversion only on 2026-08-18. Every product
recommendation today resolves to an Amazon *search* URL rather than a product
page, which converts far worse than a direct product link. **10 qualified sales
in a rolling 30 days is very unlikely at this scale**, but that is an inference
from install base, not a reading of the account. **Michael should check
Associates Central directly** — it is a two-minute lookup that decides whether
this source is reachable at all.

---

## 6. Compatibility assessment

### a. Can `AmazonCreatorsSource` implement the interface without architectural change?

**Yes.** `search(query, {maxResults, priceRange, strict})` → SearchItems.
`getProduct(id)` → GetItems. `metadata` → `{name: "amazon-creators", type:
"api", lastUpdated: null}`. Every `CatalogProduct` field maps (§1d).

Decision #1 — source-agnostic, build the interface — is vindicated here: this
audit found **no** case requiring a change above the adapter line. The
adaptations needed (joining `features`, flattening browse nodes, batching
GetItems) all live inside the adapter, which is what it is for.

### b. Latency profile

~9–12 requests per plan at 1 TPS ⇒ **9–12 seconds**, serial, plus OAuth token
acquisition (cacheable ~1 hour, so amortised to zero). At the 10 TPS ceiling,
~1–2 seconds.

Acceptable for background precompute. Unacceptable on a user tap — reinforcing
decision #3 rather than challenging it.

### c. Where it falls short of the interface

1. **24-hour data-retention cap — the significant one.** Amazon Program
   Policies: *"You may store other Product Advertising Content that does not
   consist of images for caching purposes for up to 24 hours, but if you do so
   you must immediately thereafter refresh and re-display."* Our
   `planRefresh()` defaults to `staleDays: 7`. **For an Amazon-backed candidate
   that default is not merely suboptimal, it is non-compliant.** The staleness
   policy must become a *per-source* property, not a global constant.
2. **Images may not be stored at all.** *"You will not store or cache Product
   Advertising Content consisting of an image, but you may store a link… for up
   to 24 hours."* Our `imageUrl` holds a link, which is the compliant form —
   but it too expires at 24h, and the image must never be mirrored.
3. **Required price disclaimer.** A date/time stamp must appear adjacent to any
   displayed price refreshed less often than hourly, plus the fixed notice
   *"Product prices and availability are accurate as of the date/time indicated
   and are subject to change…"*. This is a **UI obligation on the recommendation
   card**, not a matcher concern — but it is a shipping blocker for showing
   Amazon prices, and nothing in the current card design accounts for it.
4. **10 results per request** vs the 20–50 candidate set the design assumes
   (§1c).
5. **Keyword semantics undocumented** (§1a).
6. **No per-product commission** — benign (§1d).

### d. Primary source, or fallback enhancement?

**Architecturally: a strong primary source candidate — the strongest audited.**
It is the only one offering a real query API, structured refinements,
pre-tagged affiliate URLs, ratings, browse-node category filtering, and a
batched refresh primitive, with no ingestion and no feed pipeline. CJ has the
right interface but zero joined advertisers; Awin has links but no rankable
fields. Creators API has both.

**Commercially: still gated, and now known to be revocable.** The 10-sales
threshold is unchanged, and §5c establishes that access lapses after 30 quiet
days.

That combination argues for a specific posture: **build Amazon as a first-class
`CatalogSource` implementation, but never let the system depend on it.** The
existing search-URL `AmazonSearchSource` stays exactly where it is, as the
fallback that always works. `AmazonCreatorsSource` sits in front of it and
fails closed. Both are Amazon; one is gated and rich, one is ungated and thin.

That is not a compromise — it is the same shape decision #4 already chose
("a specific product appears only when Product Intelligence has enough
evidence"), with "enough evidence" now including "we currently hold API
credentials."

---

## Recommended next steps

1. **Check Associates Central for trailing-30-day qualified sales.** Two
   minutes, and it decides whether any of this is reachable. Nothing else
   should be sequenced before it.
2. **Make staleness a per-source policy** in `planRefresh()` before any Amazon
   adapter exists. Amazon needs ≤24h; the fixture and a feed-based source do
   not. This is a small change to code already written, and it is a compliance
   requirement rather than a preference.
3. **Design the price disclaimer into the recommendation card** if Amazon
   prices will ever be displayed. Currently unaccounted for.
4. **Resolve the AND/OR question empirically** as the first act after
   credentials are issued — it is worth ~30 points of expected coverage.
5. **Do not build the head-noun → browse-node table yet.** High value, but only
   once access is real.

---

## Sources

- [Creators API — Introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction)
- [Creators API — API Reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference)
- [Creators API — SearchItems](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items)
- [Creators API — GetItems](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-items)
- [Creators API — Migrating from PA-API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/migrating-to-creatorsapi-from-paapi)
- [Creators API — API Rates](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/api-rates)
- [Associates Program Policies (caching, images, price disclaimer)](https://affiliate-program.amazon.com/help/operating/policies)
- [PA-API 5.0 deprecation notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation)
