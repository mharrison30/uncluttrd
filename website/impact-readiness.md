# Impact Readiness — prepared, NOT submitted

Nothing here has been sent to Impact. No appeal, no reapplication, no brand
application. This is the material to have ready before contacting a PDM.

---

## 1. Impact publisher profile — what to add or update

Impact's documented requirements for a Marketplace-approvable profile:

| Field | Required | What to enter |
|---|---|---|
| Logo | yes | Uncluttrd app icon (already exists, `marketing/assets/icon.png`) |
| Description | yes | See positioning copy below |
| **Content / interest keywords** | yes | home organization · storage · closet organization · kitchen & pantry organization · home decor · wall art · lighting · shelving · furniture · cable management · drawer organizers · home improvement |
| Business model | yes | Mobile app / AI tool. **Not** coupon, cashback, loyalty, or deal site — a category Impact and its brands screen against |
| At least one contact | yes | hello@uncluttrd.app |
| **Media kit (PDF)** | yes | Does not exist yet. Outline in §3 |
| **≥1 verified media property** | yes | See §2 — this is the binding constraint |

Two notes worth remembering when filling this in:

- **Reach is not self-reported.** Impact derives "Reached audience" automatically
  from connected and verified media properties. Prose about audience size does
  nothing; connecting properties is the only lever.
- The business-model field matters more than it looks. Uncluttrd generates
  purchase intent from a recommendation the user asked for, which is the
  opposite of the incentivised-traffic model brands screen against. Say so
  explicitly.

## 2. Media properties to connect

| Property | Status | Priority |
|---|---|---|
| `uncluttrd.app` | live; Impact verification meta tag already installed | connect first |
| iOS app — `apps.apple.com/us/app/uncluttrd/id6781513811` | **live, HTTP 200** | connect |
| Android app — `play.google.com/store/apps/details?id=com.mharrison.uncluttrd` | **live, HTTP 200** | connect |
| Social account(s) | **none exist** | **the actual blocker** |

**The two live app-store listings are the single biggest change since the June
decline** — Uncluttrd was pre-launch then and is publicly shipping now.

**The gap is social.** Impact lists "social media accounts can't be verified or
don't meet quality standards" as a leading decline reason, and derives reach
from connected properties. One verified, genuinely active account does more for
approval than any amount of application copy.

## 3. Media kit — content outline

One PDF, 4–6 pages. Every number must be real; see §4.

1. **Cover** — product name, one-line positioning, app-store badges, URL.
2. **What Uncluttrd is** — photo in, organizing plan out. Two screenshots:
   a real plan, and an expanded approach card showing product recommendations.
   This is the page that shows a brand *where their product would appear*.
3. **How recommendations work** — the honest mechanic: the AI identifies a
   problem visible in the photo, recommends a *category*, explains why it helps
   that space, then routes to a retailer. Emphasise: category-level, evidence-
   grounded, never paid placement.
4. **Audience & traction** — downloads, GA4 sessions, in-app users, plans
   created, recommendation impressions and tap-through. Present honestly at
   current scale (see the caution in §4).
5. **Category demand** — the measured demand profile. This is the most
   persuasive page for a home retailer, because it is *measured*, not claimed:

   | Category | Share | | Category | Share |
   |---|---:|---|---|---:|
   | Furniture | 13.5% | | Trays | 6.9% |
   | Lighting | 12.8% | | Wall art / mirrors | 6.0% |
   | Shelving / risers | 12.0% | | Textiles | 4.1% |
   | Cable management | 10.1% | | Kitchen / pantry | 3.4% |
   | Drawer organizers | 9.4% | | Hooks / hardware | 2.7% |
   | Storage / bins / baskets | 8.4% | | Plants · Barware · Labels | 6.2% |
   | Decor objects / vases | 8.0% | | | |

   *Derived from 1,053 real product recommendations generated across production
   and staging.*
6. **Compliance & contact** — links to `/privacy`, `/terms`, `/disclosure`;
   Amazon Associates disclosure; contact address.

## 4. Evidence to collect before contacting a PDM

| Metric | Source | Have it? |
|---|---|---|
| App Store downloads since launch | App Store Connect | not collected |
| Google Play downloads since launch | Play Console | not collected |
| GA4 sessions / users / geography for `uncluttrd.app` | GA4 `G-HGQZTEWKMF` | live, not exported |
| In-app users and plans created | Firestore | **40 users, 76 plans** (measured) |
| `recommendation_shown` volume | Firebase Analytics | **event live in production** |
| `recommendation_tapped` volume + tap-through rate | Firebase Analytics | **event live in production** |
| `outbound_link_opened` volume | Firebase Analytics | **event live in production** |
| Amazon Associates click/earnings summary | Associates Central | not collected |
| Pro conversion rate | RevenueCat | available |

**The recommendation funnel is the strongest evidence we have**, and it is
stronger than raw traffic: `recommendation_shown → recommendation_tapped →
outbound_link_opened` demonstrates that Uncluttrd *generates purchase intent*,
which is precisely what a brand on Impact is buying. All three events shipped to
production on 2026-08-17, so the data begins accumulating now.

**Caution, stated plainly.** The user base is genuinely small — 40 production
users. Impact computes reach automatically from connected properties, so
overstating it would be both ineffective and damaging to the relationship. The
appeal should lead with **launch status and funnel quality**, not volume.

## 5. Positioning copy (draft — not sent)

> Uncluttrd is a live iOS and Android app that turns a photo of a room into a
> personalised organizing plan. Each plan identifies specific problems visible
> in that space and recommends product *categories* that would solve them —
> a drawer organizer for a cluttered desk, cable management for a visible tangle
> of cords — with a written explanation of why that product helps that room.
>
> We are not a coupon, cashback, or deal site. Purchase intent is created by the
> recommendation itself, at the moment a user receives a plan they trust. We
> monetise today through Amazon Associates and are seeking retail partners whose
> catalogues match our measured demand: furniture, lighting, shelving, storage
> and organization, decor, and wall art.
>
> Our affiliate relationships are disclosed publicly at
> uncluttrd.app/disclosure. We do not accept payment for placement or ranking
> inside a plan.

## 6. Sequence — not yet actioned

1. Deploy `/disclosure` and the site-wide footer (blocked on Netlify access —
   see `README.md`).
2. Create and verify at least one social property.
3. Complete the Impact profile; produce the media kit.
4. Export 30–60 days of store and GA4 data.
5. *Then* contact support to identify our PDM and request reconsideration —
   citing that the June decline was "insufficient traffic as a new publisher"
   and that Uncluttrd has since launched publicly on both platforms.

Impact documents **no mandatory waiting period**, and its guidance for a
limited-reach decline is to *"continue building your online presence and reapply
once your reach has grown."* An appeal via a named PDM is a different and better
route than resubmitting into the automated screen.
