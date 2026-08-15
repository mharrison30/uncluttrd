#!/usr/bin/env node
/**
 * Temporal-dead-zone auditor.
 *
 * Catches the class of bug that shipped a broken bundle to staging on
 * 2026-08-14: a hook whose DEPENDENCY ARRAY references a `const`/`let`
 * declared later in the same function scope.
 *
 * Why this needs a real parser rather than a grep: the distinction that
 * matters is WHEN the reference is evaluated.
 *
 *   useEffect(() => { use(x) }, [])   // deferred - body runs after render, SAFE
 *   useEffect(() => {}, [x])          // dependency array is evaluated DURING
 *                                     // render - THROWS if x is declared below
 *
 * Both look identical to a text search. Only scope-and-position analysis
 * separates them.
 *
 * Neither `node -c` nor `expo export` catches this: it is a runtime error,
 * and the file is syntactically valid. Run this in CI or before any OTA.
 *
 * Usage: node scripts/auditTdz.js [file]        (default: App.js)
 * Exit code 1 if any violation is found.
 */
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverseMod = require("@babel/traverse");
const traverse = traverseMod.default || traverseMod;

const FILE = process.argv[2] || path.join(__dirname, "..", "App.js");
const code = fs.readFileSync(FILE, "utf8");

const ast = parser.parse(code, {
  sourceType: "module",
  plugins: ["jsx", "classProperties", "objectRestSpread", "optionalChaining", "nullishCoalescingOperator", "dynamicImport"],
});

const HOOKS_WITH_DEPS = new Set(["useEffect", "useLayoutEffect", "useMemo", "useCallback", "useImperativeHandle"]);
const violations = [];
let hooksChecked = 0;
let depsChecked = 0;

traverse(ast, {
  CallExpression(p) {
    const callee = p.node.callee;
    const name = callee.type === "Identifier" ? callee.name
      : callee.type === "MemberExpression" && callee.property.type === "Identifier" ? callee.property.name
      : null;
    if (!name || !HOOKS_WITH_DEPS.has(name)) return;
    // The deps array is the last argument when it is an ArrayExpression.
    const args = p.node.arguments;
    const deps = args.length >= 2 && args[args.length - 1].type === "ArrayExpression" ? args[args.length - 1] : null;
    if (!deps) return;
    hooksChecked++;
    const hookLine = p.node.loc.start.line;

    // Every identifier appearing anywhere in the deps array, including
    // inside member expressions (a.b.c -> a) and optional chains.
    const ids = new Set();
    const collect = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "Identifier") { ids.add(node.name); return; }
      if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
        collect(node.object);
        if (node.computed) collect(node.property);
        return;
      }
      for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === "object" && v.type) collect(v);
      }
    };
    deps.elements.forEach(collect);

    ids.forEach((idName) => {
      depsChecked++;
      const binding = p.scope.getBinding(idName);
      if (!binding) return;                       // import, global, or module scope
      const kind = binding.kind;
      // Only let/const/class are subject to TDZ. `var`, params, and function
      // declarations are hoisted and initialized.
      if (!["const", "let", "class"].includes(kind)) return;
      const declLine = binding.identifier.loc ? binding.identifier.loc.start.line : null;
      if (declLine === null) return;
      // Same function scope, and declared AFTER the hook call -> TDZ at
      // render time.
      const sameFn = binding.scope.getFunctionParent() === p.scope.getFunctionParent();
      if (sameFn && declLine > hookLine) {
        violations.push({ hook: name, hookLine, idName, declLine, kind });
      }
    });
  },
});

// ---------------------------------------------------------------------------
// PASS 2 — the general case, not just hook deps.
//
// Any reference to a const/let/class that is evaluated in the SAME function
// scope, at a source position ABOVE its declaration, throws. Pass 1 covers
// dependency arrays because that is the trap that actually shipped; this pass
// covers everything else - an initializer reading a later const, JSX at
// render scope, a default argument, and so on.
//
// References inside a NESTED function are deferred and therefore safe: the
// body runs long after the scope finished initializing. That distinction is
// the entire reason this needs an AST.
// ---------------------------------------------------------------------------
const generalViolations = [];
let bindingsChecked = 0;
traverse(ast, {
  Scopable(p) {
    const scope = p.scope;
    if (scope.path !== p) return;               // visit each scope once
    Object.keys(scope.bindings).forEach((name) => {
      const binding = scope.bindings[name];
      if (!["const", "let", "class"].includes(binding.kind)) return;
      const declLine = binding.identifier.loc?.start.line;
      if (declLine == null) return;
      bindingsChecked++;
      const declFn = binding.scope.getFunctionParent();
      binding.referencePaths.forEach((ref) => {
        const refLine = ref.node.loc?.start.line;
        if (refLine == null || refLine >= declLine) return;
        // Deferred? If the reference sits inside a function nested below the
        // declaring scope, it runs later and is safe.
        if (ref.getFunctionParent() !== declFn) return;
        // Already reported by pass 1.
        if (violations.some((v) => v.idName === name && v.declLine === declLine)) return;
        generalViolations.push({ name, declLine, refLine, kind: binding.kind });
      });
    });
  },
});

console.log(`TDZ AUDIT — ${path.relative(process.cwd(), FILE)}`);
console.log(`  PASS 1  hook dependency arrays checked : ${hooksChecked}`);
console.log(`          dependency identifiers resolved: ${depsChecked}`);
console.log(`          violations                     : ${violations.length}`);
console.log(`  PASS 2  const/let/class bindings checked: ${bindingsChecked}`);
console.log(`          violations                     : ${generalViolations.length}`);

if (violations.length) {
  console.log(`\nPASS 1 — hook dependency arrays evaluated during render:`);
  violations.sort((a, b) => a.hookLine - b.hookLine).forEach((v) => {
    console.log(`  ${FILE}:${v.hookLine}`);
    console.log(`     ${v.hook}(...) deps reference '${v.idName}' (${v.kind}) declared at line ${v.declLine}`);
    console.log(`     -> ReferenceError: Cannot access '${v.idName}' before initialization, on every render`);
  });
}
if (generalViolations.length) {
  console.log(`\nPASS 2 — use before declaration in the same function scope:`);
  generalViolations.sort((a, b) => a.refLine - b.refLine).forEach((v) => {
    console.log(`  ${FILE}:${v.refLine}  reads '${v.name}' (${v.kind}) declared at line ${v.declLine}`);
  });
}
const total = violations.length + generalViolations.length;
if (!total) console.log(`\n  CLEAN — no temporal-dead-zone hazard found.`);
process.exit(total ? 1 : 0);
