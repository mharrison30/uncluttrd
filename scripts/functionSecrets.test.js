/**
 * Cloud Functions secret declarations, checked statically.
 *
 *   node --test scripts/functionSecrets.test.js
 *
 * analyzePhotoDetail called verifyProEntitlement without listing
 * REVENUECAT_SECRET_API_KEY in its own secrets array. Firebase does not fail
 * the deploy for that: the container starts, the secret is simply absent, and
 * REVENUECAT_SECRET_API_KEY.value() returns empty. RevenueCat then answers
 * HTTP 401, which verifyProEntitlement treats as a definite "not entitled" -
 * so every paying subscriber silently dropped to the free daily cap, and the
 * only sign was one log line per call.
 *
 * The emulator suites cannot catch this: they never reach RevenueCat with a
 * real key, and a secret that is merely undeclared looks exactly like a secret
 * that is declared but unset. The declaration is a deploy-time fact, so this
 * reads it from the source instead.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "functions", "index.js");
const SRC = fs.readFileSync(INDEX_PATH, "utf8").replace(/\r\n/g, "\n");

// Babel ships with Expo; resolve it the way the other static suites do rather
// than adding a dependency.
const expoDir = path.dirname(require.resolve("expo/package.json", { paths: [ROOT] }));
const fromExpo = (m) => require(require.resolve(m, { paths: [expoDir, ROOT] }));
const parser = fromExpo("@babel/parser");
const traverse = fromExpo("@babel/traverse").default;

const ast = parser.parse(SRC, { sourceType: "script", plugins: ["optionalChaining", "nullishCoalescingOperator"] });

const isFn = (n) => n && (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "FunctionDeclaration");

/** secretIdentifier -> SECRET_NAME, from `const X = defineSecret("NAME")`. */
const secretNames = new Map();
/** Module-level helpers, so a secret read one call deep still counts. */
const helpers = new Map();
/** Every deployed function: exports.NAME = onCall/onRequest/onSchedule(...). */
const deployed = [];

for (const stmt of ast.program.body) {
  if (stmt.type === "VariableDeclaration") {
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier" || !d.init) continue;
      if (d.init.type === "CallExpression" && d.init.callee.type === "Identifier" && d.init.callee.name === "defineSecret") {
        const arg = d.init.arguments[0];
        if (arg && arg.type === "StringLiteral") secretNames.set(d.id.name, arg.value);
      }
      if (isFn(d.init)) helpers.set(d.id.name, d.init);
    }
  }
  if (stmt.type === "FunctionDeclaration" && stmt.id) helpers.set(stmt.id.name, stmt);

  if (stmt.type !== "ExpressionStatement") continue;
  const expr = stmt.expression;
  if (expr.type !== "AssignmentExpression") continue;
  const left = expr.left;
  if (left.type !== "MemberExpression" || left.object.type !== "Identifier" || left.object.name !== "exports") continue;
  const right = expr.right;
  if (right.type !== "CallExpression") continue;
  // onCall / onRequest / onSchedule / onDocumentWritten / ... - anything the
  // Functions SDK exposes as a trigger wrapper.
  const callee = right.callee.type === "Identifier" ? right.callee.name : null;
  if (!callee || !/^on[A-Z]/.test(callee)) continue;

  const opts = right.arguments.find((a) => a.type === "ObjectExpression");
  const handler = right.arguments.find(isFn);
  const declared = [];
  if (opts) {
    const prop = opts.properties.find((p) => p.type === "ObjectProperty" && p.key.type === "Identifier" && p.key.name === "secrets");
    if (prop && prop.value.type === "ArrayExpression") {
      for (const el of prop.value.elements) if (el && el.type === "Identifier") declared.push(el.name);
    }
  }
  deployed.push({ name: left.property.name, trigger: callee, declared, handler, line: stmt.loc.start.line });
}

/**
 * Every identifier a handler can reach, following module-level helpers. A
 * secret read inside verifyProEntitlement belongs to every function that can
 * call it, however indirectly.
 */
