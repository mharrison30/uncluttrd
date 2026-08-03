# Uncluttrd Commerce

Last updated: June 2026
Status: Living document. This is the strategic blueprint for the Commerce domain.

This document answers: **what is Commerce, and why does it exist?**

For how it is built, see CommerceImplementation.md. For platform philosophy, see Vision.md. For other module implementation, see Architecture.md.

---

## The Thesis

**The recommendation engine is the product. Affiliate links are the monetization layer.**

Everything else in this document follows from that sentence.

Commerce is not an affiliate program bolted onto Uncluttrd. It is a platform domain, on equal footing with Organize, Find, and Memories, that turns AI recommendations into trusted, monetized purchase opportunities while helping users find the best products at the best value.

---

## Mission

Transform AI recommendations into trusted, monetized purchase opportunities while helping users find the best products at the best value.

Every word is intentional:

- **Transform** — not just link to, but actively convert
- **Trusted** — the user must feel helped, not sold to
- **Monetized** — this is a revenue domain, not a convenience feature
- **Best products** — quality of recommendation matters as much as commission rate
- **Best value** — price comparison is a feature, not an afterthought

---

## The Core Insight

Uncluttrd's AI recommends a product by name. Until Jul 2026, the app opened a Google search for it — it now opens a tagged Amazon search instead.

That gives away the most valuable moment in e-commerce: purchase intent immediately following a trusted recommendation. A user who just received an AI-generated organization plan is not browsing. They are ready to buy. Amazon now captures a portion of that intent via the tagged link. The deeper opportunity remains: full ownership of the purchase experience — in-app product cards, real SKU and price data, no dependency on a retailer's own search results page.

The Commerce Layer is how we take it back.

---

## Ownership

Every platform module needs a clear boundary. Commerce's boundary is this:

**Commerce owns:**
- Products and the product catalog
- Retailers and their affiliate relationships
- Recommendation scoring and ranking
- Click tracking and purchase tracking
- Pricing and price comparison
- Commerce-specific analytics

