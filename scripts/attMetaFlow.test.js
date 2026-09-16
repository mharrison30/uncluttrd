/**
 * ATT-first-launch and Meta initialisation.
 *
 *   node --test scripts/attMetaFlow.test.js
 *
 * Apple rejected iOS build 41 (submission 9c79a096) because the ATT prompt was
 * not visible on a fresh install, while the Meta SDK - auto-initialising
 * natively before JS ran - had already logged an install and read the IDFA.
 *
 * These tests run the REAL functions out of App.js in a scope that supplies
 * exactly the globals they use, with a fake react-native-fbsdk-next and a fake
 * expo-tracking-transparency, so every ordering claim is checked against the
 * shipping code rather than a description of it.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "App.js"), "utf8").replace(/\r\n/g, "\n");

// ---- harness ---------------------------------------------------------------

// The ATT/Meta block, minus the one JSX function in the middle (Modal, which is
// a pass-through wrapper and not part of this flow).
function extractFlowSource() {
  const start = SRC.indexOf("let metaStarted = false;");
  const end = SRC.indexOf("\n}", SRC.indexOf("async function resolveTrackingThenStartMeta()")) + 2;
  assert.ok(start > 0 && end > start, "ATT/Meta block located in App.js");
  const block = SRC.slice(start, end);
  const modalStart = block.indexOf("function Modal(props) {");
  const modalEnd = block.indexOf("\n}", modalStart) + 2;
  assert.ok(modalStart > 0, "Modal wrapper located");
  return block.slice(0, modalStart) + block.slice(modalEnd);
}
const FLOW_SRC = extractFlowSource();

/**
 * @param {object} opts
 *   production  - the IS_PRODUCTION value for this run
 *   os          - "ios" | "android"
 *   status      - initial ATT status, or null to make the tracking module absent
 *   requestTo   - status returned by requestTrackingPermissionsAsync
 *   appState    - "active" | "background"
 *   deferRequest- when true, the ATT request hangs until release() is called
 */
function makeApp(opts = {}) {
  const {
    production = true, os = "ios", status = "undetermined",
    requestTo = "granted", appState = "active", deferRequest = false,
  } = opts;

  const calls = [];
  const record = (name, value) => calls.push(value === undefined ? [name] : [name, value]);

  const Settings = {
    setAdvertiserTrackingEnabled: async (v) => { record("setAdvertiserTrackingEnabled", v); return true; },
    setAdvertiserIDCollectionEnabled: (v) => record("setAdvertiserIDCollectionEnabled", v),
    setAutoLogAppEventsEnabled: (v) => record("setAutoLogAppEventsEnabled", v),
    initializeSDK: () => record("initializeSDK"),
  };
  const AppEventsLogger = { logEvent: (name, params) => record("logEvent", name) };

  let releaseRequest;
  const requestGate = deferRequest ? new Promise((r) => { releaseRequest = r; }) : Promise.resolve();

  const tracking = {
    getTrackingPermissionsAsync: async () => { record("getTrackingPermissionsAsync"); return { status }; },
    requestTrackingPermissionsAsync: async () => {
      record("requestTrackingPermissionsAsync");
      await requestGate;
      return { status: requestTo };
    },
    getAdvertisingId: () => { throw new Error("getAdvertisingId must never be called"); },
  };

  const fakeRequire = (name) => {
    if (name === "react-native-fbsdk-next") {
      if (!production) throw new Error("staging must never require the Meta SDK");
      return { Settings, AppEventsLogger };
    }
    if (name === "expo-tracking-transparency") {
      if (status === null) throw new Error("tracking module unavailable");
      return tracking;
    }
    throw new Error(`unexpected require(${name})`);
  };

  const listeners = [];
  const AppState = {
    currentState: appState,
    addEventListener: (_evt, fn) => { listeners.push(fn); return { remove: () => {} } },
  };

  const names = ["IS_PRODUCTION", "Platform", "AppState", "require", "console"];
  const values = [
    production,
    { OS: os },
    AppState,
    fakeRequire,
    { log: () => {} },
  ];
  const api = new Function(...names, `${FLOW_SRC}\nreturn { startMetaOnce, logMetaEvent, resolveTrackingThenStartMeta, REQUESTS_ATT };`)(...values);

  return {
    ...api,
    calls,
    names: () => calls.map((c) => c[0]),
    releaseRequest: () => releaseRequest && releaseRequest(),
    goActive: () => { AppState.currentState = "active"; listeners.forEach((fn) => fn("active")); },
  };
}

