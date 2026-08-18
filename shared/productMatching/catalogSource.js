// ===========================================================================
// CATALOG SOURCE INTERFACE
// ===========================================================================
//
// The contract every catalog source must satisfy. Wayfair (via CJ), Rakuten,
// Awin and a future Amazon PA-API are all IMPLEMENTATIONS of this interface,
// not architectural choices - that is decision #1 in ProductMatchingDesign.md
// ("source-agnostic: build the interface, let the first sufficiently good
// catalog become the first implementation").
//
// This mirrors the PRODUCT_SOURCES adapter split already in App.js one layer
// down: that layer abstracts LINK CONSTRUCTION across incompatible mechanisms
// (Amazon appends a tag, Awin reads aw_deep_link, CJ calls linkCode). This
// abstracts RETRIEVAL the same way.
//
// Nothing above this layer may know which source answered. A source-specific
// identifier, a tracking parameter or a network quirk that escapes into the
// ranker is a bug, not a shortcut.
//
// Plain CommonJS, same as shared/spaceMigration.js, so a Node CLI can
// require() it with no transform step while Metro can still import it.
// ===========================================================================

/**
 * @typedef {Object} CatalogProduct
 * @property {string} id            Source-unique product id
 * @property {string} name          Retailer's own product title
 * @property {string} description   Retailer's own copy
 * @property {string} category      Source category label
 * @property {number} price         Numeric, in `currency`
 * @property {string} currency      ISO 4217, e.g. "USD"
 * @property {string} imageUrl
 * @property {string} productUrl    Non-affiliate canonical URL
 * @property {"in_stock"|"out_of_stock"|"unknown"} availability
 * @property {Object} sourceMetadata
 * @property {string} sourceMetadata.source        Source name, e.g. "fixture"
 * @property {string} sourceMetadata.merchantId
 * @property {string} sourceMetadata.affiliateUrl  The monetizable link
 * @property {number} [sourceMetadata.commission]  Rate 0-1, optional
 */

/**
 * @typedef {Object} CatalogSource
 * @property {Object} metadata
 * @property {string} metadata.name
 * @property {string} metadata.type          "fixture" | "api" | "feed"
 * @property {string|null} metadata.lastUpdated  ISO 8601
 * @property {(query: string, options?: SearchOptions) => CatalogProduct[]} search
 * @property {(id: string) => CatalogProduct|null} getProduct
 */

/**
 * @typedef {Object} SearchOptions
 * @property {number} [maxResults=50]
 * @property {{min?: number, max?: number}} [priceRange]
 */

const AVAILABILITY_VALUES = ["in_stock", "out_of_stock", "unknown"];

/**
 * Validates a single product against the CatalogProduct schema.
 * Returns an array of problem strings; empty means valid.
 *
 * Exists so a future real adapter can be conformance-tested against exactly
 * the same checks the fixture passes. An adapter that returns rows this
 * rejects would break the ranker in ways that are hard to trace back, because
 * ranking failures surface as "bad results" rather than as type errors.
 */
function validateProduct(p) {
  const problems = [];
  const str = (k) => typeof p[k] === "string" && p[k].length > 0;

  if (!p || typeof p !== "object") return ["not an object"];
  ["id", "name", "description", "category", "currency", "imageUrl", "productUrl"]
    .forEach((k) => { if (!str(k)) problems.push(`${k} missing or not a non-empty string`); });

  if (typeof p.price !== "number" || !isFinite(p.price) || p.price < 0) {
    problems.push("price must be a finite non-negative number");
  }
  if (!AVAILABILITY_VALUES.includes(p.availability)) {
    problems.push(`availability must be one of ${AVAILABILITY_VALUES.join("|")}`);
  }
  const sm = p.sourceMetadata;
  if (!sm || typeof sm !== "object") {
    problems.push("sourceMetadata missing");
  } else {
    ["source", "merchantId", "affiliateUrl"].forEach((k) => {
      if (typeof sm[k] !== "string" || !sm[k]) problems.push(`sourceMetadata.${k} missing`);
    });
    if (sm.commission != null &&
        (typeof sm.commission !== "number" || sm.commission < 0 || sm.commission > 1)) {
      problems.push("sourceMetadata.commission must be a number 0-1 when present");
    }
  }
  return problems;
}

/**
 * Conformance-checks a whole source: shape of `metadata`, presence of the two
 * methods, and validity of a sample of what `search` actually returns.
 *
 * Deliberately calls search() with a real query rather than trusting the
 * declaration. An adapter can satisfy the type signature and still return
 * malformed rows.
 */
function validateSource(source, probeQuery = "tray") {
  const problems = [];
  if (!source || typeof source !== "object") return ["source is not an object"];

  const m = source.metadata;
  if (!m || typeof m !== "object") problems.push("metadata missing");
  else {
    if (typeof m.name !== "string" || !m.name) problems.push("metadata.name missing");
    if (!["fixture", "api", "feed"].includes(m.type)) problems.push("metadata.type must be fixture|api|feed");
    if (!(m.lastUpdated === null || typeof m.lastUpdated === "string")) {
      problems.push("metadata.lastUpdated must be an ISO string or null");
    }
  }
  if (typeof source.search !== "function") problems.push("search() not implemented");
  if (typeof source.getProduct !== "function") problems.push("getProduct() not implemented");
  if (problems.length) return problems;

  let sample;
  try {
    sample = source.search(probeQuery, { maxResults: 5 });
  } catch (e) {
    return [`search() threw: ${e.message}`];
  }
  if (!Array.isArray(sample)) return ["search() did not return an array"];

  sample.forEach((p, i) => {
    validateProduct(p).forEach((x) => problems.push(`search()[${i}]: ${x}`));
  });

  if (sample.length) {
    const round = source.getProduct(sample[0].id);
    if (!round) problems.push("getProduct() returned null for an id search() just produced");
    else if (round.id !== sample[0].id) problems.push("getProduct() returned a different product");
  }
  return problems;
}

module.exports = { validateProduct, validateSource, AVAILABILITY_VALUES };
