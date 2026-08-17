# Uncluttrd Affiliate Pipeline

Last updated: June 2026
Status: Living document. Operational tracking, not architecture. Update as status changes.

This document answers: **what is our affiliate program status right now?**

For the strategic why behind Commerce, see Commerce.md. For engineering detail, see CommerceImplementation.md.

---

## Networks

| Network | Status | Publisher ID / Notes |
|---|---|---|
| CJ Affiliate | ✅ Active | Account active |
| Impact | ✅ Active | Marketplace declined; individual brand applications still work |
| Amazon Associates | ✅ Active | ID: `uncluttrd20-20` |
| Awin | ✅ Active | Account active |
| FlexOffers | ⏳ Pending | Applied, 5 business day review |
| Rakuten Advertising | ✅ Active | Publisher API auth, partnership retrieval, SFTP Product Catalog and Deep Link API all validated 2026-08-17. **Supersedes the previous "not yet applied / may become moot" note** — the Impact alliance did not make Rakuten unavailable to us |

---

## Rakuten Advertising — validation status (2026-08-17)

Recorded separately because Rakuten is the first network where feed
**mechanics** have been validated end to end, and it is important not to let
that be mistaken for validated **coverage**.

**Proven:**

| Capability | Evidence |
|---|---|
| Publisher API authentication | works |
| Advertiser partnership retrieval | programmatic |
| Product Catalog via SFTP | full catalog downloaded |
| Record count fidelity | 2,213 records, **exactly** the count Rakuten reports for that advertiser |
| Feed contents | names, categories, descriptions, prices, images, availability, UPC/identifiers, product URLs |
| Affiliate-tracked product URLs | present in the catalog itself |
| File types available | full, category, delta, template, delta-template |
| Deep Link API | works on advertiser homepage **and** individual product page; preserves the custom `u1` value |

**Two findings that constrain any future design:**

1. **Product Search ≠ Product Catalog.** Product Search returned **zero**
   results for the test advertiser while the Product Catalog held 2,213
   records. The two must not be assumed to have equivalent coverage, and any
   future adapter must be built on ingested catalog data rather than on
   Product Search.
2. **The test advertiser is Highwood USA (MID 50730), an outdoor-furniture
   merchant.** It validates mechanics only. Its catalog is almost entirely
   outside the categories Uncluttrd recommends, so it is explicitly **not**
   evidence of useful coverage.

**Open, and required before any production ingestion:** durable catalog
storage/retention rights under Rakuten's publisher terms. Amazon's 24-hour
retention restriction is an Amazon rule and must not be assumed to apply here —
but neither may durable storage be assumed permitted until verified.

**Status:** validated on mechanics, **gated on category coverage.** No ingestion
pipeline, adapter, or canonical catalog has been built.

### Endpoint capability map (investigated 2026-08-17, read-only)

The finding that matters: **Rakuten exposes human-readable advertiser
categories only AFTER a partnership exists.** Network-wide it offers
eligibility/capability metadata but no merchandising taxonomy.

| Endpoint | Access | Carries categories? |
|---|---|---|
| `GET /v2/advertisers` | 2,159 advertisers | **No.** 8 fields: `network`, `id`, `name`, `url`, `policies`, `features`, `contact`, `logo_url`. Zero descriptions, zero categories |
| `GET /v2/advertisers/{mid}` | single | No — adds only `can_partner` |
| `GET /v1/partnerships` | our 6 | **Yes** — human-readable, plus partnership + advertiser status |
| `GET /linklocator/1.0/getMerchByID/{mid}` | **partners only** | Yes (numeric ids) + `applicationStatus`. **HTTP 500 for every non-partner** |
| `GET /linklocator/1.0/getMerchByCategory/{id}` | partners only | Enumerates *our* merchants, not the network |
| `GET /advertisersearch/1.0` | 2,131 | No — `<mid>` + `<merchantname>` only, and **ignores every parameter** (`category`, `categoryid`, `name`, `mid`, `page`, `limit` all return a byte-identical list) |
| `/v1/categories`, `/v2/categories`, `/categories/1.0` | 404 | — |
| `getCategories` | 500 | — |

**Consequence:** a network-wide advertiser relevance screen is not buildable
from Rakuten's own metadata. The information needed to decide whether to apply
is released only once you have applied — structurally the same gate as Amazon's
Creators API.

Network-wide, only eligibility filters exist: `product_feed = true` (1,753),
ships to US (1,416), **both (1,200)**. These narrow the list but say nothing
about whether a merchant sells what Uncluttrd recommends.

### What the tool does now

