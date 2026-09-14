/**
 * PDF export: approach resolution, the Results photo merge, and the HTML
 * generatePDF actually produces.
 *
 *   node --test scripts/pdfExport.test.js
 *
 * The render tests run App.js's real generatePDF, sliced out of the source by
 * its declaration rather than re-implemented, against synthetic plans. Every
 * app dependency it touches is supplied explicitly; an identifier the slice
 * needs but the test does not provide fails the test instead of passing
 * silently. Images are placeholders - imageToDataUri's own download and
 * conversion are not exercised here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolvePdfApproachId, mergeUploadedPhotoUrl } = require(path.join(__dirname, "..", "shared", "pdfExport.js"));

// ---- fixtures ---------------------------------------------------------------

const PHOTO = "https://firebasestorage.googleapis.com/v0/b/test/o/plans%2Fu%2FPLAN%2Foriginal.jpg";
const VIZ_POLISHED = "https://firebasestorage.googleapis.com/v0/b/test/o/viz%2Fu%2FPLAN%2Fpolished.jpg";

const approach = (id, guidance, products) => ({
  strategyDescription: `Start by clearing the ${id} shelf. Then regroup what remains by how often it is used.`,
  organizingGuidance: Array.from({ length: guidance }, (_, i) => `Group ${id} item set ${i + 1} by category so the counter reads as one surface`),
  keyChanges: ["Clear the counter", "Group by use", "Contain loose items", "Label the bins"],
  productRecommendations: Array.from({ length: products }, (_, i) => ({
    approachId: id, productType: `${id} product ${i + 1}`, shortReason: "Keeps loose items findable",
    reason: "Keeps loose items findable", icon: "bin", grounding: "observed", relatedProblemIds: [], searchTerms: ["x"],
  })),
  taskChecklist: ["Task 1", "Task 2", "Task 3", "Task 4"],
  suggestedAdditionTypes: [], estimatedSpendRange: "$25-$60", visualizationDirection: "x",
});

// The shape of the plan the bug was reported on: schemaVersion 3, detail
// complete, nothing committed.
const v3Plan = (extra = {}) => ({
  schemaVersion: 3, analysisStage: "complete", scopeSize: "room-section", areaScope: "sub-area",
  spaceName: "Kitchen", areaName: "Pantry Shelf",
  overview: "The shelf holds mixed items with no clear grouping.",
  proTip: "Keep daily items at eye level.",
  problemsFound: [{ id: "p1", description: "Mixed items" }],
  approaches: { simple: approach("simple", 4, 1), polished: approach("polished", 4, 5), elevated: approach("elevated", 4, 6) },
  selectedApproach: null, approachHistory: [], currentBatch: null, batchHistory: [], progressPhotos: [],
  ...extra,
});

const legacyPlan = () => ({
  spaceName: "Kitchen", overview: "The shelf holds mixed items.", proTip: "Keep daily items at eye level.", photoUrl: PHOTO,
  tiers: ["budget", "mid", "premium"].map((id) => ({
    id, label: id, range: "$20-$50", suggestions: ["Group like items"], products: [{ icon: "📦", name: "Clear bins", price: "$15" }],
  })),
});

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};

// ---- resolvePdfApproachId ---------------------------------------------------

test("valid committed selection wins", () => {
  assert.equal(resolvePdfApproachId(v3Plan({ selectedApproach: "elevated" }), null), "elevated");
});

test("valid committed selection wins over a different preview", () => {
  assert.equal(resolvePdfApproachId(v3Plan({ selectedApproach: "elevated" }), "polished"), "elevated");
});

test("no committed selection plus a valid preview uses the preview", () => {
  assert.equal(resolvePdfApproachId(v3Plan(), "polished"), "polished");
});

test("an invalid preview is ignored", () => {
  assert.equal(resolvePdfApproachId(v3Plan(), "luxury"), null);
  assert.equal(resolvePdfApproachId(v3Plan(), "constructor"), null);
  assert.equal(resolvePdfApproachId(v3Plan(), ""), null);
  assert.equal(resolvePdfApproachId(v3Plan(), { id: "polished" }), null);
  const missingDetail = v3Plan();
  missingDetail.approaches = { ...missingDetail.approaches, polished: null };
  assert.equal(resolvePdfApproachId(missingDetail, "polished"), null);
});

test("an invalid committed selection falls back to a valid preview, else comparison", () => {
  assert.equal(resolvePdfApproachId(v3Plan({ selectedApproach: "luxury" }), "simple"), "simple");
  assert.equal(resolvePdfApproachId(v3Plan({ selectedApproach: "luxury" }), null), null);
});

test("no valid committed selection or preview means comparison (null)", () => {
  assert.equal(resolvePdfApproachId(v3Plan(), null), null);
  assert.equal(resolvePdfApproachId(v3Plan(), undefined), null);
});

test("a legacy plan never resolves an approach", () => {
  assert.equal(resolvePdfApproachId(legacyPlan(), "polished"), null);
  assert.equal(resolvePdfApproachId(null, "polished"), null);
});

test("resolution reads without mutating", () => {
  const plan = deepFreeze(v3Plan());
  assert.equal(resolvePdfApproachId(plan, "polished"), "polished");
  assert.equal(plan.selectedApproach, null);
});

// ---- mergeUploadedPhotoUrl --------------------------------------------------

test("a successful upload adds photoUrl to the matching active results", () => {
  const prev = v3Plan();
  const next = mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: PHOTO });
  assert.notEqual(next, prev);
  assert.equal(next.photoUrl, PHOTO);
  assert.equal(prev.photoUrl, undefined, "the previous object is not mutated");
});

test("a different active plan is not changed", () => {
  const prev = v3Plan({ photoUrl: "https://example.test/other.jpg" });
  assert.equal(mergeUploadedPhotoUrl(prev, "OTHER", { planId: "PLAN", photoUrl: PHOTO }), prev);
});

test("null results remain null", () => {
  assert.equal(mergeUploadedPhotoUrl(null, "PLAN", { planId: "PLAN", photoUrl: PHOTO }), null);
  assert.equal(mergeUploadedPhotoUrl(undefined, "PLAN", { planId: "PLAN", photoUrl: PHOTO }), undefined);
});

test("existing detail and visualization fields are preserved", () => {
  const prev = deepFreeze(v3Plan({ vizImages: { polished: VIZ_POLISHED }, selectedApproach: "polished", currentBatch: { batchIndex: 1, items: [] } }));
  const next = mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: PHOTO });
  assert.deepEqual({ ...next, photoUrl: undefined }, { ...prev, photoUrl: undefined });
  assert.equal(next.approaches, prev.approaches);
  assert.equal(next.vizImages, prev.vizImages);
  assert.equal(next.selectedApproach, "polished");
  assert.deepEqual(Object.keys(next).sort(), [...Object.keys(prev), "photoUrl"].sort());
});

test("a late upload cannot overwrite a newer plan's state", () => {
  // Plan A's upload resolves after the user has moved on to plan B.
  const planB = deepFreeze(v3Plan({ photoUrl: "https://example.test/b.jpg", analysisStage: "complete" }));
  assert.equal(mergeUploadedPhotoUrl(planB, "PLAN_B", { planId: "PLAN_A", photoUrl: PHOTO }), planB);
  // Home screen: no active plan at all.
  assert.equal(mergeUploadedPhotoUrl(planB, null, { planId: "PLAN_A", photoUrl: PHOTO }), planB);
});

test("only a remote URL is merged, never a local cache file", () => {
  const prev = v3Plan();
  const local = "file:///var/mobile/Containers/Data/Library/Caches/ImageManipulator/X.jpg";
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: local }), prev);
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: null }), prev);
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", null), prev);
});

test("merging the same URL again keeps the same reference", () => {
  const prev = v3Plan({ photoUrl: PHOTO });
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: PHOTO }), prev);
});

// ---- generatePDF render -----------------------------------------------------

// Line endings normalized: the markers below are written with \n.
const APP_SOURCE = fs.readFileSync(path.join(__dirname, "..", "App.js"), "utf8").replace(/\r\n/g, "\n");

function slice(source, startMarker, endMarker, { includeEnd }) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `end marker not found after: ${startMarker}`);
  return source.slice(start, includeEnd ? end + endMarker.length : end);
}

function pdfSlices(source) {
  return {
    // APPROACH_META through the step-title and product-name helpers the PDF
    // uses; stops before the icon table, which needs the icon imports.
    helpers: slice(source, "\nconst BRAND = {", "\n};\n", { includeEnd: true })
      + slice(source, "\nconst APPROACH_META = {","\nconst PRODUCT_CATEGORY_ICONS = {", { includeEnd: false })
      + "\n" + slice(source, "\nfunction normalizeProductRecommendation(rec) {", "\n// ===", { includeEnd: false }),
    escHtml: slice(source, "\n  const escHtml = ", ";\n", { includeEnd: true }),
    generatePDF: slice(source, "\n  const generatePDF = async () => {", "\n  };\n", { includeEnd: true }),
  };
}

const WRITE_APIS = ["updateDoc", "setDoc", "addDoc", "deleteDoc", "writeBatch", "arrayUnion", "setResults", "setHistory", "setPreviewApproach", "setCurrentPlanId", "setVizImage"];

// Runs generatePDF and returns the HTML handed to Print.printToFileAsync.
async function renderPdf(source, { results, previewApproach = null, vizImage = {} }) {
  const s = pdfSlices(source);
  const calls = [];
  let html = null;
  const env = {
    results, previewApproach, vizImage,
    resolvePdfApproachId,
    pdfInFlightRef: { current: false },
    setAsyncBusyText: () => {},
    Print: { printToFileAsync: async (opts) => { html = opts.html; return { uri: "file:///out.pdf" }; } },
    Sharing: { shareAsync: async () => {} },
    logEvent: (_a, name, params) => calls.push({ name, params }),
    getAnalytics: () => null,
    Alert: { alert: (title, message) => { throw new Error(`generatePDF raised "${title}": ${message}`); } },
    getSpaceDisplayName: (r) => r.spaceName || "Room",
    resolveExportIdentity: async () => ({ label: "Kitchen · Pantry Shelf" }),
    imageToDataUri: async (url) => {
      calls.push({ name: "imageToDataUri", url });
      return url ? `data:image/png;base64,${Buffer.from(String(url)).toString("base64")}` : null;
    },
    dlog: () => {},
  };
  for (const api of WRITE_APIS) env[api] = (...args) => { calls.push({ name: api, args }); };
  const scope = new Proxy(env, {
    has: (_t, key) => typeof key === "string" && !(key in globalThis),
    get: (t, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (key in t) return t[key];
      throw new ReferenceError(`generatePDF test harness does not provide ${String(key)}`);
    },
  });
  // eslint-disable-next-line no-new-func
  const factory = new Function("scope", `with (scope) {\n${s.helpers}\n${s.escHtml}\n${s.generatePDF}\nreturn generatePDF;\n}`);
  await factory(scope)();
  assert.ok(html, "generatePDF produced no HTML");
  return { html, calls };
}

const firstPage = (html) => html.slice(0, html.indexOf('style="page-break-before:always;"'));
const imgSrc = (url) => `src="data:image/png;base64,${Buffer.from(url).toString("base64")}"`;

test("render: new v3 plan previewing polished gets the single-approach document", async () => {
  const results = deepFreeze(v3Plan({ photoUrl: PHOTO, vizImages: {} }));
  const before = JSON.stringify(results);
  const { html, calls } = await renderPdf(APP_SOURCE, { results, previewApproach: "polished", vizImage: { polished: VIZ_POLISHED } });
  const p1 = firstPage(html);

  assert.ok(p1.includes(`<img class="photo" ${imgSrc(PHOTO)}/>`), "photo on page 1");
  assert.ok(p1.includes('<div class="cap">Your space today</div>'), "caption on page 1");
  assert.match(p1, /<div class="approach-section">\s*<span class="approach-name">Polished &amp; Practical<\/span>/, "polished card on page 1");
  assert.ok(html.includes('<div class="eyebrow">Your action plan</div>'));
  assert.ok(html.includes("Four moves that make the biggest difference"));
  for (const n of ["01", "02", "03", "04"]) assert.ok(html.includes(`<div class="stepno">${n}</div>`), `step ${n}`);
  assert.ok(html.includes('<table class="prodgrid">'), "product grid");
  assert.equal((html.match(/class="product-card"/g) || []).length, 5, "the five polished products");
  assert.ok(html.includes(`<img class="viz" ${imgSrc(VIZ_POLISHED)}/>`), "polished visualization");
  assert.ok(!html.includes("Three ways to approach this"));

  // Nothing persisted or started, and the plan object is untouched.
  assert.deepEqual(calls.filter((c) => WRITE_APIS.includes(c.name)), []);
  assert.equal(JSON.stringify(results), before);
  assert.equal(results.selectedApproach, null);
  assert.deepEqual(results.approachHistory, []);
});

test("render: the persisted visualization is used when this session has none", async () => {
  const results = v3Plan({ photoUrl: PHOTO, vizImages: { polished: VIZ_POLISHED } });
  const { html } = await renderPdf(APP_SOURCE, { results, previewApproach: "polished" });
  assert.ok(html.includes(`<img class="viz" ${imgSrc(VIZ_POLISHED)}/>`));
});

test("render: a committed selection wins over a different preview", async () => {
  const results = v3Plan({ photoUrl: PHOTO, selectedApproach: "elevated" });
  const { html, calls } = await renderPdf(APP_SOURCE, { results, previewApproach: "polished" });
  assert.match(firstPage(html), /<span class="approach-name">Elevated Finish<\/span>/);
  assert.equal((html.match(/class="product-card"/g) || []).length, 6, "the six elevated products");
  assert.deepEqual(calls.find((c) => c.name === "pdf_exported").params, { format: "approach", selected: "elevated" });
});

test("render: no committed selection and no preview keeps the comparison document", async () => {
  const { html } = await renderPdf(APP_SOURCE, { results: v3Plan({ photoUrl: PHOTO }), previewApproach: null });
  assert.ok(html.includes("Three ways to approach this"));
  assert.ok(!firstPage(html).includes('<div class="approach-section">'));
  assert.ok(!html.includes("Your action plan"));
  assert.ok(!html.includes('<table class="prodgrid">'));
});

test("render: an invalid preview keeps the comparison document", async () => {
  const { html } = await renderPdf(APP_SOURCE, { results: v3Plan({ photoUrl: PHOTO }), previewApproach: "luxury" });
  assert.ok(html.includes("Three ways to approach this"));
});

test("render: a legacy tier plan stays on the legacy document, preview or not", async () => {
  const { html, calls } = await renderPdf(APP_SOURCE, { results: legacyPlan(), previewApproach: "polished" });
  assert.equal((html.match(/class="tier"/g) || []).length, 3);
  assert.ok(!html.includes('<div class="approach-section">'));
  assert.ok(!html.includes("Three ways to approach this"));
  assert.ok(!html.includes("Your action plan"));
  assert.equal(calls.find((c) => c.name === "pdf_exported").params, undefined);
});

test("generatePDF itself contains no write or state-changing call", () => {
  const body = pdfSlices(APP_SOURCE).generatePDF;
  for (const api of WRITE_APIS) {
    assert.ok(!new RegExp(`\\b${api}\\s*\\(`).test(body), `generatePDF calls ${api}`);
  }
});
