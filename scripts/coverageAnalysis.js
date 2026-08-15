#!/usr/bin/env node
/**
 * Product Intelligence coverage analysis — Phase 1f.
 *
 * A MEASUREMENT TOOL, not a production feature and not deployed. It answers
 * the one question that gates whether Awin ingestion is worth building:
 *
 *   "Of the recommendations Uncluttrd actually makes, how many could a real
 *    product source resolve today?"
 *
 * AwinMosaicFeedComparison.md ended by saying this measurement is the gate.
 * If coverage against real recommendation text is low, the Awin
 * downloader/normalizer is premature no matter how good the adapter looks.
 *
 * SINGLE SOURCE OF TRUTH: the resolver is not reimplemented here. This
 * script extracts the region between [PI-RESOLVER-START] and
 * [PI-RESOLVER-END] out of App.js and evaluates it, so the queries measured
 * are byte-identical to the queries production builds. If that region stops
 * being pure, this script fails loudly rather than measuring a stale copy.
 *
 * STRICTLY READ-ONLY against Firestore. It calls .get() only — grep this
 * file for .set(, .update(, .delete(, .add(, .commit( and you will find
 * none. Per the standing rule on the production service-account key, this
 * tool never writes.
 *
 * Usage:
 *   node scripts/coverageAnalysis.js --plans plans.json   # offline, no Firestore
 *   node scripts/coverageAnalysis.js --limit 50           # read real plans
 *   node scripts/coverageAnalysis.js --limit 50 --json coverage.json
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------------------------------------------------------------------------
// 1. Extract the production resolver from App.js
// ---------------------------------------------------------------------------
function loadResolver() {
  const appPath = path.join(__dirname, "..", "App.js");
  const src = fs.readFileSync(appPath, "utf8");
  const start = src.indexOf("// [PI-RESOLVER-START]");
  const end = src.indexOf("// [PI-RESOLVER-END]");
  if (start === -1 || end === -1 || end <= start) {
    console.error(
      "Could not find the [PI-RESOLVER-START]/[PI-RESOLVER-END] markers in App.js.\n" +
      "The resolver region moved or was renamed. Fix the markers rather than\n" +
      "copying the resolver into this script — a copy would drift from production."
    );
    process.exit(1);
  }
  const region = src.slice(start, end);
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`${region}\nreturn { resolveProductDestination, normalizeProductRecommendation, buildAmazonSearchQuery, PRODUCT_SOURCES };`)();
  } catch (e) {
    console.error(`The resolver region is no longer evaluable standalone: ${e.message}\n` +
      `It must stay pure (no React, no imports, no module-scope side effects).`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 2. Source coverage predicates
// ---------------------------------------------------------------------------
// Amazon search always resolves — a search URL can be built from any
// searchTerms. That is the whole reason it is the v1 primary path.
//
// Awin coverage is measured against the feeds we can actually read TODAY.
// Deliberately conservative: a recommendation counts as Awin-covered only if
// its text overlaps the catalog vocabulary of a joined, non-stale feed. An
// optimistic predicate here would manufacture the very justification this
// tool exists to test.
const AWIN_JOINED_CATALOGS = [
  {
    advertiser: "King Koil", feedId: "101819", products: 29,
    // 29 rows, 1 distinct product. Documented in AwinProductFeedPOC.md.
    vocabulary: /\b(air mattress|airbed|inflatable bed|guest bed)\b/i,
  },
  {
    advertiser: "Mosaic Weighted Blankets", feedId: "105766", products: 496,
    // 496 rows, 46 distinct products. AwinMosaicFeedComparison.md.
    vocabulary: /\b(weighted blanket|duvet cover|throw blanket|lap pad|shoulder wrap)\b/i,
  },
];

function coverageFor(rec, R) {
  const text = [rec.productType, rec.searchTerms, rec.reason].filter(Boolean).join(" ");
  const sources = [];
  const resolution = R.resolveProductDestination(rec, { approachId: rec.approachId || null });
  sources.push({ source: "amazon-search-v1", kind: "search", resolved: true });
  AWIN_JOINED_CATALOGS.forEach((cat) => {
    if (cat.vocabulary.test(text)) {
      sources.push({ source: "awin-feed", kind: "product", resolved: true, advertiser: cat.advertiser, feedId: cat.feedId });
    }
  });
  return { resolution, sources };
}

// ---------------------------------------------------------------------------
// 3. Input: offline fixture, or real plans (read-only)
// ---------------------------------------------------------------------------
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

async function loadPlansFromFirestore(limit) {
  const KEY_ENV = "GOOGLE_APPLICATION_CREDENTIALS";
  if (!process.env[KEY_ENV]) {
    console.error(
      `No Firestore credentials.\n\n` +
      `Either run offline against a fixture:\n` +
      `  node scripts/coverageAnalysis.js --plans plans.json\n\n` +
      `or point ${KEY_ENV} at a service-account key. NOTE: this tool only ever\n` +
      `calls .get(); it performs no writes of any kind.`
    );
    process.exit(1);
  }
  let admin;
  try { admin = require("firebase-admin"); }
  catch { console.error(`firebase-admin is not installed. Use --plans <fixture.json> for offline analysis.`); process.exit(1); }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  // READ ONLY. collectionGroup().get() — no write API is touched anywhere.
  const snap = await db.collectionGroup("plans").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function extractRecommendations(plans) {
  const out = [];
  plans.forEach((plan) => {
    const approaches = plan.approaches || {};
    Object.entries(approaches).forEach(([approachId, a]) => {
      (a?.productRecommendations || []).forEach((rec) => {
        out.push({ planId: plan.id, approachId, ...rec });
      });
    });
    // Pre-approach plans stored products under tiers[].products with a
    // `searchQuery` rather than `searchTerms`. Counted too — they are real
    // recommendations that real users still see.
    (plan.tiers || []).forEach((t) => {
      (t?.products || []).forEach((p) => {
        out.push({ planId: plan.id, approachId: null, productType: p.name, searchTerms: p.searchQuery, legacy: true });
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
(async () => {
  const R = loadResolver();
  console.log(`Resolver loaded from App.js — ${R.PRODUCT_SOURCES.length} source adapter(s) registered: ${R.PRODUCT_SOURCES.map((s) => s.resolverKind).join(", ")}\n`);

  const fixture = arg("--plans");
  const limit = parseInt(arg("--limit", "50"), 10);
  const jsonOut = arg("--json");

  let plans;
  if (fixture) {
    plans = JSON.parse(fs.readFileSync(fixture, "utf8"));
    if (!Array.isArray(plans)) plans = [plans];
    console.log(`Loaded ${plans.length} plan(s) from fixture ${fixture}`);
  } else {
    plans = await loadPlansFromFirestore(limit);
    console.log(`Read ${plans.length} plan(s) from Firestore (read-only)`);
  }

  const recs = extractRecommendations(plans);
  if (!recs.length) { console.log(`No product recommendations found.`); process.exit(0); }
  console.log(`Extracted ${recs.length} recommendation(s)\n`);

  const rows = recs.map((rec) => {
    const { resolution, sources } = coverageFor(rec, R);
    return { rec, resolution, sources, awin: sources.some((s) => s.source === "awin-feed") };
  });

  console.log(`PER-RECOMMENDATION`);
  console.log(`  ${"productType".padEnd(38)} ${"approach".padEnd(10)} ${"sources".padEnd(9)} query`);
  rows.slice(0, 60).forEach(({ rec, resolution, sources, awin }) => {
    console.log(`  ${String(rec.productType || "").slice(0, 36).padEnd(38)} ${String(rec.approachId || "-").padEnd(10)} ${String(sources.length).padEnd(9)} ${resolution.queryUsed}`);
    if (awin) console.log(`  ${" ".repeat(38)} ^ ALSO Awin: ${sources.filter((s) => s.source === "awin-feed").map((s) => s.advertiser).join(", ")}`);
  });
  if (rows.length > 60) console.log(`  … ${rows.length - 60} more`);

  const awinCovered = rows.filter((r) => r.awin).length;
  const enriched = rows.filter((r) => r.resolution.analyticsContext.queryEnriched).length;
  const byType = {};
  rows.forEach((r) => { const k = (r.rec.productType || "(none)").toLowerCase(); byType[k] = (byType[k] || 0) + 1; });

  console.log(`\nCOVERAGE SUMMARY`);
  console.log(`  recommendations analysed     : ${rows.length}`);
  console.log(`  distinct productTypes        : ${Object.keys(byType).length}`);
  console.log(`  resolvable by Amazon search  : ${rows.length}  (100.0%)`);
  console.log(`  resolvable by an Awin feed   : ${awinCovered}  (${(awinCovered / rows.length * 100).toFixed(1)}%)`);
  console.log(`  queries context-enriched     : ${enriched}  (${(enriched / rows.length * 100).toFixed(1)}%)`);
  console.log(`  legacy (pre-approach) recs   : ${rows.filter((r) => r.rec.legacy).length}`);

  console.log(`\nMOST COMMON productTypes (what a real product source would need to cover)`);
  Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));

  console.log(`\nGATE READING`);
  const pct = awinCovered / rows.length * 100;
  if (pct < 5) {
    console.log(`  Awin covers ${pct.toFixed(1)}% of real recommendations. Building the feed`);
    console.log(`  downloader/normalizer now would serve almost nothing. Keep Amazon search`);
    console.log(`  as the sole path and use scripts/awinFeedList.js to find broader advertisers.`);
  } else if (pct < 25) {
    console.log(`  Awin covers ${pct.toFixed(1)}%. A narrow overlay is defensible but thin.`);
  } else {
    console.log(`  Awin covers ${pct.toFixed(1)}%. Ingestion is justified by coverage.`);
  }

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(rows.map((r) => ({
      planId: r.rec.planId, productType: r.rec.productType, approachId: r.rec.approachId,
      queryUsed: r.resolution.queryUsed, resolverKind: r.resolution.resolverKind,
      url: r.resolution.url, sources: r.sources,
    })), null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
})();
