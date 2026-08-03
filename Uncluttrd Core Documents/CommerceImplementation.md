# Uncluttrd Commerce — Implementation

Last updated: June 2026
Status: Living document. Engineering specification for the Commerce domain.

This document answers: **how is Commerce built?**

For the strategic blueprint (why Commerce exists, business model, guiding principles), see Commerce.md.

---

## Module File Structure

```
src/
  modules/
    commerce/
      CommerceService.js       — public API, orchestrates all other files
      RetailRegistry.js        — knows about retailers and their programs
      ProductCatalog.js        — knows about products and categories
      ProductResolver.js       — matches AI needs to real products
      AffiliateResolver.js     — picks the right link for a product/retailer
      RecommendationEngine.js  — scores and ranks options
      Analytics.js             — tracks clicks, conversions, revenue
```

Nothing outside the commerce module imports from individual files. Everything goes through `CommerceService.js`. This is the public API.

```javascript
import CommerceService from '../modules/commerce/CommerceService';

const products = await CommerceService.getProducts({
  needs: ['shelving', 'storage bins', 'labels'],
  spaceType: 'garage',
  tier: 'budget',
  userId: uid
});
```

---

## Data Flow Architecture

```
AI
  ↓
Needs (what the space requires)
  ↓
Commerce Engine
  ↓
Product Database (what exists)
  ↓
Retail Registry (who sells it)
  ↓
Affiliate Resolver (which link to use)
  ↓
UI (what the user sees)
```

Each layer has one job. None of them know about each other's internals. The AI knows nothing about retailers. The Retail Registry knows nothing about AI. The Affiliate Resolver knows nothing about products.

---

## CommerceService.js — Public API

```javascript
const CommerceService = {

  // Primary entry point. AI calls this with what the space needs.
  async getProducts({ needs, spaceType, tier, userId }) {
    // 1. Resolve each need to real products
    // 2. Score and rank by RecommendationEngine
    // 3. Resolve affiliate links for top results
    // 4. Record impression event in Analytics
    // Returns array of scored products with affiliate links
  },

  async getProduct({ productId, userId }) {},

  async buildProjectCart({ productIds, userId }) {},

  async trackClick({ productId, retailer, userId, planId }) {},

  async trackConversion({ orderId, retailer, amount, commission }) {},

};

export default CommerceService;
```

---

## RetailRegistry.js — Retailer Data

```javascript
// Firestore collection: retailers/{retailerId}
const retailerSchema = {
  id: string,                    // "walmart", "homedepot", "amazon"
  name: string,                  // "Walmart"
  affiliateNetwork: string,      // "impact", "cj", "amazon-associates", "flexoffers", "direct"
  affiliateId: string,           // your publisher ID on that network
  commissionRate: number,        // 0.04 = 4%
  cookieDuration: number,        // days
  deepLinkTemplate: string,      // URL template with {productId} and {affiliateId} placeholders
  searchLinkTemplate: string,    // URL template with {query} and {affiliateId} placeholders
  productFeedUrl: string | null, // nightly product feed URL if available
  logo: string,                  // Storage URL
  priority: number,              // lower = higher priority in scoring
  status: string,                // "active" | "pending" | "inactive"
  categories: string[],          // which product categories this retailer covers well
  createdAt: timestamp,
  schemaVersion: 1
};

const RetailRegistry = {
  async getAll() {},
  async getActive() {},
  async getByCategory(category) {},
  async buildAffiliateLink(retailerId, productId) {},
  async buildSearchLink(retailerId, query) {},
};

export default RetailRegistry;
```

Retailer priority is data in Firestore, never hardcoded. See AffiliatePipeline.md for current retailer status and network assignments.

---

## ProductCatalog.js — Product Data

