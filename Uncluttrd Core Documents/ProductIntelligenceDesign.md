# Product Intelligence — Scoping & Design Pass (2026-08-12)

Read-only design investigation. Nothing implemented in this pass.

**Authority.** This document is the authoritative design for the next commerce
phase. Where it and `ShoppabilityDesign.md` (2026-08-10) disagree, this
document and the shipped implementation win; that document is retained as
historical context for the tier→approach evolution. Where this document and
`ApproachSelectionDesign.md` touch the same ground, the approach-based
architecture is authoritative and is treated here as settled input, not
re-litigated.

**Headline finding, which reshapes the whole plan:** the Amazon Product
Advertising API no longer exists to be integrated with. PA-API 5.0 was
deprecated 2026-04-30 and **retired 2026-05-15** — three months ago — and
Amazon stopped accepting new PA-API customers before that. Its replacement,
the **Creators API**, requires **10+ qualified sales in a trailing 30-day
window before credentials are issued at all**. Uncluttrd is pre-launch on
staging with no production sales, so **Tier B is not reachable today, at any
level of engineering effort**. Section 3 has the evidence; Section 11 sets
the v1 boundary around it.

---

## Section 1 — Current state audit

Read from the shipped code, not from the prior document.

### 1a. What the AI produces per recommendation

Written by **Call 2** (`analyzePhotoDetail`), one array per approach:

| Field | Notes |
|---|---|
| `productType` | a *category* phrase, never a brand or product ("Decorative tray for credenza") |
| `reason` | one sentence on what it does for this space |
| `searchTerms` | retailer-independent search words |
| `icon` | one key from `PRODUCT_CATEGORY_ICONS`, vocabulary derived from the map's own keys |
| `relatedProblemIds` | **array** of `problemsFound` ids |
| `grounding` | visible-evidence sentence, or `null` |
| `approachId` | which approach this belongs to |

Zero to six per approach. Three valid grounding states (problem-solving,
multi-problem, optional-enhancement); empty ids **and** null grounding is
invalid and must not be returned.

### 1b. What "Find options →" does

`openProduct(searchTerms)` →
`https://www.amazon.com/s?k=<encoded>&tag=uncluttrd20-20`, opened via
`Linking.openURL`. A **search page**, not a product. Constructed entirely at
tap time.

### 1c. Stored vs constructed

**Stored on the plan:** the seven fields above, inside
`approaches.<id>.productRecommendations`.
**Constructed at tap time:** the URL, and nothing else.
**Never stored:** any product identity, price, image, rating, availability,
or ASIN. Confirmed: no commerce collections exist, and `price` appears in
`App.js` only on the legacy tier path (`t.products[].price`, an
AI-authored *string*) and in the old tier PDF/share.

### 1d. Associates tag and URL pattern

Tag `uncluttrd20-20`, hardcoded in the single `openProduct` helper. That
one-line helper is, today, the entire "retailer resolver."

### 1e. Analytics

One event: `product_clicked`. Two call sites — approach path sends
`{ product: productType, approach: id }`, legacy tier path sends
`{ product: p.name }`. **No event for recommendation *shown*, none for
outbound link opened as distinct from tapped, and no affiliate/revenue
correlation.**

### 1f. What changed since ShoppabilityDesign.md

| Prior design | Status now |
|---|---|
| `relatedProblemId` (singular, mandatory) | **Superseded.** Now `relatedProblemIds[]` + `grounding`. A single mandatory id left nowhere honest for a recommendation solving no named problem, and two prompt revisions failed to fix it where one schema change succeeded |
| Structured `problemsFound` as the bridge | **Still valid**, and load-bearing — it is what makes `relatedProblemIds` meaningful |
| Retailer-agnostic data, Amazon-specific resolver | **Still valid**, and unchanged as an architectural commitment |
| Recommendations rendered as "Products that could help" 0–4 cards | **Superseded** by `ApproachSelectionDesign.md`: recommendations live inside the *expanded approach card*, 0–6 per approach, three approaches per plan |
| Flat `organizingTips` list | **Superseded** by per-approach `organizingGuidance` |
| Tier-based context | **Superseded** by approach ambition (Simple / Polished / Elevated) |
| "Real product catalog, real pricing, real photos" deferred | **Still deferred** — and Section 3 now shows it is externally blocked, not merely unscheduled |
| Open question: what replaces the budget selector | **Resolved** — the selector was removed 2026-08-12; approaches replaced it |
| Open question: what drives AI Visualization post-tiers | **Resolved** — `visualizationDirection` per approach |

