// ===========================================================================
// DETERMINISTIC QUERY REWRITER   (RECOMMENDATION -> PRODUCT INTENT)
// ===========================================================================
//
// The middle layer of ProductMatchingDesign.md Section 0. Takes a stored
// recommendation and derives one or more PRODUCT INTENTS. Product intent is
// DERIVED AND NEVER STORED, which is what makes structured `productNeed`
// (Section 9) adoptable later with no migration: changing how intent is
// derived cannot invalidate an existing plan.
//
// No model. No network. Pure string handling, deterministic by construction:
// same recommendation in, same intents out. That matters because Section 1
// measured 87% of the corpus as a VOCABULARY TRANSLATION problem rather than
// a reasoning problem, and routing translation through an LLM would be paying
// inference prices for `split()`.
//
// ---------------------------------------------------------------------------
// A CORRECTION TO THE DESIGN DOCUMENT
// ---------------------------------------------------------------------------
// ProductMatchingDesign.md Section 7 says to "strip room words using the
// QUERY_STOPWORDS set that already exists in App.js". Implementing that
// literally is WRONG, and the fix is the interesting part of this file.
//
// In App.js, QUERY_STOPWORDS is never used to strip anything. Its only use is
// inside buildAmazonSearchQuery, as a filter on words being APPENDED as
// context hints:
//
//     if (tokens.every((t) => seen.has(t) || QUERY_STOPWORDS.has(t))) return;
//
// The base query is never touched. So the set conflates two different jobs,
// and reusing it wholesale as a strip-list damages real product categories.
// The set contains "wall" - and "wall" appears 7 times in the corpus's
// productType values, every one of them load-bearing:
//
//     "framed wall art"  -> strip "wall" ->  "framed art"      (worse query)
//     "Gallery wall art set"                                    (same damage)
//
// Measured against the corpus: 7 occurrences of "wall" would be wrongly
// stripped, and 1 occurrence of "surface" ("decorative tray for cabinet
// surface") correctly stripped. Naive application is net harmful.
//
// The fix is to split the set by JOB rather than reuse it by NAME:
//   - FUNCTION_WORDS  - always strippable, no exceptions
//   - LOCATION_WORDS  - strippable ONLY when not part of a protected compound
// plus PROTECTED_COMPOUNDS, an explicit, inspectable list of bigrams where a
// location word is part of the product category itself.
// ===========================================================================

const { tokenizeRaw, normalizeToken, singularize, TOKEN_SYNONYMS,
        IRREGULAR_SINGULARS } = require("./lexical");

// Always safe to drop. Pure syntax, never a product category.
const FUNCTION_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "of", "to", "in", "on",
  "your", "this", "that", "these", "those", "some", "any", "is", "are",
]);

// Room / location / spatial words. Strippable only outside a protected
// compound. This is exactly the subset of App.js's QUERY_STOPWORDS that
// describes WHERE rather than WHAT.
const LOCATION_WORDS = new Set([
  "room", "living", "dining", "bedroom", "bathroom", "kitchen", "garage",
  "office", "hallway", "entry", "entryway", "basement", "attic", "closet",
  "area", "space", "zone", "section", "corner", "wall", "floor", "surface",
  "niche", "credenza", "vanity", "cabinet", "shelf", "bookshelf", "pantry",
]);

// Bigrams in which a LOCATION_WORD is part of the product category, not
// context. Checked before any location stripping. Deliberately explicit
// rather than inferred: a heuristic here fails silently and invisibly, and
// this list is short enough to read and argue with.
const PROTECTED_COMPOUNDS = [
  "wall art", "wall mirror", "wall shelf", "wall hook", "wall sconce",
  "wall decor", "wall hanging",
  "bath mat", "bath towel", "hand towel", "bath rug",
  "counter shelf", "countertop tray", "kitchen counter",
  "corner shelf", "corner organizer",
  "floor lamp", "floor mirror",
  "closet organizer", "closet light",
  "area rug", "dining table", "coffee table", "table lamp", "side table",
  "shelf riser", "shelf light", "shelf lighting",
  "cabinet light", "cabinet lighting", "bar cabinet", "liquor cabinet",
  "drinks cabinet", "accent cabinet", "storage cabinet", "display cabinet",
  "picture light", "accent light", "accent lighting", "strip light",
  "strip lighting", "puck light", "niche lighting", "niche shelf",
  "drawer organizer", "drawer divider", "drawer tray",
  "pantry bin", "pantry label", "pantry organizer",
];

