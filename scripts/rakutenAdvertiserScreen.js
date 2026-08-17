#!/usr/bin/env node
/**
 * Rakuten partnership portfolio + (deprecated) advertiser screen — BD tooling,
 * not a product feature.
 *
 * ---------------------------------------------------------------------------
 * WHAT WE PROVED, 2026-08-17, AND WHY THIS TOOL CHANGED SHAPE
 * ---------------------------------------------------------------------------
 * The original intent was a network-wide advertiser relevance screen. Endpoint
 * investigation established that Rakuten cannot support one:
 *
 *   /v2/advertisers  returns 2,159 advertisers with EXACTLY 8 fields —
 *                    network, id, name, url, policies, features, contact,
 *                    logo_url. Zero descriptions. Zero categories. 100% of
 *                    records carry name only (mean 13 chars of usable text).
 *
 *   linklocator/getMerchByID  DOES return categories + applicationStatus, but
 *                    ONLY for merchants we already partner with. Every
 *                    non-partner MID returns HTTP 500.
 *
 *   getMerchByCategory  enumerates OUR partnerships, not the network — every
 *                    category id returns exactly our approved merchants.
 *
 *   advertisersearch/1.0  ignores every parameter (category, categoryid, cat,
 *                    category_id, name, mid, appstatus, page, limit all return
 *                    the byte-identical 2,131-merchant list) and exposes only
 *                    <mid> and <merchantname>.
 *
 *   /v1/categories, /v2/categories, /categories/1.0  404. getCategories 500s.
 *
 * CONCLUSION: Rakuten exposes useful human-readable categories ONLY AFTER a
 * partnership exists. Network-wide, it offers eligibility/capability metadata
 * (product_feed, deep_links, ships_to) but NO merchandising taxonomy. The
 * information needed to decide whether to apply is released only once you have
 * applied — structurally the same gate as Amazon's Creators API.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TOOL DOES NOW
 * ---------------------------------------------------------------------------
 *   --portfolio (DEFAULT)  Read-only view of merchants we have ALREADY
 *                          engaged, from /v1/partnerships, joined to
 *                          /v2/advertisers for capability flags.
 *
 *                          *** THIS IS NOT A COVERAGE MEASUREMENT. ***
 *                          It describes six merchants we chose. It says
 *                          NOTHING about Rakuten-wide category coverage and
 *                          must never be quoted as though it did.
 *
 *   --name-screen          DEPRECATED. The original merchant-name relevance
 *                          classification. Retained only for reproducibility;
 *                          see the deprecation banner below for why its output
 *                          is not a decision input.
 *
 *   --self-test            Validates the 15-category Uncluttrd taxonomy. Still
 *                          worth running: the taxonomy is deliberately
 *                          PRESERVED for future PRODUCT-level coverage
 *                          analysis, where it will be applied to catalog rows
 *                          rather than to merchant names.
 *
 * It does NOT ingest, normalize, store, or rank anything. No adapter, no
 * canonical catalog, no change to the app. It does not crawl merchant
 * websites, apply to advertisers, touch SFTP, or download catalogs.
 *
 * STRICTLY READ-ONLY:
 *   - GETs against the Rakuten Publisher API only
 *   - no tracking/deep link is ever FETCHED (that would register a real click);
 *     deep-link construction is out of scope here entirely
 *   - no SFTP connection is opened and no catalog file is downloaded — SFTP
 *     input is an OPTIONAL directory listing the operator captures themselves
 *     (--sftp-listing), so this tool never becomes half an ingestion pipeline
 *
 * CREDENTIALS live OUTSIDE the repository in ~/.uncluttrd-rakuten.env, are
 * never printed, never written to an artifact, and never passed as argv.
 * Every value is redacted from all output, including error paths.
 *
 * Usage:
 *   node scripts/rakutenAdvertiserScreen.js
 *   node scripts/rakutenAdvertiserScreen.js --portfolio          # same, explicit
 *   node scripts/rakutenAdvertiserScreen.js --portfolio --json out.json
 *
 *   node scripts/rakutenAdvertiserScreen.js --self-test          # no credentials
 *   node scripts/rakutenAdvertiserScreen.js --name-screen        # deprecated
 *   node scripts/rakutenAdvertiserScreen.js --sftp-listing=listing.txt
 *
 * PRODUCT SEARCH CAVEAT, established empirically: Product Search returned ZERO
 * results for Highwood USA while its Product Catalog held 2,213 records. The
 * two do NOT have equivalent coverage, so a zero-result probe is INCONCLUSIVE
 * rather than evidence of an empty catalog. `--probe` is therefore retained
 * only behind `--name-screen`, whose candidate list is itself discredited; it
 * is not a supported path and issues zero requests when there are no
 * candidates.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration. Endpoints are overridable because the operator has already
// validated a working auth + partnership flow; if these defaults disagree with
// what was validated, override rather than edit, and the tool fails loudly on
// a 404 instead of silently reporting "no advertisers".
// ---------------------------------------------------------------------------
const ENV_FILE = path.join(os.homedir(), ".uncluttrd-rakuten.env");
const DEFAULTS = {
  RAKUTEN_TOKEN_URL: "https://api.linksynergy.com/token",
  RAKUTEN_ADVERTISERS_URL: "https://api.linksynergy.com/v2/advertisers",
  RAKUTEN_PRODUCTSEARCH_URL: "https://api.linksynergy.com/productsearch/1.0",
};
const PROBE_DELAY_MS = 1200;   // conservative; Rakuten's published limits vary by endpoint
const PROBE_MAX_ADVERTISERS = 25;

// ---------------------------------------------------------------------------
// THE RELEVANCE TAXONOMY.
//
// *** DEPRECATED AS AN ADVERTISER SIGNAL. PRESERVED FOR PRODUCT-LEVEL USE. ***
//
// Applying this taxonomy to ADVERTISER metadata is disqualified. Proven, not
// suspected: /v2/advertisers carries no description and no category for any of
// 2,159 records, so classifyText() was in practice matching MERCHANT NAMES —
// mean 13 characters of text. That measures naming conventions, not
// inventory. The 26 "matches" it produced were roughly 11 plausible and 15
// false positives: six Cordis HOTELS matched "cord" -> cable management; Bath
// Depot, Card Depot, SpotHero and Apotheke matched "pot" -> plants; Easy
// Plumbing, Cabin Zero and Anine Bing matched "bin" -> storage. It is also
// blind in the other direction — Wayfair, Target, IKEA and The Container Store
// would all score zero, exactly as Highwood USA did.
//
// The taxonomy itself is NOT the problem and is deliberately retained. It is
// the measured Uncluttrd demand profile and remains the right instrument for
// PRODUCT-level coverage analysis, where it will be applied to catalog rows
// (product titles, categories, descriptions) that actually describe inventory.
// --self-test continues to validate it against real recommendation text so it
// stays honest until that work begins.
//
// These fifteen categories are NOT invented. They are the measured demand
// profile of Uncluttrd, derived from 1,053 real product recommendations across
// production (684 legacy tier products) and staging (54 approach-format
// recommendations + 315 legacy). Percentages are that measurement, retained so
// a future reader can see WHY these categories and not some tidier list.
//
// `weight` is that measured share. It is used ONLY to weight a merchant's
// relevance score toward what Uncluttrd recommends most — it is never used to
// rank products, which this tool does not do.
//
// `negative` exists because the single most likely failure of a keyword screen
// is a false positive on a merchant that sells the wrong version of the right
// word: "outdoor furniture", "garden lighting", "auto floor mat". Highwood USA
// is precisely that case and is used as the negative control in --self-test.
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { id: "furniture",         label: "Furniture",              weight: 13.5,
    keywords: ["furniture", "cabinet", "console", "dresser", "nightstand", "bookcase", "credenza", "sideboard", "ottoman", "bench", "desk", "chair", "table"] },
  { id: "lighting",          label: "Lighting",               weight: 12.8,
    // " led " is space-padded deliberately: a bare "led" substring matches
    // "handled", "sled" and "bundled" and would quietly poison the screen.
    keywords: ["lighting", "lamp", "sconce", "pendant", "chandelier", "picture light", "led strip", "led accent", " led ", "puck light", "light fixture", "accent light", "lights"] },
  { id: "shelving",          label: "Shelving / risers",      weight: 12.0,
    keywords: ["shelving", "shelf", "shelves", "bookshelf", "riser", "rack", "etagere", "wall shelf", "floating shelf"] },
  { id: "cable",             label: "Cable management",       weight: 10.1,
    keywords: ["cable management", "cable", "cord", "wire management", "cable box", "cable sleeve", "cord organizer", "power strip"] },
  { id: "drawer",            label: "Drawer organizers",      weight: 9.4,
    keywords: ["drawer organizer", "drawer divider", "drawer insert", "utensil tray", "organizer tray", "compartment organizer"] },
  { id: "storage",           label: "Storage / bins / baskets", weight: 8.4,
    keywords: ["storage bin", "storage box", "storage container", "basket", "bin", "tote", "cube storage", "storage cube", "fabric bin", "lidded box"] },
  { id: "decor",             label: "Decor objects / vases",  weight: 8.0,
    keywords: ["vase", "decorative object", "home decor", "sculpture", "figurine", "decorative bowl", "centerpiece", "bookend", "candle holder"] },
  { id: "tray",              label: "Trays",                  weight: 6.9,
    keywords: ["tray", "serving tray", "decorative tray", "vanity tray", "catchall", "valet tray"] },
  { id: "wallart",           label: "Wall art / mirrors",     weight: 6.0,
    keywords: ["wall art", "framed art", "art print", "wall decor", "mirror", "picture frame", "gallery wall", "canvas print"] },
  { id: "textiles",          label: "Textiles",               weight: 4.1,
    keywords: ["towel", "rug", "bath mat", "blanket", "throw", "pillow", "cushion", "curtain", "linen", "textile", "runner"] },
  { id: "hooks",             label: "Hooks / hardware",       weight: 2.7,
    keywords: ["hook", "wall hook", "hanger", "closet rod", "command hook", "pegboard", "bracket", "rail system"] },
  { id: "plants",            label: "Plants",                 weight: 2.4,
    keywords: ["planter", "plant stand", "pot", "faux plant", "artificial plant", "succulent", "greenery"] },
  { id: "barware",           label: "Barware / glassware",    weight: 2.0,
    keywords: ["barware", "glassware", "decanter", "bar cart", "wine rack", "coaster", "tumbler", "stemware"] },
  { id: "labels",            label: "Labels",                 weight: 1.8,
    keywords: ["label maker", "labels", "adhesive label", "chalkboard label", "label holder"] },
  { id: "kitchen",           label: "Kitchen / pantry organization", weight: 1.6,
    keywords: ["pantry", "canister", "lazy susan", "turntable", "spice rack", "food storage", "kitchen organizer", "countertop organizer", "counter organizer", "under sink", "under-sink"] },
];

// Words that indicate the RIGHT keyword attached to the WRONG product. Applied
// per-match, not per-merchant, so "outdoor furniture" scores nothing while a
// merchant selling both indoor and outdoor still scores on its indoor lines.
const NEGATIVE_CONTEXT = [
  "outdoor", "patio", "garden", "lawn", "deck", "poolside", "adirondack",
  "automotive", "auto ", "car ", "truck", "rv ", "marine", "boat",
  "industrial", "warehouse", "commercial kitchen", "restaurant supply",
  "playground", "pet ", "dog ", "cat ", "aquarium",
  "apparel", "clothing", "footwear", "jewelry", "cosmetic",
];

const REDACT = [];                                   // filled with secret values at load
const redact = (s) => REDACT.reduce((acc, v) => (v ? acc.split(v).join("[REDACTED]") : acc), String(s));
const say = (s = "") => console.log(redact(s));

// ---------------------------------------------------------------------------
// Relevance classification. Pure, deterministic, no network — which is what
// lets --self-test validate it against real recommendation text.
// ---------------------------------------------------------------------------
function classifyText(text) {
  const hay = ` ${String(text || "").toLowerCase().replace(/\s+/g, " ")} `;
  if (!hay.trim()) return { categories: [], score: 0, negatives: [] };
  const negatives = NEGATIVE_CONTEXT.filter((n) => hay.includes(n));
  const hits = [];
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      const at = hay.indexOf(kw);
      if (at === -1) continue;
      // Window the negative test around the match so a merchant that sells
      // "outdoor furniture" and "storage bins" is not disqualified wholesale.
      const window = hay.slice(Math.max(0, at - 40), at + kw.length + 25);
      const negated = NEGATIVE_CONTEXT.some((n) => window.includes(n));
      if (!negated) { hits.push({ id: cat.id, label: cat.label, weight: cat.weight, matched: kw }); break; }
    }
  }
  const score = hits.reduce((n, h) => n + h.weight, 0);
  return { categories: hits, score: Math.round(score * 10) / 10, negatives };
}

// A merchant is a CANDIDATE only on breadth, never on a single lucky keyword.
// One category hit is noise; the Awin screen's whole lesson was that a
// high-EPC merchant with one relevant product is worthless.
function tierFor(score, categoryCount) {
  if (categoryCount >= 4 && score >= 25) return "STRONG";
  if (categoryCount >= 2 && score >= 10) return "POSSIBLE";
  if (categoryCount >= 1) return "WEAK";
  return "IRRELEVANT";
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`\n  Missing credential file: ${ENV_FILE}`);
    console.error("  Create it with (no quotes, one per line):");
    console.error("    RAKUTEN_CLIENT_ID=...");
    console.error("    RAKUTEN_CLIENT_SECRET=...");
    console.error("    RAKUTEN_SID=...            # publisher/site id used as the token scope");
    console.error("  Optional overrides if your validated endpoints differ:");
    Object.keys(DEFAULTS).forEach((k) => console.error(`    ${k}=...`));
    console.error("\n  Then restrict it:");
    console.error(`    icacls "${ENV_FILE}" /inheritance:r /grant:r "%USERNAME%:R"\n`);
    process.exit(1);
  }
  const env = { ...DEFAULTS };
  fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  });
  ["RAKUTEN_CLIENT_ID", "RAKUTEN_CLIENT_SECRET", "RAKUTEN_SID"].forEach((k) => {
    if (!env[k]) { console.error(`  ${ENV_FILE} is missing ${k}`); process.exit(1); }
    REDACT.push(env[k]);
  });
  return env;
}

async function getToken(env) {
  const basic = Buffer.from(`${env.RAKUTEN_CLIENT_ID}:${env.RAKUTEN_CLIENT_SECRET}`).toString("base64");
  REDACT.push(basic);
  const r = await fetch(env.RAKUTEN_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: env.RAKUTEN_SID }),
  });
  const text = await r.text();
  if (r.status !== 200) {
    say(`  token request failed: HTTP ${r.status} ${text.slice(0, 200)}`);
    say("  If this is a 404, your validated token endpoint differs from the default -");
    say("  set RAKUTEN_TOKEN_URL in the env file rather than editing this script.");
    process.exit(1);
  }
  const j = JSON.parse(text);
  const tok = j.access_token || j.token;
  if (!tok) { say("  token response contained no access_token"); process.exit(1); }
  REDACT.push(tok);
  return tok;
}

// ---------------------------------------------------------------------------
// Tier 1 — partnerships + advertiser metadata
// ---------------------------------------------------------------------------
async function fetchAdvertisers(env, token) {
  const out = []; let page = 1;
  while (page <= 40) {
    const url = `${env.RAKUTEN_ADVERTISERS_URL}?page=${page}&limit=100`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (r.status === 404) { say(`  advertisers endpoint 404 at ${redact(url)} - set RAKUTEN_ADVERTISERS_URL`); process.exit(1); }
    if (r.status !== 200) { say(`  advertisers HTTP ${r.status} on page ${page}; stopping pagination`); break; }
    const j = await r.json().catch(() => null);
    if (!j) break;
    // Shape-tolerant: Rakuten has shipped several envelopes over time.
    const batch = j.advertisers || j.data || j.results || (Array.isArray(j) ? j : []);
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return out;
}

function normalizeAdvertiser(a) {
  const mid = a.mid || a.id || a.advertiser_id || a.merchant_id || null;
  const name = a.name || a.advertiser_name || a.merchant_name || "(unnamed)";
  const status = (a.partnership_status || a.status || a.relationship_status || "unknown");
  const cats = []
    .concat(a.categories || a.category || a.primary_category || [])
    .map((c) => (typeof c === "string" ? c : c?.name || c?.category || ""))
    .filter(Boolean);
  const desc = a.description || a.overview || "";
  return { mid, name, status: String(status).toLowerCase(), categories: cats, description: desc,
           text: [name, cats.join(" "), desc].join(" ") };
}

// ---------------------------------------------------------------------------
// PARTNERSHIP PORTFOLIO — /v1/partnerships
//
// The ONLY Rakuten surface that carries human-readable advertiser categories,
// and it carries them only for merchants we have already engaged. That is the
// entire reason this is a portfolio view and not a screen: it is a description
// of six merchants WE chose, not a sample of the network.
//
// Joined to /v2/advertisers on MID for capability flags. The join key is
// handed to us by the API itself — each partnership carries
// `advertiser.details: "/v2/advertisers/{mid}"`.
// ---------------------------------------------------------------------------
async function fetchPartnerships(env, token) {
  const base = env.RAKUTEN_ADVERTISERS_URL.replace(/\/v2\/advertisers.*$/, "");
  const out = []; let page = 1; let meta = null;
  while (page <= 20) {
    const r = await fetch(`${base}/v1/partnerships?page=${page}&limit=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (r.status !== 200) { if (page === 1) say(`  /v1/partnerships HTTP ${r.status}`); break; }
    const j = await r.json().catch(() => null);
    if (!j) break;
    meta = j._metadata || meta;
    const batch = j.partnerships || [];
    out.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return { partnerships: out, meta };
}

function renderPortfolio({ partnerships, meta }, advByMid) {
  say(`\n  ===== RAKUTEN PARTNERSHIP PORTFOLIO =====`);
  say(`  Source: /v1/partnerships${meta ? `  (${meta.api_name_version}, total ${meta.total})` : ""}`);
  say("");
  say("  *** SCOPE WARNING — read before quoting any of this ***");
  say("  These are merchants we have ALREADY ENGAGED. This view describes our own");
  say("  application portfolio. It is NOT a sample of Rakuten's network and is NOT");
  say("  evidence of Rakuten-wide category coverage. Rakuten exposes categories only");
  say("  after a partnership exists; the other ~2,150 advertisers have none exposed.");
  say("");

  if (!partnerships.length) { say("  no partnerships returned"); return; }

  const flag = (b) => (b === true ? "yes" : b === false ? "no " : " ? ");
  say(`  ${"MID".padEnd(8)}${"merchant".padEnd(24)}${"partnership".padEnd(14)}${"advertiser".padEnd(12)}${"feed".padEnd(6)}${"deep".padEnd(6)}${"US".padEnd(5)}categories`);
  say(`  ${"-".repeat(8)}${"-".repeat(24)}${"-".repeat(14)}${"-".repeat(12)}${"-".repeat(6)}${"-".repeat(6)}${"-".repeat(5)}${"-".repeat(10)}`);

  const statusCount = {};
  for (const p of partnerships) {
    const a = p.advertiser || {};
    const mid = a.id;
    const cap = advByMid.get(mid) || null;
    const f = cap?.features || {};
    const ships = cap?.policies?.international_capabilities?.ships_to || null;
    const cats = (a.categories || []).map((c) => String(c).trim()).filter(Boolean);
    statusCount[p.status] = (statusCount[p.status] || 0) + 1;
    say(`  ${String(mid).padEnd(8)}${String(a.name || "").slice(0, 22).padEnd(24)}${String(p.status || "?").padEnd(14)}${String(a.status || "?").padEnd(12)}${flag(f.product_feed).padEnd(6)}${flag(f.deep_links).padEnd(6)}${(ships ? (ships.includes("US") ? "yes" : "no ") : " ? ").padEnd(5)}${cats.join(", ")}`);
    if (!cap) say(`  ${" ".repeat(8)}(not present in /v2/advertisers — capability flags unavailable)`);
  }

  say("");
  say(`  partnership status: ${Object.entries(statusCount).map(([k, v]) => `${k}:${v}`).join("  ")}`);

  // Category vocabulary actually observed — useful, but only across OUR six.
  const vocab = {};
  partnerships.forEach((p) => (p.advertiser?.categories || []).forEach((c) => {
    const k = String(c).trim(); if (k) vocab[k] = (vocab[k] || 0) + 1; }));
  say(`\n  Rakuten category vocabulary observed across these partnerships:`);
  Object.entries(vocab).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => say(`    ${k.padEnd(28)}${v}`));
  say(`\n  These are RAKUTEN's advertiser categories, not the Uncluttrd product`);
  say(`  taxonomy. They describe a merchant's general sector, not whether its`);
  say(`  catalog contains the specific items Uncluttrd recommends. Establishing`);
  say(`  that still requires product-level evidence.`);
}

// ---------------------------------------------------------------------------
// Tier 2 — Product Search probes. INCONCLUSIVE on zero, never negative.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeAdvertiser(env, token, adv) {
  const perCategory = {};
  let total = 0, errors = 0;
  for (const cat of CATEGORIES) {
    const kw = cat.keywords[0];
    const url = `${env.RAKUTEN_PRODUCTSEARCH_URL}?keyword=${encodeURIComponent(kw)}&mid=${encodeURIComponent(adv.mid)}&max=1`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (r.status !== 200) { errors++; perCategory[cat.id] = null; await sleep(PROBE_DELAY_MS); continue; }
      const body = await r.text();
      // Rakuten Product Search has historically returned XML; tolerate both.
      let n = 0;
      const j = (() => { try { return JSON.parse(body); } catch { return null; } })();
      if (j) n = Number(j.total_matches ?? j.totalMatches ?? (j.items ? j.items.length : 0)) || 0;
      else { const m = body.match(/TotalMatches="(\d+)"/i) || body.match(/<TotalMatches>(\d+)</i); n = m ? Number(m[1]) : 0; }
      perCategory[cat.id] = n; total += n;
    } catch (e) { errors++; perCategory[cat.id] = null; }
    await sleep(PROBE_DELAY_MS);
  }
  return { perCategory, total, errors };
}

// ---------------------------------------------------------------------------
// Tier 3 — parse an SFTP directory listing the operator captured themselves.
// No SFTP connection is made here, by design: this tool must not grow into
// half an ingestion pipeline. Accepts `ls -l`-style lines.
// ---------------------------------------------------------------------------
function parseSftpListing(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(.+?)\s+(\S+)\s*$/);
    if (!m) continue;
    const [, size, when, name] = m;
    const mid = (name.match(/(\d{4,6})/) || [])[1] || null;
    const kind = /delta/i.test(name) ? (/template/i.test(name) ? "delta-template" : "delta")
              : /template/i.test(name) ? "template"
              : /categor/i.test(name) ? "category" : "full";
    rows.push({ file: name, bytes: Number(size), modified: when, mid, kind });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// --self-test: validate the taxonomy against REAL recommendation text before
// it is ever pointed at a merchant. The negative control is Highwood USA.
// ---------------------------------------------------------------------------
const FIXTURE = [
  // real Uncluttrd approach-format productType values (staging, 2026-08)
  ["countertop tray", "tray"], ["framed wall art", "wallart"], ["hand towel", "textiles"],
  ["tiered countertop organizer", "kitchen"], ["decorative bookends", "decor"],
  ["fabric storage bins or cubes", "storage"], ["cable management box or organizer", "cable"],
  ["floating shelf or niche shelf", "shelving"], ["small potted plant or succulent", "plants"],
  ["battery-powered LED accent lights", "lighting"], ["label maker or adhesive labels", "labels"],
  ["woven or wire baskets", "storage"], ["bar cabinet or liquor cabinet", "furniture"],
  ["drawer organizer or divided tray", "drawer"], ["lazy susan turntable", "kitchen"],
  ["decorative mirror", "wallart"], ["wine rack", "barware"], ["wall hook rail", "hooks"],
  // negative controls - the right words on the wrong products
  ["outdoor patio furniture set", null], ["adirondack deck chair", null],
  ["garden planter for the lawn", null], ["automotive floor mat", null],
];

function selfTest() {
  let pass = 0, fail = 0;
  say("  RELEVANCE TAXONOMY SELF-TEST (no credentials required)\n");
  for (const [text, expected] of FIXTURE) {
    const r = classifyText(text);
    const ids = r.categories.map((c) => c.id);
    const ok = expected === null ? ids.length === 0 : ids.includes(expected);
    ok ? pass++ : fail++;
    say(`    ${ok ? "PASS" : "FAIL"}  ${String(text).padEnd(38)} -> [${ids.join(", ") || "none"}]${expected === null ? "  (negative control)" : `  expected ${expected}`}`);
  }
  say(`\n    ${pass} passed, ${fail} failed`);
  say("\n  HIGHWOOD USA CONTROL — the merchant that validated mechanics, not coverage:");
  const hw = classifyText("Highwood USA - outdoor patio furniture, adirondack chairs, deck and garden furnishings for the lawn");
  say(`    categories: [${hw.categories.map((c) => c.id).join(", ") || "none"}]   score ${hw.score}   tier ${tierFor(hw.score, hw.categories.length)}`);
  say("    A merchant whose only signal is negated context must screen as IRRELEVANT,");
  say("    even though its catalog is large and its feed mechanics are perfect.");
  return fail === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const argv = process.argv.slice(2);
  const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : null; };
  const has = (k) => argv.includes(`--${k}`);

  if (has("self-test")) process.exit(selfTest());

  const sftpFile = arg("sftp-listing");
  const jsonOut = arg("json");
  const doProbe = has("probe");
  // Portfolio is the DEFAULT. The name screen is opt-in because its output is
  // not a decision input - see the deprecation notice on CATEGORIES.
  const nameScreen = has("name-screen");
  const portfolio = has("portfolio") || !nameScreen;

  say(`\nRAKUTEN — read-only   ${new Date().toISOString()}`);

  const env = loadEnv();
  const token = await getToken(env);
  say("  auth: OK (token acquired, redacted)");

  const raw = await fetchAdvertisers(env, token);
  const advByMid = new Map(raw.filter((a) => a && a.id != null).map((a) => [a.id, a]));
  say(`  /v2/advertisers: ${raw.length} advertisers visible (eligibility/capability metadata only — no categories)`);

  let portfolioData = null;
  if (portfolio) {
    portfolioData = await fetchPartnerships(env, token);
    renderPortfolio(portfolioData, advByMid);
    if (!nameScreen) {
      say(`\n  ===== WHY THERE IS NO NETWORK-WIDE SCREEN HERE =====`);
      say(`  Rakuten exposes no category, vertical, description or keyword field for`);
      say(`  the ${raw.length} discoverable advertisers. Category data appears only after a`);
      say(`  partnership exists. Network-wide, only eligibility/capability filters are`);
      say(`  available:`);
      const feed = raw.filter((a) => a?.features?.product_feed === true).length;
      const us = raw.filter((a) => a?.policies?.international_capabilities?.ships_to?.includes("US")).length;
      const both = raw.filter((a) => a?.features?.product_feed === true && a?.policies?.international_capabilities?.ships_to?.includes("US")).length;
      say(`    product_feed = true            : ${feed}`);
      say(`    ships to US                    : ${us}`);
      say(`    product_feed AND ships US      : ${both}`);
      say(`  Those are ELIGIBILITY filters, not relevance filters. Narrowing them`);
      say(`  further requires product-level evidence, which this tool does not gather.`);
      if (jsonOut) {
        fs.writeFileSync(jsonOut, JSON.stringify({
          capturedAt: new Date().toISOString(),
          scope: "PARTNERSHIP PORTFOLIO ONLY - not evidence of Rakuten-wide coverage",
          advertisersVisible: raw.length,
          eligibility: { productFeed: feed, shipsUS: us, both },
          partnerships: (portfolioData.partnerships || []).map((p) => ({
            mid: p.advertiser?.id, name: p.advertiser?.name,
            partnershipStatus: p.status, advertiserStatus: p.advertiser?.status,
            categories: (p.advertiser?.categories || []).map((c) => String(c).trim()),
            productFeed: advByMid.get(p.advertiser?.id)?.features?.product_feed ?? null,
            deepLinks: advByMid.get(p.advertiser?.id)?.features?.deep_links ?? null,
            shipsUS: advByMid.get(p.advertiser?.id)?.policies?.international_capabilities?.ships_to?.includes("US") ?? null,
            applyDatetime: p.apply_datetime, approveDatetime: p.approve_datetime,
          })),
        }, null, 1));
        say(`\n  wrote ${jsonOut}`);
      }
      say("");
      return;
    }
  }

  // ---- DEPRECATED PATH BELOW ----
  say(`\n  ${"!".repeat(74)}`);
  say(`  DEPRECATED: merchant-name relevance classification.`);
  say(`  /v2/advertisers has no description and no category for any of the ${raw.length}`);
  say(`  records, so this classifies MERCHANT NAMES (mean ~13 chars). It measures`);
  say(`  naming conventions, not inventory. Six Cordis HOTELS matched "cord" ->`);
  say(`  cable management. Wayfair, Target and The Container Store would all score`);
  say(`  zero, exactly as Highwood USA did. NOT a decision input.`);
  say(`  ${"!".repeat(74)}\n`);
  const advs = raw.map(normalizeAdvertiser).filter((a) => a.mid);
  say(`  advertisers visible to this account: ${advs.length}`);

  const scored = advs.map((a) => {
    const c = classifyText(a.text);
    return { ...a, relevance: c, tier: tierFor(c.score, c.categories.length) };
  }).sort((x, y) => y.relevance.score - x.relevance.score);

  const byTier = { STRONG: [], POSSIBLE: [], WEAK: [], IRRELEVANT: [] };
  scored.forEach((s) => byTier[s.tier].push(s));
  const byStatus = {};
  scored.forEach((s) => { byStatus[s.status] = (byStatus[s.status] || 0) + 1; });

  say(`  partnership status: ${Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  say(`\n  RELEVANCE TIERS (metadata-based, Tier 1)`);
  say(`    STRONG     ${String(byTier.STRONG.length).padStart(4)}   >=4 categories and score >=25`);
  say(`    POSSIBLE   ${String(byTier.POSSIBLE.length).padStart(4)}   >=2 categories and score >=10`);
  say(`    WEAK       ${String(byTier.WEAK.length).padStart(4)}   1 category`);
  say(`    IRRELEVANT ${String(byTier.IRRELEVANT.length).padStart(4)}   no category signal`);

  const candidates = [...byTier.STRONG, ...byTier.POSSIBLE];
  say(`\n  CANDIDATES (${candidates.length})`);
  say(`  ${"MID".padEnd(8)}${"status".padEnd(12)}${"tier".padEnd(10)}${"score".padStart(6)}  ${"cats".padStart(4)}  name / matched categories`);
  candidates.slice(0, 60).forEach((c) => {
    say(`  ${String(c.mid).padEnd(8)}${c.status.slice(0, 11).padEnd(12)}${c.tier.padEnd(10)}${String(c.relevance.score).padStart(6)}  ${String(c.relevance.categories.length).padStart(4)}  ${c.name.slice(0, 34)}`);
    say(`  ${" ".repeat(40)}${c.relevance.categories.map((x) => x.id).join(", ")}`);
  });
  if (!candidates.length) {
    say("    none. Metadata alone shows no home-organization depth on this account.");
    say("    That is a RESULT, not a failure - it is the Awin outcome repeating (5 of 974).");
  }

  // ---- Tier 2 ----
  let probes = null;
  if (doProbe && candidates.length) {
    const targets = candidates.slice(0, PROBE_MAX_ADVERTISERS);
    say(`\n  PRODUCT SEARCH PROBE — ${targets.length} advertiser(s) x ${CATEGORIES.length} categories`);
    say(`  Zero results are INCONCLUSIVE, not negative: Product Search returned 0 for`);
    say(`  Highwood USA (MID 50730) while its Product Catalog held 2,213 records.\n`);
    probes = [];
    for (const t of targets) {
      const p = await probeAdvertiser(env, token, t);
      const nonZero = Object.entries(p.perCategory).filter(([, v]) => v > 0);
      probes.push({ mid: t.mid, name: t.name, ...p });
      say(`    ${String(t.mid).padEnd(8)} ${t.name.slice(0, 30).padEnd(32)} matches=${String(p.total).padStart(6)}  categories>0=${String(nonZero.length).padStart(2)}  errors=${p.errors}`);
      if (p.total === 0) say(`    ${" ".repeat(8)} INCONCLUSIVE - probe found nothing; catalog may still be populated`);
      else say(`    ${" ".repeat(8)} ${nonZero.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join("  ")}`);
    }
  } else if (doProbe) {
    say("\n  --probe requested but there are no candidates to probe.");
  }

  // ---- Tier 3 ----
  let sftp = null;
  if (sftpFile) {
    if (!fs.existsSync(sftpFile)) { say(`\n  --sftp-listing file not found: ${sftpFile}`); }
    else {
      sftp = parseSftpListing(sftpFile);
      const byKind = {}; sftp.forEach((r) => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
      say(`\n  SFTP CATALOG LISTING (parsed, nothing downloaded) — ${sftp.length} file(s)`);
      say(`    file kinds: ${Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join("  ")}`);
      sftp.sort((a, b) => b.bytes - a.bytes).slice(0, 25).forEach((r) => {
        say(`    ${String(r.mid || "?").padEnd(8)}${r.kind.padEnd(16)}${(r.bytes / 1048576).toFixed(1).padStart(8)} MB   ${r.modified}   ${r.file.slice(0, 46)}`);
      });
      say(`\n    Byte size is a proxy for RECORD count, and records are VARIANT ROWS.`);
      say(`    Awin's King Koil feed was 29 rows = 1 distinct product. Never quote a`);
      say(`    record count as a product count without a distinct-product rollup.`);
    }
  }

  say(`\n  WHAT THIS DOES AND DOES NOT ESTABLISH`);
  say(`    Establishes : which advertisers are worth a partnership application,`);
  say(`                  and which are large-but-irrelevant (the Highwood pattern).`);
  say(`    Does NOT    : distinct-product counts, field population, rankability, or`);
  say(`                  whether a catalog can actually answer a real recommendation.`);
  say(`                  Those require ingestion, which is deliberately not built.`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({
      capturedAt: new Date().toISOString(),
      taxonomy: CATEGORIES.map(({ id, label, weight }) => ({ id, label, weight })),
      counts: { advertisers: advs.length, strong: byTier.STRONG.length, possible: byTier.POSSIBLE.length,
                weak: byTier.WEAK.length, irrelevant: byTier.IRRELEVANT.length },
      advertisers: scored.map((s) => ({ mid: s.mid, name: s.name, status: s.status, tier: s.tier,
        score: s.relevance.score, categories: s.relevance.categories.map((c) => c.id) })),
      probes, sftp,
    }, null, 1));
    say(`\n  wrote ${jsonOut}`);
  }
  say("");
})();
