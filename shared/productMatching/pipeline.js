// ===========================================================================
// PIPELINE   (the three-layer separation, executed)
// ===========================================================================
//
//   RECOMMENDATION  ->  PRODUCT INTENT  ->  COMMERCE CANDIDATE
//   (stable, on the    (derived, never     (ephemeral, stored
//    plan document)     stored)             separately, matchedAt)
//
// ProductMatchingDesign.md Section 0. The separation is enforced structurally
// here, not by convention: matchRecommendation() NEVER mutates the
// recommendation it is given, and the commerce candidate it returns holds a
// POINTER back to the recommendation rather than a copy of it. Storing a
// commerce candidate inside a plan document would weld a weeks-lived object
// to a permanent one, and every price refresh would become a write against
// the user's analysis.
//
// THE CONFIDENCE GATE is the load-bearing piece (Section 7 item 4, decision
// #4). A specific product appears ONLY when there is enough evidence.
// Otherwise the existing "Find options ->" Amazon fallback serves the user
// unchanged. A wrong matched product is worse than a search link, because it
// looks authoritative.
// ===========================================================================

const { rewriteRecommendation } = require("./queryRewriter");
const { retrieveForIntents } = require("./retrieval");
const { rankCandidates } = require("./ranking");

// Gate thresholds. Two independent floors, deliberately.
//
// MIN_SCORE alone is not sufficient: a product can clear it on price fit,
// availability and style vocabulary while barely matching what was asked for.
// That is the same failure mode as letting commission rescue a mediocre
// product, wearing different clothes. MIN_RELEVANCE closes it.
const MIN_SCORE = 0.55;
const MIN_RELEVANCE = 0.50;

// Head nouns that name no purchasable category. Section 1d measured 7/54
// (13%) of the corpus as genuinely underspecified, with the signature that
// the head is "objects" or "styling". These go to fallback by design, not by
// failure - decision #5 makes them a roadmap item for structured productNeed,
// explicitly NOT something to paper over with an LLM in v1.
const ABSTRACT_HEADS = new Set([
  "object", "piece", "styling", "decor", "accent", "item", "thing", "element",
]);

function isUnderspecified(intent) {
  const t = intent.tokens;
  if (!t.length) return true;
  const head = t[t.length - 1];
  if (!ABSTRACT_HEADS.has(head)) return false;
  // An abstract head is only fatal if nothing else in the phrase names a
  // concrete category: "sculptural vase object" is still findable.
  return !t.slice(0, -1).some((x) => !ABSTRACT_HEADS.has(x) && x.length > 3 &&
    !["decorative", "small", "large", "modern", "sculptural"].includes(x));
}

/**
 * Runs the full three-layer pipeline for one recommendation.
 *
 * @param {Object} rec       the stored recommendation (NEVER mutated)
 * @param {Object} source    any CatalogSource
 * @param {Object} ctx       { planId, now } - `now` injected for determinism
 * @returns {Object} result
 */
