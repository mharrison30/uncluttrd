# DHgate CJ Product Feed Check

**Run 2026-08-14 against `https://ads.api.cj.com/query` with live credentials.**

**Outcome: D — No usable DHgate catalog through CJ, for this account, right now.**

This is *not* the Shelving Inc. failure repeated. DHgate's catalog demonstrably
exists and is fresh — five feeds totalling 874,439 products each were updated
this morning. The problem is that **zero of those products are retrievable by
this publisher account through the Product Feed API**, on any access path, and
the account still reports `partnerStatus: JOINED → 0` across the entire CJ
catalog.

Read-only. No production or staging code touched. `App.js`, Firebase Functions,
Firestore and `ProductIntelligenceDesign.md` are unchanged, as instructed. The
credential never left `C:\Users\mharr\.uncluttrd-cj.env` and was redacted from
all output; the PID is masked as `<PID>` in every artifact.

---

## 1. Is DHgate JOINED for this publisher account?

**No — not as the API sees it.**

```
shoppingProducts(companyId: <CID>, partnerStatus: JOINED)      -> 0             (1,222 ms)
shoppingProducts(companyId: <CID>, partnerStatus: NOT_JOINED)  -> 728,590,500   (4,322 ms)
shoppingProducts(companyId: <CID>)                             -> 728,590,582   (1,764 ms)
```

Zero joined advertisers account-wide — the same result as the previous POC.
The ~82-row gap between the unfiltered and `NOT_JOINED` totals is index churn
between two queries taken seconds apart, not a hidden joined set; filtering to
DHgate under either status returns 0 (see §5).

**The CID is correct and is genuinely enforced.** This was tested rather than
assumed:

```
companyId = <our CID>   partnerStatus: JOINED  ->  0
companyId = 9999999     partnerStatus: JOINED  ->  ERROR "User is not authorized
                                                   to query on behalf of companyId 9999999."
companyId = 7654321     partnerStatus: JOINED  ->  ERROR (same shape)
```

So the account is right, the token is right, and the API is scoping to us. It
simply reports no joined relationships.

The `*FromApplication` surfaces were checked as an alternative path. They are
**advertiser-side**, not publisher-side — `advertiserId: ID!` is required and is
validated as a companyId you must be authorized for:

```
shoppingProductsFromApplication(advertiserId: "3992613") -> ERROR "User is not
    authorized to query on behalf of companyId 3992613."
```

Not applicable to us. There is no second publisher path to try.

---

## 2. DHgate's CJ advertiser ID

**`3992613`**, advertiserName `DHGate`, advertiserCountry `HK`.

Found by sweeping `shoppingProductFeeds` and matching `/dhgate/i` on
`advertiserName` — 17 feed rows matched, all under the one advertiser ID. (As
established in the previous POC, `keywords` searches product text only and never
matches advertiser names; there is no advertiser-lookup root query.)

---

## 3. Every DHgate feed available to this account

`shoppingProductFeeds(partnerIds: ["3992613"])` → **14 feeds** (368 ms).
`productFeeds` returns the identical 14.

| Feed name | adId | productCount | lastUpdated | Currency | Lang |
|---|---|---:|---|---|---|
| DHgate IT Product Feed | 15924625 | 874,439 | 2026-08-14T09:43:41Z | USD | it |
| DHgate FR Product Feed | 15924630 | 874,439 | 2026-08-14T09:30:13Z | USD | fr |
| DHgate UK Product Feed | 17093863 | 874,439 | 2026-08-14T09:16:43Z | GBP | en |
| DHgate DE Product Feed | 15924631 | 874,439 | 2026-08-14T10:13:38Z | USD | de |
| DHgate ES Product Feed | 15924627 | 874,439 | 2026-08-14T09:58:26Z | USD | es |
| Feed_CJ | 15924616 | 864,409 | 2025-12-21T09:16:07Z | USD | en |
| DHgate EN Product Feed | 15923536 | 772,083 | 2025-02-17T07:10:44Z | USD | en |
| DHgate PT Product Feed | 15924621 | 584,181 | 2025-02-02T07:35:13Z | USD | pt |
| DHgate EN — Sports & Outdoors | 15924618 | 56,266 | 2025-02-02T07:38:19Z | USD | en |
| DHgate EN — Health & Beauty | 15924619 | 37,505 | 2025-02-02T07:36:32Z | USD | en |
| DHgate EN — Shoes & Accessories | 15924617 | 20,348 | 2025-02-02T07:37:00Z | USD | en |
| DHgate EN — Cellphones & Accessories | 15905114 | 16,907 | 2025-02-02T07:35:40Z | USD | en |
| Feed_CJ_NEW | 17215661 | 0 | null | USD | en |
| CJ_Engineering_Test | 15880990 | 0 | null | USD | en |

