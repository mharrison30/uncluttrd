// ===========================================================================
// RANKING
// ===========================================================================
//
// Implements the scoring formula from ProductMatchingDesign.md Section 3:
//
//   score(x) = 0.55 * relevance
//            + 0.20 * price_fit
//            + 0.15 * availability
//            + 0.10 * context_fit
//
//   tiebreak within epsilon = 0.02: commission desc      (decision #2)
//   hard filters: no price -> drop; explicitly out of stock -> drop
//
// Two invariants this file must preserve, because other things depend on them:
//
//   1. EVERY TERM IS BOUNDED [0,1] AND THE WEIGHTS SUM TO 1.00. Decision #2's
//      epsilon of 0.02 is meaningful only because the score is normalized -
//      it is 2% of full scale, not an arbitrary float. Reweighting without
//      preserving sum-to-1 silently changes what a "tie" means.
//
//   2. COMMISSION IS A TIEBREAKER, NEVER A WEIGHT. It appears nowhere in
//      score(). It may only reorder products already within epsilon of each
//      other. Commission must never rescue a mediocre product.
// ===========================================================================

const WEIGHTS = { relevance: 0.55, price: 0.20, availability: 0.15, context: 0.10 };
const EPSILON = 0.02;

// Below this many priced candidates, percentile rank is noise rather than
// signal - a 2-element distribution has no meaningful 25th percentile. Drop
// the price term and renormalize the remaining weights instead of ranking on
// a distribution that does not exist.
const MIN_CANDIDATES_FOR_PRICE = 5;

// Target percentile WITHIN THE CANDIDATE SET, never an absolute dollar band.
// This is the point of Section 3c: the range emerges from what the category
// actually costs. SCOPE_SPEND_TABLE was retired for imposing bands from
// outside, and re-adding them as hidden constants would reintroduce it.
const APPROACH_TARGET_PERCENTILE = { simple: 0.25, polished: 0.50, elevated: 0.75 };

// Style/quality vocabulary, reused from App.js's APPROACH_QUERY_INTENT so the
// ranker and the Amazon fallback express the same notion of ambition.
const APPROACH_STYLE_WORDS = {
  simple: ["simple", "practical", "basic", "essential", "everyday", "classic"],
  polished: ["modern", "coordinated", "matching", "contemporary", "brushed", "matte"],
  elevated: ["premium", "designer", "luxury", "solid", "marble", "brass", "crystal",
             "handmade", "artisan", "hand-blown", "limited"],
};

// ---------------------------------------------------------------------------
// PRICE OUTLIER FENCE
// ---------------------------------------------------------------------------
// Percentile pricing (Section 3c) has no notion of "out of distribution", and
// evaluation against the real corpus found the resulting hole:
//
//   intent "decorative sculpture", approach elevated, 16 candidates
//   prices $19.99 ... $189, then $2400 - a limited-edition art piece, 41x median
//
//   The elevated target of the 75th percentile landed ON the outlier, giving
//   it a high price_fit. It then scored 0.771 against 0.782 for a $134
//   sculpture - inside epsilon - so the COMMISSION TIEBREAK promoted it,
//   because the outlier carried a 10% rate against the default 5%.
//
// That is precisely the outcome decision #2 was written to forbid: commission
// rescuing a product that should not have been near the top. The tiebreak
// obeyed its own rule; the fault was upstream, in letting an out-of-
// distribution price define what "elevated" means.
//
// The fix is faithful to "the range should emerge from the products": a
// listing at 41x the median is not the premium end of this category, it is a
// different market that shares a keyword. Extreme outliers are excluded from
// the percentile BASIS and scored price_fit = 0, so they never land near the
// top and the tiebreak is never consulted on them.
//
// The fence is deliberately loose - Q3 + 3*IQR, not the usual 1.5 - so it
// only ever catches the genuinely absurd. A merely expensive product must
// still be reachable, or Elevated stops working.
const OUTLIER_IQR_MULTIPLIER = 3;

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function priceOutlierFence(sortedAsc) {
  if (sortedAsc.length < 4) return Infinity;
  const q1 = quantile(sortedAsc, 0.25);
  const q3 = quantile(sortedAsc, 0.75);
  const iqr = q3 - q1;
  if (!(iqr > 0)) return Infinity;
  return q3 + OUTLIER_IQR_MULTIPLIER * iqr;
}

function percentileRank(value, sortedAsc) {
  if (!sortedAsc.length) return 0.5;
  if (sortedAsc.length === 1) return 0.5;
  let below = 0;
  for (const v of sortedAsc) { if (v < value) below++; else break; }
  return below / (sortedAsc.length - 1);
}

/**
 * Lexical relevance of a product to an intent's tokens, in [0,1].
 *
 * HEAD-NOUN WEIGHTED, and that is not a tuning knob - it comes straight out of
 * the corpus analysis. ProductMatchingDesign.md Section 1b measured 40 distinct
 * head nouns across 54 phrases and identified the head noun as the CATEGORY
 * ANCHOR. A product whose title or category contains the head noun is in the
 * right category; the leading tokens are refinements on it.
 *
 * Flat coverage - the first implementation here - treats every token as equally
 * important, and that measurably rejected correct products:
 *
 *   "lazy susan turntable" vs "11-Inch Rotating Turntable Organizer"
 *      flat coverage = 1/3 = 0.300  ->  below the 0.5 gate  ->  FALLBACK
 *
 * The head noun "turntable" matched perfectly. "lazy" and "susan" are
 * colloquialisms that appear in no retailer listing anywhere, so penalising
 * their absence punishes the corpus for how people talk. Found by evaluating
 * against the real 54, not predicted.
 *
 * Field weighting (title > category > description) mirrors how retailer search
 * engines actually behave.
 */
