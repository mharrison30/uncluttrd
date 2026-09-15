/**
 * App.js integrity: undefined references, and the flows they broke.
 *
 *   node --test scripts/appIntegrity.test.js
 *
 * Production 2.1.0 and 2.2.0 shipped a reset() that called setTierTouched,
 * whose state had been deleted (34960c1): "Analyze Another Area" threw a
 * ReferenceError - a white screen on Android, a crash on iOS. Account
 * deletion called setEmail/setPassword, which MainApp never had, so a
 * successful deletion was reported as a failure. The temporal-dead-zone audit
 * cannot see either; these tests can.
 *
 * APP_JS=<path> runs the same tests against another copy of App.js (used to
 * prove they fail on the pre-fix code).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const APP_PATH = process.env.APP_JS || path.join(ROOT, "App.js");
const SRC = fs.readFileSync(APP_PATH, "utf8").replace(/\r\n/g, "\n");

// Babel ships with Expo; resolve it the way Metro does rather than adding a
// dependency.
const expoDir = path.dirname(require.resolve("expo/package.json", { paths: [ROOT] }));
const fromExpo = (m) => require(require.resolve(m, { paths: [expoDir, ROOT] }));
const parser = fromExpo("@babel/parser");
const traverse = fromExpo("@babel/traverse").default;

// Legitimate free identifiers in a React Native (Hermes) bundle: ECMAScript
// and host globals the app actually relies on. Anything else unbound is a
// ReferenceError waiting for its code path to run.
const KNOWN_GLOBALS = new Set([
  "undefined", "NaN", "Infinity", "globalThis", "global", "arguments",
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp",
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "Promise", "Proxy", "Reflect", "Intl",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError",
  "ArrayBuffer", "DataView", "Uint8Array", "Uint8ClampedArray", "Int8Array", "Uint16Array", "Int16Array",
  "Uint32Array", "Int32Array", "Float32Array", "Float64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
  "escape", "unescape", "atob", "btoa", "structuredClone", "queueMicrotask",
  "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
  "requestAnimationFrame", "cancelAnimationFrame", "performance", "navigator",
  "fetch", "Headers", "Request", "Response", "FormData", "URL", "URLSearchParams", "XMLHttpRequest", "Blob",
  "FileReader", "AbortController", "TextEncoder", "TextDecoder",
  "require", "module", "exports", "process", "__DEV__",
]);

function unresolvedIdentifiers(code) {
  const ast = parser.parse(code, { sourceType: "module", plugins: ["jsx"] });
  const hits = [];
  traverse(ast, {
    ReferencedIdentifier(p) {
      const { name } = p.node;
      if (p.isJSXIdentifier() && /^[a-z]/.test(name)) return; // intrinsic JSX tags
      if (p.scope.hasBinding(name, true) || KNOWN_GLOBALS.has(name)) return;
      hits.push(`${name} (line ${p.node.loc.start.line})`);
    },
  });
  return hits;
}

// ---- 1. unresolved identifiers ----------------------------------------------

test("the scanner flags an undefined setter and accepts globals and scoped bindings", () => {
  const sample = `
    import { useState } from "react";
    function Screen() {
      const [photo, setPhoto] = useState(null);
      const reset = () => { setPhoto(null); setTierTouched(false); console.log(JSON.stringify({})); setTimeout(() => {}, 1); };
      return <View onPress={reset} label={photo} />;
    }
    function Other() { const [email, setEmail] = useState(""); return setEmail; }
    function Main() { setEmail(""); setPassword(""); }`;
  assert.deepEqual(unresolvedIdentifiers(sample).map((h) => h.split(" ")[0]), ["setTierTouched", "View", "setEmail", "setPassword"]);
});

test("App.js has no unresolved identifier references", () => {
  assert.deepEqual(unresolvedIdentifiers(SRC), []);
});

// ---- helpers: run real MainApp code in a scope with exactly MainApp's names -

const MAIN_START = SRC.indexOf("function MainApp(");
const MAIN_END = SRC.indexOf("\nfunction ", MAIN_START + 10);
const MAIN = SRC.slice(MAIN_START, MAIN_END);

function mainAppDeclarations() {
  const names = new Set();
  for (const m of MAIN.matchAll(/const \[(\w+), (\w+)\] = useState/g)) { names.add(m[1]); names.add(m[2]); }
  for (const m of MAIN.matchAll(/^ {2}const (\w+) = /gm)) names.add(m[1]);
  for (const m of MAIN.matchAll(/^ {2}(?:async )?function (\w+)\(/gm)) names.add(m[1]);
  const params = MAIN.slice(MAIN.indexOf("({") + 2, MAIN.indexOf("})"));
  for (const p of params.split(",")) if (p.trim()) names.add(p.trim());
  return names;
}

// Every identifier the snippet uses must be supplied; the Function has no
// access to anything else, so an undeclared name throws as it does in Hermes.
function runInMainAppScope(snippet, overrides, invoke) {
  const calls = [];
  const env = {};
  for (const name of mainAppDeclarations()) {
    if (/^set[A-Z]/.test(name)) env[name] = (v) => calls.push([name, v]);
    else if (/Ref$/.test(name)) env[name] = { current: `stale-${name}` };
    else env[name] = () => calls.push([name]);
  }
  Object.assign(env, overrides(calls));
  for (const k of Object.keys(env)) if (snippet.includes(`const ${k} = `)) delete env[k];
  const names = Object.keys(env);
  const fn = new Function(...names, `"use strict";\n${snippet}\nreturn ${invoke};`);
  return { calls, env, result: fn(...names.map((n) => env[n])) };
}

// ---- 2. reset(): "Analyze Another Area" -------------------------------------

const RESET_LINE = SRC.split("\n").find((l) => l.startsWith("  const reset = () => { dlog(`[PHOTO DEBUG] reset()"));

function resetFor(seed) {
  return runInMainAppScope(RESET_LINE, () => ({
    dlog: () => {},
    activePlanIdRef: { current: seed.planId },
    companionBasePhotoRef: { current: seed.photo },
    companionOriginalPhotoRef: { current: seed.photo },
    companionOriginalCompressedRef: { current: seed.photo },
    recognitionPendingRef: { current: seed.pending },
    analysisIdRef: { current: seed.analysisId },
    lastFailedAnalysisRef: { current: seed.analysisId },
  }), "reset()");
}

const RESET_SEEDS = {
  "a newly generated plan": { planId: "NEW_PLAN", photo: "file:///var/mobile/Caches/ImageManipulator/new.jpg", pending: { parsed: {} }, analysisId: "an-1" },
  "a plan reopened from My Rooms": { planId: "REOPENED_PLAN", photo: "https://firebasestorage.googleapis.com/o/plans%2Fu%2FREOPENED_PLAN%2Foriginal.jpg", pending: null, analysisId: null },
};

for (const [label, seed] of Object.entries(RESET_SEEDS)) {
  test(`reset() completes every operation for ${label}`, () => {
    assert.ok(RESET_LINE, "reset() located in App.js");
    let run;
    assert.doesNotThrow(() => { run = resetFor(seed); });
    const { calls, env } = run;
    // Every state setter reset() names ran, in order, and nothing was skipped.
    const expected = [...RESET_LINE.matchAll(/\b(set[A-Z]\w*|clearCompanionRevealState)\(/g)].map((m) => m[1]);
    assert.deepEqual(calls.map((c) => c[0]), expected);
    assert.ok(expected.length >= 24, `${expected.length} operations`);
    for (const [name, value] of [["setPhoto", null], ["setResults", null], ["setShowCompanion", false], ["setCurrentPlanId", null], ["setProgressPhoto", null]]) {
      assert.deepEqual(calls.find((c) => c[0] === name), [name, value], name);
    }
    assert.equal(calls.at(-1)[0], "clearCompanionRevealState", "reached the last operation");
    for (const ref of ["activePlanIdRef", "companionBasePhotoRef", "companionOriginalPhotoRef", "companionOriginalCompressedRef", "recognitionPendingRef", "analysisIdRef", "lastFailedAnalysisRef"]) {
      assert.equal(env[ref].current, null, `${ref} cleared`);
    }
  });
}

test("reset() is what Analyze Another Area calls", () => {
  assert.match(SRC, /<TouchableOpacity style=\{s\.startOverBtn\} onPress=\{reset\}>\n\s*<Text style=\{s\.startOverText\}>Analyze Another Area<\/Text>/);
});

// ---- 3. account deletion ----------------------------------------------------

function extractFunction(name) {
  const start = SRC.indexOf(`  const ${name} = async () => {`);
  assert.ok(start > MAIN_START && start < MAIN_END, `${name} located in MainApp`);
  const end = SRC.indexOf("\n  };\n", start);
  return SRC.slice(start, end + "\n  };".length);
}

test("a successful account deletion reaches cleanup without an undefined-setter error", async () => {
  const handler = extractFunction("handleConfirmDelete");
  const order = [];
  const storage = [];
  const run = runInMainAppScope(handler, (calls) => ({
    deletePassword: "correct horse",
    deleteAccountInFlightRef: { current: false },
    auth: { currentUser: { email: "tester@example.com" } },
    functions: {},
    EmailAuthProvider: { credential: (email, pw) => ({ email, pw }) },
    reauthenticateWithCredential: async () => { order.push("reauthenticate"); },
    httpsCallable: (_f, fnName) => async () => { order.push(`callable:${fnName}`); return { data: { outcome: "hard-deleted" } }; },
    signOut: async () => { order.push("signOut"); },
    AsyncStorage: { removeItem: async (k) => { storage.push(k); order.push(`remove:${k}`); } },
    setDeleteError: (v) => calls.push(["setDeleteError", v]),
    setDeleteLoading: (v) => calls.push(["setDeleteLoading", v]),
    setShowDeleteModal: (v) => calls.push(["setShowDeleteModal", v]),
  }), "handleConfirmDelete()");
  await run.result;
  const { calls, env } = run;

  assert.deepEqual(order, ["reauthenticate", "callable:hardDeleteAccount", "signOut",
    "remove:analysisCount", "remove:isPro", "remove:skipOnboarding"]);
  assert.deepEqual(storage, ["analysisCount", "isPro", "skipOnboarding"], "every local cleanup ran");
  assert.deepEqual(calls.find((c) => c[0] === "setShowDeleteModal"), ["setShowDeleteModal", false], "modal closed");
  assert.deepEqual(calls.filter((c) => c[0] === "setDeleteError"), [["setDeleteError", ""]], "no error shown");
  assert.deepEqual(calls.filter((c) => c[0] === "setDeleteLoading").map((c) => c[1]), [true, false]);
  assert.equal(env.deleteAccountInFlightRef.current, false, "re-entry guard released");
});

test("a failed deletion still reports its error (the catch path is unchanged)", async () => {
  const handler = extractFunction("handleConfirmDelete");
  const run = runInMainAppScope(handler, (calls) => ({
    deletePassword: "wrong",
    deleteAccountInFlightRef: { current: false },
    auth: { currentUser: { email: "tester@example.com" } },
    functions: {},
    EmailAuthProvider: { credential: () => ({}) },
    reauthenticateWithCredential: async () => { const e = new Error("bad"); e.code = "auth/wrong-password"; throw e; },
    httpsCallable: () => async () => { throw new Error("must not be called"); },
    signOut: async () => { throw new Error("must not be called"); },
    AsyncStorage: { removeItem: async () => { throw new Error("must not be called"); } },
    setDeleteError: (v) => calls.push(["setDeleteError", v]),
    setDeleteLoading: (v) => calls.push(["setDeleteLoading", v]),
    setShowDeleteModal: (v) => calls.push(["setShowDeleteModal", v]),
  }), "handleConfirmDelete()");
  await run.result;
  assert.deepEqual(run.calls.filter((c) => c[0] === "setDeleteError").map((c) => c[1]), ["", "Incorrect password. Please try again."]);
  assert.ok(!run.calls.some((c) => c[0] === "setShowDeleteModal"), "modal stays open");
  assert.equal(run.env.deleteAccountInFlightRef.current, false);
});
