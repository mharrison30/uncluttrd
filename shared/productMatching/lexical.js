// ===========================================================================
// LEXICAL MATCHING
// ===========================================================================
//
// One place that decides what "this term appears in this text" means.
//
// WHY THIS FILE EXISTS: the matcher previously used String.includes() for
// every lexical comparison, which matches ANYWHERE INSIDE A WORD. Against the
// short, controlled descriptions in the fixture catalog that looked fine.
// Against a real feed it collapsed. Measured over the 54-recommendation corpus
// against 491 real Mosaic Awin product rows (AwinMosaicFeedValidation.md):
//
//     token-product hits, substring       4,080
//     token-product hits, word-boundary   1,063
//     FALSE hits from substring           3,017  -  74% of all hits
//
// The colliding tokens were the corpus's most common head nouns, not edge
// cases:
//
//     bin   -> com-BIN-ation        out    -> r-OUT-ine
//     art   -> light-heART-ed       mat    -> ulti-MAT-e
//     light -> de-LIGHT-ful         table  -> sui-TABLE
//
// `art` appears 7 times in the corpus and `light`/`lighting` 8 times, so this
// was not a tail problem. It produced four confident, wrong, expensive-looking
// matches against Mosaic - a weighted blanket for "Pull-out bins or drawers".
//
// The rule now: **tokens match tokens, phrases match contiguous token runs.**
// Never raw character containment.
//
// Plain CommonJS, no dependencies, so every other module can import it without
// a cycle. singularize and TOKEN_SYNONYMS live here rather than in
// queryRewriter for exactly that reason: BOTH sides of a comparison must be
// normalized the same way, so the normalizer cannot belong to one side.
// ===========================================================================

// Irregular plurals where naive "-s" removal produces a token matching
// nothing. Retailer titles favour singular head nouns ("Floating Wall Shelf",
// "Serving Tray"), so singularizing improves recall.
const IRREGULAR_SINGULARS = {
  shelves: "shelf", boxes: "box", dishes: "dish", brushes: "brush",
  glasses: "glass", vases: "vase", leaves: "leaf", knives: "knife",
  candles: "candle", supplies: "supply", accessories: "accessory",
  canisters: "canister", turntables: "turntable", baskets: "basket",
};

// Token-level normalization applied to BOTH query and catalog text.
//
// Symmetry is the point. When this map lived on the query side only, the
// corpus's "artwork" was rewritten to "art" but a catalog saying "Artwork"
// still tokenized to "artwork" - and under word-boundary matching those no
// longer meet. Substring matching hid that by accident. Normalizing both
// sides fixes it on purpose.
const TOKEN_SYNONYMS = {
  artwork: "art",
  organiser: "organizer",
  turntables: "turntable",
};

function singularize(word) {
  if (IRREGULAR_SINGULARS[word]) return IRREGULAR_SINGULARS[word];
  if (word.length <= 3) return word;
  if (/(ss|us|is|as|os)$/.test(word)) return word;       // glass, status, axis
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";  // caddies -> caddy
  if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * The single normalization every token passes through, on both sides.
 * Order matters: singularize first, then map synonyms, so "artworks" and
 * "artwork" both land on "art".
 */
function normalizeToken(token) {
  const s = singularize(String(token).toLowerCase());
  return TOKEN_SYNONYMS[s] || s;
}

/**
 * Splits text into normalized word tokens.
 *
 * Deliberate handling, rather than accidental:
 *   - CAPITALIZATION  lowercased throughout.
 *   - POSSESSIVES     "Mosaic's" -> ["mosaic"], not ["mosaic","s"].
 *   - SEPARATORS      hyphen, slash, comma, period, ampersand and every other
 *                     non-alphanumeric all split. "3-Tier" -> ["3","tier"],
 *                     "counter/shelf" -> ["counter","shelf"].
 *   - PUNCTUATION     stripped, never treated as part of a word.
 *   - NUMBERS         kept as tokens ("11-Inch" -> ["11","inch"]), since sizes
 *                     and counts are real product attributes.
 *   - PLURALS         normalized via normalizeToken.
 */
function tokenizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")   // possessive: mosaic's -> mosaic
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(normalizeToken);
}

/** Raw tokens with no normalization - for callers that need surface forms. */
function tokenizeRaw(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Does `token` occur as a WHOLE WORD in the given normalized token list?
 *
 * This is the function that replaces String.includes(). It cannot match inside
 * a word, because there is no "inside" - both sides are already split into
 * words and normalized identically.
 */
function matchToken(tokens, token) {
  if (!tokens || !tokens.length || !token) return false;
  const t = normalizeToken(token);
  for (let i = 0; i < tokens.length; i++) if (tokens[i] === t) return true;
  return false;
}

/**
 * Does the phrase occur as a CONTIGUOUS run of whole words?
 *
 * Preserves legitimate multi-word matching ("wall art", "bath mat") while
 * refusing the span-across-words behaviour the old joined-string check
 * allowed: `["small","wall","artistic"].join(" ")` contains the substring
 * "wall art", so `"wall art"` was treated as present. It is not - "artistic"
 * is a different word.
 *
 * Returns the start index of the first match, or -1.
 */
function findPhrase(tokens, phraseTokens) {
  const p = phraseTokens.map(normalizeToken);
  if (!p.length || p.length > tokens.length) return -1;
  outer:
  for (let i = 0; i + p.length <= tokens.length; i++) {
    for (let j = 0; j < p.length; j++) if (tokens[i + j] !== p[j]) continue outer;
    return i;
  }
  return -1;
}

function matchPhrase(tokens, phraseTokens) {
  return findPhrase(tokens, phraseTokens) !== -1;
}

/**
 * Tokenizes a product's searchable fields once and caches by object identity.
 *
 * Ranking calls relevanceScore thousands of times per evaluation; re-splitting
 * the same 1,100-character description each time is pure waste. A WeakMap
 * keyed on the product object holds no strong reference, so a source is free
 * to discard products whenever it likes.
 */
const _cache = new WeakMap();

function productTokens(product) {
  let hit = _cache.get(product);
  if (hit) return hit;
  hit = {
    name: tokenizeText(product.name),
    category: tokenizeText(String(product.category || "").replace(/-/g, " ")),
    description: tokenizeText(product.description),
  };
  _cache.set(product, hit);
  return hit;
}

module.exports = {
  tokenizeText,
  tokenizeRaw,
  normalizeToken,
  singularize,
  matchToken,
  matchPhrase,
  findPhrase,
  productTokens,
  IRREGULAR_SINGULARS,
  TOKEN_SYNONYMS,
};
