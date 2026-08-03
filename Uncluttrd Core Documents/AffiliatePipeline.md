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
| Rakuten Advertising | Not yet applied | Migrating into Impact per April 2026 alliance; may become moot |

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
