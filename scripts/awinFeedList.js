#!/usr/bin/env node
/**
 * Awin feed-list BD tool — Product Intelligence v1, Phase 1b.
 *
 * A CATALOG-SIZING tool, not a production feature and not a Cloud Function.
 * It answers one question before we spend an approval on an advertiser:
 * "does this advertiser actually have a catalog worth having?"
 *
 * Why this exists at all: the Awin feed list returns product counts and
 * import timestamps for EVERY feed visible to the account — including the
 * ones we have not joined. That means breadth and freshness are measurable
 * before applying, which is exactly the evidence AwinMosaicFeedComparison.md
 * concluded was missing. It is one request and it costs nothing.
 *
 * STRICTLY READ-ONLY. One HTTP GET, well inside Awin's documented 5
 * requests/minute publisher limit. No Awin tracking link is ever fetched —
 * doing so would register a real affiliate click.
 *
 * The datafeed API key is read from an env file OUTSIDE the repository and
 * is redacted from every line of output. It is never printed, never written
 * to an artifact, and never passed as an argv.
 *
 * Usage:
 *   node scripts/awinFeedList.js                    # full summary
 *   node scripts/awinFeedList.js --filter mosaic    # name or advertiser-ID filter
 *   node scripts/awinFeedList.js --region US --min-products 1000
 *   node scripts/awinFeedList.js --json out.json    # machine-readable dump
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ENV_FILE = path.join(os.homedir(), ".uncluttrd-awin.env");
const ENDPOINT = "https://productdata.awin.com/datafeed/list/apikey/";

function loadKey() {
  let raw;
  try {
    raw = fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    console.error(
      `Missing ${ENV_FILE}\n\n` +
      `Create it (outside the repo — it must never be committed) with:\n` +
      `  AWIN_DATAFEED_APIKEY=<your Create-a-Feed datafeed key>\n` +
      `  AWIN_PUBLISHER_ID=<your Awin publisher id>\n`
    );
    process.exit(1);
  }
  const key = ((raw.match(/AWIN_DATAFEED_APIKEY=(.*)/) || [])[1] || "").trim();
  if (!key) {
    console.error(`AWIN_DATAFEED_APIKEY is not set in ${ENV_FILE}`);
    process.exit(1);
  }
  return key;
}

// RFC4180 parser. Awin quotes feed names that contain commas.
function parseCSV(s) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
// Awin returns "YYYY-MM-DD HH:MM:SS" with no timezone suffix, and the values
// are UTC (verified: a feed imported at 23:03:11 appeared while UTC was
// 23:0x). Date.parse would otherwise read them as local time and produce
// negative ages for feeds imported within the last few hours.
const daysSince = (stamp, now) => {
  if (!stamp || !String(stamp).trim()) return null;
  const t = Date.parse(String(stamp).trim().replace(" ", "T") + "Z");
  return isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86400000));
};

(async () => {
  const KEY = loadKey();
  const redact = (s) => String(s).split(KEY).join("<REDACTED_KEY>");
  const filter = arg("--filter");
  const region = arg("--region");
  const minProducts = parseInt(arg("--min-products", "0"), 10) || 0;
  const jsonOut = arg("--json");

  console.log(`Awin feed list  (key len=${KEY.length}, ends …${KEY.slice(-4)} — value never printed)`);

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(ENDPOINT + KEY, { headers: { "User-Agent": "uncluttrd-bd-tool/1" } });
  } catch (e) {
    console.error(`Request failed: ${redact(e.message)}`);
    process.exit(1);
  }
  const body = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.error(`HTTP ${res.status} in ${ms}ms — ${redact(body).replace(/\s+/g, " ").slice(0, 200)}`);
    if (res.status === 403) console.error(`\n403 usually means the datafeed key is wrong or disabled. Note it is a DIFFERENT key from the Publisher API token.`);
    process.exit(1);
  }

  const rows = parseCSV(body.replace(/^﻿/, ""));
  const header = rows[0].map((h) => h.trim());
  const data = rows.slice(1).filter((r) => r.length > 1 && r.some((v) => v !== ""));
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const I = {
    advId: col("Advertiser ID"), advName: col("Advertiser Name"), region: col("Primary Region"),
    membership: col("Membership Status"), feedId: col("Feed ID"), feedName: col("Feed Name"),
    language: col("Language"), vertical: col("Vertical"), imported: col("Last Imported"),
    checked: col("Last Checked"), count: col("No of products"),
  };
  const NOW = Date.now();
  const feeds = data.map((r) => ({
    feedId: r[I.feedId], advertiserId: r[I.advId], advertiserName: r[I.advName],
    feedName: r[I.feedName], region: r[I.region], membership: r[I.membership],
    language: r[I.language],
    // Awin leaves Vertical blank for most US advertisers, so it is reported
    // as "(unclassified)" rather than silently dropped — an empty sector
    // column is a real property of the data, not a parsing failure.
    sector: (r[I.vertical] || "").trim() || "(unclassified)",
    lastImported: r[I.imported], lastChecked: r[I.checked],
    products: parseInt(r[I.count], 10) || 0,
    ageDays: daysSince(r[I.imported], NOW),
  }));

  console.log(`HTTP ${res.status} in ${ms}ms — ${feeds.length} feeds, ${body.length} bytes\n`);

  // ---- filtered view -------------------------------------------------------
  let view = feeds;
  if (region) view = view.filter((f) => (f.region || "").toUpperCase() === region.toUpperCase());
  if (minProducts) view = view.filter((f) => f.products >= minProducts);
  if (filter) {
    const re = new RegExp(filter, "i");
    view = view.filter((f) => re.test(f.advertiserName) || re.test(f.advertiserId) || re.test(f.feedId) || re.test(f.feedName));
  }

  if (filter || region || minProducts) {
    console.log(`FILTER  ${[filter && `name/id ~ /${filter}/i`, region && `region=${region}`, minProducts && `products>=${minProducts}`].filter(Boolean).join("  ")}`);
    console.log(`MATCHED ${view.length} of ${feeds.length} feeds\n`);
  }

  // ---- summary -------------------------------------------------------------
  const byRegion = {};
  feeds.forEach((f) => { byRegion[f.region || "(none)"] = (byRegion[f.region || "(none)"] || 0) + 1; });
  const us = feeds.filter((f) => f.region === "US");
  console.log(`TOTALS`);
  console.log(`  all feeds : ${feeds.length}`);
  console.log(`  US feeds  : ${us.length}`);
  console.log(`  regions   : ${Object.entries(byRegion).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  const byMembership = {};
  feeds.forEach((f) => { byMembership[f.membership || "(none)"] = (byMembership[f.membership || "(none)"] || 0) + 1; });
  console.log(`  membership: ${Object.entries(byMembership).map(([k, v]) => `${k}:${v}`).join("  ")}`);

  const sectorOf = (list) => {
    const m = {};
    list.forEach((f) => { m[f.sector] = (m[f.sector] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  console.log(`\nBY SECTOR (US)`);
  sectorOf(us).slice(0, 12).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));

  const band = (list, lo, hi) => list.filter((f) => f.ageDays !== null && f.ageDays >= lo && f.ageDays < hi).length;
  console.log(`\nBY FRESHNESS (US, from Last Imported)`);
  console.log(`  within 7 days   : ${band(us, 0, 7)}`);
  console.log(`  7-30 days       : ${band(us, 7, 30)}`);
  console.log(`  30-90 days      : ${band(us, 30, 90)}`);
  console.log(`  90+ days        : ${us.filter((f) => f.ageDays !== null && f.ageDays >= 90).length}`);
  console.log(`  never imported  : ${us.filter((f) => f.ageDays === null).length}`);

  const totalUsProducts = us.reduce((s, f) => s + f.products, 0);
  console.log(`\nPRODUCT COUNTS (US)`);
  console.log(`  total products visible : ${totalUsProducts.toLocaleString()}`);
  console.log(`  feeds >= 1,000         : ${us.filter((f) => f.products >= 1000).length}`);
  console.log(`  feeds >= 5,000         : ${us.filter((f) => f.products >= 5000).length}`);
  console.log(`  large AND fresh (>=5k, <=7d) : ${us.filter((f) => f.products >= 5000 && f.ageDays !== null && f.ageDays <= 7).length}`);

  // ---- per-feed table ------------------------------------------------------
  const listing = (filter || region || minProducts ? view : us)
    .slice().sort((a, b) => b.products - a.products);
  const limit = filter ? listing.length : 30;
  console.log(`\nPER-FEED${filter || region || minProducts ? " (filtered)" : " (US, top 30 by product count)"}`);
  console.log(`  ${"feedId".padEnd(9)} ${"advertiser".padEnd(34)} ${"products".padStart(9)} ${"imported".padEnd(20)} ${"age".padStart(5)}  ${"membership".padEnd(11)} sector`);
  listing.slice(0, limit).forEach((f) => {
    console.log(`  ${String(f.feedId).padEnd(9)} ${String(f.advertiserName).slice(0, 32).padEnd(34)} ${String(f.products).padStart(9)} ${String(f.lastImported || "never").slice(0, 19).padEnd(20)} ${String(f.ageDays === null ? "-" : f.ageDays).padStart(5)}  ${String(f.membership).padEnd(11)} ${f.sector}`);
    if (filter) console.log(`  ${" ".repeat(9)} advertiserId=${f.advertiserId}  feed="${f.feedName}"  region=${f.region} lang=${f.language}`);
  });
  if (!filter && listing.length > limit) console.log(`  … ${listing.length - limit} more not shown (use --filter or --min-products to narrow)`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, redact(JSON.stringify(filter || region || minProducts ? view : feeds, null, 2)));
    console.log(`\nwrote ${jsonOut} (${(filter || region || minProducts ? view : feeds).length} feeds, key redacted)`);
  }

  console.log(`\nBD READ: a feed is worth applying for when it is US, has a real product count,`);
  console.log(`and shows a recent Last Imported. A large but 90-day-stale feed is the CJ failure`);
  console.log(`mode — live-looking metadata over a catalog nobody is maintaining.`);
})();