Net: the *data model* commitments survived; the *presentation* and *context*
model were replaced by approaches.

---

## Section 2 — What "real products" means at v1

| Tier | What it delivers | Reachable today? |
|---|---|---|
| **A — Enhanced search** | Context-built queries, better-targeted Amazon search URLs. No product data | **Yes** |
| **B — Product resolution** | 2–4 real products with name, image, price, rating; deep links | **No** — see Section 3 |
| **C — Curated intelligence** | B, plus ranking/filtering on dimensions, style, ambition | **No** — strictly requires B |

**Recommendation: Tier A for v1**, built behind a resolver interface shaped
for Tier B, so B becomes a swap of one module rather than a rewrite.

This is not the smallest-lift option chosen for its own sake — it is the
only reachable one. The honest framing is that Tier A is v1 *because Amazon
closed the door on B*, and the design's job is to make sure that door can be
walked through the moment it opens.

---

## Section 3 — Amazon Product Advertising API: the feasibility answer

### 3a–3b. PA-API 5.0 is retired

- **Deprecated 2026-04-30; endpoint retired 2026-05-15.** Today is
  2026-08-12. It has been gone for three months.
- Amazon **stopped accepting new PA-API customers** before retirement.
- `webservices.amazon.com/paapi5/documentation/` now **302-redirects to a
  deprecation notice** — verified during this investigation, not assumed.

So questions 3a/3b as posed are moot. The live question is the replacement.

### 3c. Does `uncluttrd20-20` qualify? — the blocking answer

The replacement is the **Creators API**. Its gate:

> **10+ qualified sales in the trailing 30 days**, per marketplace, before
> credentials are issued.

(The predecessor rule was 3 qualifying sales within 180 days of joining;
the bar went *up*, not down.)

Uncluttrd is pre-launch, running on staging, with no production install
base. Ten qualified sales in a rolling 30-day window is not achievable
before launch. **Credentials cannot be obtained now.**

This is a chicken-and-egg gate: API access that would help drive sales is
granted only to accounts already making sales. It is worth naming plainly
because it means no amount of implementation effort unblocks Tier B.

> **One thing I could not verify and you must:** the actual sales history on
> the `uncluttrd20-20` Associates account. I have no access to Associates
> Central. If that account *already* clears 10 qualified sales in a trailing
> 30 days from some other property, Tier B becomes reachable and this
> document's v1 boundary should be revisited. Everything else here is
> verified.

### 3d. Rate limits and cost

- **Free.** No usage cost.
- New credentials start at **1 TPS**, **8,640 requests/day** for the first
  30 days, scaling with qualified sales.
- 1 TPS is a real design constraint even post-eligibility: a plan with three
  approaches × up to 6 recommendations is up to 18 lookups. Resolving a
  whole plan eagerly at 1 TPS takes ~18 seconds and burns 18 of the daily
  8,640. Resolution must be lazy and cached (Section 5).

### 3e–3f. Display and caching restrictions

- Auth is **OAuth 2.0 client-credentials** (Credential ID + Secret, ~1 hour
  token), *not* AWS SigV4 — so any PA-API signing code or library found
  online is already obsolete.
- Operations: **Search / Get / Variations**.
- **Data retention is limited to 24 hours.** Prices and availability may be
  cached for roughly a day and no longer. This is a hard constraint on
  Section 5's cache design and forbids building a durable local catalog.

### 3g. Latency

Not independently measured (no credentials to measure with). Design assumes
a network round trip per resolution and treats it as user-visible, which is
why Section 6 specifies a non-blocking presentation.

### Alternatives, since Tier B is blocked

1. **Better affiliate search URLs — no API, no eligibility gate.** Plain
   `/s?k=…&tag=…` links work for anyone in the Associates programme and are
   what ships today. This is Tier A and it is available immediately.