function relevanceScore(product, tokens) {
  if (!tokens || !tokens.length) return 0;
  const name = product.name.toLowerCase();
  const cat = String(product.category || "").toLowerCase().replace(/-/g, " ");
  const desc = String(product.description || "").toLowerCase();

  let hits = 0;
  let weighted = 0;
  const maxPerToken = 3 + 2 + 1;
  for (const t of tokens) {
    const inName = name.includes(t);
    const inCat = cat.includes(t);
    const inDesc = desc.includes(t);
    if (inName || inCat || inDesc) hits++;
    weighted += (inName ? 3 : 0) + (inCat ? 2 : 0) + (inDesc ? 1 : 0);
  }
  const coverage = hits / tokens.length;
  const density = weighted / (tokens.length * maxPerToken);

  // The head noun is the last token - the rewriter preserves phrase order.
  const head = tokens[tokens.length - 1];
  const headScore = (name.includes(head) || cat.includes(head)) ? 1
    : (desc.includes(head) ? 0.6 : 0);

  return Math.min(1, 0.45 * headScore + 0.35 * coverage + 0.20 * density);
}

function availabilityScore(product) {
  if (product.availability === "in_stock") return 1;
  if (product.availability === "out_of_stock") return 0;
  return 0.5; // unknown - must not be treated as "out", or sources with
              // sparse stock data lose every candidate (Section 3).
}

/**
 * Style/ambition fit, in [0,1]. Weighted low (0.10) deliberately: most feeds
 * carry no style metadata at all - the Awin POC found the relevant fields 0%
 * populated - so this is a proxy built from title vocabulary, not a real
 * signal. Do not manufacture confidence from an absent field.
 */
function contextFitScore(product, approachId) {
  const words = APPROACH_STYLE_WORDS[approachId];
  if (!words) return 0.5; // no approach known - neutral, not zero
  const hay = `${product.name} ${product.description}`.toLowerCase();
  const hitCount = words.filter((w) => hay.includes(w)).length;
  if (!hitCount) return 0.4;              // neutral-ish, not a penalty
  return Math.min(1, 0.5 + 0.25 * hitCount);
}

/**
 * Ranks candidates for a single intent.
 *
 * @param {Array} candidates  CatalogProduct[]
 * @param {Object} intent     { tokens, approachId }
 * @returns {Array} scored, sorted best-first
 */
function rankCandidates(candidates, intent) {
  const approachId = intent.approachId;

  // --- hard filters, applied before any scoring -----------------------------
  const eligible = candidates.filter((p) => {
    if (typeof p.price !== "number" || !isFinite(p.price)) return false;
    if (p.availability === "out_of_stock") return false;
    return true;
  });
  if (!eligible.length) return [];

  // --- price percentile basis ----------------------------------------------
  const allPrices = eligible.map((p) => p.price).sort((a, b) => a - b);
  const fence = priceOutlierFence(allPrices);
  // Outliers are excluded from the BASIS but remain rankable - they simply
  // cannot score on price. Excluding them outright would impose a band.
  const prices = allPrices.filter((v) => v <= fence);
  const usePrice = prices.length >= MIN_CANDIDATES_FOR_PRICE;
  const target = APPROACH_TARGET_PERCENTILE[approachId];

  // Renormalize when a term is unavailable, preserving invariant (1).
  const activeWeights = { ...WEIGHTS };
  if (!usePrice || target == null) activeWeights.price = 0;
  const totalWeight = Object.values(activeWeights).reduce((a, b) => a + b, 0);

  const scored = eligible.map((p) => {
    const relevance = relevanceScore(p, intent.tokens);
    const availability = availabilityScore(p);
    const context = contextFitScore(p, approachId);
    let priceFit = 0;
    if (activeWeights.price > 0) {
      // Out-of-distribution price scores zero rather than being clamped to
      // the top of the scale. See the OUTLIER note above.
      priceFit = p.price > fence ? 0 : 1 - Math.abs(percentileRank(p.price, prices) - target);
    }

    const raw =
      activeWeights.relevance * relevance +
      activeWeights.price * priceFit +
      activeWeights.availability * availability +
      activeWeights.context * context;

    return {
      product: p,
      score: raw / totalWeight, // stays in [0,1] whatever is active
      components: { relevance, priceFit, availability, context },
      priceUsed: activeWeights.price > 0,
    };
  });

  // --- sort, then commission tiebreak WITHIN epsilon only -------------------
  scored.sort((a, b) => {
    const d = b.score - a.score;
    if (Math.abs(d) >= EPSILON) return d;
    const ca = (a.product.sourceMetadata && a.product.sourceMetadata.commission) || 0;
    const cb = (b.product.sourceMetadata && b.product.sourceMetadata.commission) || 0;
    if (cb !== ca) return cb - ca;
    return d;
  });

  return scored;
}

module.exports = {
  rankCandidates,
  relevanceScore,
  availabilityScore,
  contextFitScore,
  percentileRank,
  WEIGHTS,
  EPSILON,
  MIN_CANDIDATES_FOR_PRICE,
  APPROACH_TARGET_PERCENTILE,
  APPROACH_STYLE_WORDS,
  priceOutlierFence,
  quantile,
  OUTLIER_IQR_MULTIPLIER,
};