const INIT_CALLS = ["setAdvertiserIDCollectionEnabled", "setAutoLogAppEventsEnabled", "initializeSDK"];

// ---- iOS production: the fresh-install path --------------------------------

test("iOS production, fresh install, notDetermined: the prompt is requested on this launch", async () => {
  const app = makeApp({ status: "undetermined", requestTo: "granted" });
  await app.resolveTrackingThenStartMeta();

  assert.deepEqual(app.names(), [
    "getTrackingPermissionsAsync",
    "requestTrackingPermissionsAsync",
    "setAdvertiserTrackingEnabled",
    ...INIT_CALLS,
  ]);
});

test("ATT authorized: advertiser tracking on, SDK initialised once", async () => {
  const app = makeApp({ status: "undetermined", requestTo: "granted" });
  await app.resolveTrackingThenStartMeta();

  assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserTrackingEnabled"), ["setAdvertiserTrackingEnabled", true]);
  assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserIDCollectionEnabled"), ["setAdvertiserIDCollectionEnabled", true]);
  assert.deepEqual(app.calls.find((c) => c[0] === "setAutoLogAppEventsEnabled"), ["setAutoLogAppEventsEnabled", true]);
  assert.equal(app.names().filter((n) => n === "initializeSDK").length, 1);
});

test("ATT denied: tracking off and no advertising identifier, but the SDK still initialises", async () => {
  const app = makeApp({ status: "undetermined", requestTo: "denied" });
  await app.resolveTrackingThenStartMeta();

  assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserTrackingEnabled"), ["setAdvertiserTrackingEnabled", false]);
  assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserIDCollectionEnabled"), ["setAdvertiserIDCollectionEnabled", false]);
  assert.ok(app.names().includes("initializeSDK"), "SKAdNetwork attribution needs the SDK running");
});

test("ATT restricted is treated as not authorized", async () => {
  // iOS reports .restricted through expo-tracking-transparency as "denied";
  // the literal "restricted" is checked too, so the rule stays "granted only".
  for (const restricted of ["denied", "restricted"]) {
    const app = makeApp({ status: "undetermined", requestTo: restricted });
    await app.resolveTrackingThenStartMeta();
    assert.deepEqual(
      app.calls.find((c) => c[0] === "setAdvertiserTrackingEnabled"),
      ["setAdvertiserTrackingEnabled", false],
      restricted,
    );
    assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserIDCollectionEnabled"), ["setAdvertiserIDCollectionEnabled", false]);
  }
});

test("already determined: the prompt is never shown again, and the system status decides", async () => {
  for (const [status, tracking] of [["granted", true], ["denied", false]]) {
    const app = makeApp({ status });
    await app.resolveTrackingThenStartMeta();

    assert.ok(!app.names().includes("requestTrackingPermissionsAsync"), `${status}: must not re-prompt`);
    assert.ok(app.names().includes("getTrackingPermissionsAsync"), `${status}: system status is read`);
    assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserTrackingEnabled"), ["setAdvertiserTrackingEnabled", tracking]);
    assert.equal(app.names().filter((n) => n === "initializeSDK").length, 1);
  }
});

// ---- ordering and idempotence ----------------------------------------------

test("Meta never initialises before ATT resolves", async () => {
  const app = makeApp({ status: "undetermined", deferRequest: true });
  const done = app.resolveTrackingThenStartMeta();
  await new Promise((r) => setImmediate(r));

  // The prompt is up and unanswered: nothing has touched the SDK.
  assert.deepEqual(app.names(), ["getTrackingPermissionsAsync", "requestTrackingPermissionsAsync"]);
  assert.ok(!app.names().includes("initializeSDK"));

  app.releaseRequest();
  await done;
  assert.ok(app.names().includes("initializeSDK"), "and it initialises once answered");
});

