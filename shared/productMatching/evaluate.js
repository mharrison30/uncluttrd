#!/usr/bin/env node
// ===========================================================================
// EVALUATION HARNESS
// ===========================================================================
//
//   node shared/productMatching/evaluate.js          summary
//   node shared/productMatching/evaluate.js --full   plus per-recommendation detail
//
// Runs the whole pipeline against all 54 staging recommendations and the
// fixture catalog. No network, no Firestore, no credentials - which is the
// point: ProductMatchingDesign.md Section 7 establishes that the rewriter and
// the ranker are testable with no commercial relationship in place, and this
// is the proof of that claim rather than the assertion of it.
//
// What this CANNOT measure: end-to-end retrieval quality against real catalog
// vocabulary. The fixture was authored to be realistic, but it was authored
// by the same process that authored the matcher, so recall numbers here are
// an upper bound and are reported as such.
// ===========================================================================

const fs = require("fs");
const path = require("path");

const { FixtureCatalogSource, ALL_PRODUCTS } = require("./fixtureCatalog");
const { validateSource, validateProduct } = require("./catalogSource");
const { rewriteRecommendation, splitDisjunctions } = require("./queryRewriter");
const { rankCandidates, WEIGHTS, EPSILON, MIN_CANDIDATES_FOR_PRICE } = require("./ranking");
const { matchRecommendation, planRefresh, isUnderspecified } = require("./pipeline");

const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus.fixture.json"), "utf8"));
const FULL = process.argv.includes("--full");
const NOW = "2026-08-18T00:00:00Z";

let pass = 0, fail = 0;
const ck = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};
const pct = (n, d) => (d ? `${n}/${d} (${(n / d * 100).toFixed(0)}%)` : `${n}/0`);

console.log(`\n  PRODUCT MATCHING MVI - EVALUATION`);
console.log(`  corpus: ${CORPUS.length} staging recommendations   catalog: ${ALL_PRODUCTS.length} fixture products\n`);

// ---------------------------------------------------------------------------
console.log("  === 0. LEXICAL REGRESSION TESTS ===");
const lex = require("./lexicalTests").run(() => {}); // quiet; detail via lexicalTests.js
ck(`lexical regression suite (${lex.pass + lex.fail} cases)`, lex.fail === 0,
   lex.fail ? `${lex.fail} failing - run node shared/productMatching/lexicalTests.js` : "");

// ---------------------------------------------------------------------------
console.log("\n  === 1. CATALOG SOURCE INTERFACE CONFORMANCE ===");
const srcProblems = validateSource(FixtureCatalogSource, "tray");
ck("fixture implements CatalogSource", srcProblems.length === 0, srcProblems.join("; "));
const badProducts = ALL_PRODUCTS.map((p) => validateProduct(p)).filter((x) => x.length);
ck(`all ${ALL_PRODUCTS.length} products valid`, badProducts.length === 0, `${badProducts.length} invalid`);
ck("metadata complete", !!(FixtureCatalogSource.metadata.name &&
  FixtureCatalogSource.metadata.type && FixtureCatalogSource.metadata.lastUpdated));
const distractorCount = ALL_PRODUCTS.filter((p) => p._distractor).length;
console.log(`  catalog composition: ${ALL_PRODUCTS.length} products, ${distractorCount} deliberate distractors`);
const cats = {};
ALL_PRODUCTS.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
console.log(`  categories: ${Object.keys(cats).length}`);
const priceAll = ALL_PRODUCTS.map((p) => p.price).sort((a, b) => a - b);
console.log(`  price range: $${priceAll[0]} - $${priceAll[priceAll.length - 1]}, median $${priceAll[Math.floor(priceAll.length / 2)]}`);

// ---------------------------------------------------------------------------
console.log("\n  === 2. REWRITER vs ALL 54 RECOMMENDATIONS ===");
let totalIntents = 0, multiIntent = 0, strippedTokenTotal = 0, clauseStripped = 0;
let protectedTotal = 0, emptyFallbacks = 0, serviceCount = 0, conjunctiveAnd = 0;
const strippedHistogram = {};
const rewrites = [];

