# Product Intelligence v1 — Multi-Source Resolver Foundation

**Implemented 2026-08-14.** Follows `ProductIntelligenceDesign.md` Section 4.

Amazon context-aware search is the primary path and serves 100% of
recommendations. Awin appears only as a BD measurement tool. No product
cards, no ranking, no price filtering, no spend ranges, no retailer
comparison — all deferred until catalog coverage justifies them.

---

## Phase 1a — `.gitignore` hardening

Line 34 was `.env*.local` only, so a repo-root `.env` was committable.

```gitignore
.env*.local
/.env
/.env.*
!/.env.example
```

**The leading slash is load-bearing.** `functions/.env` and
`functions/.env.cluttrd-staging` are *tracked, functional deploy config* —
`firebase deploy` logs "Loaded environment variables from .env,
.env.cluttrd-staging" on every run. A bare `.env*` pattern would have been
wrong. Anchoring to the root closes the gap where a stray credential would
actually land (next to `package.json`) without touching the working deploy.

Verified:

| Path | Result |
|---|---|
| `.env` | ignored — `.gitignore:41` |
| `.env.local`, `.env.production`, `.env.staging.local` | ignored — `.gitignore:42` |
| `functions/.env` | **not** ignored, still tracked (correct) |
| `functions/.env.cluttrd-staging` | **not** ignored, still tracked (correct) |

Key rotation was explicitly out of scope and was not reopened.

---

## Phase 1b — Awin feed-list BD tool

`scripts/awinFeedList.js`. Standalone Node script, not a Cloud Function, not
deployed.

One authenticated GET to `productdata.awin.com/datafeed/list/apikey/…` —
well inside Awin's documented 5 req/min publisher limit. No Awin tracking
link is ever fetched (that would register a real affiliate click). The
datafeed key is read from `~/.uncluttrd-awin.env`, outside the repo, and is
redacted from every line of output.

```
node scripts/awinFeedList.js
node scripts/awinFeedList.js --filter "mosaic|king koil"
node scripts/awinFeedList.js --region US --min-products 1000 --json out.json
```

**Live run (test k):** HTTP 200 in 1,806 ms, 590 feeds, 490,074 bytes.

```
all feeds : 590        US feeds : 142
membership: Not Joined:588  active:2
regions   : GB:195  US:142  DE:66  PL:40  NL:34  ES:20  FR:18  …

BY FRESHNESS (US)          PRODUCT COUNTS (US)
  within 7 days   : 22       total visible : 1,902,440
  7-30 days       : 8        >= 1,000      : 34
  30-90 days      : 24       >= 5,000      : 16
  90+ days        : 81       large AND fresh (>=5k, <=7d) : 7
```

Two findings the tool surfaced immediately:

- **81 of 142 US feeds are 90+ days stale.** The freshness banding is the
  guard against the exact CJ failure mode — live-looking metadata over a
  catalog nobody maintains.
- **Mosaic's own feed is 91 days stale** (`Last Imported 2026-05-15`) despite
  `membership: active`. That is new since `AwinMosaicFeedComparison.md`, and
  it materially weakens Mosaic as an ingestion target.

One bug found and fixed during the run: Awin returns `Last Imported` as
`YYYY-MM-DD HH:MM:SS` with no timezone, and the values are UTC. `Date.parse`
read them as local time and produced a `-1` day age for a feed imported
hours earlier. Now parsed explicitly as UTC and clamped at zero.

`Vertical` is blank for 128 of 142 US feeds. Reported as `(unclassified)`
rather than dropped — an empty sector column is a real property of Awin's
data, not a parse failure.

---

## Phase 1c — Multi-source resolver module

`App.js`, between the `[PI-RESOLVER-START]` / `[PI-RESOLVER-END]` markers.
Replaces the entire previous implementation, which was one line:

```js
const openProduct = (q) => Linking.openURL(`https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=…`);
```

### The layer split

**Source adapter layer** owns retrieval, source-specific identifiers, and
**all affiliate URL construction**. This is the whole point: the three
networks resolve links three incompatible ways — Awin ships `aw_deep_link`
inside the feed, CJ mints one per query via `linkCode(pid:)`, Amazon builds
one from a search string. Each stays inside its own adapter.

**Everything above** sees only:

```js
{
  resolverKind: "amazon-search-v1",
  retailer: "Amazon",
  url: "<opaque>",
  queryUsed: "<the actual query sent>",
  productData: null,          // future adapters fill this
  analyticsContext: { … },
}
```

`resolverKind` is set from day one, on every resolution, so the UI renders
from it without assuming a source.

### Adding a source

A new object in `PRODUCT_SOURCES` with a `canResolve` predicate. Ordered —
first accepting adapter wins — so a future `AwinFeedSource` goes *above*
`AmazonSearchSource`, which keeps serving everything it declines. No change
to `resolveProductDestination`'s signature, the returned shape, or any call
site. Proven by test (m).