test("Meta initialises exactly once no matter how often the entry point is called", async () => {
  const app = makeApp({ status: "granted" });
  await Promise.all([
    app.resolveTrackingThenStartMeta(),
    app.resolveTrackingThenStartMeta(),
    app.resolveTrackingThenStartMeta(),
  ]);
  await app.resolveTrackingThenStartMeta();
  await app.startMetaOnce(true);

  assert.equal(app.names().filter((n) => n === "initializeSDK").length, 1);
  assert.equal(app.names().filter((n) => n === "getTrackingPermissionsAsync").length, 1);
});

test("both ATT answers continue to the same normal app flow", async () => {
  const results = [];
  for (const requestTo of ["granted", "denied"]) {
    const app = makeApp({ status: "undetermined", requestTo });
    results.push(await app.resolveTrackingThenStartMeta());
  }
  // Nothing is returned, nothing throws, nothing is gated: the caller is a
  // fire-and-forget line in onExited and the app renders either way.
  assert.deepEqual(results, [undefined, undefined]);
});

test("the prompt waits for the app to be active", async () => {
  const app = makeApp({ status: "undetermined", appState: "background" });
  const done = app.resolveTrackingThenStartMeta();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(app.names(), [], "nothing happens while backgrounded");

  app.goActive();
  await done;
  assert.ok(app.names().includes("requestTrackingPermissionsAsync"));
});

// ---- platform and environment matrix ---------------------------------------

test("Android production initialises Meta without ATT", async () => {
  const app = makeApp({ os: "android", status: "undetermined" });
  await app.resolveTrackingThenStartMeta();

  assert.equal(app.REQUESTS_ATT, false);
  assert.ok(!app.names().includes("getTrackingPermissionsAsync"), "no ATT on Android");
  assert.ok(!app.names().includes("requestTrackingPermissionsAsync"));
  // setAdvertiserTrackingEnabled is iOS-only in 13.4.3 and is skipped here.
  assert.deepEqual(app.names(), INIT_CALLS);
  assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserIDCollectionEnabled"), ["setAdvertiserIDCollectionEnabled", true]);
});

test("iOS staging requests no ATT and never initialises Meta", async () => {
  const app = makeApp({ production: false, os: "ios" });
  await app.resolveTrackingThenStartMeta();
  await app.startMetaOnce(true);
  assert.deepEqual(app.calls, []);
});

test("Android staging never initialises Meta", async () => {
  const app = makeApp({ production: false, os: "android" });
  await app.resolveTrackingThenStartMeta();
  await app.startMetaOnce(true);
  assert.deepEqual(app.calls, []);
});

test("a tracking module failure still leaves Meta running without tracking", async () => {
  const app = makeApp({ status: null });
  await app.resolveTrackingThenStartMeta();
  assert.deepEqual(app.calls.find((c) => c[0] === "setAdvertiserTrackingEnabled"), ["setAdvertiserTrackingEnabled", false]);
  assert.ok(app.names().includes("initializeSDK"));
});

// ---- event safety ----------------------------------------------------------

test("Meta events before initialisation cannot trigger tracking", async () => {
  const app = makeApp({ status: "undetermined", deferRequest: true });
  const done = app.resolveTrackingThenStartMeta();

  app.logMetaEvent("Purchase", { value: 2.99 });
  app.logMetaEvent("fb_mobile_activate_app");
  assert.ok(!app.names().includes("logEvent"), "no event may be sent before ATT resolves");
  assert.ok(!app.names().includes("initializeSDK"), "and an event must not initialise the SDK implicitly");

  app.releaseRequest();
  await done;
  app.logMetaEvent("Purchase", { value: 2.99 });
  assert.deepEqual(app.calls.filter((c) => c[0] === "logEvent"), [["logEvent", "Purchase"]]);
});