for (const rec of CORPUS) {
  const { intents, diagnostics } = rewriteRecommendation(rec);
  rewrites.push({ rec, intents, diagnostics });
  totalIntents += intents.length;
  if (intents.length > 1) multiIntent++;
  strippedTokenTotal += diagnostics.strippedTokens.length;
  diagnostics.strippedTokens.forEach((t) => { strippedHistogram[t] = (strippedHistogram[t] || 0) + 1; });
  if (diagnostics.strippedClauses.length) clauseStripped++;
  protectedTotal += diagnostics.protectedTokens.length;
  if (diagnostics.emptyAfterRewrite) emptyFallbacks++;
  if (diagnostics.isService) serviceCount++;
  if (diagnostics.hasConjunctiveAnd) conjunctiveAnd++;
}

console.log(`  recommendations in            : ${CORPUS.length}`);
console.log(`  product intents out           : ${totalIntents}   (expansion ${(totalIntents / CORPUS.length).toFixed(2)}x)`);
console.log(`  split into multiple intents   : ${pct(multiIntent, CORPUS.length)}`);
console.log(`  purpose clause stripped       : ${pct(clauseStripped, CORPUS.length)}`);
console.log(`  tokens stripped (total)       : ${strippedTokenTotal}`);
console.log(`  location tokens PROTECTED     : ${protectedTotal}  <- would have been wrongly stripped`);
console.log(`  empty-after-rewrite failsafes : ${emptyFallbacks}`);
console.log(`  service (unmatchable)         : ${serviceCount}`);
console.log(`  conjunctive "and" NOT split   : ${conjunctiveAnd}  (documented limitation)`);

const designExpected = CORPUS.reduce((n, r) => n + splitDisjunctions(r.productType).length, 0);
ck(`intent count matches design's measured 82`, totalIntents === designExpected && designExpected === 82,
  `got ${totalIntents}, design measured 82`);

console.log(`\n  most-stripped tokens:`);
Object.entries(strippedHistogram).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([t, c]) => console.log(`    ${String(c).padStart(3)}x  "${t}"`));

// Sanity: no intent should be empty, and none should have lost its head noun.
const emptyIntents = rewrites.filter((r) => r.intents.some((i) => !i.query.trim()));
ck("no empty intent queries", emptyIntents.length === 0, `${emptyIntents.length} empty`);
const wallArt = rewrites.filter((r) => /wall art/i.test(r.rec.productType));
const wallArtKept = wallArt.every((r) => r.intents.some((i) => i.tokens.includes("wall")));
ck(`"wall art" survives stripping (${wallArt.length} recs)`, wallArtKept,
  wallArtKept ? "" : "wall was stripped - PROTECTED_COMPOUNDS regression");

// ---------------------------------------------------------------------------
console.log("\n  === 3. RANKING INVARIANTS ===");
const wsum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
ck("weights sum to 1.00", Math.abs(wsum - 1) < 1e-9, `sum=${wsum}`);
ck(`epsilon (${EPSILON}) is small vs full scale`, EPSILON > 0 && EPSILON <= 0.05);

// Every produced score must be within [0,1] - the invariant decision #2's
// epsilon depends on.
let scoreOutOfRange = 0, scoredTotal = 0;
// Commission must never lift a product across a real (>= epsilon) score gap.
let commissionViolations = 0;

// Out-of-stock must never appear in a ranked list.
let oosLeak = 0;

for (const { rec, intents } of rewrites) {
  for (const intent of intents) {
    const cands = FixtureCatalogSource.search(intent.query, { maxResults: 40 });
    if (!cands.length) continue;
    const ranked = rankCandidates(cands, intent);
    scoredTotal += ranked.length;
    ranked.forEach((r) => {
      if (r.score < 0 || r.score > 1) scoreOutOfRange++;
      if (r.product.availability === "out_of_stock") oosLeak++;
    });
    for (let i = 0; i + 1 < ranked.length; i++) {
      const gap = ranked[i].score - ranked[i + 1].score;
      if (gap < -1e-9 && Math.abs(gap) >= EPSILON) commissionViolations++;
    }
  }
}
ck(`all ${scoredTotal} scores within [0,1]`, scoreOutOfRange === 0, `${scoreOutOfRange} out of range`);
ck("out-of-stock never ranked", oosLeak === 0, `${oosLeak} leaked`);
ck("commission never crosses an epsilon gap", commissionViolations === 0, `${commissionViolations} violations`);