// Words that mean "more than one of the same thing" rather than naming a
// product. They add nothing to a catalog query and actively narrow it.
const QUANTITY_NOISE = new Set([
  "multiple", "set", "sets", "pair", "piece", "pieces", "options", "collection",
]);

// A recommendation naming a SERVICE cannot be satisfied by any product
// catalog. Corpus has exactly one ("...with professional installation").
const SERVICE_MARKERS = /\b(installation|installed|professional service|delivery service|assembly service)\b/i;

// ---------------------------------------------------------------------------
// CATALOG SYNONYMS - the deterministic stand-in for the embedding layer
// ---------------------------------------------------------------------------
// ProductMatchingDesign.md Section 2b names embedding similarity as the right
// tool for synonymy ("tiered countertop organizer" -> "3-tier kitchen counter
// shelf") and Section 7 excludes it from v1 because it requires a resident
// catalog to index. This map is what fills that gap in the meantime.
//
// It is deliberately TINY. Every entry is a hand-maintained liability that an
// embedding index would subsume, so padding it out would be building the
// wrong thing carefully. Entries are added only when a measured corpus
// failure demands one, and each records what failed.
//
// Both entries below came from evaluating against the real 54-recommendation
// corpus, not from imagination:
//
//   "lazy susan"  Retailers say "turntable" or "rotating organizer". The
//                 corpus says "Lazy Susan turntable" twice. Retrieval found
//                 the correct product; ranking rejected it because 2 of 3
//                 query tokens were colloquialisms appearing in no listing.
//
//   "artwork"     The corpus says "artwork", every catalog says "art".
//                 Substring matching is one-way: "Framed Wall Art" does not
//                 contain "artwork", so the match was invisible.
const MULTIWORD_SYNONYMS = [
  [/\blazy\s+susan\b/gi, "turntable"],
];


// Surface-form tokens (no normalization) - normalizeToken is applied at the
// end of the rewrite, after stripping, so diagnostics report real words.
function tokenize(text) {
  return tokenizeRaw(text);
}

// Marks token positions covered by a protected compound so location stripping
// can skip them.
function protectedPositions(tokens) {
  // CONTIGUOUS TOKEN-SEQUENCE MATCHING, not string containment.
  //
  // This previously pre-filtered with `tokens.join(" ").includes(compound)`,
  // which was wrong in BOTH directions:
  //   over-permissive - ["small","wall","artistic"] joins to
  //     "small wall artistic", which contains the substring "wall art",
  //     so an unrelated phrase looked like the protected compound;
  //   under-permissive - ["walls","art"] joins to "walls art", which does
  //     NOT contain "wall art", so the guard skipped a compound that the
  //     singularizing loop below would have matched correctly.
  //
  // The inner loop was always right. The pre-filter was the bug, so it is
  // gone rather than patched.
  const norm = tokens.map(normalizeToken);
  const protectedIdx = new Set();
  for (const compound of PROTECTED_COMPOUNDS) {
    const parts = compound.split(" ").map(normalizeToken);
    if (parts.length > norm.length) continue;
    for (let i = 0; i + parts.length <= norm.length; i++) {
      let match = true;
      for (let j = 0; j < parts.length; j++) {
        if (norm[i + j] !== parts[j]) { match = false; break; }
      }
      if (match) for (let j = 0; j < parts.length; j++) protectedIdx.add(i + j);
    }
  }
  return protectedIdx;
}

/**
 * Splits a phrase on disjunctive "or" into separate branches.
 *
 * Section 1 measured 28/54 (52%) of the corpus as disjunctive, expanding 54
 * recommendations to 82 intents (1.52x). This is where that expansion happens.
 *
 * NOTE, and a real limitation: only "or" is split, per spec. Two corpus
 * entries use a conjunctive "and" to join genuinely different products
 * ("Decorative objects and accent lamp for credenza styling"; "sculptural
 * vases and decorative objects for niche"). Those arguably deserve splitting
 * too, but "and" is far more likely to appear inside a single product name
 * than "or" is, so splitting it is not safe without a product-name lexicon.
 * Reported by the evaluation harness rather than silently handled.
 */