2. **Third-party product data providers** (Canopy, Rainforest, and similar
   scraping-backed APIs). Real capability, but: paid per request, terms-of-
   service exposure on Amazon data, no affiliate attribution of their own,
   and they would still need Associates links for monetisation. Introducing
   a paid dependency *and* a ToS question to a pre-launch app is a poor
   trade. **Not recommended for v1.**
3. **Manual/curated catalog.** Contradicts the stated v1 constraint ("no
   product catalog curation or manual data entry") and does not scale across
   arbitrary rooms. **Rejected.**

---

## Section 4 — Retailer resolver architecture

**There is exactly one resolver design, and it is the one already committed
to in `ShoppabilityDesign.md` Section 4.** This section refines it for
approaches; it does not create a competitor.

### What remains valid from the prior design

- Recommendations describe **what** to buy and **why**; a separate resolver
  decides **where**. Unchanged and correct.
- Recommendation data stays **retailer-agnostic** — no Amazon-specific field
  ever enters the plan document.
- v1 is **Amazon-only**.
- All affiliate/retailer logic lives in **one place**.

### What changes

The resolver's *input* is richer than the prior design assumed, because
approaches now carry ambition and the schema carries grounding:

```
resolve({
  productType, searchTerms,          // the need
  approachId, approachAmbition,      // simple | polished | elevated
  roomName, areaName,                // canonical identity, live Space/Area names
  problem, grounding,                // why this was recommended
}) -> [{ retailer, kind, url, label, price?, image?, rating? }]
```

`kind` is `"search"` (Tier A) or `"product"` (Tier B). **The call site never
branches on tier** — it renders whatever the resolver returns, so upgrading
to B changes one module.

### v1 behaviour (Tier A)

Construct the best possible Amazon *search* destination from the full
context rather than from `searchTerms` alone — see Section 11 for exactly
what "best possible" means and what evidence would prove it.

### Future (deferred)

Multiple retailers, and category→partner eligibility (storage →
Amazon/Walmart/Container Store; decorative → Amazon/Target; closet systems →
specialty). The `retailer` field and array return type exist from v1 so this
needs no schema change later, but **no second retailer ships in v1.**

---

## Section 5 — Where product data lives

**v1 (Tier A): nothing changes.** No product data exists, so there is
nothing to store or cache. The plan document keeps exactly the seven fields
in §1a. This is a real advantage of the Tier A boundary — it ships with zero
new persistence.

**Tier B design, for when it unblocks:**

- **a. On the plan:** still only the seven fields. Resolved product data must
  **never** be written into `approaches.*.productRecommendations` — prices go
  stale, the 24-hour retention rule forbids durable storage, and the plan is
  a historical record of *advice*, not of a shopping session.
- **b. At display time:** resolution is lazy — only for the expanded approach
  card the user is actually looking at, never eagerly for all three (1 TPS,
  Section 3d).
- **c/d. Cache:** a separate top-level collection keyed by a hash of the
  resolver input, **not** on the plan and **not** per-user, so two users
  needing "decorative tray" share one entry. Storing it on the plan would
  both violate retention and duplicate identical data per user.
- **e. Expiry: 24 hours maximum**, set by Amazon's retention rule, not by our
  preference. Expired entries are deleted, not served stale.
- **f. Unavailable product:** fall back to the Tier A search URL for that
  recommendation. The category advice is still valid even when one specific
  item is gone — which is precisely why the plan stores the *category* and
  not the product.

---

## Section 6 — UI when recommendations become "real"

**v1: the card does not change.** Icon + `productType` + resolved reason +
"Find options →" is already correct for a search destination, and promising
more without product data would be dishonest.

**Tier B design:**

- **a.** The product row becomes: image, product name, `price · retailer ·
  rating`, a fit line, "View product →".
- **b. One best pick per recommendation**, expandable to 2–3 alternatives.
  Uncluttrd's value is judgement, not a results page; returning four options
  per category × six categories × three approaches recreates the Amazon
  search the user could have run themselves.
- **c. Prices to all users.** A price is information needed to decide, not a
  premium feature, and hiding it behind Pro would make the free experience
  worse than today's plain search link.
- **d. Images only from real catalogue data, never generated.** An
  AI-generated image of a purchasable product misrepresents the item.
- **e. Tapping goes directly to the retailer** with the affiliate tag. An
  in-app product page is a commerce surface Uncluttrd has no reason to own.
- **f. Mixed states must degrade per-recommendation, not per-card:** a
  resolved item renders rich, an unresolved one keeps "Find options →", in
  the same list. This falls out of the resolver returning `kind` per result.

---

## Section 7 — Spend range restoration

The deterministic scope × approach table still computes
`estimatedSpendRange` and still persists it; only its *display* was removed,
because the number was disconnected from the actual recommendations.

**With real product data it becomes credible — and only then.**
Recommendation: **derive it from the sum of resolved product prices**, not a
separate calculation, so the number and the list can never disagree. Show a
range (min/max across the resolved options), phrased as
"Estimated investment: $85–$140 based on the products above."

Two conditions before restoring it:

1. **All** of an approach's recommendations resolved. A partial sum reads as
   a total and understates cost — worse than showing nothing.
2. Recomputed at display time from live prices, never persisted, because a
   persisted total would go stale exactly as the removed table did.

If those conditions fail, show nothing — the current state. The old
`estimatedSpendRange` field should then be **retired**, not displayed
alongside a real sum, or the app will show two different numbers for one
approach.

---

## Section 8 — Analytics

Two separate concerns, deliberately not merged. Recommendation analytics
answer *"is our advice good?"*; affiliate analytics answer *"does it earn?"*
Merging them makes the first unanswerable whenever the second is noisy.

**Recommendation analytics (v1, implementable now):**

| Event | Payload |
|---|---|
| `recommendation_shown` | planId, approachId, productType, relatedProblemIds, hasGrounding |
| `recommendation_tapped` | the above, plus position in list |
| `resolver_destination` | resolverKind (`search`/`product`), retailer, whether context enrichment applied |

`recommendation_shown` is the notable gap today — without it, tap counts have
no denominator and "which recommendations get ignored" is unanswerable.

**Affiliate analytics (deferred):** outbound click id, and eventually
conversion/revenue from Associates reporting. Amazon does not attribute
conversions back per-link in real time, so this will always be a *joined,
delayed* dataset rather than an event stream — another reason to keep it
separate.

---

## Section 9 — Area-level `productMemory` (scope only)

Data model only; not implemented, not in v1.

```
spaces/{roomId}/areas/{areaId}.productMemory: {
  recommended: [{ productType, firstRecommendedAt, timesRecommended, lastApproachId }],
  purchased:   [{ productType, recordedAt, source: "user" | "affiliate" }],
  alreadyOwn:  [{ productType, recordedAt }],
  notNeeded:   [{ productType, recordedAt }],
}
```

- **a.** A tap is **interest, not acquisition**, and should be recorded as
  `recommended.timesRecommended`, never as `purchased`. Treating a tap as a
  purchase would suppress a recommendation the user merely looked at.
- **b.** On re-analysis, Product Intelligence should **de-emphasise, not
  suppress**, categories in `recommended` — and genuinely suppress only
  `purchased`, `alreadyOwn` and `notNeeded`. Hard-suppressing everything ever
  recommended would silently degrade the plan for a user who simply hasn't
  acted yet.
- **c.** `purchased` is **user-declared** in v1 of that feature ("I got
  this"). Affiliate conversion data is aggregate and delayed and cannot
  reliably attribute a specific product to a specific Area, so inferring
  purchases from it would produce confident wrong state.
- **d.** Belongs on the **Area**, not the plan: it is a property of the
  physical place across visits, which is exactly the distinction Areas exist
  to carry.

---

## Section 10 — Service recommendations (scope only)

**Feasible, and the UI is already shaped for it:** the expanded card renders
from `recommendationGroups`, an ordered list built specifically so a future
`serviceRecommendations` array joins as a second group with
`kind: "service"` without touching the card layout.

- **a.** Yes — "professional organizer for this closet system", "electrician
  to install a picture light" (which the evidence-constrained rule currently
  forces the AI to phrase conditionally or omit; a service recommendation is
  the honest home for exactly those).
- **b.** A service resolver differs fundamentally: **local and licensed**,
  not shippable. Inputs are geography and trade, not product category;
  partners would be directories (Thumbtack, Angi) rather than retailers.
- **c.** Needs: `serviceType`, `reason`, `relatedProblemIds`, an urgency or
  complexity signal, and a locality — **which Uncluttrd does not currently
  collect and should not collect casually.**
- **d.** Deferred. The unlock is a location signal with a real privacy
  decision attached, not resolver work.

---

## Section 11 — v1 scope boundary

**In scope for v1 — "Context-Aware Search Resolution" (Tier A):**

1. **A real resolver module.** One function, one place for all
   retailer/affiliate logic, returning an array of typed destinations.
   Replaces the one-line `openProduct`. This is the load-bearing piece: it
   is what makes Tier B a swap rather than a rewrite.
2. **Context-enriched query construction.** Build the Amazon query from
   `searchTerms` + room type + approach ambition rather than `searchTerms`
   alone, so a Polished dining-room tray query differs from an Elevated one.
3. **Ambition-aligned price banding** via Amazon's own URL price filters
   (`rh=p_36:…`), driven by the existing scope × approach table — using the
   table for *filtering* the destination, which is credible, rather than for
   *displaying* a number, which was not.
4. **`recommendation_shown` analytics**, giving tap-through a denominator.
5. **`resolverKind` in the response from day one**, so the UI already renders
   whatever it is given.

**Deferred:** multiple retailers · product catalog/curation · purchase
tracking & `productMemory` · service recommendations · cross-visit
suppression · social proof · **and all of Tier B/C until Creators API
eligibility exists.**

**The honest summary:** v1 makes the destination smarter. It does not make
the app a commerce surface, because Amazon has closed that door until
Uncluttrd is already selling.

---

## Section 12 — Required staging evidence for v1

Scoped to Tier A, since that is the recommended v1.

| # | Evidence |
|---|---|
| a | For a real plan, the resolver returns a destination for **every** recommendation across all three approaches — no recommendation loses its "Find options →" |
| b | The constructed URL differs meaningfully from today's for the same `searchTerms` — room type and ambition demonstrably present in the query |
| c | The same `productType` under **Simple vs Elevated** produces **different** URLs (price band and/or qualifiers), proving ambition reaches the destination |
| d | Every URL carries `tag=uncluttrd20-20`; the tag appears in **exactly one** place in the codebase |
| e | Every URL is valid and correctly encoded — fetched and returns HTTP 200 with results, not an error or empty page |
| f | Legacy tier plans still resolve through the same module and still open a working search |
| g | `recommendation_shown` fires once per rendered recommendation, with approach and problem linkage |
| h | `recommendation_tapped` payload matches the `shown` event, so the funnel joins |
| i | A recommendation with empty `searchTerms` degrades to a `productType` query rather than an empty search |
| j | No product data is written to the plan document — the seven fields are unchanged after resolution |
| k | `resolverKind` is `"search"` for every v1 result, and the UI renders from it rather than assuming |

**Sources**

- [PA-API 5.0 deprecation notice (redirect target of the official docs)](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation)
- [Amazon PA-API Deprecation May 15 2026: Creators API Migration Guide](https://blog.freshstore.com/amazon-creators-api-pa-api-retirement/)
- [Amazon PA-API v5 deprecates April 30, 2026 — auth-layer changes](https://dev.to/th3nate/amazon-pa-api-v5-is-shutting-down-april-30-2026-here-is-what-changes-at-the-auth-layer-22ek)
- [How to get Amazon Creators API access in 2026 (the actual requirements)](https://velantio.com/blog/how-to-get-amazon-creators-api-access)
- [Amazon Creators API: What Changed and How to Switch](https://www.keywordrush.com/blog/amazon-creator-api-what-changed-and-how-to-switch/)
- [Amazon PA-API “AssociateNotEligible”: the 10-sales rule](https://www.keywordrush.com/blog/amazon-pa-api-associatenoteligible-error-is-there-a-new-10-sales-rule/)
- [Are There Any Requirements to Use the Product Advertising API? (Amazon Associates)](https://affiliate-program.amazon.com/help/node/topic/GVJ2BJP35457CLML)