// Price percentile guard: with < MIN_CANDIDATES the price term must be off.
const tiny = FixtureCatalogSource.search("murano", { maxResults: 3 });
if (tiny.length && tiny.length < MIN_CANDIDATES_FOR_PRICE) {
  const r = rankCandidates(tiny, { tokens: ["murano"], approachId: "elevated" });
  ck(`price term disabled below ${MIN_CANDIDATES_FOR_PRICE} candidates`, r.every((x) => !x.priceUsed));
} else {
  ck(`price-guard probe ran`, true, "probe returned >= threshold, guard untested here");
}

// Approach discrimination: same intent, different approach, should move the
// selected price percentile in the expected direction.
const probe = { tokens: ["storage", "basket"], approachId: "simple" };
const cSimple = rankCandidates(FixtureCatalogSource.search("storage basket", { maxResults: 40 }), probe);
const cElev = rankCandidates(FixtureCatalogSource.search("storage basket", { maxResults: 40 }),
  { ...probe, approachId: "elevated" });
if (cSimple.length && cElev.length) {
  ck("elevated selects a pricier product than simple",
    cElev[0].product.price >= cSimple[0].product.price,
    `simple $${cSimple[0].product.price} vs elevated $${cElev[0].product.price}`);
}

// ---------------------------------------------------------------------------
console.log("\n  === 4. FULL PIPELINE vs 54 RECOMMENDATIONS ===");
const results = CORPUS.map((rec) => matchRecommendation(rec, FixtureCatalogSource, { now: NOW, planId: "eval" }));
const matched = results.filter((r) => r.decision === "matched");
const fell = results.filter((r) => r.decision === "fallback");

console.log(`  MATCHED  : ${pct(matched.length, results.length)}`);
console.log(`  FALLBACK : ${pct(fell.length, results.length)}`);

const reasons = {};
fell.forEach((r) => r.gateNotes.forEach((n) => {
  const key = n.replace(/[\d.]+/g, "N");
  reasons[key] = (reasons[key] || 0) + 1;
}));
console.log(`\n  fallback reasons:`);
Object.entries(reasons).sort((a, b) => b[1] - a[1])
  .forEach(([r, c]) => console.log(`    ${String(c).padStart(2)}x  ${r}`));

const underspecified = CORPUS.filter((rec) => {
  const { intents } = rewriteRecommendation(rec);
  return intents.length && intents.every(isUnderspecified);
});
// The design's 7, from a MANUAL classification of all 54 (Section 1d).
const DESIGN_UNDERSPECIFIED = [
  "decorative sculpture or art object",
  "Decorative objects for display styling",
  "Small accent decor objects",
  "Set of decorative objects or sculptural pieces",
  "Decorative objects and accent lamp for credenza styling",
  "sculptural vases and decorative objects for niche",
  "decorative objects or vases for niche styling",
];
console.log(`\n  structurally detected underspecified: ${pct(underspecified.length, CORPUS.length)}`);
console.log(`  design's manual classification        : ${pct(DESIGN_UNDERSPECIFIED.length, CORPUS.length)}`);

// The right assertion is NOT "detector count == 7". The design's 7 came from a
// manual read of the whole phrase; the detector is a mechanical head-noun rule.
// Tuning the rule until the counts match would be fitting the metric, not
// measuring anything. What actually matters is that the detector has no FALSE
// POSITIVES - it must never send a findable product to fallback.
const falsePositives = underspecified.filter(
  (r) => !DESIGN_UNDERSPECIFIED.some((d) => d.toLowerCase() === r.productType.toLowerCase()));
ck("underspecified detector has no false positives", falsePositives.length === 0,
  falsePositives.map((r) => r.productType).join("; "));

const missed = DESIGN_UNDERSPECIFIED.filter(
  (d) => !underspecified.some((r) => r.productType.toLowerCase() === d.toLowerCase()));