function splitDisjunctions(phrase) {
  return String(phrase || "")
    .split(/\s+\bor\b\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Removes a trailing purpose/location clause: "... for credenza styling",
 * "... for niche". Only strips when the clause is genuinely locational -
 * a clause carrying a real feature ("with custom font options") is kept,
 * because it constrains which product is correct.
 */
function stripPurposeClause(phrase) {
  const m = phrase.match(/^(.*?)\s+\bfor\b\s+(.*)$/i);
  if (!m) return { phrase, stripped: null };
  const [, head, tail] = m;
  const tailTokens = tokenize(tail);
  if (!tailTokens.length || !head.trim()) return { phrase, stripped: null };
  const locational = tailTokens.filter(
    (t) => LOCATION_WORDS.has(t) || t === "styling" || t === "display" || t === "use"
  ).length;
  // Majority-locational tail is context, not product.
  if (locational / tailTokens.length >= 0.5) return { phrase: head.trim(), stripped: tail.trim() };
  return { phrase, stripped: null };
}

/**
 * Rewrites one recommendation into product intents.
 *
 * @param {Object} rec  { productType, searchTerms, reason, approachId, ... }
 * @returns {{intents: Array, diagnostics: Object}}
 */
function rewriteRecommendation(rec) {
  const productType = (rec && rec.productType) || "";
  const diagnostics = {
    original: productType,
    isService: SERVICE_MARKERS.test(productType),
    branches: 0,
    strippedTokens: [],
    strippedClauses: [],
    protectedTokens: [],
    hasConjunctiveAnd: /\s+\band\b\s+/i.test(productType),
    emptyAfterRewrite: false,
    synonymsApplied: [],
  };

  // Multi-word synonyms run BEFORE tokenization, since they rewrite phrases
  // ("lazy susan" -> "turntable") that tokenization would split apart.
  let normalizedType = productType;
  for (const [pattern, replacement] of MULTIWORD_SYNONYMS) {
    // Reset explicitly: these are /g regexes, and .test() advances lastIndex.
    // Without this the second recommendation carrying the same phrase can be
    // silently missed - the corpus has "Lazy Susan" twice, so it would.
    pattern.lastIndex = 0;
    if (pattern.test(normalizedType)) {
      pattern.lastIndex = 0;
      diagnostics.synonymsApplied.push(`${pattern.source} -> ${replacement}`);
      normalizedType = normalizedType.replace(pattern, replacement);
    }
  }

  const branches = splitDisjunctions(normalizedType);
  diagnostics.branches = branches.length;

  const intents = [];
  for (const branch of branches) {
    const { phrase, stripped } = stripPurposeClause(branch);
    if (stripped) diagnostics.strippedClauses.push(stripped);

    const raw = tokenize(phrase);
    const prot = protectedPositions(raw);

    const kept = [];
    raw.forEach((tok, i) => {
      if (FUNCTION_WORDS.has(tok)) { diagnostics.strippedTokens.push(tok); return; }
      if (QUANTITY_NOISE.has(tok)) { diagnostics.strippedTokens.push(tok); return; }
      if (LOCATION_WORDS.has(tok)) {
        if (prot.has(i)) { diagnostics.protectedTokens.push(tok); kept.push(tok); return; }
        diagnostics.strippedTokens.push(tok);
        return;
      }
      kept.push(tok);
    });

    // Singularize, then de-duplicate while preserving order.
    const seen = new Set();
    const norm = [];
    for (const t of kept.map(normalizeToken)) {
      if (seen.has(t)) continue;
      seen.add(t);
      norm.push(t);
    }

    // FAILSAFE: if stripping removed everything, fall back to the branch's
    // own tokens minus function words only. An empty query retrieves nothing,
    // which would silently drop a recommendation - strictly worse than a
    // noisy query. Section 6d's "never fabricate parity" logic applies here
    // too: degrade visibly, not invisibly.
    if (!norm.length) {
      diagnostics.emptyAfterRewrite = true;
      const fallback = raw.filter((t) => !FUNCTION_WORDS.has(t)).map(normalizeToken);
      const s2 = new Set();
      fallback.forEach((t) => { if (!s2.has(t)) { s2.add(t); norm.push(t); } });
    }
    if (!norm.length) continue;

    intents.push({
      query: norm.join(" "),
      tokens: norm,
      sourcePhrase: branch,
      approachId: (rec && rec.approachId) || null,
      isService: SERVICE_MARKERS.test(branch),
    });
  }

  return { intents, diagnostics };
}

module.exports = {
  rewriteRecommendation,
  splitDisjunctions,
  stripPurposeClause,
  singularize,
  tokenize,
  FUNCTION_WORDS,
  LOCATION_WORDS,
  PROTECTED_COMPOUNDS,
  QUANTITY_NOISE,
  SERVICE_MARKERS,
  MULTIWORD_SYNONYMS,
  TOKEN_SYNONYMS,
};
