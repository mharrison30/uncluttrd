/**
 * Production deep-link configuration: universal links (iOS) and App Links
 * (Android), asserted against the REAL app.config.js evaluation.
 *
 *   node --test scripts/deepLinkConfig.test.js
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 *
 * They prove that app.config.js, evaluated for a given APP_ENV, resolves to a
 * configuration that claims uncluttrd.app for production and does not claim it
 * for staging. That is the whole of it.
 *
 * They do NOT prove that any signed binary contains the generated entitlement.
 * Expo turns this configuration into native entitlements at prebuild time, so
 * an .ipa only carries `applinks:uncluttrd.app` if the commit it was built from
 * already had this configuration. Current HEAD having it says nothing about a
 * binary built earlier.
 *
 * THE CONCRETE EXAMPLE, worth keeping in front of whoever reads this next.
 * iOS production build 43 was created 2026-09-17T00:15:08Z from commit
 * 6dc4707. That commit contained no associatedDomains at all: the capability
 * arrived eight hours later in 9fe3d5b, and the website's
 * apple-app-site-association went live in the same minute. Grepping build 43's
 * own Xcode log for `associated-domains` and `applinks` returns zero hits, and
 * its entitlements read
 * `application-identifier = D372SHAVT3.com.mharrison.uncluttrd`. So the AASA is
 * correct, Apple's CDN serves it byte-identically, the configuration here is
 * correct, and universal links still do not work, because no binary carrying
 * the entitlement has ever been built. These tests would have passed at HEAD
 * throughout and would not have caught it.
 *
 * TWO DISTINCT FAILURES, deliberately not conflated:
 *
 *   1. BUILT-INVALID. The build was already wrong for its stated purpose at
 *      its own commit. Build 43 is this case: 6dc4707 simply did not contain
 *      the capability, so no comparison against anything later is needed to
 *      see the problem. A purpose-specific preflight - "resolve the config for
 *      this commit and confirm it declares what this build is for" - catches
 *      it before the build is paid for. Nothing about a future commit is
 *      involved, and nothing about a future commit could have been, because
 *      9fe3d5b did not exist yet.
 *
 *   2. BECAME-STALE. The build was valid when made, and a later commit changed
 *      native configuration so that the artifact no longer represents the
 *      branch. This is only detectable after the fact, by comparing the built
 *      commit against the approved head at the moment of submission.
 *
 * See "Uncluttrd Core Documents/BuildFreshnessGate.md" for the checks these
 * two cases require.
 *
 * No emulator, no network, no credentials. The live association files are
 * checked separately and opt-in by scripts/liveAssociation.test.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "app.config.js");
const SRC = fs.readFileSync(CONFIG_PATH, "utf8").replace(/\r\n/g, "\n");

const DOMAIN = "uncluttrd.app";
const APPLINK = `applinks:${DOMAIN}`;
const PROD_ID = "com.mharrison.uncluttrd";
const STAGING_ID = "com.mharrison.uncluttrd.staging";

/**
 * Evaluates the real app.config.js for one APP_ENV.
 *
 * Compiled into a fresh module rather than require()d, for two reasons:
 * app.config.js reads process.env.APP_ENV at module scope, so the require
 * cache would hand back whichever environment was resolved first; and the
 * mutation proofs need an edited copy that never touches the repository.
 *
 * The fields asserted below (ios.bundleIdentifier, ios.associatedDomains,
 * android.package, android.intentFilters) are plain literals in this file, so
 * the module export is their source. Checked once against
 * `APP_ENV=... npx expo config --type public --json`, which resolved the same
 * values.
 */
