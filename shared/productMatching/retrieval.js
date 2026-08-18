// ===========================================================================
// KEYWORD RETRIEVAL
// ===========================================================================
//
// Turns a product intent into a candidate set by querying a CatalogSource.
// Source-agnostic by construction: it only ever calls source.search(), so
// swapping the fixture for a real Wayfair/Rakuten/Amazon adapter changes
// nothing above this line (decision #1).
//
// Retrieval RECALL is the pipeline's real bottleneck, not ranking precision:
// the ranker cannot recover a product that retrieval never surfaced. That is
// why the rewriter matters more than the re-ranker choice
// (ProductMatchingDesign.md Section 2d), and why the backoff below exists.
// ===========================================================================

const DEFAULT_MAX = 40;

/**
 * Retrieves candidates for one intent, with progressive backoff.
 *
 * The backoff is the whole trick. A rewritten query like
 * "matching soap dispenser" is 3 tokens, and a strict AND-style catalog
 * search may return nothing while dropping one modifier would have matched.
 * Rather than accept zero candidates, drop leading modifiers and retry -
 * the head noun is the last token to go, because it is the category anchor
 * (Section 1b measured 40 distinct head nouns across 54 phrases).
 *
 * Each backoff step is recorded so the evaluation harness can report how
 * often the first-choice query was actually sufficient.
 */
function retrieveForIntent(source, intent, options = {}) {
  const maxResults = options.maxResults == null ? DEFAULT_MAX : options.maxResults;
  const priceRange = options.priceRange;
  const attempts = [];

  const tokens = intent.tokens.slice();
  // Try full query, then progressively drop the LEADING modifier.
  for (let drop = 0; drop < tokens.length; drop++) {
    const q = tokens.slice(drop).join(" ");
    if (!q) break;
    const results = source.search(q, { maxResults, priceRange });
    attempts.push({ query: q, dropped: drop, count: results.length });
    if (results.length) {
      return { candidates: results, queryUsed: q, backoffSteps: drop, attempts };
    }
  }
  return { candidates: [], queryUsed: null, backoffSteps: tokens.length, attempts };
}

/**
 * Retrieves for every intent of one recommendation and merges the results.
 *
 * Merging is by product id, keeping the BEST (lowest) intent index a product
 * appeared under, so a product retrieved by the first branch of a disjunction
 * is not displaced by the same product retrieved by the second. Deduplication
 * matters because disjunctive phrasing frequently retrieves overlapping sets -
 * "Cable management box or organizer" is two intents over one product space.
 */
function retrieveForIntents(source, intents, options = {}) {
  const merged = new Map();
  const perIntent = [];

  intents.forEach((intent, i) => {
    const r = retrieveForIntent(source, intent, options);
    perIntent.push({ intent, ...r });
    for (const product of r.candidates) {
      if (!merged.has(product.id)) merged.set(product.id, { product, intentIndex: i });
    }
  });

  return { candidates: [...merged.values()].map((m) => m.product), perIntent };
}

module.exports = { retrieveForIntent, retrieveForIntents, DEFAULT_MAX };