```javascript
// Firestore collection: commerce/catalog/{productId}
const productSchema = {
  id: string,
  name: string,                  // "Sterilite 3-Drawer Rolling Cart"
  genericName: string,           // "3-Drawer Rolling Cart" (what AI says)
  description: string,
  category: string,              // "storage" | "shelving" | "organization" | "cleaning" etc
  subcategory: string,           // "rolling-carts" | "wire-shelving" etc
  rooms: string[],               // ["garage", "kitchen", "bedroom"] - which spaces this fits
  tiers: string[],               // ["budget", "mid-range"] - which budget tiers this fits
  brand: string,                 // "Sterilite"
  imageUrl: string,
  tags: string[],                // ["plastic", "wheels", "stackable", "white"]
  searchTerms: string[],         // lowercased, for matching AI descriptions
  retailerListings: [{
    retailerId: string,          // "walmart"
    retailerProductId: string,   // Walmart item ID
    price: number,
    inStock: boolean,
    lastUpdated: timestamp,
  }],
  clickCount: number,            // learning engine input
  conversionCount: number,       // learning engine input
  conversionRate: number,        // computed
  schemaVersion: 1
};

const ProductCatalog = {
  async search(query, filters) {},          // text search
  async getByCategory(category, filters) {},
  async getByRoom(room, tier) {},
  async getById(productId) {},
  async updateRetailerListing(productId, retailerId, data) {},
};

export default ProductCatalog;
```

---

## ProductResolver.js — Matching Needs to Products

```javascript
// Takes what the AI says is needed and finds real products.
// This is the product matching layer described in Commerce.md.

const ProductResolver = {

  async resolve(need, context) {
    // need: "3-Drawer Rolling Cart"
    // context: { spaceType: "garage", tier: "budget", userId }

    // V1: Search ProductCatalog by text match on searchTerms
    // V2: Fuzzy match + category inference
    // V3: AI-assisted matching (Claude picks from real catalog)

    return products; // array of ProductCatalog entries
  },

  async resolveAll(needs, context) {
    return Promise.all(needs.map(need => this.resolve(need, context)));
  },

};

export default ProductResolver;
```

---

## AffiliateResolver.js — Picking the Right Link

```javascript
// Takes a product and returns ranked affiliate links.
// Does not know about scoring - that is RecommendationEngine's job.

const AffiliateResolver = {

  async getLinks(product) {
    return [
      { retailer: "walmart", price: 54.00, url: "https://walmart.com/...?affid=..." },
      { retailer: "amazon",  price: 57.00, url: "https://amazon.com/...?tag=uncluttrd20-20" },
    ];
  },

  async getBestLink(product, context) {
    const links = await this.getLinks(product);
    return RecommendationEngine.pickBest(links, context);
  },

};

export default AffiliateResolver;
```

---

## RecommendationEngine.js — Scoring and Ranking

```javascript
const RecommendationEngine = {

  score(product, retailerListing, context) {
    return (
      this.availabilityScore(retailerListing) * weights.availability +
      this.priceScore(retailerListing.price, context.tier) * weights.price +
      this.ratingScore(product) * weights.rating +
      this.commissionScore(retailerListing.retailerId) * weights.commission +
      this.priorityScore(retailerListing.retailerId) * weights.priority +
      this.historicalScore(product, retailerListing.retailerId) * weights.historical
    );
  },

  pickBest(links, context) {
    return links
      .map(link => ({ ...link, score: this.score(link.product, link, context) }))
      .sort((a, b) => b.score - a.score)[0];
  },

  // Default weights - stored in commerce/config/weights, not hardcoded
  weights: {
    availability: 0.30,
    price: 0.25,
    rating: 0.15,
    commission: 0.15,
    priority: 0.10,
    historical: 0.05,   // grows as data accumulates
  },

};

export default RecommendationEngine;
```

**Weight levels (see Commerce.md for the personalization philosophy):**

```
Global weights   — default for all users, the table above
User weights      — overrides for a specific user based on their purchase history
Session weights   — short-term adjustments for the current session
```

Global weights ship at launch. User and session weights are a post-learning-engine milestone, not a launch requirement.

---

## Analytics.js — The Learning Foundation

**Analytics is Phase 2 of the build sequence, not an afterthought.**

Every click before Analytics is instrumented is data lost forever. Instrument first, analyze later.