function resolveConfig(appEnv, { transform = (s) => s, tag = "" } = {}) {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = appEnv;
  try {
    const filename = tag ? path.join(ROOT, `app.config.${tag}.js`) : CONFIG_PATH;
    const m = new Module(filename, null);
    m.filename = filename;
    m.paths = Module._nodeModulePaths(ROOT);
    m._compile(transform(SRC), filename);
    // app.config.js exports { expo: {...} }; the resolved config is that inner
    // object, which is what `expo config --type public --json` also reports.
    const exported = m.exports && m.exports.expo ? m.exports.expo : m.exports;
    assert.ok(exported && exported.ios && exported.android,
      "app.config.js did not resolve to a config with ios and android sections");
    return exported;
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
}

const httpsFilterFor = (cfg, host) =>
  (cfg.android && cfg.android.intentFilters ? cfg.android.intentFilters : [])
    .filter((f) => f && f.action === "VIEW")
    .find((f) => (f.data || []).some((d) => d && d.scheme === "https" && d.host === host));

// ---- production ----------------------------------------------------------

test("production resolves the production iOS bundle identifier", () => {
  assert.equal(resolveConfig("production").ios.bundleIdentifier, PROD_ID);
});

test("production claims uncluttrd.app for iOS universal links", () => {
  const domains = resolveConfig("production").ios.associatedDomains;
  assert.ok(Array.isArray(domains), "associatedDomains must be present on production");
  assert.deepEqual(domains, [APPLINK], "production must claim exactly applinks:uncluttrd.app");
});

test("production resolves the production Android package", () => {
  assert.equal(resolveConfig("production").android.package, PROD_ID);
});

test("production declares a verified HTTPS App Link intent filter for uncluttrd.app", () => {
  const filter = httpsFilterFor(resolveConfig("production"), DOMAIN);
  assert.ok(filter, "production must declare a VIEW intent filter for https://uncluttrd.app");
  assert.equal(filter.autoVerify, true, "autoVerify must be true or Android never checks assetlinks.json");
  for (const c of ["BROWSABLE", "DEFAULT"]) {
    assert.ok((filter.category || []).includes(c), `intent filter must include the ${c} category`);
  }
});

// ---- staging, asserted as explicit ABSENCE --------------------------------
//
// Staging must never claim the production domain. A device with both builds
// installed would otherwise have two apps competing for the same link, and the
// staging app could swallow a production universal link.

test("staging resolves the staging bundle identifier and package", () => {
  const cfg = resolveConfig("staging");
  assert.equal(cfg.ios.bundleIdentifier, STAGING_ID);
  assert.equal(cfg.android.package, STAGING_ID);
});

test("staging declares NO associatedDomains claiming uncluttrd.app", () => {
  const domains = resolveConfig("staging").ios.associatedDomains;
  assert.equal(Object.prototype.hasOwnProperty.call(resolveConfig("staging").ios, "associatedDomains"), false,
    "staging must not carry an associatedDomains key at all");
  assert.equal(domains, undefined);
});

test("staging declares NO Android intent filter claiming uncluttrd.app", () => {
  const cfg = resolveConfig("staging");
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.android, "intentFilters"), false,
    "staging must not carry an intentFilters key at all");
  assert.equal(httpsFilterFor(cfg, DOMAIN), undefined);
});

test("the two environments never share an identifier", () => {
  const p = resolveConfig("production");
  const s = resolveConfig("staging");
  assert.notEqual(p.ios.bundleIdentifier, s.ios.bundleIdentifier);
  assert.notEqual(p.android.package, s.android.package);
  assert.equal(p.scheme === s.scheme, false, "the custom schemes must differ too");
});

// ---- mutation proofs -----------------------------------------------------
//
// Each edits a copy of the source IN MEMORY, compiled at a filename that is
// never written. The repository file is untouched, so there is nothing to
// restore afterwards.

const mutate = (from, to) => (src) => {
  assert.ok(src.includes(from), `mutation target is gone from app.config.js, so this proof proves nothing: ${from}`);
  return src.split(from).join(to);
};

const ASSOC_GATE = '...(IS_PRODUCTION ? { associatedDomains: ["applinks:uncluttrd.app"] } : {}),';
const ANDROID_GATE = "...(IS_PRODUCTION ? {\n        intentFilters: [";

test("MUTATION: removing the production associated-domain gate fails the production claim", () => {
  const cfg = resolveConfig("production", { transform: mutate(ASSOC_GATE, "...({}),"), tag: "__no_applinks__" });
  assert.equal(cfg.ios.associatedDomains, undefined, "the mutant no longer claims the domain");
  assert.throws(
    () => assert.deepEqual(cfg.ios.associatedDomains, [APPLINK]),
    "the production assertion must fail once the gate is removed",
  );
});

test("MUTATION: removing the production intent filter fails the App Link claim", () => {
  const cfg = resolveConfig("production", { transform: mutate(ANDROID_GATE, "...(false ? {\n        intentFilters: ["), tag: "__no_intent__" });
  assert.equal(httpsFilterFor(cfg, DOMAIN), undefined, "the mutant no longer declares the filter");
});

test("MUTATION: applying the production native-link config to staging fails the absence assertions", () => {
  // Ungate both, so staging resolves exactly what production would.
  const ungate = (src) => mutate(ANDROID_GATE, "...(true ? {\n        intentFilters: [")(
    mutate(ASSOC_GATE, '...({ associatedDomains: ["applinks:uncluttrd.app"] }),')(src),
  );
  const cfg = resolveConfig("staging", { transform: ungate, tag: "__staging_claims__" });

  assert.deepEqual(cfg.ios.associatedDomains, [APPLINK], "the mutant staging config now claims the production domain");
  assert.ok(httpsFilterFor(cfg, DOMAIN), "and declares the production App Link filter");

  // Which is precisely what the absence assertions above exist to reject.
  assert.throws(
    () => assert.equal(Object.prototype.hasOwnProperty.call(cfg.ios, "associatedDomains"), false),
    "the staging associatedDomains absence assertion must fail",
  );
  assert.throws(
    () => assert.equal(Object.prototype.hasOwnProperty.call(cfg.android, "intentFilters"), false),
    "the staging intentFilters absence assertion must fail",
  );
});

test("the mutation proofs left no file behind in the repository", () => {
  for (const tag of ["__no_applinks__", "__no_intent__", "__staging_claims__"]) {
    assert.equal(fs.existsSync(path.join(ROOT, `app.config.${tag}.js`)), false);
  }
  // And app.config.js itself is byte-for-byte what was read at load.
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8").replace(/\r\n/g, "\n"), SRC);
});