### Backward compatibility

- Pre-approach tier products (`{name, searchQuery}`, no approach, no
  grounding) route through the same resolver with a thinner context.
- Old singular `relatedProblemId` is normalized to `relatedProblemIds[]` by
  the existing `normalizeProductRecommendation`, which the resolver calls
  before doing anything else.
- **No change to how recommendations are stored.** Nothing was written to
  any plan document.

---

## Phase 1d — Amazon context-aware search resolver

Deterministic string manipulation. No AI call, no network, no randomness —
same context in, same query out, which is what makes test (b) meaningful and
lets the coverage tool reproduce production queries exactly.

**Starts from the AI's `searchTerms`**, then adds:

1. **A context hint from the WHY, not the WHERE.** Matched against problem
   text, grounding, reason, and area name — never the room name. `bar` is the
   design doc's own example: a credenza bar-zone tray is a genuinely
   different product from a generic tray.
2. **Two ambition words**, appended last so the AI's terms lead the query:

| Approach | Words |
|---|---|
| simple | `simple`, `practical` |
| polished | `modern`, `coordinated` |
| elevated | `premium`, `designer` |

Two words, not five — Amazon's relevance degrades as a query lengthens, and
every added word is another chance to over-narrow.

**No template taxonomy keyed by `productType`.** `productType` is
AI-generated and open-ended; a per-category template would become an
unbounded taxonomy nobody maintains.

**`QUERY_STOPWORDS` blocks room names explicitly.** `dining room tray` is a
strictly worse query than `tray` — it matches listings that happen to say
"dining room" rather than the category the user needs. Verified by test.

**No price filtering.** Not via URL parameters, not anywhere. We removed
`SCOPE_SPEND_TABLE`'s displayed ranges because they were arbitrary without
real product evidence; re-adding them as invisible URL filters would
reintroduce exactly that problem. A $50–$175 band on Polished would exclude
the best $42 tray and steer toward a $140 one on the authority of a table
rather than of the product. Approach ambition shapes **style and quality
intent**, never dollars.

**The Associates tag appears in exactly one place** —
`const AMAZON_ASSOCIATES_TAG`. Grepping the literal returns one hit. The
comment above it deliberately does not repeat the string, so the grep stays
honest.

---

## Phase 1e — Analytics

Three events. Recommendation analytics and affiliate analytics are kept
separate — verified: the outbound event carries no `productType`/
`approachId`, and the tapped event carries no `url`.

### `recommendation_shown` — an impression, not a render

This is the one most likely to be got wrong, so the rule is stated once and
enforced structurally:

> **One event per `(planId, approachId, productType)`, for as long as the
> user stays on that plan.**

Emitted from a `useEffect` with deps `[previewApproach, currentPlanId,
results]` — **never from the render path**, where an approach card re-renders
on every unrelated state change. A `useRef` Set holds fired keys; the key is
added *before* `logEvent`. Collapsing and re-expanding the same card re-runs
the effect, finds the key already present, and returns before emitting. The
Set is cleared only when `currentPlanId` changes.

The effect also returns early at `summary-ready` — Call 2 has not landed, so
there are no product objects to be exposed to yet. The impression belongs to
the real recommendation, not the loading state.

Captures `productType`, `approachId`, `relatedProblemIds`, `resolverKind`.

### `recommendation_tapped`

Fires on tap at both product rows (approach cards and legacy tier cards).
Captures the above plus **`queryUsed`** — the actual query sent, not the raw
`searchTerms`.

### `outbound_link_opened`

Fires only *after* `await Linking.openURL(...)` resolves. Captures
`retailer`, `resolverKind`, `url`.

**It means exactly one thing: the OS accepted the handoff.** It is *not*
evidence the user saw the retailer page or that a browser rendered anything
— the app loses visibility the moment the URL leaves it. Named `opened`
rather than `viewed` or `visited` for that reason, and documented in-code so
it is not later reported as a page view. A refused handoff emits nothing;
the absence is the signal.

The previous `product_clicked` event is gone (0 emit sites).

---

## Phase 1f — Coverage analysis

`scripts/coverageAnalysis.js`. A measurement tool, not deployed.

**Single source of truth:** the resolver is *not* reimplemented. The script
extracts the region between `[PI-RESOLVER-START]` and `[PI-RESOLVER-END]`
from `App.js` and evaluates it, so measured queries are byte-identical to
production. If that region stops being pure, the script fails loudly rather
than measuring a stale copy.

**Strictly read-only against Firestore** — `.get()` only. Grep the file for
`.set(`, `.update(`, `.delete(`, `.add(`, `.commit(`: none.

Awin coverage is measured conservatively, against the vocabulary of feeds we
can actually read today (King Koil: air mattresses; Mosaic: weighted
blankets, duvet covers). An optimistic predicate would manufacture the very
justification this tool exists to test.

