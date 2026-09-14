/**
 * PDF export: the Results photo merge, the comprehensive plan document, and
 * the HTML generatePDF actually produces.
 *
 *   node --test scripts/pdfExport.test.js
 *
 * The render tests run App.js's real generatePDF, sliced out of the source by
 * its declaration rather than re-implemented, against synthetic plans. Every
 * app dependency it touches is supplied explicitly; an identifier the slice
 * needs but the test does not provide fails the test instead of passing
 * silently. imageToDataUri itself (download + resize) is stubbed with real,
 * decodable PNG data URIs.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  mergeUploadedPhotoUrl, buildComprehensivePlanPdf, comprehensivePdfAnalytics,
  imageDimensions, PDF_PAGE, NO_PRODUCTS_MESSAGE, SELECTED_LABEL,
} = require(path.join(__dirname, "..", "shared", "pdfExport.js"));

// ---- fixtures ---------------------------------------------------------------

// A valid solid-colour PNG, small enough to build per test; the document
// scales images from their own dimensions, so aspect is what matters.
function pngDataUri(width, height, [r, g, b]) {
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (~c) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

// A JPEG header down to its start-of-frame marker - enough for the
// dimension reader, which is what imageToDataUri's output is read with.
function jpegHeaderDataUri(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, ...app0, ...dqt, ...sof]).toString("base64")}`;
}

const PHOTO_URL = "https://firebasestorage.googleapis.com/v0/b/test/o/plans%2Fu%2FPLAN%2Foriginal.jpg";
const VIZ_URL = (id) => `https://firebasestorage.googleapis.com/v0/b/test/o/viz%2Fu%2FPLAN%2F${id}.jpg`;
const IMAGES = {
  [PHOTO_URL]: pngDataUri(30, 40, [120, 132, 150]),
  [VIZ_URL("simple")]: pngDataUri(40, 40, [30, 158, 82]),
  [VIZ_URL("polished")]: pngDataUri(40, 40, [183, 140, 90]),
  [VIZ_URL("elevated")]: pngDataUri(40, 40, [110, 80, 170]),
};

const task = (id, i) => `${id} task ${i + 1}: clear the lower shelf and group what remains by how often you use it, so the counter reads as one calm surface.`;
const product = (id, i) => ({
  approachId: id, productType: `${id} item ${i + 1}`, shortReason: `${id} reason ${i + 1}`,
  reason: "Keeps loose items findable", icon: "bin", grounding: "observed", relatedProblemIds: [], searchTerms: ["x"],
});
const approach = (id, tasks, products) => ({
  strategyDescription: `Start by clearing the ${id} shelf. Then regroup what remains by how often it is used and give every group a container.`,
  organizingGuidance: ["Guidance one", "Guidance two"],
  keyChanges: ["Clear the counter", "Group by use"],
  taskChecklist: Array.from({ length: tasks }, (_, i) => task(id, i)),
  productRecommendations: Array.from({ length: products }, (_, i) => product(id, i)),
  suggestedAdditionTypes: [], estimatedSpendRange: "$25-$60", visualizationDirection: "x",
});

// The stored shape of a new schemaVersion 3 plan: detail complete, nothing
// committed, one visualization.
const v3Plan = (extra = {}) => ({
  schemaVersion: 3, analysisStage: "complete", scopeSize: "room-section", areaScope: "sub-area",
  spaceName: "Kitchen", areaName: "Pantry Shelf",
  overview: "The shelf holds mixed items with no clear grouping, and the lower half is doing most of the work.",
  proTip: "Keep daily items between eye and hip level; everything else can live higher up.",
  problemsFound: [{ id: "p1", description: "Mixed items" }],
  approaches: { simple: approach("simple", 4, 1), polished: approach("polished", 5, 5), elevated: approach("elevated", 6, 6) },
  selectedApproach: null, approachHistory: [], currentBatch: null, batchHistory: [], progressPhotos: [],
  vizImages: { polished: VIZ_URL("polished") },
  ...extra,
});

const legacyPlan = () => ({
  spaceName: "Kitchen", overview: "The shelf holds mixed items.", proTip: "Keep daily items at eye level.", photoUrl: PHOTO_URL,
  tiers: ["budget", "mid", "premium"].map((id) => ({
    id, label: id, range: "$20-$50", suggestions: ["Group like items"], products: [{ icon: "📦", name: "Clear bins", price: "$15" }],
  })),
});

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
};

// A model as App.js builds it, for the builder tests.
const model = (extra = {}) => ({
  roomLabel: "Kitchen · Pantry Shelf",
  overview: "The shelf holds mixed items with no clear grouping.",
  proTip: "Keep daily items at eye level.",
  photo: IMAGES[PHOTO_URL],
  logo: "",
  selectedApproachId: null,
  approaches: ["simple", "polished", "elevated"].map((id, n) => ({
    id, name: { simple: "Keep It Simple", polished: "Polished & Practical", elevated: "Elevated Finish" }[id],
    strategy: `Strategy for ${id}. More detail follows.`, spendRange: "$25-$60",
    tasks: Array.from({ length: 3 + n }, (_, i) => task(id, i)),
    products: Array.from({ length: 1 + n * 2 }, (_, i) => ({ name: `${id} item ${i + 1}`, why: `${id} reason ${i + 1}` })),
    visualization: null,
  })),
  ...extra,
});

const sheetsOf = (html) => html.split('<div class="sheet">').slice(1);
const sectionOrder = (html) => [...html.matchAll(/<div class="h2">([^<]*)<\/div>/g)].map((m) => m[1]);

// ---- mergeUploadedPhotoUrl --------------------------------------------------

test("a successful upload adds photoUrl to the matching active results", () => {
  const prev = v3Plan();
  const next = mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: PHOTO_URL });
  assert.notEqual(next, prev);
  assert.equal(next.photoUrl, PHOTO_URL);
  assert.equal(prev.photoUrl, undefined, "the previous object is not mutated");
});

test("a different active plan is not changed", () => {
  const prev = v3Plan({ photoUrl: "https://example.test/other.jpg" });
  assert.equal(mergeUploadedPhotoUrl(prev, "OTHER", { planId: "PLAN", photoUrl: PHOTO_URL }), prev);
});

test("null results remain null", () => {
  assert.equal(mergeUploadedPhotoUrl(null, "PLAN", { planId: "PLAN", photoUrl: PHOTO_URL }), null);
  assert.equal(mergeUploadedPhotoUrl(undefined, "PLAN", { planId: "PLAN", photoUrl: PHOTO_URL }), undefined);
});

test("existing detail and visualization fields are preserved", () => {
  const prev = deepFreeze(v3Plan({ selectedApproach: "polished", currentBatch: { batchIndex: 1, items: [] } }));
  const next = mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: PHOTO_URL });
  assert.deepEqual({ ...next, photoUrl: undefined }, { ...prev, photoUrl: undefined });
  assert.equal(next.approaches, prev.approaches);
  assert.equal(next.vizImages, prev.vizImages);
  assert.deepEqual(Object.keys(next).sort(), [...Object.keys(prev), "photoUrl"].sort());
});

test("a late upload cannot overwrite a newer plan's state", () => {
  const planB = deepFreeze(v3Plan({ photoUrl: "https://example.test/b.jpg" }));
  assert.equal(mergeUploadedPhotoUrl(planB, "PLAN_B", { planId: "PLAN_A", photoUrl: PHOTO_URL }), planB);
  assert.equal(mergeUploadedPhotoUrl(planB, null, { planId: "PLAN_A", photoUrl: PHOTO_URL }), planB);
});

test("only a remote URL is merged, never a local cache file", () => {
  const prev = v3Plan();
  const local = "file:///var/mobile/Containers/Data/Library/Caches/ImageManipulator/X.jpg";
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: local }), prev);
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", { planId: "PLAN", photoUrl: null }), prev);
  assert.equal(mergeUploadedPhotoUrl(prev, "PLAN", null), prev);
});

// ---- image dimensions -------------------------------------------------------

test("image dimensions are read from JPEG and PNG data URIs", () => {
  assert.deepEqual(imageDimensions(jpegHeaderDataUri(1400, 1050)), { width: 1400, height: 1050 });
  assert.deepEqual(imageDimensions(pngDataUri(30, 40, [0, 0, 0])), { width: 30, height: 40 });
  assert.equal(imageDimensions("data:image/jpeg;base64,AAAA"), null);
  assert.equal(imageDimensions("https://example.test/x.jpg"), null);
});

// ---- buildComprehensivePlanPdf ----------------------------------------------

test("no selected approach: all three approaches, in order, with no selected badge", () => {
  const { html, stats } = buildComprehensivePlanPdf(model());
  assert.deepEqual(sectionOrder(html), ["Keep It Simple", "Polished &amp; Practical", "Elevated Finish"]);
  assert.ok(!html.includes(SELECTED_LABEL));
  assert.equal(stats.approachCount, 3);
  assert.equal(stats.selectedApproach, null);
});

test("a selected approach still includes all three, and only it carries the badge", () => {
  const input = model({ selectedApproachId: "polished" });
  const { html, stats } = buildComprehensivePlanPdf(input);
  assert.deepEqual(sectionOrder(html), ["Keep It Simple", "Polished &amp; Practical", "Elevated Finish"]);
  const heads = [...html.matchAll(/<div class="approach-head">([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => m[1]);
  assert.equal(heads.length, 3);
  assert.deepEqual(heads.map((h) => h.includes(`<div class="badge">${SELECTED_LABEL}</div>`)), [false, true, false]);
  assert.equal(stats.selectedApproach, "polished");
  // Nothing is removed from the other two.
  const full = buildComprehensivePlanPdf(model());
  assert.equal(stats.taskCount, full.stats.taskCount);
  assert.equal(stats.productCount, full.stats.productCount);
});

test("an unknown selectedApproach is treated as no selection", () => {
  const { html, stats } = buildComprehensivePlanPdf(model({ selectedApproachId: "luxury" }));
  assert.ok(!html.includes(SELECTED_LABEL));
  assert.equal(stats.selectedApproach, null);
});

test("every task from every approach is included, numbered", () => {
  const input = model();
  const { html } = buildComprehensivePlanPdf(input);
  for (const a of input.approaches) {
    a.tasks.forEach((t, i) => {
      const number = String(i + 1).padStart(2, "0");
      assert.ok(html.includes(`<div class="stepno">${number}</div><div class="steptext">${t.replace(/'/g, "&#39;")}</div>`), `${a.id} task ${i + 1}`);
    });
  }
  assert.equal((html.match(/class="step"/g) || []).length, 3 + 4 + 5);
});

test("every product recommendation from every approach is included", () => {
  const input = model();
  const { html } = buildComprehensivePlanPdf(input);
  for (const a of input.approaches) {
    for (const p of a.products) {
      assert.ok(html.includes(`<div class="prodname">${p.name}</div><div class="prodwhy">${p.why}</div>`), `${a.id} ${p.name}`);
    }
  }
  assert.equal((html.match(/class="product-card"/g) || []).length, 1 + 3 + 5);
});

test("an approach with zero products shows the no-products message, not an empty grid", () => {
  const input = model();
  input.approaches[0].products = [];
  const { html } = buildComprehensivePlanPdf(input);
  const simple = html.slice(html.indexOf(`<div class="h2">Keep It Simple</div>`), html.indexOf(`<div class="h2">Polished &amp; Practical</div>`));
  assert.ok(simple.includes(NO_PRODUCTS_MESSAGE));
  assert.ok(!simple.includes('class="prodrow"'));
  assert.equal((html.match(new RegExp(NO_PRODUCTS_MESSAGE.replace(/\./g, "\\."), "g")) || []).length, 1);
});

test("visualizations sit under their own approach, all of them, and missing ones leave nothing", () => {
  const input = model();
  input.approaches[1].visualization = IMAGES[VIZ_URL("polished")];
  input.approaches[2].visualization = IMAGES[VIZ_URL("elevated")];
  const { html, stats } = buildComprehensivePlanPdf(input);
  const at = (s) => html.indexOf(s);
  const polishedViz = at(IMAGES[VIZ_URL("polished")]);
  const elevatedViz = at(IMAGES[VIZ_URL("elevated")]);
  assert.ok(at(`<div class="h2">Polished &amp; Practical</div>`) < polishedViz && polishedViz < at(`<div class="h2">Elevated Finish</div>`), "polished viz inside the polished section");
  assert.ok(at(`<div class="h2">Elevated Finish</div>`) < elevatedViz, "elevated viz inside the elevated section");
  assert.equal((html.match(/<img class="viz"/g) || []).length, 2);
  assert.equal((html.match(/class="viz-section"/g) || []).length, 2, "no section for the approach without one");
  assert.ok(html.includes("Polished &amp; Practical &middot; AI visualization"));
  assert.ok(html.includes("Elevated Finish &middot; AI visualization"));
  assert.ok(!html.includes("Keep It Simple &middot; AI visualization"));
  assert.equal(stats.visualizationCount, 2);
});

test("an unusable image is dropped rather than drawn as a blank box", () => {
  const input = model({ photo: "https://not-inlined.example/x.jpg" });
  input.approaches[0].visualization = "";
  input.approaches[1].visualization = "file:///local.jpg";
  const { html, stats } = buildComprehensivePlanPdf(input);
  assert.ok(!html.includes('<img class="photo"'));
  assert.ok(!html.includes("Your space today"));
  assert.ok(!html.includes('class="viz-section"'));
  assert.equal(stats.hasPhoto, false);
  assert.equal(stats.visualizationCount, 0);
});

test("the photo is sized from its own dimensions, and images are never empty", () => {
  const { html } = buildComprehensivePlanPdf(model({ photo: IMAGES[PHOTO_URL] }));
  const m = html.match(/<img class="photo" src="([^"]+)" width="(\d+)" height="(\d+)"\/>/);
  assert.ok(m, "photo present");
  assert.equal(m[1], IMAGES[PHOTO_URL]);
  assert.ok(Math.abs(Number(m[2]) / Number(m[3]) - 0.75) < 0.01);
  assert.ok(html.includes('<div class="cap">Your space today</div>'));
});

test("every page has the branded header and footer, and page numbers are right", () => {
  const input = model();
  input.approaches.forEach((a) => { a.visualization = IMAGES[VIZ_URL(a.id)]; });
  const { html, stats } = buildComprehensivePlanPdf(input);
  const sheets = sheetsOf(html);
  assert.equal(sheets.length, stats.pageCount);
  assert.ok(stats.pageCount >= 4);
  sheets.forEach((s, n) => {
    assert.ok(s.includes('<div class="brandbar">') && s.includes('<div class="brandrule">'), `header on page ${n + 1}`);
    assert.ok(s.includes(`<div class="foot"><span>Generated by Uncluttrd Pro</span><span>uncluttrd.app &middot; Page ${n + 1} of ${stats.pageCount}</span></div>`), `footer on page ${n + 1}`);
  });
});

test("each approach starts on its own page, and no page is over-filled", () => {
  const input = model();
  input.approaches.forEach((a) => { a.visualization = IMAGES[VIZ_URL(a.id)]; });
  const built = buildComprehensivePlanPdf(input);
  const sheets = sheetsOf(built.html);
  for (const name of ["Keep It Simple", "Polished &amp; Practical", "Elevated Finish"]) {
    const n = sheets.findIndex((s) => s.includes(`<div class="h2">${name}</div>`));
    assert.ok(n > 0, `${name} has a page`);
    assert.match(sheets[n], /<div class="sheet-body"><div class="approach-head">/, `${name} opens its page`);
  }
  built.sheets.forEach((s, n) => assert.ok(s.used <= PDF_PAGE.bodyHeight, `page ${n + 1} estimated ${s.used}px of ${PDF_PAGE.bodyHeight}`));
});

test("follow-on pages are labelled and never nearly empty", () => {
  const input = model();
  input.approaches.forEach((a) => {
    a.tasks = Array.from({ length: 6 }, (_, i) => task(a.id, i) + " Take your time with this one and put back only what earns its place.");
    a.products = Array.from({ length: 6 }, (_, i) => ({ name: `${a.id} item ${i + 1}`, why: "A longer reason that wraps onto a second line on the card" }));
    a.visualization = IMAGES[VIZ_URL(a.id)];
  });
  const built = buildComprehensivePlanPdf(input);
  const sheets = sheetsOf(built.html);
  built.sheets.forEach((s, n) => {
    if (n === 0) return;
    const opensSection = /<div class="sheet-body"><div class="approach-head">/.test(sheets[n]);
    if (!opensSection) {
      assert.ok(s.used - 30 >= PDF_PAGE.bodyHeight * 0.2, `page ${n + 1} holds ${s.used - 30}px`);
      if (!sheets[n].includes('class="card pro-tip"') || s.sections.length > 1) {
        assert.match(sheets[n], /<div class="continued">[^<]+ &middot; continued<\/div>/, `page ${n + 1} is labelled`);
      }
    }
  });
});

test("page 1 lists the approaches with the page each starts on", () => {
  const { html } = buildComprehensivePlanPdf(model({ selectedApproachId: "elevated" }));
  const first = sheetsOf(html)[0];
  assert.ok(first.includes('<div class="lbl">In this plan</div>'));
  const pages = [...first.matchAll(/<div class="contents-page">Page (\d+)<\/div>/g)].map((m) => Number(m[1]));
  const sheets = sheetsOf(html);
  const actual = ["Keep It Simple", "Polished &amp; Practical", "Elevated Finish"].map((name) => 1 + sheets.findIndex((s) => s.includes(`<div class="h2">${name}</div>`)));
  assert.deepEqual(pages, actual);
  assert.ok(first.includes(`<span class="badge badge-sm">${SELECTED_LABEL}</span>`));
});

test("text is escaped", () => {
  const input = model({ overview: "Bins & <baskets>" });
  input.approaches[0].products = [{ name: "Bins & baskets", why: "Use <labels>" }];
  const { html } = buildComprehensivePlanPdf(input);
  assert.ok(html.includes("Bins &amp; &lt;baskets&gt;"));
  assert.ok(html.includes("Use &lt;labels&gt;"));
  assert.ok(!html.includes("<baskets>") && !html.includes("<labels>"));
});

test("analytics: comprehensive format, committed selection only, counts", () => {
  assert.deepEqual(comprehensivePdfAnalytics({ approachCount: 3, visualizationCount: 1, selectedApproach: null }),
    { format: "comprehensive", has_selected_approach: false, approach_count: 3, visualization_count: 1 });
  assert.deepEqual(comprehensivePdfAnalytics({ approachCount: 3, visualizationCount: 2, selectedApproach: "polished" }),
    { format: "comprehensive", has_selected_approach: true, selected_approach: "polished", approach_count: 3, visualization_count: 2 });
});

// ---- print pagination (iOS WebKit page model) -------------------------------
//
// Chrome prints on an 816 x 1056px Letter page whatever the document's width,
// so a Chrome render cannot show this defect. iOS does not: expo-print hands
// WKWebView's print formatter a 612 x 792pt page, and WebKit's PrintContext
// lays the document out at that size times its minimum shrink factor (1.25),
// i.e. 765px wide, widening only when the document is wider, then cuts pages
// of floor(documentWidth x 792 / 612) px (PrintContext::computePageRects).
// Every sheet is followed by a forced break, so each sheet occupies
// ceil(sheetHeight / pageHeight) physical pages. This models exactly that.

const IOS_PRINT = { pointsWide: 612, pointsHigh: 792, minimumShrink: 1.25 };
function iosPhysicalPages({ documentWidth, sheetHeights }) {
  const layoutWidth = Math.max(IOS_PRINT.pointsWide * IOS_PRINT.minimumShrink, documentWidth || 0);
  const pageHeight = Math.floor(layoutWidth * IOS_PRINT.pointsHigh / IOS_PRINT.pointsWide);
  return { layoutWidth, pageHeight, pages: sheetHeights.reduce((n, h) => n + Math.ceil(h / pageHeight), 0) };
}

// The page-box CSS the document actually ships, read back out of its <style>.
function pageBox(html) {
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  const rule = (selector) => {
    const m = css.match(new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : "";
  };
  const px = (decls, prop) => {
    const m = decls.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(-?[\\d.]+)px`));
    return m ? Number(m[1]) : null;
  };
  return { css, rule, px };
}

test("iOS page model reproduces the on-device failure for an unpinned document width", () => {
  // The document as ab35aa8 shipped it: sheets of 1040px, no explicit width,
  // so WebKit prints it at its 765px default - six logical pages become twelve.
  const { layoutWidth, pageHeight, pages } = iosPhysicalPages({ documentWidth: null, sheetHeights: Array(6).fill(1040) });
  assert.equal(layoutWidth, 765);
  assert.equal(pageHeight, 990);
  assert.equal(pages, 12);
});

test("every logical page prints as exactly one physical page on iOS", () => {
  const input = model();
  input.approaches.forEach((a) => { a.visualization = IMAGES[VIZ_URL(a.id)]; });
  for (const variant of [model(), input, model({ selectedApproachId: "polished" })]) {
    const built = buildComprehensivePlanPdf(variant);
    const { rule, px } = pageBox(built.html);
    const docWidth = px(rule("html, body"), "width");
    const sheetWidth = px(rule(".sheet"), "width");
    const sheetHeight = px(rule(".sheet"), "height");
    assert.equal(docWidth, PDF_PAGE.width, "html/body pinned to the Letter width");
    assert.equal(sheetWidth, PDF_PAGE.width, "each sheet is exactly one page wide");
    const sheets = sheetsOf(built.html).length;
    const ios = iosPhysicalPages({ documentWidth: docWidth, sheetHeights: Array(sheets).fill(sheetHeight) });
    assert.equal(ios.pageHeight, PDF_PAGE.height, "WebKit paginates an 816px document at 1056px");
    assert.equal(ios.pages, built.stats.pageCount, "one physical page per logical page");
    assert.ok(sheetHeight <= ios.pageHeight - 8, `a safety allowance remains (${ios.pageHeight - sheetHeight}px)`);
  }
});

test("the page box keeps header, body and footer inside the page height", () => {
  const { html } = buildComprehensivePlanPdf(model());
  const { css, rule, px } = pageBox(html);
  assert.match(css, /@page\s*\{\s*size:\s*letter;\s*margin:\s*0;\s*\}/);
  assert.match(rule("html, body"), /margin:0/);
  assert.match(rule("html, body"), /padding:0/);
  const sheet = rule(".sheet");
  assert.match(sheet, /box-sizing:border-box/);
  assert.match(sheet, /position:relative/);
  assert.match(sheet, /padding:0/);
  assert.match(sheet, /border:0/);
  assert.doesNotMatch(sheet, /overflow\s*:\s*hidden/, "no content is hidden to make the page fit");
  const sheetHeight = px(sheet, "height");

  // Header, body and footer are absolutely positioned inside the sheet and
  // end above its bottom edge; nothing flows after the sheet.
  const headerBottom = px(rule(".brandrule"), "top") + px(rule(".brandrule"), "height");
  const bodyTop = px(rule(".sheet-body"), "top");
  const bodyBottom = bodyTop + px(rule(".sheet-body"), "height");
  const foot = rule(".foot");
  assert.match(foot, /position:absolute/);
  const footTop = sheetHeight - px(foot, "bottom") - px(foot, "height");
  const footBottom = sheetHeight - px(foot, "bottom");
  assert.ok(headerBottom <= bodyTop, "body starts below the header");
  assert.ok(bodyBottom <= footTop, `body (${bodyBottom}) ends above the footer (${footTop})`);
  assert.ok(footBottom <= sheetHeight, "footer inside the sheet");
  assert.ok(sheetHeight <= PDF_PAGE.height, "sheet inside the page");

  // Every sheet carries its own footer inside its own markup.
  sheetsOf(html).forEach((s, n) => {
    const footAt = s.indexOf('<div class="foot">');
    assert.ok(footAt > 0 && footAt > s.indexOf('<div class="sheet-body">'), `footer ${n + 1} is inside sheet ${n + 1}`);
  });
});

test("a break follows every sheet except the last", () => {
  const { html } = buildComprehensivePlanPdf(model());
  const { rule } = pageBox(html);
  assert.match(rule(".sheet"), /page-break-after:always/);
  assert.match(rule(".sheet:last-child"), /page-break-after:auto/);
  assert.match(rule(".sheet:last-child"), /break-after:auto/);
  // The last sheet really is the body's last child: nothing after it could
  // turn it back into a sheet that breaks.
  assert.match(html, /<\/div>\s*<\/div>\s*<\/body><\/html>$/);
  assert.equal(html.slice(html.lastIndexOf('<div class="sheet">')).split('<div class="sheet">').length, 2);
});

test("nothing is wider than the page, so the document width stays exactly one page", () => {
  const input = model();
  input.approaches.forEach((a) => { a.visualization = IMAGES[VIZ_URL(a.id)]; });
  const { html } = buildComprehensivePlanPdf(input);
  const { rule, px } = pageBox(html);
  const inset = px(rule(".sheet-body"), "left");
  for (const m of html.matchAll(/<img class="(photo|viz)" src="[^"]+" width="(\d+)" height="(\d+)"\/>/g)) {
    assert.ok(Number(m[2]) + 2 <= PDF_PAGE.width - inset * 2, `${m[1]} ${m[2]}px fits the content width`);
  }
  assert.ok(px(rule(".product-card"), "width") * 2 + 12 <= PDF_PAGE.width - inset * 2, "two product cards fit");
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
    // BRAND, then APPROACH_META through the product-name helpers the PDF
    // uses; stops before the icon table, which needs the icon imports.
    helpers: slice(source, "\nconst BRAND = {", "\n};\n", { includeEnd: true })
      + slice(source, "\nconst APPROACH_META = {", "\nconst PRODUCT_CATEGORY_ICONS = {", { includeEnd: false })
      + "\n" + slice(source, "\nfunction normalizeProductRecommendation(rec) {", "\n// ===", { includeEnd: false }),
    generatePDF: slice(source, "\n  const generatePDF = async () => {", "\n  };\n", { includeEnd: true }),
  };
}

const WRITE_APIS = ["updateDoc", "setDoc", "addDoc", "deleteDoc", "writeBatch", "arrayUnion", "setResults", "setHistory", "setPreviewApproach", "setCurrentPlanId", "setVizImage"];

// Runs generatePDF and returns the HTML handed to Print.printToFileAsync.
async function renderPdf(source, { results, previewApproach = null, vizImage = {}, images = IMAGES }) {
  const s = pdfSlices(source);
  const calls = [];
  let html = null;
  const env = {
    results, previewApproach, vizImage,
    buildComprehensivePlanPdf, comprehensivePdfAnalytics,
    pdfInFlightRef: { current: false },
    setAsyncBusyText: () => {},
    Print: { printToFileAsync: async (opts) => { html = opts.html; return { uri: "file:///out.pdf" }; } },
    Sharing: { shareAsync: async () => {} },
    logEvent: (_a, name, params) => calls.push({ name, params }),
    getAnalytics: () => null,
    Alert: { alert: (title, message) => { throw new Error(`generatePDF raised "${title}": ${message}`); } },
    getSpaceDisplayName: (r) => r.spaceName || "Room",
    resolveExportIdentity: async () => ({ label: "Kitchen · Pantry Shelf" }),
    imageToDataUri: async (url) => { calls.push({ name: "imageToDataUri", url }); return (url && images[url]) || null; },
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
  const factory = new Function("scope", `with (scope) {\n${s.helpers}\n${s.generatePDF}\nreturn generatePDF;\n}`);
  await factory(scope)();
  assert.ok(html, "generatePDF produced no HTML");
  return { html, calls };
}

test("render: new plan, no selection, one visualization - the complete plan", async () => {
  // photoUrl as the 157b7dc merge leaves it on a newly created plan.
  const results = deepFreeze(mergeUploadedPhotoUrl(v3Plan(), "PLAN", { planId: "PLAN", photoUrl: PHOTO_URL }));
  const before = JSON.stringify(results);
  const { html, calls } = await renderPdf(APP_SOURCE, { results, previewApproach: "elevated" });

  assert.deepEqual(sectionOrder(html), ["Keep It Simple", "Polished &amp; Practical", "Elevated Finish"]);
  assert.ok(sheetsOf(html)[0].includes(`<img class="photo" src="${IMAGES[PHOTO_URL]}"`), "photo on page 1");
  assert.ok(html.includes('<div class="cap">Your space today</div>'));
  assert.ok(html.includes('<div class="lbl">What we noticed</div>'));
  assert.equal((html.match(/class="step"/g) || []).length, 4 + 5 + 6, "every task");
  assert.equal((html.match(/class="product-card"/g) || []).length, 1 + 5 + 6, "every product");
  assert.equal((html.match(/<img class="viz"/g) || []).length, 1);
  assert.ok(html.includes("Polished &amp; Practical &middot; AI visualization"));
  assert.ok(html.includes('class="card pro-tip"'));
  assert.ok(!html.includes(SELECTED_LABEL), "an expanded preview is not a selection");

  // The session's own visualization state is honoured.
  const withSession = await renderPdf(APP_SOURCE, { results, vizImage: { simple: VIZ_URL("simple") } });
  assert.equal((withSession.html.match(/<img class="viz"/g) || []).length, 2);

  assert.deepEqual(calls.find((c) => c.name === "pdf_exported").params,
    { format: "comprehensive", has_selected_approach: false, approach_count: 3, visualization_count: 1 });
  assert.deepEqual(calls.filter((c) => WRITE_APIS.includes(c.name)), [], "nothing persisted or started");
  assert.equal(JSON.stringify(results), before, "plan object untouched");
  assert.equal(results.selectedApproach, null);
});

test("render: selected Polished with visualizations for several approaches", async () => {
  const results = v3Plan({ photoUrl: PHOTO_URL, selectedApproach: "polished", vizImages: { polished: VIZ_URL("polished"), elevated: VIZ_URL("elevated") } });
  const { html, calls } = await renderPdf(APP_SOURCE, { results, vizImage: { simple: VIZ_URL("simple") } });
  assert.deepEqual(sectionOrder(html), ["Keep It Simple", "Polished &amp; Practical", "Elevated Finish"]);
  assert.equal((html.match(new RegExp(`<div class="badge">${SELECTED_LABEL}</div>`, "g")) || []).length, 1);
  assert.equal((html.match(/<img class="viz"/g) || []).length, 3);
  assert.deepEqual(calls.find((c) => c.name === "pdf_exported").params,
    { format: "comprehensive", has_selected_approach: true, selected_approach: "polished", approach_count: 3, visualization_count: 3 });
});

test("render: a zero-product approach shows the message", async () => {
  const results = v3Plan({ photoUrl: PHOTO_URL });
  results.approaches = { ...results.approaches, simple: { ...results.approaches.simple, productRecommendations: [] } };
  const { html } = await renderPdf(APP_SOURCE, { results });
  assert.equal((html.match(/No additional products needed for this approach\./g) || []).length, 1);
});

test("render: a missing photo or visualization leaves no image block", async () => {
  const results = v3Plan({ photoUrl: PHOTO_URL, vizImages: {} });
  const { html } = await renderPdf(APP_SOURCE, { results, images: {} });
  assert.ok(!html.includes("<img class=\"photo\"") && !html.includes("Your space today"));
  assert.ok(!html.includes('class="viz-section"'));
});

test("render: a legacy tier plan stays on the legacy document", async () => {
  const { html, calls } = await renderPdf(APP_SOURCE, { results: legacyPlan(), previewApproach: "polished" });
  assert.equal((html.match(/class="tier"/g) || []).length, 3);
  assert.ok(!html.includes('class="sheet"'));
  assert.ok(!html.includes('class="approach-head"'));
  assert.equal(calls.find((c) => c.name === "pdf_exported").params, undefined);
});

test("generatePDF reads no preview state and makes no write or state-changing call", () => {
  const body = pdfSlices(APP_SOURCE).generatePDF;
  assert.ok(!/\bpreviewApproach\b/.test(body), "generatePDF must not depend on previewApproach");
  for (const api of WRITE_APIS) {
    assert.ok(!new RegExp(`\\b${api}\\s*\\(`).test(body), `generatePDF calls ${api}`);
  }
});