**Commerce does not own:**
- AI analysis (Organize's job)
- Organization plan generation (Organize's job)
- UI presentation of results (each module's own job)
- Subscriptions and billing (RevenueCat integration, separate from Commerce)
- User authentication (Firebase Auth, separate from Commerce)

This boundary matters because Commerce is designed to be reused across every future module. Find will surface replacement items through Commerce. Memories may surface archival supplies through Commerce. A future Move or Sell module would use Commerce as its transaction layer. Commerce stays useful across all of them only if it never absorbs responsibilities that belong to another module.

---

## The Four Pillars of Commerce

### 1. Fulfillment
*Replace Google search with tracked, monetized retailer links.*

**Phase 1 shipped (Jul 2026):** the minimum viable version — product taps redirect to a tagged Amazon Associates search link, tracked via the `product_clicked` analytics event (see Analytics.md). Simple, immediate, revenue-generating.

The full pillar remains open: real retailers beyond a single Amazon search page, true SKU-level links, multi-program routing.

### 2. Intelligence
*Match AI descriptions to real products with pricing and availability.*

The AI invents product names. Commerce translates them into real SKUs at real retailers with real prices. The user sees "Sterilite 3-Drawer Cart at Walmart, $54" instead of "a 3-drawer rolling cart."

### 3. Learning
*Use purchase behavior to improve future recommendations.*

Every click and purchase teaches the system. If users click Walmart's rolling cart 18% of the time and Target's 6% of the time, Walmart ranks higher next time. Over thousands of purchases, recommendations become meaningfully better. This is the compounding advantage.

### 4. Partnerships
*Direct brand relationships beyond standard affiliate commissions.*

Once Uncluttrd has meaningful traffic, the pitch to brands becomes: "Our AI just recommended a storage cart to 50,000 people actively organizing their homes. Here's how to make sure it's yours." That's a media buy, not an affiliate click. Higher margins, direct relationships, differentiated revenue.

---

## The Product Matching Opportunity

Today the AI outputs a generic description: "3-Drawer Rolling Cart." Affiliate programs need a real product: a specific SKU at a specific retailer.

The long-term direction inverts the current model. Instead of AI inventing a generic product that Commerce then searches for, Commerce eventually knows the catalog of real products, and Claude chooses among actual SKUs. The AI asks Commerce what's available; Commerce answers with real options; the AI recommends the best fit.

This improves recommendation quality, affiliate conversion, and user trust simultaneously, because the user sees a specific, purchasable product instead of an invented description.

**Sequence:** simple search-based matching now, catalog-based matching once volume justifies it, AI-informed catalog as the long-term target. Full technical detail in CommerceImplementation.md.

---

## The Learning Engine

This is the compounding advantage that competitors cannot replicate without the same dataset.

Every click and purchase is a data point: which retailer, which product, which price, at what position in the list, and whether it converted. Over time, this data answers questions no static algorithm can: which retailers users actually prefer per category, which price points convert at each budget tier, which recommendations get clicked but not bought.

After 100,000 purchases, Uncluttrd's recommendations are meaningfully better than a competitor starting fresh. The data advantage compounds. This is the moat.

**The personalization direction:** learning operates at three levels over time. Global weights (what works for all users), user weights (what works for this specific person, e.g. someone who always buys from Home Depot), and session weights (what's relevant right now). Global weights come first. Personal and session weights are a maturity milestone, not a launch requirement.

---

## The Project Experience

Individual product links are one affiliate click. Projects are a multiplier.

When AI recommends six products for a garage organization plan, those are not six independent clicks. They are one project: a Garage Refresh, with an estimated total and a single "Add All to Cart" action that builds tracked links to each item across retailers.

This is not technically one cart, since that requires deep retailer integration Commerce does not have. It is a guided purchase flow that makes buying everything feel like one action. The distinction matters less to users than the convenience does.

---

## Retail Registry Philosophy

Retailers are data, not fixed tiers. Everything about a retailer, its priority, its commission rate, its category fit, lives in a registry that grows over time rather than a hardcoded tier list.

**Launch registry:** the retailers ready at launch, covering the majority of home organization recommendations. Walmart, Home Depot, Amazon, and whichever affiliate approvals are complete by launch.

**Expansion registry:** retailers added as approvals complete and as the platform grows. IKEA, Costco, specialty organization brands, lifestyle retailers.

There is no permanent tier structure. A retailer's priority is a score, computed from availability, price competitiveness, commission, and historical conversion, not a fixed assignment. See CommerceImplementation.md for the registry schema and scoring model.

---

## Retailer Strategy

Affiliate program status, network assignments, and the operational pipeline for onboarding retailers now live in a dedicated pipeline document, since this has become an operational track with its own cadence separate from architecture.

**See AffiliatePipeline.md for:**
- Current network status (CJ Affiliate, Impact, Amazon Associates, Awin, FlexOffers)
- Retailer approval status
- Commission rates and cookie durations
- Which retailers are blocked and the plan to reapply

**Standing policy:** Amazon is a fallback, not the face of Uncluttrd. It appears when other retailers don't carry a recommended product, never as the first option shown.

---

## Brand Partnerships (Future Revenue Stream)

Once Uncluttrd has meaningful traffic (target: 10,000+ monthly active users), direct brand partnerships become viable, moving beyond standard affiliate commissions into media-style relationships.

**Partnership formats:**
- **Preferred placement** — brand pays for first position in their category, clearly disclosed
- **Featured collections** — a curated product set within a tier, e.g. "Sterilite Garage Solution"
- **Co-marketing** — brand promotes Uncluttrd in exchange for preferred placement
- **Sponsored recommendations** — clearly labeled sponsored results within a plan

These require a meaningful user base, verified click and conversion data to support pricing, clear disclosure to users for FTC compliance, and direct sales relationships. This is a sales motion, drawing on Michael's channel sales and partnerships background, not a technology motion.

---

## Commerce and the Platform Modules

Commerce is not isolated to Organize. It is reusable infrastructure that makes every module more valuable.

| Module | Commerce connection |
|---|---|
| Organize | AI recommends products → Commerce fulfills |
| Find | User locates a worn-out item → Commerce suggests a replacement |
| Memories | User catalogs keepsakes → Commerce suggests archival supplies |
| Move (future) | User is moving → Commerce surfaces boxes, tape, storage rentals |
| Sell (future) | Commerce is the transaction layer itself |

This is why Commerce is a platform domain, not a module feature.

---

## Guiding Principles

**1. Help first, monetize second.**
Every Commerce decision should make the recommendation more useful, not less. A user who feels helped will buy. A user who feels sold to will leave.

**2. Never show only one option.**
Price comparison across retailers builds trust. It signals that Uncluttrd is finding the best value, not steering to the highest commission.

**3. The learning loop is the moat.**
Every click and purchase is a data point. Protect and invest in the data infrastructure that makes recommendations improve over time.

**4. Commission follows quality.**
Don't optimize for commission rate at the expense of recommendation quality. Short-term commission gains from steering to higher-paying but inferior retailers erode the trust that makes Commerce work long-term.

**5. Disclose brand partnerships.**
Any sponsored or preferred placement must be labeled. FTC compliance is not optional, and transparency builds the trust that makes Commerce work long-term.

**6. Amazon is a fallback, not a strategy.**
Amazon can cover gaps. It should not define Uncluttrd's commerce identity.

**7. Retailers are data, not tiers.**
The registry grows. Nothing about retailer priority is hardcoded.

---

## The Launch Sequence

**Now, in parallel with everything else:** affiliate network and retailer applications (see AffiliatePipeline.md). Approvals take weeks; there is no reason to wait.

**Done (Jul 2026):** the simplest possible Commerce Service — see Pillar 1 (Fulfillment) above. This alone converts a cost center into a revenue line.

**After V1 is proven:** product matching, retailer ranking, price comparison. Only after there is real click data to build on.

**12+ months:** the learning engine matures, personalized weights, and direct brand partnerships become viable at scale.

---

## The Warning

Do not let Commerce delay the launch of the core product.

The value proposition of Uncluttrd is: take a photo, get an organization plan. Commerce enhances that experience. It does not define it.

The temptation with good architecture is to build for every future possibility. The discipline is to build a foundation that can evolve. Uncluttrd launched with Google Search links, then replaced them with a tagged Amazon link in the first update (see Pillar 1). Add intelligence in the second.

---

*Commerce.md is the strategic blueprint. See CommerceImplementation.md for the engineering specification: module structure, Firestore schemas, service APIs, and build phases.*