**12 of 14 live; 2 dormant. Sum of `productCount`: 6,723,894.**

Note the shape of this catalog. The five feeds updated *today* are all localized
storefronts (IT/FR/UK/DE/ES) carrying the same 874,439 items. The
**English-language general feed is 18 months stale** (2025-02-17), and `Feed_CJ`
— the one named for CJ specifically — was last updated 2025-12-21. There is **no
US-targeted feed**; `advertiserCountry` is `HK` throughout and the only
freshly-updated English feed is `GBP`-denominated. This matters for §8 even if
the access problem is solved.

---

## 4. Actual retrievable product count

**Zero, on every path tried.**

```
shoppingProducts(partnerIds: ["3992613"])                          -> 0   (850 ms)
products(partnerIds: ["3992613"])                                  -> 0   (238 ms)
shoppingProducts(partnerIds: [DH], includeDeletedProducts: true)   -> 0   (370 ms)
shoppingProducts(partnerIds: [DH], partnerStatus: JOINED)          -> 0   (541 ms)
shoppingProducts(partnerIds: [DH], partnerStatus: NOT_JOINED)      -> 0   (273 ms)
shoppingProducts(partnerIds: [DH], currency: "USD")                -> 0 (1,069 ms)
```

Per-feed, by `adId`, across all 12 live feeds — **every one returns 0**:

```
DHgate IT / FR / UK / DE / ES Product Feed          0
Feed_CJ                                             0
DHgate EN Product Feed                              0
DHgate PT Product Feed                              0
DHgate EN — Sports & Outdoors / Health & Beauty     0
DHgate EN — Shoes & Accessories / Cellphones        0
```

DHgate also never surfaces in unscoped keyword results. Sampling the first 100
rows of three category searches, DHGate rows returned: `storage basket` 0/100,
`decorative tray` 0/100, `closet organizer` 0/100.

**Control — the query shape and the pipeline both work:**

```
shoppingProducts(partnerIds: ["4683856"])  ->  6,889,382   (614 ms)   [Zoro]
```

So a `0` here is a real, meaningful zero — not a malformed filter and not a
broken harness.

---

## 5. The eight representative Uncluttrd searches

Scoped to DHgate — `shoppingProducts(partnerIds: ["3992613"], keywords: [...])`:

| Search | Results | Time |
|---|---:|---:|
| decorative tray | 0 | 757 ms |
| storage basket | 0 | 216 ms |
| closet organizer | 0 | 418 ms |
| wire shelving | 0 | 332 ms |
| desk organizer | 0 | 108 ms |
| cable management | 0 | 481 ms |
| pantry organizer | 0 | 820 ms |
| shoe storage | 0 | 918 ms |

All eight return nothing. There is no DHgate product to inspect, so **§6 (field
population) and §7 (`linkCode`) cannot be answered for DHgate** — there is no
sample to run them against. Reporting that plainly rather than substituting
another advertiser's data and calling it DHgate's.

For context, the same searches against the whole CJ catalog (US advertisers)
show what *is* reachable:

| Search | Total | Top advertisers |
|---|---:|---|
| decorative tray | 5,585,536 | Wayfair North America, Joss & Main, Birch Lane |
| storage basket | 6,061,518 | CJDemo |
| closet organizer | 3,574,982 | Poshmark, Wayfair North America |
| wire shelving | 1,612,020 | Zoro |
| desk organizer | 1,344,649 | Wayfair North America |
| cable management | 1,569,859 | UnbeatableSale.com |
| pantry organizer | 545,646 | Wayfair North America, UntilGone, DailySteals |
| shoe storage | 8,605,939 | Wayfair North America |

Every one of these carries `joinedStatus: false` and an empty `linkCode` — the
same finding as the previous POC. Coverage exists; monetization does not.

---

## 6. Field population — not answerable for DHgate

No DHgate product was retrievable, so `title`, `description`, `brand`,
`imageLink`, `price`, `availability`, `productType`, `gtin`/`mpn` and
`lastUpdated` fill rates for DHgate are **unmeasured**.

What *is* known from the previous POC, measured on 25 live products from another
advertiser, is the ceiling the schema allows: 20 of 38 fields populated 25/25
(including title, description, brand, link, imageLink, price, gtin, mpn,
productType, availability, shipping, lastUpdated), 18 always empty (including
`salePrice`, `googleProductCategory`, all dimension fields, and `linkCode`).
**No ratings or reviews field exists anywhere in the CJ schema.** That gap is
structural and applies to DHgate too, whenever its products become reachable.

