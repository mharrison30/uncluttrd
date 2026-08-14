# CJ Product Feed API — Shelving Inc. Proof of Concept

**Status: BLOCKED — awaiting credential configuration. No live queries run.**

Read-only investigation. Nothing was wired into Uncluttrd. `App.js`, Firebase
Functions, Firestore, and `ProductIntelligenceDesign.md` are untouched, as
instructed.

---

## 0. Security findings — read before placing the token

Two things were found while looking for a safe place to hold the credential.
Both matter more than the POC itself.

### 0a. `functions/.env` and `functions/.env.cluttrd-staging` are TRACKED IN GIT

Verified with `git ls-files --error-unmatch`. They are committed files, not
local-only config. They currently hold `CANARY_TEST_UID`,
`CANARY_WEB_API_KEY` and `REVENUECAT_PROJECT_ID`.

**Consequence for this task:** the obvious-looking place to put a CJ token —
next to the other Firebase config — would commit it on the next `git add`.
The token must not go there.

**Separate pre-existing issue, flagged not fixed:** a web API key is already
committed to the repository. That is out of scope for this POC and I have not
touched it, but it is worth a deliberate decision. Note that `firebase deploy`
reads both files ("Loaded environment variables from .env,
.env.cluttrd-staging"), so they are functional config and cannot simply be
deleted.

### 0b. `.gitignore` does not cover `.env`

Line 34 is `.env*.local` only. Verified:

```
git check-ignore -v .env   ->  no match  (a root .env would be committable)
git check-ignore -v .env.local -> .gitignore:34  (ignored)
```

So a root `.env` is **not** protected either.

### 0c. Chosen location

```
C:\Users\mharr\.uncluttrd-cj.env
```

Outside the repository entirely — it cannot be added to git by any `git add`
run from the project, regardless of `.gitignore` contents. The harness reads
it at runtime; nothing writes the token to disk, and no artifact contains it.

The harness also carries a redaction filter: every line it prints is passed
through a replacer that substitutes the token with `<REDACTED_PAT>` before
output, and it identifies the credential only by a fingerprint
(`len=…, ends …abcd`) so you can confirm *which* token was used without the
value appearing anywhere.

---

## Step 1 — Current CJ API contract

Confirmed from public sources; the remainder is deliberately deferred to
runtime introspection rather than guessed.

| Question | Finding | Confidence |
|---|---|---|
| Product Feed GraphQL endpoint | `https://ads.api.cj.com/query` — CJ's GraphQL surface for affiliate products, shopping feeds, advertiser discovery, travel and finance | High — multiple independent sources |
| Auth header | `Authorization: Bearer <Personal Access Token>` | High |
| Publisher PID / Website ID | Supplied as a **Company ID (CID)** argument on the query, obtained from `members.cj.com`. It is a query argument, not a header | High |
| Separate endpoints | Commission Detail is a *different* endpoint (`https://commissions.api.cj.com/query`). Do not assume one endpoint serves everything | High |
| Exact query name, filters, field set | **Not confirmed from public docs** | — |

**Why the last row is blank, deliberately.** The CJ Developer Portal renders
its schema reference through a client-side app that returns no documentation
content to a fetcher, and the public marketing article about the Product
Search API states capabilities without naming the query, its arguments, or
its fields. Rather than reconstruct the syntax from memory or from
third-party blog posts — which the task explicitly warned against — the
harness **introspects the live schema** as its first action:

```graphql
{ __schema { queryType { fields { name args { name } } } } }
{ __type(name: "Product") { fields { name type { name kind } } } }
```

This is the authoritative contract, it reflects exactly what *this* account is
entitled to see, and it cannot drift from remembered syntax. Steps 1.4, 1.5
and 1.6 (schema, filters, restricting to joined advertisers, advertiser CID)
are answered by that output, and the harness writes it to
`01-root-queries.json` and `02-product-fields.json`.

---

## Steps 2–7 — BLOCKED

No CJ credentials are present in this environment:

- No `CJ_*` environment variable is set (checked by name; no values printed).
- No credential file at the chosen location.
- Environment variables set in your own terminal do not reach this session —
  each command runs in a fresh shell — so a file is the only workable channel.

Per the task's instruction, I am stopping rather than asking you to paste the
token into chat.

Not run, and therefore not answered:

- **Step 2** — Shelving Inc.'s advertiser CID, relationship status, whether
  the relationship is active, and whether it exposes a product catalog at all.
  **Being joined does not imply a catalog exists**; the harness reports the
  joined-advertiser list and flags a `/shelving/i` match rather than assuming.
- **Step 3** — the 5–10 product sample and its real field coverage.
- **Step 4** — the three search-quality probes (`shelving`, `wire shelving`,
  `storage shelf`).
- **Step 5** — whether the feed already carries a publisher-specific deep
  link or whether the Link Search API is required to convert a destination
  URL into an affiliate URL.
- **Step 6** — `ProductCandidate` suitability.
- **Step 7** — the A/B/C/D outcome.

---

## What to configure

Create this file (it is outside the repo and cannot be committed):

```
C:\Users\mharr\.uncluttrd-cj.env
```

with exactly two lines, no quotes and no trailing spaces:

```
CJ_PAT=<your CJ Personal Access Token>
CJ_CID=<your CJ company / publisher ID from members.cj.com>
```

Then say the word and I will run the harness. It will:

1. Introspect the live schema and report what this account can actually query.
2. List joined advertisers and identify Shelving Inc.'s CID.
3. Run the product sample and the three search probes.
4. Inspect the affiliate-link situation.
5. Complete Steps 6 and 7 and update this document with the outcome.

The harness is already written and verified to fail safely without
credentials (exercised: it exits with instructions and touches nothing).

---

## Preliminary read on the architecture question

Not an answer — Step 7 is unanswered until the queries run — but worth
recording, because it shapes what the result will mean.

Even the best possible outcome here (**A — Strong product source**) would be
**narrow**: one retailer, in one category. Shelving Inc. sells shelving and
storage. Uncluttrd recommends trays, wall art, picture lights, rugs, barware,
baskets and cable management across kitchens, dining rooms, bathrooms and
offices. A CJ/Shelving Inc. integration would resolve real products for a
*subset* of one category and nothing else.

That does not make it uninteresting — it makes it a **second resolver
branch**, not a replacement for the Amazon-only Tier A plan:

- Amazon (Tier A search resolution) stays the default destination for
  everything, because it has coverage.
- CJ becomes a **category-scoped candidate source** that can return real
  products *where it has them*, which is exactly the shape
  `ProductIntelligenceDesign.md` §4 already specified: a resolver returning
  an array of typed destinations, with `kind: "product"` vs `kind: "search"`
  decided per result.

So the interesting question this POC really answers is not "should we use CJ
instead of Amazon" but **"can a per-category real-product branch exist at all
before Amazon Creators API eligibility?"** If yes, Product Intelligence v1
gains a genuine Tier B slice for storage/shelving while everything else stays
Tier A — and, notably, that would be reachable *now*, whereas Amazon's is
gated behind 10 qualified sales in a trailing 30 days.

That would be a real change to the v1 recommendation, which is why the POC is
worth running before any Product Intelligence implementation begins.

---

**Sources**

- [CJ Developer Portal](https://developers.cj.com/)
- [Product Feeds — CJ Developer Portal](https://developers.cj.com/docs/data-imports/product-feeds)
- [Personal Access Tokens — CJ Developer Portal](https://developers.cj.com/account/personal-access-tokens)
- [Product Discovery, Improved! CJ's New Product Search API](https://junction.cj.com/article/product-discovery-improved-cjs-new-product-search-api)
- [CJ Affiliate's APIs: 5 Things You Should Know](https://junction.cj.com/article/cj-affiliates-apis-5-things-you-should-know)
- [CJ Affiliate API — developer docs, auth (API Tracker)](https://apitracker.io/a/cj)