Output on a schema-faithful fixture:

```
Extracted 14 recommendation(s)
  resolvable by Amazon search  : 14  (100.0%)
  resolvable by an Awin feed   : 3   (21.4%)
  queries context-enriched     : 11  (78.6%)
  legacy (pre-approach) recs   : 3
```

**That 21.4% is a fixture artifact and must not be quoted as a result.** The
fixture deliberately includes a bedroom plan with a weighted blanket and a
duvet cover, which is exactly Mosaic's catalog. Real coverage will be far
lower, because Uncluttrd overwhelmingly recommends trays, baskets, shelving,
and cable management — none of which either advertiser sells.

**The real measurement has not been run.** See Limitations.

---

## Test results

| # | Test | Result |
|---|---|---|
| a | Context-enriched URL, not bare searchTerms + tag | **PASS** — all 3 approaches |
| b | Different approaches → different queries | **PASS** — 3/3 unique |
| c | Tag in exactly one place per URL, and once in the codebase | **PASS** — 1 occurrence in `App.js` |
| d | URLs open with relevant Amazon results | **PASS** — live, see below |
| e | `recommendation_shown` once per expansion, not per re-render | **Static** — see Limitations |
| f | `recommendation_tapped` on tap with `queryUsed` | **Static** |
| g | `outbound_link_opened` on successful `openURL` | **Static** |
| h | Fallback to bare searchTerms + tag if enrichment fails | **PASS** |
| i | `resolverKind` on every resolution | **PASS** — 4/4 shapes |
| j | Old plans still work through the resolver | **PASS** |
| k | Feed-list poller reports US feeds, counts, freshness | **PASS** — live, 590 feeds |
| l | No affiliate/tracking/source identifiers above the adapter | **PASS** |
| m | New source needs only a new adapter | **PASS** |

28 resolver assertions and 25 analytics assertions, all passing.

### (b) — the actual queries, same `productType`

```
simple    -> "decorative tray bar simple practical"
polished  -> "decorative tray bar modern coordinated"
elevated  -> "decorative tray bar premium designer"
```

The `bar` hint came from the linked problem text ("no defined bar zone"),
not from the room name. `dining` and `room` are correctly absent.

### (d) — live Amazon fetches

| Approach | Query | HTTP | Distinct ASINs | Zero-results |
|---|---|---|---:|---|
| polished | `decorative tray bar modern coordinated` | 200 | 65 | false |
| simple | `cable management box simple practical` | 200 | 22 | false |
| elevated | `framed wall art premium designer` | 200 | 75 | false |
| simple | `woven storage basket simple practical` | 200 | 67 | false |

The Associates tag was echoed back in every returned page, confirming
Amazon received it.

### (m) — extensibility, proven not asserted

A fake `awin-feed-v1` adapter was registered ahead of Amazon at runtime. It
claimed `weighted blanket` and returned `productData`; Amazon continued
serving everything it declined; `resolveProductDestination`'s arity and
returned key set were unchanged.

### Build

`node -c App.js` clean. `npx expo export --platform ios` succeeded —
9.94 MB bundle.

---

## Limitations — stated plainly

**Tests (e), (f) and (g) are code-verified, not runtime-verified.** There is
no working emulator in this environment, so no event was observed arriving
in Firebase. What was verified statically is precise and non-trivial: one
emit site each; `recommendation_shown` inside a `useEffect` with the exact
expected deps and never in a JSX prop; the dedupe Set consulted and written
before the emit; the outbound event emitted only after `await
Linking.openURL` inside a `try` whose `catch` emits nothing. The structural
properties that make the impression rule correct are confirmed. **Observing
the events land is still owed.**

**Coverage has not been measured against real plans.** No Firestore
credential is available in this session (`GOOGLE_APPLICATION_CREDENTIALS`
unset; `gcloud` is broken — Python missing). The tool is verified working
against a fixture. Running it against real plans is the actual gate on Awin
ingestion, and it remains open.

**Mosaic's feed is 91 days stale**, which the BD tool surfaced during this
work. That is a change since `AwinMosaicFeedComparison.md` and it weakens
the ingestion case further, not that ingestion was recommended for building
yet.

---

## Explicitly not built

Awin feed downloading/normalization · product cards · candidate
ranking/evaluation · price filtering via URL parameters · displayed spend
ranges · retailer comparison UI · API key rotation.

`ProductIntelligenceDesign.md` is unchanged.

---

## Next

1. **Run the coverage tool against real plans.** One command once a
   credential is present. It is the gate on everything Awin.
2. **Confirm the three events in Firebase DebugView**, particularly that
   expanding and collapsing the same card twice yields one
   `recommendation_shown`.
3. **Use `awinFeedList.js` for BD.** 7 US feeds are both large (≥5k) and
   fresh (≤7d); none is a home-organization retailer. That gap, not any
   individual advertiser, is what should drive advertiser applications.