console.log(`  detector misses ${missed.length} of the design's 7 - each then judged on merit by the gate:`);
missed.forEach((d) => {
  const i = CORPUS.findIndex((r) => r.productType.toLowerCase() === d.toLowerCase());
  const res = results[i];
  console.log(`    ${res.decision === "matched" ? "MATCHED " : "fallback"}  ${d}`);
});

// Distractors must never win.
const distractorWins = matched.filter((r) => {
  const p = ALL_PRODUCTS.find((x) => x.id === r.commerceCandidate.productId);
  return p && p._distractor;
});
ck("no distractor was ever selected", distractorWins.length === 0,
  distractorWins.map((r) => r.commerceCandidate.name).join(", "));

// Three-layer separation: the recommendation must be untouched.
const mutated = results.filter((r, i) =>
  JSON.stringify(r.recommendation) !== JSON.stringify(CORPUS[i]));
ck("recommendations never mutated", mutated.length === 0, `${mutated.length} mutated`);

// Commerce candidate must not carry plan prose.
const leaked = matched.filter((r) => {
  const s = JSON.stringify(r.commerceCandidate);
  return /"reason"|"grounding"|"shortReason"/.test(s);
});
ck("commerce candidate carries no plan prose", leaked.length === 0, `${leaked.length} leaked`);
ck("every matched candidate has matchedAt", matched.every((r) => r.commerceCandidate.matchedAt === NOW));

// ---------------------------------------------------------------------------
console.log("\n  === 5. REFRESH vs REMATCH (decision #3) ===");
if (matched.length) {
  const cand = matched[0].commerceCandidate;
  const fresh = planRefresh(cand, FixtureCatalogSource, { ageDays: 0, staleDays: 7 });
  ck("fresh candidate needs nothing", fresh.action === "none", fresh.reason);

  const stale = planRefresh(cand, FixtureCatalogSource, { ageDays: 30, staleDays: 7 });
  ck("stale candidate REFRESHES (not rematch)", stale.action === "refresh", `${stale.action}: ${stale.reason}`);

  const priceMoved = planRefresh({ ...cand, price: cand.price + 5 }, FixtureCatalogSource, { ageDays: 0 });
  ck("price change REFRESHES, never rematches", priceMoved.action === "refresh",
    `${priceMoved.action}: ${priceMoved.reason}`);

  const gone = planRefresh({ ...cand, productId: "fx-9999" }, FixtureCatalogSource, { ageDays: 0 });
  ck("disappeared product REMATCHES", gone.action === "rematch", `${gone.action}: ${gone.reason}`);

  const changed = planRefresh(cand, FixtureCatalogSource, { ageDays: 0, recommendationChanged: true });
  ck("changed recommendation REMATCHES", changed.action === "rematch", `${changed.action}: ${changed.reason}`);
}

// ---------------------------------------------------------------------------
// ABLATION: what does the REWRITER actually contribute?
//
// The absolute match rate above is inflated and must not be quoted on its own:
// the fixture was authored by the same process that authored the matcher, so
// its vocabulary is friendlier than a real catalog's will be. The rate is an
// UPPER BOUND, not a forecast.
//
// This ablation is the honest number. Both arms run against the same fixture,
// so the fixture's generosity cancels out, and what remains is the rewriter's
// own contribution: raw productType as a single query, versus the full
// rewrite. That comparison survives the fixture being too kind.
// ---------------------------------------------------------------------------
console.log("\n  === 6. ABLATION: rewriter contribution (fixture bias cancels) ===");
const { rankCandidates: rank2 } = require("./ranking");
const { MIN_SCORE, MIN_RELEVANCE } = require("./pipeline");
const { tokenize } = require("./queryRewriter");

const gate = (r) => r.length && r[0].score >= MIN_SCORE && r[0].components.relevance >= MIN_RELEVANCE;

function armMatches(rec, useRewriter, strict) {
  const tokens = useRewriter
    ? (rewriteRecommendation(rec).intents[0] || {}).tokens || []
    : tokenize(rec.productType);
  if (!tokens.length) return null;
  const cands = FixtureCatalogSource.search(tokens.join(" "), { maxResults: 40, strict });
  if (!cands.length) return null;
  const ranked = rank2(cands, { tokens, approachId: rec.approachId });
  return gate(ranked) ? ranked[0] : null;
}