```javascript
// Firestore collection: users/{uid}/commerceEvents/{eventId}
const eventSchema = {
  id: string,
  userId: string,
  planId: string,
  spaceType: string,
  tier: string,
  need: string,                  // "3-Drawer Rolling Cart" (what AI said)
  productId: string,             // matched product in catalog
  productName: string,
  retailer: string,
  price: number,
  position: number,              // rank shown to user (1 = first option)
  eventType: string,             // "impression" | "click" | "purchase"
  commissionEarned: number,      // 0 until purchase confirmed
  sessionId: string,
  clickedAt: timestamp,
  convertedAt: timestamp | null,
  schemaVersion: 1
};

const Analytics = {
  async recordImpression(data) {},
  async recordClick(data) {},
  async recordConversion(data) {},

  async getClickRateByRetailer(productCategory) {},
  async getConversionRateByRetailer(productCategory) {},
  async getRevenueByRoom(dateRange) {},
  async getRevenueByRetailer(dateRange) {},
};

export default Analytics;
```

---

## commerce/config — Runtime Configuration

A dedicated Firestore collection so the engine is configurable without a code release.

```javascript
// Firestore collection: commerce/config/{configId}
{
  weights: { ... },              // RecommendationEngine default weights
  retailerPriority: { ... },     // override priority without touching RetailRegistry docs
  featureFlags: {
    aiInformedMatching: false,   // V3 product matching, off until ready
    projectCart: false,          // "Buy Everything" flow, off until built
    personalizedWeights: false,  // user-level weight overrides, off until learning engine matures
  },
  apiKeys: { ... },               // references to Secret Manager, not raw keys
  experiments: { ... },           // active A/B tests on recommendation logic
  commissionOverrides: { ... },   // manual overrides for specific retailer deals
}
```

This collection is what makes "everything is data" real in practice. Toggling a feature, adjusting a weight, or overriding a commission rate happens in Firestore, not in a pull request.

---

## Firestore Schema Summary

| Collection | Purpose |
|---|---|
| `retailers/{retailerId}` | RetailRegistry data |
| `commerce/catalog/{productId}` | ProductCatalog data |
| `users/{uid}/commerceEvents/{eventId}` | Analytics events |
| `commerce/config/{configId}` | Runtime configuration, weights, flags |

---

## What Not To Build

Never write:

```javascript
if (spaceType === 'garage') {
  showWalmartLink();
}
```

Everything is data. Space type, retailer priority, product categories, commission rates, recommendation weights. All of it lives in Firestore. All of it changes without a code release. The code is the engine. Firestore is the fuel.

---

## Build Phases

**Phase 1: Replace Google Search links**
Amazon affiliate search link replaces Google Search. One function, one code change. Starts earning commissions immediately.

```javascript
// Before
Linking.openURL(`https://google.com/search?q=${productName}`);

// After
const { url } = await CommerceService.getProducts({ needs: [productName], ... });
Linking.openURL(url);
```

**Phase 2: Analytics instrumentation (same time as Phase 1)**
Record every click from day one. Three lines of Firestore code. Non-negotiable.

**Phase 3: RetailRegistry in Firestore**
Move retailer data from hardcoded constants to Firestore. Change retailer priority, commission rates, and status without a code release.

**Phase 4: ProductCatalog (first real data work)**
Populate real products matched to what the AI commonly recommends. Start with the 20-30 most common organization products across all space types.

**Phase 5: ProductResolver (matching layer)**
Connect AI output to ProductCatalog. AI says "rolling cart," Commerce finds the Sterilite 3-Drawer at Walmart for $54.

**Phase 6: AffiliateResolver + RecommendationEngine**
Multi-retailer comparison. Score products. Show best option first. Show alternatives.

**Phase 7: Product Feeds**
Nightly sync from retailer APIs/feeds into Firestore. Prices, availability, and new products update automatically.

**Phase 8: Learning Engine**
Historical click and conversion data feeds back into RecommendationEngine weights. Recommendations improve automatically over time. Personalized (user-level) weights become viable once volume supports them.

---

*CommerceImplementation.md is the engineering specification. See Commerce.md for the strategic blueprint, business model, and guiding principles.*