`scripts/rakutenAdvertiserScreen.js` defaults to `--portfolio`: a read-only
view of merchants we have **already engaged**, from `/v1/partnerships`, joined
to `/v2/advertisers` on MID for capability flags.

**It is a portfolio, not a screen.** It describes six merchants we chose and is
never evidence of Rakuten-wide category coverage.

The merchant-name relevance classification is **deprecated** and now requires
`--name-screen`. It was proven to measure naming conventions rather than
inventory: with no descriptions or categories in `/v2/advertisers`, it was
classifying merchant names (mean 13 characters). Six Cordis *hotels* matched
"cord" → cable management; Wayfair, Target and The Container Store would all
score zero, exactly as Highwood USA did.

The 15-category Uncluttrd taxonomy is **retained deliberately** — it is the
right instrument for future *product-level* coverage analysis against catalog
rows, and `--self-test` keeps it validated against real recommendation text.

---

## Retailers — By Status

### ✅ Approved

| Retailer | Network | Status | Commission | Cookie | Last Checked | Next Action |
|---|---|---|---|---|---|---|
| Amazon | Amazon Associates | Active | 1-8% (category) | 24 hrs | Jun 2026 | Fallback retailer, not primary — no action needed |
| Shelving.com | Direct | Active | TBD | TBD | Jun 2026 | Confirm affiliate link format, add to RetailRegistry when Commerce V1 builds |

### ⏳ Pending

| Retailer | Network | Status | Commission (expected) | Cookie | Last Checked | Next Action |
|---|---|---|---|---|---|---|
| Walmart | Impact / Direct | Pending | 1-4% | 3 days | Jun 2026 | Check approval status |
| Home Depot | Impact | Pending | up to 8% | 24 hrs | Jun 2026 | Check approval status |
| Best Buy | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Staples | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Office Depot/Max | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Wrap-It Storage | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Macy's | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| JC Penney | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Hobby Lobby | — | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Joseph Joseph | Direct/CJ | Pending | TBD | TBD | Jun 2026 | Check approval status |
| iDesign | Direct/CJ | Pending | TBD | TBD | Jun 2026 | Check approval status |
| Wayfair | FlexOffers | Pending | 5-7% | 7 days | Jun 2026 | Waiting on FlexOffers network approval |
| Lowe's | FlexOffers | Pending | 2-4% | 30 days | Jun 2026 | Waiting on FlexOffers network approval |
| Bed Bath & Beyond | FlexOffers | Pending | TBD | TBD | Jun 2026 | Waiting on FlexOffers network approval |
| Kohl's | FlexOffers | Pending | TBD | TBD | Jun 2026 | Waiting on FlexOffers network approval |

### ❌ Blocked

| Retailer | Network | Status | Last Checked | Next Action |
|---|---|---|---|---|
| Target | Impact | Blocked — Marketplace declined | Jun 2026 | Reapply 60-90 days post-launch with download/traffic data |
| Wayfair (via Impact) | Impact | Blocked — Marketplace declined | Jun 2026 | Use FlexOffers path instead |
| The Container Store | Impact (migrated from Rakuten) | Blocked — Marketplace declined | Jun 2026 | Reapply 60-90 days post-launch |
| Lowe's Creator Program | Direct | Blocked — requires social media | Jun 2026 | Blocked on Social Media Accounts (see BACKLOG.md, 🟡 High) |

### Not Available
| Brand | Reason |
|---|---|
| Rubbermaid | No affiliate program exists. Covered indirectly via Home Depot, Walmart, Amazon listings. |
| ClosetMaid | No affiliate program exists. Covered indirectly via Home Depot, Walmart, Lowe's, Amazon listings. |

---

## Next Actions

1. **When FlexOffers approves** (expected early July 2026): immediately apply to Wayfair, Lowe's, Bed Bath & Beyond, Kohl's within that network.
2. **When Social Media Accounts are live** (see BACKLOG.md): apply to Lowe's Creator Program directly (up to 20% commission).
3. **60-90 days post-launch:** reapply to Impact Marketplace with real download numbers and Google Analytics traffic data to unlock Target and The Container Store.
4. **Ongoing:** check FlexOffers listings periodically for additional relevant retailers (Costco, Sam's Club membership programs found but lower priority — commission is on membership signup, not product purchase).

---

## Website & Verification Assets

| Asset | Status |
|---|---|
| Google Analytics on uncluttrd.app | ✅ Live, G-HGQZTEWKMF |
| Impact site verification meta tag | ✅ Live |
| Privacy policy reflects account deletion | ✅ Updated Jun 2026 |

---

*AffiliatePipeline.md is operational. Commerce.md and CommerceImplementation.md do not need to track individual retailer status — that lives here.*