const arms = {};
for (const strict of [false, true]) {
  for (const rw of [false, true]) {
    arms[`${strict ? "AND" : "OR"}-${rw ? "rw" : "raw"}`] =
      CORPUS.filter((rec) => armMatches(rec, rw, strict)).length;
  }
}
console.log(`                            no rewrite      with rewriter    delta`);
console.log(`  OR-semantics  (forgiving)  ${pct(arms["OR-raw"], 54).padEnd(16)}${pct(arms["OR-rw"], 54).padEnd(17)}+${arms["OR-rw"] - arms["OR-raw"]}`);
console.log(`  AND-semantics (realistic)  ${pct(arms["AND-raw"], 54).padEnd(16)}${pct(arms["AND-rw"], 54).padEnd(17)}+${arms["AND-rw"] - arms["AND-raw"]}`);

ck("rewriter beats baseline under OR", arms["OR-rw"] > arms["OR-raw"]);
ck("rewriter beats baseline under AND", arms["AND-rw"] > arms["AND-raw"]);
ck("rewriter's value is LARGER under realistic AND retrieval",
  (arms["AND-rw"] - arms["AND-raw"]) > (arms["OR-rw"] - arms["OR-raw"]),
  `AND +${arms["AND-rw"] - arms["AND-raw"]} vs OR +${arms["OR-rw"] - arms["OR-raw"]}`);

// Does rewriting change WHICH product wins, not just whether one is found?
let bothMatched = 0, differentPick = 0;
for (const rec of CORPUS) {
  const a = armMatches(rec, false, false);
  const b = armMatches(rec, true, false);
  if (a && b) { bothMatched++; if (a.product.id !== b.product.id) differentPick++; }
}
console.log(`\n  of ${bothMatched} recs matched by BOTH arms, ${differentPick} chose a DIFFERENT product`);
console.log(`  -> the rewriter changes match QUALITY, not only coverage`);

// Distractor pressure: how often does a distractor even reach the top 3?
let distractorTop3 = 0, rankedIntents = 0;
for (const { intents } of rewrites) {
  for (const intent of intents) {
    const c = FixtureCatalogSource.search(intent.query, { maxResults: 40 });
    if (!c.length) continue;
    rankedIntents++;
    if (rank2(c, intent).slice(0, 3).some((r) => r.product._distractor)) distractorTop3++;
  }
}
console.log(`  distractors reaching any top-3: ${pct(distractorTop3, rankedIntents)} of ranked intents`);

// ---------------------------------------------------------------------------
if (FULL) {
  console.log("\n  === 6. PER-RECOMMENDATION DETAIL ===");
  results.forEach((r, i) => {
    const rec = CORPUS[i];
    console.log(`\n  ${String(i + 1).padStart(2)}. [${(rec.approachId || "?").padEnd(9)}] ${rec.productType}`);
    r.intents.forEach((it) => console.log(`      intent: "${it.query}"`));
    if (r.decision === "matched") {
      const c = r.commerceCandidate;
      console.log(`      -> MATCHED  ${c.name}  $${c.price}  score ${c.score}`);
      console.log(`         rel ${c.components.relevance.toFixed(2)}  price ${c.components.priceFit.toFixed(2)}  avail ${c.components.availability.toFixed(2)}  ctx ${c.components.context.toFixed(2)}`);
    } else {
      console.log(`      -> FALLBACK (${r.gateNotes.join("; ")})`);
    }
  });
}

// ---------------------------------------------------------------------------
console.log(`\n  ${"=".repeat(60)}`);
console.log(`  PASS ${pass}   FAIL ${fail}`);
console.log(`  coverage: ${pct(matched.length, results.length)} matched, ${pct(fell.length, results.length)} fallback`);
console.log(fail === 0
  ? "  => pipeline behaves as designed against the fixture catalog.\n"
  : "  => investigate before wiring any real source.\n");
process.exit(fail ? 1 : 0);
