# Uncluttrd Retailers

Last updated: June 29, 2026  
Status: Living document. This is the operating manual for retailer, affiliate, and commerce relationships.

This document answers: **which retailers does Uncluttrd work with, how do those relationships operate, and where should the Commerce Service route users when AI recommendations create purchase intent?**

For commerce architecture and philosophy, see Commerce.md.

---

## Purpose

Retailers.md is the source of truth for Uncluttrd's retailer relationships.

It tracks:

- Affiliate program access
- Direct retailer relationships
- API availability
- Deep-linking capability
- Product-category fit
- Approval status
- Strategic priority
- Brand partnership potential
- Operational notes

The goal is not to build a traditional affiliate list. The goal is to build a retailer network that helps users complete organization projects with trusted product options.

---

## Core Principle

**Uncluttrd should never feel like an affiliate site.**

From the business side, affiliate revenue may fund the commerce layer.

From the user side, the experience should feel like:

> "Here are the best places to buy the products that complete your organization plan."

That distinction matters.

---

## Retailer Priority System

### Tier 1 — Launch Coverage

These retailers should be pursued first because they cover the majority of Uncluttrd's early product recommendations.

| Retailer | Commerce Profile | Best For | Priority |
|---|---|---|---|
| Walmart | Budget Value Leader | Budget bins, carts, basic shelving, household storage | Tier 1 |
| Home Depot | Garage & Workshop Leader | Garage shelving, pegboards, hooks, utility storage | Tier 1 |
| Lowe's | DIY & Home Improvement Leader | Garage, basement, utility, home improvement storage | Tier 1 |
| Target | Decorative Storage Leader | Closet, bedroom, pantry, home office, attractive storage | Tier 1 |

### Tier 2 — Specialty and Expansion

These should be added after Tier 1 coverage is underway.

| Retailer | Commerce Profile | Best For | Priority |
|---|---|---|---|
| The Container Store | Premium Organization Specialist | Closet systems, bins, drawer organization, Elfa | Tier 2 |
| IKEA | Space-Saving Furniture Leader | Small spaces, modular storage, affordable furniture | Tier 2 |
| Best Buy | Tech & Cable Management | Office tech, smart home, cable organization | Tier 2 |
| Office Depot | Home Office Utility | Filing, office storage, desk organization | Tier 2 |
| Staples | Home Office Utility | Office supplies, file storage, shipping supplies | Tier 2 |

### Tier 3 — Long-Term Retailer Network

These are useful once Uncluttrd has traffic, product data, and a stronger partnership story.

| Retailer | Commerce Profile | Best For | Priority |
|---|---|---|---|
| Ace Hardware | Local Hardware Convenience | Hooks, bins, tools, small hardware | Tier 3 |
| Tractor Supply | Utility & Outdoor Storage | Garage, outdoor, shed, utility storage | Tier 3 |
| Menards | Midwest DIY Value | Garage, shelving, home improvement | Tier 3 |
| Costco | Bulk Value | Bulk bins, shelving, garage storage | Tier 3 |
| Wayfair | Home Decor & Furniture | Decorative storage, furniture, premium home items | Tier 3 |
| Amazon | Fallback Marketplace | Product gaps, hard-to-find items | Fallback |

---

## Retailer Commerce Profiles

Commerce Profiles help the recommendation engine understand where each retailer is strongest.

A retailer is not just a store. In Uncluttrd, each retailer has a role.

| Profile | Meaning |
|---|---|
| Budget Value Leader | Strong default for lower-cost recommendations |
| Garage & Workshop Leader | Best fit for utility, shelving, heavy-duty organization |
| DIY & Home Improvement Leader | Strong across improvement, utility, and home storage |
| Decorative Storage Leader | Best fit when appearance matters |
| Premium Organization Specialist | Higher-quality or specialized organization systems |
| Space-Saving Furniture Leader | Strong for small homes, apartments, and multi-use furniture |
| Tech & Cable Management | Best for electronics, cables, smart home, and desk setup |
| Home Office Utility | Best for office supplies, files, desks, and workspaces |
| Local Hardware Convenience | Good for small project add-ons and quick-pickup items |
| Fallback Marketplace | Used when preferred retailers do not satisfy the recommendation |

---

## Approval Strategy

### Immediate sequence

1. Walmart
2. Home Depot
3. Lowe's
4. Target

These four provide enough coverage to make Commerce useful across Garage, Closet, Kitchen, Bedroom, Home Office, and Living Room recommendations.

### Why this order

Walmart provides broad budget coverage and strong household storage fit. Home Depot and Lowe's provide the garage, utility, and DIY backbone. Target provides the design-friendly home organization side.

Together, they make Uncluttrd feel like a shopping assistant rather than a single-retailer affiliate app.

---

## Program Access Notes