function reachableIdentifiers(node) {
  const seen = new Set();
  const names = new Set();
  const walk = (fnNode) => {
    traverse(
      { type: "File", program: { type: "Program", body: [{ type: "ExpressionStatement", expression: { type: "FunctionExpression", id: null, params: [], body: fnNode.body.type === "BlockStatement" ? fnNode.body : { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: fnNode.body }], directives: [] }, async: false, generator: false } }], directives: [], sourceType: "script" } },
      {
        Identifier(p) {
          const n = p.node.name;
          names.add(n);
          if (helpers.has(n) && !seen.has(n)) {
            seen.add(n);
            walk(helpers.get(n));
          }
        },
      },
    );
  };
  walk(node);
  return names;
}

test("the parse found the functions and secrets it is meant to check", () => {
  assert.ok(secretNames.size >= 4, `expected several defineSecret declarations, found ${secretNames.size}`);
  assert.ok(deployed.length >= 10, `expected the full function set, found ${deployed.length}`);
  assert.ok(secretNames.has("REVENUECAT_SECRET_API_KEY"), "REVENUECAT_SECRET_API_KEY must be defined with defineSecret");
  for (const n of ["analyzePhoto", "analyzePhotoDetail", "generateVisualization"]) {
    assert.ok(deployed.some((f) => f.name === n), `${n} must be found by the static parse`);
  }
});

test("every function that can reach verifyProEntitlement declares REVENUECAT_SECRET_API_KEY", () => {
  const callers = deployed.filter((f) => f.handler && reachableIdentifiers(f.handler).has("verifyProEntitlement"));
  assert.ok(callers.length >= 3, `expected the entitlement callers, found ${callers.map((f) => f.name).join(", ")}`);

  for (const f of callers) {
    assert.ok(
      f.declared.includes("REVENUECAT_SECRET_API_KEY"),
      `${f.name} (functions/index.js:${f.line}) calls verifyProEntitlement but does not list REVENUECAT_SECRET_API_KEY ` +
        `in its secrets (declared: ${f.declared.join(", ") || "none"}). The call will not fail - it will return HTTP 401, ` +
        `which reads as "not entitled", so paying subscribers get the free cap.`,
    );
  }
});

test("every function that can reach a secret declares that secret", () => {
  // The general form of the same defect: an undeclared secret is empty at
  // runtime, never an error, so only a static check sees it.
  const failures = [];
  for (const f of deployed) {
    if (!f.handler) continue;
    const reached = reachableIdentifiers(f.handler);
    for (const [ident, secretName] of secretNames) {
      if (reached.has(ident) && !f.declared.includes(ident)) {
        failures.push(`${f.name} (functions/index.js:${f.line}) reads ${secretName} but does not declare it`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("no [entitlement] log line prints a raw uid", () => {
  const lines = SRC.split("\n");
  const offenders = [];
  lines.forEach((line, i) => {
    if (!line.includes("[entitlement]")) return;
    // A raw uid is the Firebase account identifier; it is stable, it appears in
    // Firestore paths, and it does not belong in a log anyone can read.
    if (/uid=\$\{uid\}/.test(line) || /uid=\$\{request\.auth/.test(line)) {
      offenders.push(`functions/index.js:${i + 1}: ${line.trim()}`);
    }
  });
  assert.deepEqual(offenders, [], `use guards.uidTag(uid):\n${offenders.join("\n")}`);
});

test("the [entitlement] log lines still identify the call, via the hashed tag", () => {
  const entitlementLines = SRC.split("\n").filter((l) => l.includes("[entitlement]") && l.includes("console."));
  assert.ok(entitlementLines.length >= 4, `expected the four entitlement log lines, found ${entitlementLines.length}`);
  for (const line of entitlementLines) {
    assert.ok(line.includes("guards.uidTag(uid)"), `must correlate by hashed tag: ${line.trim()}`);
  }
});
