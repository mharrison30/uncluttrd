/**
 * Live domain-association checks for uncluttrd.app. OPT-IN, because these make
 * real network requests and the ordinary offline suite must never depend on
 * connectivity.
 *
 *   RUN_LIVE_ASSOCIATION_TESTS=1 node --test scripts/liveAssociation.test.js
 *
 * Without the flag the suite skips immediately, before any request is made.
 *
 * WHAT THIS PROVES: that the two association files are served correctly, that
 * Apple has fetched and cached the iOS one, and that Google can parse the
 * Android one. It is the server half of universal links and App Links.
 *
 * WHAT IT DOES NOT PROVE: that any installed binary carries the matching
 * entitlement. Both halves have to be right, and in September 2026 this half
 * was already right while no production binary had ever been built with the
 * capability - see scripts/deepLinkConfig.test.js for that story, and
 * "Uncluttrd Core Documents/BuildFreshnessGate.md" for the checks that catch it.
 *
 * ANDROID FINGERPRINT, stated plainly: the sha256_cert_fingerprints value in
 * assetlinks.json must be the certificate Google Play signs the app with. When
 * Play App Signing is enabled that key lives only in Play Console, and it is
 * not the upload key EAS builds with. Nothing readable from this repository,
 * from EAS build metadata, or from the signed Gradle log exposes it - the
 * production Android build log contains no SHA-256 fingerprint at all. So
 * these tests assert the file's structure, its package name, its relation and
 * the fingerprint's FORM, and cross-check that Google parses the same values
 * back. They deliberately do NOT assert that the fingerprint is the right key.
 * Confirming that requires opening Play Console > Setup > App signing, which
 * cannot be done read-only from here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ENABLED = process.env.RUN_LIVE_ASSOCIATION_TESTS === "1";

const AASA_URL = "https://uncluttrd.app/.well-known/apple-app-site-association";
const CDN_URL = "https://app-site-association.cdn-apple.com/a/v1/uncluttrd.app";
const ASSETLINKS_URL = "https://uncluttrd.app/.well-known/assetlinks.json";
const DAL_URL = "https://digitalassetlinks.googleapis.com/v1/statements:list"
  + "?source.web.site=https://uncluttrd.app&relation=delegate_permission%2Fcommon.handle_all_urls";

// The exact URL the welcome email's button points at.
const WELCOME_URL = "https://uncluttrd.app/?utm_source=email&utm_medium=welcome&utm_campaign=onboarding";
// Verified from build 43's own signed entitlements
// (application-identifier = D372SHAVT3.com.mharrison.uncluttrd), not from the
// association file this suite is checking.
const EXPECTED_APP_ID = "D372SHAVT3.com.mharrison.uncluttrd";
const RELATION = "delegate_permission/common.handle_all_urls";

if (!ENABLED) {
  test("live association checks are opt-in and were skipped", (t) => {
    t.skip("set RUN_LIVE_ASSOCIATION_TESTS=1 to run these; they make real network requests to uncluttrd.app, Apple and Google");
  });
} else {
  // The production Android package, resolved from the real app.config.js, so
  // assetlinks.json is checked against the configuration rather than a literal.
  const ROOT = path.join(__dirname, "..");
  const productionPackage = (() => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      const f = path.join(ROOT, "app.config.js");
      const m = new Module(f, null);
      m.filename = f;
      m.paths = Module._nodeModulePaths(ROOT);
      m._compile(fs.readFileSync(f, "utf8"), f);
      const cfg = m.exports.expo || m.exports;
      return cfg.android.package;
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  })();

  const fetched = {};
  const get = async (key, url) => {
    if (!fetched[key]) {
      const res = await fetch(url, { redirect: "follow" });
      fetched[key] = { res, url: res.url, body: await res.text() };
    }
    return fetched[key];
  };

  // ---- Apple: the site's own file --------------------------------------

  test("AASA is served over HTTPS with no redirect", async () => {
    const r = await get("aasa", AASA_URL);
    assert.equal(r.res.status, 200);
    assert.equal(r.url, AASA_URL, "a redirect would change the URL Apple fetched, and Apple does not follow them");
    assert.ok(r.url.startsWith("https://"));
  });

  test("AASA declares a JSON-compatible content type", async () => {
    const ct = (await get("aasa", AASA_URL)).res.headers.get("content-type") || "";
    assert.match(ct, /application\/json|text\/json/i, `content-type was ${ct}`);
  });

  test("AASA is valid JSON and names the exact production appID", async () => {
    const j = JSON.parse((await get("aasa", AASA_URL)).body);
    assert.ok(j.applinks, "missing applinks section");
    assert.equal(j.applinks.details.length, 1);
    assert.equal(j.applinks.details[0].appID, EXPECTED_APP_ID);
  });

  test("AASA allows the welcome email's URL", async () => {
    const d = JSON.parse((await get("aasa", AASA_URL)).body).applinks.details[0];
    // The legacy `paths` form matches on the PATH only: query parameters take
    // no part in the decision, so the UTM tags are irrelevant here.
    const pathOnly = new URL(WELCOME_URL).pathname;
    assert.equal(pathOnly, "/");
    if (Array.isArray(d.paths)) {
      const allows = d.paths.some((p) => p === "*" || p === "/" || p === "/*");
      assert.ok(allows, `paths ${JSON.stringify(d.paths)} does not allow the root URL`);
    } else if (Array.isArray(d.components)) {
      const allows = d.components.some((c) => !c.exclude && (c["/"] === undefined || c["/"] === "/" || c["/"] === "*"));
      assert.ok(allows, `components ${JSON.stringify(d.components)} does not allow the root URL`);
    } else {
      assert.fail("details entry has neither paths nor components");
    }
  });

  // ---- Apple: the CDN copy devices actually read ------------------------

  test("Apple's CDN serves the association and it matches the site", async () => {
    const cdn = await get("cdn", CDN_URL);
    assert.equal(cdn.res.status, 200, "Apple has not cached an association for this domain");
    const site = await get("aasa", AASA_URL);
    assert.deepEqual(JSON.parse(cdn.body), JSON.parse(site.body),
      "Apple is serving a stale or different association from the live site");
  });

  // ---- Android ----------------------------------------------------------

  test("assetlinks.json is served over HTTPS with a JSON-compatible content type", async () => {
    const r = await get("al", ASSETLINKS_URL);
    assert.equal(r.res.status, 200);
    assert.equal(r.url, ASSETLINKS_URL);
    assert.match(r.res.headers.get("content-type") || "", /application\/json|text\/json/i);
  });

  test("assetlinks.json authorizes the resolved production package for app-link handling", async () => {
    const j = JSON.parse((await get("al", ASSETLINKS_URL)).body);
    assert.ok(Array.isArray(j) && j.length >= 1, "assetlinks.json must be a non-empty array");
    const entry = j.find((s) => s.target && s.target.package_name === productionPackage);
    assert.ok(entry, `no statement targets the resolved production package ${productionPackage}`);
    assert.equal(entry.target.namespace, "android_app");
    assert.ok((entry.relation || []).includes(RELATION), `relation must include ${RELATION}`);
  });

  test("assetlinks.json carries a well-formed SHA-256 fingerprint (value NOT verified)", async () => {
    const j = JSON.parse((await get("al", ASSETLINKS_URL)).body);
    const entry = j.find((s) => s.target && s.target.package_name === productionPackage);
    const prints = entry.target.sha256_cert_fingerprints || [];
    assert.ok(prints.length >= 1, "at least one fingerprint must be declared");
    for (const p of prints) {
      assert.match(p, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/,
        `fingerprint is not 32 colon-separated uppercase hex bytes: ${p}`);
    }
    // Deliberately no assertion that this is the Play App Signing certificate.
    // See the header: that key is only visible in Play Console.
  });

  test("Google parses the same package and fingerprint back from the live file", async () => {
    const dal = await get("dal", DAL_URL);
    assert.equal(dal.res.status, 200);
    const j = JSON.parse(dal.body);
    assert.ok(Array.isArray(j.statements) && j.statements.length >= 1,
      "Google returned no statements, which means it could not parse or reach the file");
    const local = JSON.parse((await get("al", ASSETLINKS_URL)).body)
      .find((s) => s.target && s.target.package_name === productionPackage);
    const remote = j.statements.find((s) => s.target && s.target.androidApp
      && s.target.androidApp.packageName === productionPackage);
    assert.ok(remote, `Google did not report a statement for ${productionPackage}`);
    assert.equal(remote.relation, RELATION);
    assert.equal(remote.target.androidApp.certificate.sha256Fingerprint, local.target.sha256_cert_fingerprints[0],
      "Google read a different fingerprint than the file serves");
  });
}