test("staging events are inert even after an init attempt", async () => {
  const app = makeApp({ production: false });
  await app.startMetaOnce(true);
  app.logMetaEvent("Purchase");
  assert.deepEqual(app.calls, []);
});

// ---- the old delayed flow is gone ------------------------------------------

test("the second-launch and after-first-plan ATT logic no longer exists", () => {
  for (const gone of [
    "requestTrackingPermissionWhenClear",
    "countProductionLaunchForTracking",
    "ATT_LAUNCH_COUNT_KEY",
    "attProductionLaunchCount",
    "productionLaunchNumber",
    "waitUntilNothingIsPresented",
    "visibleOverlays",
    "TRACKS_OVERLAYS",
    "appUpdateCheckSettled",
    "startMetaSdk",
  ]) {
    assert.ok(!SRC.includes(gone), `${gone} must be gone from App.js`);
  }
  // And the prompt is driven from the launch screen finishing.
  assert.match(SRC, /onExited=\{\(\) => \{[\s\S]{0,400}resolveTrackingThenStartMeta\(\);/);
});

test("Meta is only ever reached through the two sanctioned functions", () => {
  const requires = [...SRC.matchAll(/require\("react-native-fbsdk-next"\)/g)];
  assert.equal(requires.length, 2, "one in startMetaOnce, one in logMetaEvent");
  // No static import: a staging build must never evaluate the native modules.
  assert.ok(!/^import .*react-native-fbsdk-next/m.test(SRC));
});

// ---- generated native configuration ----------------------------------------

function productionExpoConfig() {
  const configPath = require.resolve(path.join(ROOT, "app.config.js"));
  delete require.cache[configPath];
  process.env.APP_ENV = "production";
  return require(configPath).expo;
}

function fbsdkProps(expoConfig) {
  const entry = expoConfig.plugins.find((p) => Array.isArray(p) && p[0] === "react-native-fbsdk-next");
  assert.ok(entry, "the Meta plugin is configured for production");
  return entry[1];
}

test("the production Meta plugin disables all three automatic behaviours", () => {
  const props = fbsdkProps(productionExpoConfig());
  assert.equal(props.isAutoInitEnabled, false);
  assert.equal(props.autoLogAppEventsEnabled, false);
  assert.equal(props.advertiserIDCollectionEnabled, false);
});

test("the generated iOS Info.plist carries all three as false", () => {
  // Run the installed plugin's own Info.plist writer, so this asserts on the
  // generated native configuration rather than on our source values.
  const withFacebookIOS = require(require.resolve("react-native-fbsdk-next/plugin/build/withFacebookIOS.js", { paths: [ROOT] }));
  const infoPlist = withFacebookIOS.setFacebookConfig(fbsdkProps(productionExpoConfig()), {});

  assert.equal(infoPlist.FacebookAutoInitEnabled, false);
  assert.equal(infoPlist.FacebookAutoLogAppEventsEnabled, false);
  assert.equal(infoPlist.FacebookAdvertiserIDCollectionEnabled, false);
  assert.equal(infoPlist.FacebookAppID, "1578860883970731");
});

test("the ATT purpose string is exactly the approved wording", () => {
  const expoConfig = productionExpoConfig();
  const entry = expoConfig.plugins.find((p) => Array.isArray(p) && p[0] === "expo-tracking-transparency");
  assert.ok(entry, "the tracking plugin is configured for production");
  assert.equal(
    entry[1].userTrackingPermission,
    "Your permission helps us measure whether our ads lead to app installs and improve how we reach people who may benefit from Uncluttrd.",
  );
});

test("staging carries no Meta identity and no ATT prompt text", () => {
  const configPath = require.resolve(path.join(ROOT, "app.config.js"));
  delete require.cache[configPath];
  process.env.APP_ENV = "staging";
  const expo = require(configPath).expo;
  const names = expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.ok(!names.includes("react-native-fbsdk-next"));
  assert.ok(!names.includes("expo-tracking-transparency"));
  process.env.APP_ENV = "production";
});