function matchRecommendation(rec, source, ctx = {}) {
  const now = ctx.now || "1970-01-01T00:00:00Z";

  // ---- LAYER 2: product intent ------------------------------------------
  const { intents, diagnostics } = rewriteRecommendation(rec);

  const gateNotes = [];
  const serviceOnly = intents.length > 0 && intents.every((i) => i.isService);
  const underspecifiedFlags = intents.map(isUnderspecified);
  const allUnderspecified = intents.length > 0 && underspecifiedFlags.every(Boolean);

  if (!intents.length) gateNotes.push("no intents produced");
  if (serviceOnly) gateNotes.push("service, not a product");
  if (allUnderspecified) gateNotes.push("underspecified (13% class)");

  if (!intents.length || serviceOnly || allUnderspecified) {
    return fallback(rec, intents, diagnostics, gateNotes, null);
  }

  // Only pursue intents that are actually matchable.
  const matchable = intents.filter((i, idx) => !underspecifiedFlags[idx] && !i.isService);

  // ---- LAYER 3 (a): retrieval -------------------------------------------
  const { candidates, perIntent } = retrieveForIntents(source, matchable);
  if (!candidates.length) {
    gateNotes.push("no candidates retrieved");
    return fallback(rec, intents, diagnostics, gateNotes, { perIntent });
  }

  // ---- LAYER 3 (b): ranking ---------------------------------------------
  // Ranked against the FIRST matchable intent's tokens, which is the primary
  // reading of a disjunction. Alternatives still contributed candidates via
  // retrieval; this decides which single product is shown.
  const ranked = rankCandidates(candidates, matchable[0]);
  if (!ranked.length) {
    gateNotes.push("all candidates filtered (no price / out of stock)");
    return fallback(rec, intents, diagnostics, gateNotes, { perIntent });
  }

  const top = ranked[0];

  // ---- CONFIDENCE GATE ---------------------------------------------------
  if (top.score < MIN_SCORE) gateNotes.push(`score ${top.score.toFixed(3)} < ${MIN_SCORE}`);
  if (top.components.relevance < MIN_RELEVANCE) {
    gateNotes.push(`relevance ${top.components.relevance.toFixed(3)} < ${MIN_RELEVANCE}`);
  }
  if (gateNotes.length) {
    return fallback(rec, intents, diagnostics, gateNotes, { perIntent, ranked });
  }

  // ---- COMMERCE CANDIDATE ------------------------------------------------
  // Note what is NOT here: any copy of `reason`, `grounding`, `shortReason`
  // or the plan text. This object is replaceable without touching the
  // recommendation, which is the entire point of Section 0.
  const p = top.product;
  const commerceCandidate = {
    recommendationRef: {
      planId: ctx.planId || null,
      approachId: rec.approachId || null,
      productType: rec.productType || null,
    },
    productId: p.id,
    name: p.name,
    price: p.price,
    currency: p.currency,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    affiliateUrl: p.sourceMetadata.affiliateUrl,
    availability: p.availability,
    source: p.sourceMetadata.source,
    matchedAt: now,
    score: Number(top.score.toFixed(4)),
    components: top.components,
    intentQuery: matchable[0].query,
  };

  return {
    decision: "matched",
    recommendation: rec,
    intents,
    diagnostics,
    commerceCandidate,
    ranked,
    perIntent,
    gateNotes: [],
  };
}

function fallback(rec, intents, diagnostics, gateNotes, extra) {
  return {
    decision: "fallback",
    recommendation: rec,
    intents,
    diagnostics,
    commerceCandidate: null,
    ranked: (extra && extra.ranked) || [],
    perIntent: (extra && extra.perIntent) || [],
    gateNotes,
  };
}

/**
 * Decides whether a stored commerce candidate needs a REFRESH or a REMATCH.
 *
 * Decision #3, and the distinction is load-bearing. A refresh updates price,
 * availability and link. A rematch changes WHICH product is shown.
 *
 * DO NOT REMATCH MERELY BECAUSE A PRICE CHANGED. Rematching on price churn
 * would let the cheapest-at-this-instant product win on refresh cadence
 * rather than on fit, quietly converting the Section 3c price percentile
 * from a ranking signal into a selection one.
 */
function planRefresh(candidate, source, opts = {}) {
  if (!candidate) return { action: "match", reason: "no stored candidate" };

  const live = source.getProduct(candidate.productId);
  if (!live) return { action: "rematch", reason: "product disappeared from catalog" };
  if (live.availability === "out_of_stock") {
    return { action: "rematch", reason: "product unavailable" };
  }
  if (opts.recommendationChanged) {
    return { action: "rematch", reason: "underlying recommendation changed" };
  }

  const priceChanged = live.price !== candidate.price;
  const staleDays = opts.staleDays == null ? 7 : opts.staleDays;
  const ageDays = opts.ageDays == null ? 0 : opts.ageDays;

  if (ageDays >= staleDays || priceChanged) {
    return {
      action: "refresh",
      reason: priceChanged ? "price changed" : `older than ${staleDays}d`,
      updates: {
        price: live.price,
        availability: live.availability,
        affiliateUrl: live.sourceMetadata.affiliateUrl,
      },
    };
  }
  return { action: "none", reason: "fresh" };
}

module.exports = {
  matchRecommendation,
  planRefresh,
  isUnderspecified,
  MIN_SCORE,
  MIN_RELEVANCE,
  ABSTRACT_HEADS,
};