Impact declined Marketplace access, but the account can still be used for existing or pending brand relationships, direct brand sign-up links, and brand invitations. That means Uncluttrd should not depend on Impact Marketplace access as the primary route to retailer coverage.

CJ should also be treated as a possible access route, not the foundation of the strategy.

The operating strategy is:

> **Build direct retailer relationships first. Use affiliate networks where they help. Never let one network become a dependency.**

Rakuten Advertising is now a live access route (validated 2026-08-17 — see
`AffiliatePipeline.md`). It does not change the strategy above. Network
selection remains **evidence-driven and undecided**; Impact vs Rakuten is
explicitly not being chosen on capability alone.

### Catalog size is not coverage

The governing measurement rule for every network, learned from three
consecutive investigations:

| Merchant | Catalog | Verdict |
|---|---|---|
| King Koil (Awin) | 29 rows | **1 distinct product.** Variant rows are not products |
| DHgate (CJ) | large | mostly non-US locales; live-looking metadata over unmaintained feeds |
| Highwood USA (Rakuten) | 2,213 records, count verified exactly | **outdoor furniture.** Perfect mechanics, ~zero Uncluttrd relevance |

Each was technically impressive and strategically irrelevant. A merchant is
worth an application only when its catalog is relevant to what Uncluttrd
**actually recommends**, which is now a measured quantity rather than an
assumption:

| Category | Measured share | | Category | Measured share |
|---|---:|---|---|---:|
| Furniture | 13.5% | | Trays | 6.9% |
| Lighting | 12.8% | | Wall art / mirrors | 6.0% |
| Shelving / risers | 12.0% | | Textiles | 4.1% |
| Cable management | 10.1% | | Hooks / hardware | 2.7% |
| Drawer organizers | 9.4% | | Plants | 2.4% |
| Storage / bins / baskets | 8.4% | | Barware / glassware | 2.0% |
| Decor objects / vases | 8.0% | | Labels · Kitchen/pantry | 3.4% |

Derived from 1,053 real recommendations across production and staging. This
demand profile is **broad and long-tailed** — no single home retailer covers
furniture *and* cable management *and* drawer organizers *and* wall art with
depth, which is the structural argument for a retailer network rather than a
primary-source strategy.

`Product Coverage` in the registry fields below should be set from this
evidence — `scripts/rakutenAdvertiserScreen.js` produces it for Rakuten — not
from a merchant's own category label.

### The base rate to expect

Awin's directory screen: **5 of 974** advertisers were storage/organisation
specific, and all five were weak. There is no reason to assume another
network's distribution differs until measured. Note also that The Container
Store — the single most category-relevant retailer in this document —
**migrated off Rakuten to Impact**, which is a real signal about where
organization specialists are concentrating.

---

## Retailer Registry Fields

Each retailer should be tracked using the following fields:

| Field | Meaning |
|---|---|
| Retailer | Retailer or brand name |
| Priority | Tier 1, Tier 2, Tier 3, Fallback |
| Commerce Profile | Retailer's strategic role in Uncluttrd |
| Status | Not Started, Researching, Applied, Pending, Approved, Declined, Live, Paused |
| Affiliate Method | Direct, Network, Creator Program, Brand Invite, Aggregator, None, TBD |
| Network | Impact, CJ, Awin, Rakuten, FlexOffers, Sovrn, Direct, TBD |
| Signup URL | Official application or program page |
| Login Portal | Where account is managed |
| API Available | Yes, No, Limited, Unknown |
| Deep Linking | Yes, No, Limited, Unknown |
| Commission | Known rate or TBD |
| Cookie Duration | Known duration or TBD |
| Product Coverage | 1-5 rating for Uncluttrd fit |
| Best Categories | Garage, Closet, Kitchen, Bedroom, Home Office, Living Room, etc. |
| Contact | Account manager or program contact |
| Last Checked | Date program details were last reviewed |
| Notes | Operational details |

---

## First Build Requirements

The first version of Commerce does not need perfect product matching.

It needs:

1. A small approved retailer set
2. Working tracked links
3. Click tracking
4. A fallback path when no affiliate link exists
5. Server-side link resolution through the Commerce Service

The app should not hard-code retailer links.

The app asks Commerce:

> "Where can the user buy this?"

Commerce decides:

> "Here are the best current options."

---

## Strategic Warning

Do not let retailer onboarding delay the core product.

The first version of Uncluttrd can still launch with Google Search links if needed.

The first Commerce update should replace those generic links with tracked retailer options once enough coverage exists.

Commerce is an accelerant, not the reason the app exists.

---

## Long-Term Vision

Retailers.md should eventually become a company asset.

In five years, it may track:

- 75+ retailers
- 30+ direct brand partnerships
- API integrations
- seasonal promotions
- product feed quality
- sponsored placement rules
- commission history
- sales contacts
- strategic notes

At that point, it is no longer an affiliate spreadsheet.

It is the operating system for Uncluttrd's commerce relationships.