---

## 7. `linkCode(pid:)` — not answerable for DHgate

The query was issued and returned zero rows:

```graphql
shoppingProducts(companyId: <CID>, partnerIds: ["3992613"], limit: 1) {
  totalCount            # -> 0
  resultList { id title linkCode(pid: <PID>) { clickUrl } }   # -> []
}
```

The schema does expose `linkCode(pid:) { html clickUrl imageUrl }` and would
mint publisher-specific deep links directly — no separate Link Search API
needed. But with `partnerStatus: JOINED → 0` account-wide and 0/25 populated
`clickUrl` on the last measurable sample, there is **no evidence yet that any
product on this account returns a monetizable affiliate URL**, DHgate included.

---

## 8. Relevance and candidate quality — deferred, but with a warning

Cannot be evaluated: no DHgate results exist to judge.

Two things are worth recording now, because they will shape the answer when
access is resolved and they are visible in the feed metadata already:

1. **The fresh DHgate feeds are not US-targeted.** All five same-day feeds are
   IT/FR/UK/DE/ES localizations; `advertiserCountry` is `HK` throughout; the only
   freshly-updated English feed is GBP. The English general feed is 18 months
   stale. Uncluttrd's users are US. Even with access granted, the freshest,
   largest slice may be the wrong locale, and the right-locale slice may be the
   stale one.

2. **Relevance on this API is weak in general.** From the previous POC:
   `"wire shelving"` returned five results all titled exactly `Wire Shelving`
   with `description` byte-identical to `title`, no relevance ranking exposed,
   and no ratings to rank by. The unscoped baseline above shows the same pattern
   — `closet organizer` returns Poshmark resale listings at $10 and $30; `desk
   organizer` returns Wayfair items at $32.99 and $825.00 under the same generic
   title. Matching a recommendation like *"3-tier rolling cart for under-sink
   storage"* against this would require our own ranking layer regardless of which
   advertiser supplies the rows.

---

## 9. Is a real `kind: "product"` resolver branch supportable now?

**No.** Not on DHgate, and not on CJ generally, today.

A `kind: "product"` branch needs three things simultaneously: retrievable
products, a monetizable link, and relevance good enough to name a specific item.
Currently DHgate supplies **none** of the three, and the rest of CJ supplies only
the first.

The `kind: "product" | "search"` resolver shape in `ProductIntelligenceDesign.md`
§4 remains the right seam — a CJ branch would slot in without restructuring, and
its absence costs nothing today. No change to that document, per instruction.

---

## Conclusion: **D**

**D — No usable DHgate catalog through CJ.**

Chosen over C deliberately. C ("live catalog but affiliate/deep-link problem")
would mean we can retrieve DHgate products but cannot monetize them. We cannot
retrieve them at all: 0 products on six filter variants, 0 across all 12 live
feeds by `adId`, 0 on all eight category searches, against a control returning
6.9M.

### What is actually blocking, and what to do

The approval appears not to have propagated to the Product Feed API. Supporting
evidence: the CID is valid and enforced; DHgate's feeds are visible to us in the
feed catalog with same-day timestamps; yet `partnerStatus: JOINED` is 0
account-wide, and no product under advertiser 3992613 is in the index we can
query. CJ's relationship state and its product index are synced by batch, so a
recent approval plausibly has not landed yet.

The two candidate explanations — propagation lag, or an approval that did not
attach to this CID — are indistinguishable from the API alone. Two concrete
checks, in order:

1. **Re-run this harness in 24–48 hours.** The single diagnostic that settles it
   is `shoppingProducts(companyId: <CID>, partnerStatus: JOINED) { totalCount }`.
   Any nonzero result means the relationship has landed and the rest of this
   document should be re-measured immediately.
2. **If it is still 0 after 48 hours, check in `members.cj.com`** that the DHgate
   approval is attached to the same company/publisher ID as the CID this token
   authenticates (`…1435`), and that a website property is associated with it.
   That is a CJ dashboard question, not an API one.

Until §1 flips to nonzero, there is nothing to build. No engineering action is
warranted, and no design document should change.

---

## Artifacts

Harness scripts `cjDh1.js`–`cjDh4.js` and raw JSON are in the session scratchpad
under `cj-poc/` (`20-dhgate-feeds-3992613.json`, `21-advertisers.json`). Nothing
was written into the repository. Every script reads the credential at runtime
and redacts both the token and the PID from all output.
