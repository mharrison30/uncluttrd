// PDF export helpers. Pure and plan-only, so App.js and the node tests
// (scripts/pdfExport.test.js) run the same code. CommonJS for the same
// reason as shared/spaceMigration.js: require() works with no transform.

// Folds a finished original-photo upload into the in-memory Results plan.
// savePlanToHistory writes photoUrl to Firestore and history but the open
// Results object never received it, so the PDF (and the Results photo)
// had nothing to show for a plan created in this session.
//
// Returns `results` itself - same reference, so a React updater is a no-op -
// unless the upload belongs to the plan on screen. Only photoUrl is added;
// every other field, including detail and visualization state that landed
// concurrently, is kept. Only a remote URL is accepted, never the local
// cache file the upload was made from.
function mergeUploadedPhotoUrl(results, activePlanId, upload) {
  if (!results || !upload || !activePlanId) return results;
  if (upload.planId !== activePlanId) return results;
  if (typeof upload.photoUrl !== "string" || !/^https:\/\//i.test(upload.photoUrl)) return results;
  if (results.photoUrl === upload.photoUrl) return results;
  return { ...results, photoUrl: upload.photoUrl };
}

// ===========================================================================
// Comprehensive plan PDF (schemaVersion 3 / approach-format plans)
//
// One document for every approach-format plan: the photo and summary, then
// all three approaches in full - strategy, every task, every product, and
// each approach's visualization - then the Pro Tip. What the user selected
// only adds a label; it never decides what is included.
//
// WHY THE PAGES ARE BUILT HERE. The print renderers repeat nothing: WebKit on
// iOS and Android's WebView both flow content straight across page
// boundaries, so a header drawn once per section is missing from every page
// the section runs onto, and a forced break a few pixels late clips the next
// page's header. Android's print WebView also runs with JavaScript off, so
// the document cannot measure itself either. So the document is paginated
// before it is printed: every page is a fixed-height sheet with its own
// header and footer, filled with blocks whose heights are estimated from
// their text and image dimensions. Estimates are deliberately generous - a
// little unused space at the foot of a page is invisible; an underestimate
// would overflow into the footer.
//
// Every length below is a CSS pixel. The page is US Letter at 96px/in -
// 816 x 1056 - and the document is pinned to exactly that width, because on
// iOS the width is what decides the page height. printToFileAsync hands
// WebKit a 612 x 792pt page; WebKit's print layout (PrintContext) first lays
// the document out at that size times its minimum shrink factor of 1.25,
// 765px wide, and then cuts pages of floor(documentWidth x 792 / 612) px.
// A document that merely fills the view is 765px wide, so its pages are 990px
// tall, not 1056 - which is what split every 1040px sheet in two on iPhone,
// its footer landing alone on a page of its own. A document exactly 816px
// wide is laid out again at 816 and paginated at floor(816 x 792 / 612) =
// 1056px: the same page Chrome and Android print on.
// ===========================================================================

const PAGE = {
  width: 816,
  height: 1056,
  // Short of the page by a safety allowance: each sheet ends in a forced
  // break, so a shortfall is absorbed by that page alone, while an overshoot
  // of even a pixel (float-to-point rounding in the print path) would push a
  // sliver onto an extra blank page.
  safetyAllowance: 16,
  sideInset: 72,
  headerHeight: 84,
  bodyTop: 108,
  footerBottom: 30,
  footerHeight: 24,
};
PAGE.sheetHeight = PAGE.height - PAGE.safetyAllowance;
PAGE.contentWidth = PAGE.width - PAGE.sideInset * 2;
PAGE.bodyHeight = PAGE.sheetHeight - PAGE.footerBottom - PAGE.footerHeight - 18 - PAGE.bodyTop;
// Space a section's "continued" label takes at the top of a follow-on page.
const CONTINUED_HEIGHT = 30;

const DEFAULT_APPROACH_NAMES = { simple: "Keep It Simple", polished: "Polished & Practical", elevated: "Elevated Finish" };
const NO_PRODUCTS_MESSAGE = "No additional products needed for this approach.";
// Rendered only on an approach that actually lists products, because that is
// the only place the document carries a recommendation an affiliate link is
// built from in the app. An approach with none gets NO_PRODUCTS_MESSAGE and
// no disclosure - there is nothing to disclose about. Wording is identical to
// the app's Results screen and to uncluttrd.app/disclosure.
const AFFILIATE_DISCLOSURE = "As an Amazon Associate, Uncluttrd earns from qualifying purchases.";
const SELECTED_LABEL = "Your Selected Approach";

const escHtml = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const cleanText = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

// Lines a run of text wraps to. Plan prose set in Helvetica/Arial (what both
// renderers substitute for Inter) measures about 0.43em per character
// including spaces; 0.47 (0.53 bold) adds the room lost to breaking at word
// boundaries plus a margin, so a line is only ever over-counted.
function estimateLines(text, fontSize, width, { bold = false } = {}) {
  const chars = cleanText(text).length;
  if (!chars) return 0;
  const glyph = fontSize * (bold ? 0.53 : 0.47);
  return Math.max(1, Math.ceil((chars * glyph) / width));
}

// ---- image geometry ---------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeBase64Prefix(b64, maxBytes) {
  const out = [];
  let buf = 0; let bits = 0;
  for (let i = 0; i < b64.length && out.length < maxBytes; i++) {
    const v = B64.indexOf(b64[i]);
    if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return out;
}

// Pixel size of an image data URI: a JPEG's start-of-frame marker (what
// imageToDataUri produces) or a PNG's IHDR. Null when it cannot be read, and
// the caller then assumes a 4:3 photo.
function imageDimensions(dataUri) {
  if (typeof dataUri !== "string") return null;
  const m = dataUri.match(/^data:image\/(jpe?g|png);base64,/i);
  if (!m) return null;
  const bytes = decodeBase64Prefix(dataUri.slice(m[0].length, m[0].length + 262144), 196608);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const u32 = (o) => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
    const width = u32(16); const height = u32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

// Display size for an image inside a box, aspect kept. Explicit pixel sizes
// are what make an image's height knowable before print.
function fitImage(dataUri, maxWidth, maxHeight) {
  const dims = imageDimensions(dataUri) || { width: 4, height: 3 };
  const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
  return { width: Math.floor(dims.width * scale), height: Math.floor(dims.height * scale) };
}

// ---- content model ----------------------------------------------------------

// Normalizes what App.js hands over, so the layout never has to guard
// against missing or malformed plan fields. Approaches without a strategy,
// tasks or products still appear - they are part of the plan - but an
// image that is not a usable data URI is dropped rather than drawn empty.
function normalizeComprehensiveModel(input) {
  const isImage = (v) => typeof v === "string" && /^data:image\/(jpe?g|png|webp|gif|svg\+xml);base64,/i.test(v);
  const approaches = (Array.isArray(input.approaches) ? input.approaches : [])
    .filter((a) => a && typeof a.id === "string")
    .map((a) => ({
      id: a.id,
      name: cleanText(a.name) || DEFAULT_APPROACH_NAMES[a.id] || a.id,
      strategy: cleanText(a.strategy),
      spendRange: cleanText(a.spendRange),
      tasks: (Array.isArray(a.tasks) ? a.tasks : []).map(cleanText).filter(Boolean),
      products: (Array.isArray(a.products) ? a.products : [])
        .map((p) => ({ name: cleanText(p && p.name), why: cleanText(p && p.why) }))
        .filter((p) => p.name),
      visualization: isImage(a.visualization) ? a.visualization : null,
    }));
  const selectedId = approaches.some((a) => a.id === input.selectedApproachId) ? input.selectedApproachId : null;
  return {
    roomLabel: cleanText(input.roomLabel) || "Your Space",
    overview: cleanText(input.overview),
    proTip: cleanText(input.proTip),
    photo: isImage(input.photo) ? input.photo : null,
    logo: typeof input.logo === "string" ? input.logo : "",
    approaches,
    selectedId,
  };
}

// ---- blocks -----------------------------------------------------------------
// A block is the unit that is never split across pages: { height, gapBefore,
// keepWithNext, html(isFirstOnSheet) }. gapBefore is dropped at the top of a
// sheet. keepWithNext holds a heading on the same page as what it heads.

const W = PAGE.contentWidth;

const leadSplit = (text) => {
  const m = text.match(/^(.+?[.!?])(\s+)(.*)$/s);
  if (!m || m[1].length > 140) return escHtml(text);
  return `<span class="lead">${escHtml(m[1])}</span> ${escHtml(m[3])}`;
};

const gapStyle = (gap, first) => `style="margin-top:${first ? 0 : gap}px"`;

function pageOneBlocks(model) {
  const blocks = [];
  blocks.push({
    height: 22 + 44,
    keepWithNext: true,
    html: () => `<div class="eyebrow">${escHtml(model.roomLabel)}</div><div class="h1">Your Organization Plan</div>`,
  });
  if (model.photo) {
    const size = fitImage(model.photo, 520, 330);
    blocks.push({
      height: size.height + 2 + 28,
      gapBefore: 4,
      html: (first) => `<div class="photo-section" ${gapStyle(4, first)}>
          <img class="photo" src="${model.photo}" width="${size.width}" height="${size.height}"/>
          <div class="cap">Your space today</div>
        </div>`,
    });
  }
  if (model.overview) {
    const lines = estimateLines(model.overview, 12.5, W - 38);
    blocks.push({
      height: 34 + 22 + lines * 21 + 4,
      gapBefore: 18,
      html: (first) => `<div class="card summary" ${gapStyle(18, first)}>
          <div class="lbl">What we noticed</div>
          <div class="body">${escHtml(model.overview)}</div>
        </div>`,
    });
  }
  return blocks;
}

// The optional "In this plan" list on page 1, added only when it fits in the
// space page 1 has left. Page numbers are filled in once the rest of the
// document has been laid out.
function contentsBlock(model) {
  return {
    height: 26 + model.approaches.length * 44,
    gapBefore: 20,
    html: (first, pageOf) => `<div class="contents" ${gapStyle(20, first)}>
        <div class="lbl">In this plan</div>
        ${model.approaches.map((a) => `<div class="contents-row">
            <div><span class="contents-name">${escHtml(a.name)}</span>${a.id === model.selectedId ? ` <span class="badge badge-sm">${SELECTED_LABEL}</span>` : ""}
              <div class="contents-meta">${a.tasks.length} task${a.tasks.length === 1 ? "" : "s"} &middot; ${a.products.length} product${a.products.length === 1 ? "" : "s"}${a.visualization ? " &middot; visualization" : ""}${a.spendRange ? ` &middot; ${escHtml(a.spendRange)}` : ""}</div>
            </div>
            <div class="contents-page">Page ${pageOf(a.id)}</div>
          </div>`).join("")}
      </div>`,
  };
}

function approachBlocks(model, a, index) {
  const blocks = [];
  const selected = a.id === model.selectedId;
  const strategyLines = estimateLines(a.strategy, 12.5, W);
  blocks.push({
    section: a.id,
    isSectionHead: true,
    height: 20 + 38 + (selected ? 32 : 0) + (a.spendRange ? 22 : 0) + (a.strategy ? 8 + strategyLines * 21 : 0) + 6,
    keepWithNext: true,
    html: () => `<div class="approach-head">
        <div class="eyebrow">Approach ${index + 1} of ${model.approaches.length}</div>
        <div class="h2">${escHtml(a.name)}</div>
        ${selected ? `<div class="badge">${SELECTED_LABEL}</div>` : ""}
        ${a.spendRange ? `<div class="spend">Estimated spend: ${escHtml(a.spendRange)}</div>` : ""}
        ${a.strategy ? `<div class="body strategy">${leadSplit(a.strategy)}</div>` : ""}
      </div>`,
  });

  if (a.tasks.length) {
    // The heading travels with the first task, so it can never end a page.
    const taskHeight = (t) => 20 + estimateLines(t, 12, W - 38) * 19 + 1;
    a.tasks.forEach((t, i) => {
      const number = String(i + 1).padStart(2, "0");
      const row = `<div class="step"><div class="stepno">${number}</div><div class="steptext">${escHtml(t)}</div></div>`;
      blocks.push(i === 0
        ? {
          section: a.id, height: 30 + taskHeight(t), gapBefore: 20,
          html: (first) => `<div ${gapStyle(20, first)}><div class="lbl">Your action plan &middot; ${a.tasks.length} task${a.tasks.length === 1 ? "" : "s"}</div>${row}</div>`,
        }
        : { section: a.id, height: taskHeight(t), html: () => row });
    });
  }

  const productHeading = `<div class="lbl">Products for this approach</div>`;
  if (!a.products.length) {
    blocks.push({
      section: a.id, height: 30 + 50, gapBefore: 20,
      html: (first) => `<div ${gapStyle(20, first)}>${productHeading}<div class="card note">${NO_PRODUCTS_MESSAGE}</div></div>`,
    });
  } else {
    const cardWidth = (W - 12) / 2 - 24 - 27;
    const cardHeight = (p) => 22 + estimateLines(p.name, 11.5, cardWidth, { bold: true }) * 16 + (p.why ? 3 + estimateLines(p.why, 10.5, cardWidth) * 16 : 0) + 2;
    const cell = (p) => `<div class="product-card"><span class="prodicon"></span><div>
        <div class="prodname">${escHtml(p.name)}</div>${p.why ? `<div class="prodwhy">${escHtml(p.why)}</div>` : ""}
      </div></div>`;
    for (let i = 0; i < a.products.length; i += 2) {
      const pair = a.products.slice(i, i + 2);
      const height = Math.max(...pair.map(cardHeight)) + 12;
      const row = `<div class="prodrow">${cell(pair[0])}${pair[1] ? cell(pair[1]) : `<div class="product-card empty-cell"></div>`}</div>`;
      blocks.push(i === 0
        ? {
          // +20 for the disclosure line below the sub-label. Generous by one
          // line, per this file's own estimate policy: unused space at the
          // foot of a page is invisible, an underestimate clips.
          section: a.id, height: 30 + 22 + 20 + height, gapBefore: 20,
          html: (first) => `<div ${gapStyle(20, first)}>${productHeading}<div class="sublbl">A quick shopping list. Open Uncluttrd to browse options for each recommendation.</div><div class="affiliate">${AFFILIATE_DISCLOSURE}</div>${row}</div>`,
        }
        : { section: a.id, height, html: () => row });
    }
  }

  if (a.visualization) blocks.push(vizBlock(a, VIZ_MAX_HEIGHT));
  return blocks;
}

// Capped so an image always fits on a page of its own with its caption, and
// allowed to give up height down to VIZ_MIN_HEIGHT when that is what keeps
// the next block (most often the Pro Tip) off a page of its own.
const VIZ_MAX_HEIGHT = Math.min(560, PAGE.bodyHeight - CONTINUED_HEIGHT - 60);
const VIZ_MIN_HEIGHT = 400;
function vizBlock(a, maxHeight) {
  const size = fitImage(a.visualization, W, maxHeight);
  return {
    section: a.id,
    height: size.height + 2 + 30,
    gapBefore: 22,
    shrinkTo: (h) => (h < size.height && h >= VIZ_MIN_HEIGHT ? vizBlock(a, h) : null),
    imageHeight: size.height,
    html: (first) => `<div class="viz-section" ${gapStyle(22, first)}>
        <img class="viz" src="${a.visualization}" width="${size.width}" height="${size.height}"/>
        <div class="cap">${escHtml(a.name)} &middot; AI visualization</div>
      </div>`,
  };
}

function proTipBlock(model) {
  const lines = estimateLines(model.proTip, 12.5, W - 38);
  return {
    height: 34 + 22 + lines * 21 + 4,
    gapBefore: 24,
    html: (first) => `<div class="card pro-tip" ${gapStyle(24, first)}>
        <div class="lbl">Pro tip</div>
        <div class="body">${escHtml(model.proTip)}</div>
      </div>`,
  };
}

// ---- pagination -------------------------------------------------------------

// Places blocks on sheets. A section flagged newPage starts a fresh sheet.
// A block moves to the next sheet when it (plus anything it must stay with)
// does not fit. Sheets that do not open a section reserve room for the
// "continued" label.
function paginate(sections) {
  const sheets = [];
  const open = (reserve) => { const s = { blocks: [], used: reserve, reserve }; sheets.push(s); return s; };
  const blockHeight = (b, sheet) => b.height + (sheet.blocks.length ? (b.gapBefore || 0) : 0);

  let sheet = null;
  for (const section of sections) {
    if (!sheet || section.newPage) sheet = open(0);
    const blocks = section.blocks;
    for (let i = 0; i < blocks.length; i++) {
      // A keepWithNext chain is placed as one unit for the fit test.
      let need = blockHeight(blocks[i], sheet);
      for (let j = i; blocks[j].keepWithNext && j + 1 < blocks.length; j++) need += blocks[j + 1].height + (blocks[j + 1].gapBefore || 0);
      if (sheet.blocks.length && sheet.used + need > PAGE.bodyHeight) {
        // A visualization that does not fit may take the room that is left,
        // down to its minimum, rather than start a page of its own.
        const room = PAGE.bodyHeight - sheet.used - (blocks[i].gapBefore || 0);
        const smaller = blocks[i].shrinkTo && !blocks[i].keepWithNext ? blocks[i].shrinkTo(room - (blocks[i].height - blocks[i].imageHeight)) : null;
        if (smaller && smaller.height <= room) {
          blocks[i] = smaller;
        } else if (!shrinkToFit(sheet, sheet.used + need - PAGE.bodyHeight)) {
          sheet = open(CONTINUED_HEIGHT);
        }
      }
      sheet.used += blockHeight(blocks[i], sheet);
      sheet.blocks.push(blocks[i]);
    }
  }
  rebalance(sheets);
  return sheets;
}

// Frees `shortfall` px on a sheet by shrinking its visualizations, largest
// first, if they can give that much between them. All or nothing.
function shrinkToFit(sheet, shortfall) {
  const candidates = sheet.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.shrinkTo)
    .sort((x, y) => y.b.imageHeight - x.b.imageHeight);
  const slack = candidates.reduce((n, { b }) => n + (b.imageHeight - VIZ_MIN_HEIGHT), 0);
  if (!candidates.length || slack < shortfall) return false;
  let remaining = shortfall;
  for (const { b, i } of candidates) {
    if (remaining <= 0) break;
    const give = Math.min(b.imageHeight - VIZ_MIN_HEIGHT, remaining + 2);
    const smaller = b.shrinkTo(b.imageHeight - give);
    if (!smaller) continue;
    remaining -= b.height - smaller.height;
    sheet.blocks[i] = smaller;
  }
  recount(sheet);
  return remaining <= 0;
}

const recount = (s) => {
  s.used = s.reserve;
  s.blocks.forEach((b, i) => { s.used += b.height + (i ? (b.gapBefore || 0) : 0); });
};

// A follow-on sheet holding a single product row or a Pro Tip on its own
// reads as a mistake. When a follow-on sheet fills less than a fifth of the page, trailing
// blocks move down from the sheet before it - never a section heading, never
// leaving a heading stranded at the foot of the previous page, and only while
// that previous page stays well filled and the moved block still fits.
function rebalance(sheets) {
  const minFill = PAGE.bodyHeight * 0.2;
  for (let s = 1; s < sheets.length; s++) {
    const cur = sheets[s];
    const prev = sheets[s - 1];
    if (cur.reserve === 0) continue; // opens a section: its space is intentional
    while (cur.used - cur.reserve < minFill && prev.blocks.length > 1) {
      const last = prev.blocks[prev.blocks.length - 1];
      const before = prev.blocks[prev.blocks.length - 2];
      if (last.isSectionHead || before.keepWithNext) break;
      const moved = [last, ...cur.blocks];
      const trial = { blocks: moved, reserve: cur.reserve };
      recount(trial);
      const prevTrial = { blocks: prev.blocks.slice(0, -1), reserve: prev.reserve };
      recount(prevTrial);
      if (trial.used > PAGE.bodyHeight || prevTrial.used - prevTrial.reserve < PAGE.bodyHeight * 0.25) break;
      prev.blocks.pop(); cur.blocks = moved;
      recount(prev); recount(cur);
    }
  }
}

// ---- document ---------------------------------------------------------------

const CSS = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size: letter; margin: 0; }
  /* Exactly one page wide - see PAGE. Wider would shrink every page; narrower
     (including "auto", which is WebKit's 765px print view on iOS) makes the
     pages shorter than the sheets. */
  html, body { width:${PAGE.width}px; margin:0; padding:0; font-family:Inter,Helvetica,Arial,sans-serif; background:#FFFFFF; color:#0F2A52; }
  /* One sheet per page: border-box, a fixed height inside the page, and the
     header, body and footer all positioned within it. No overflow clipping -
     the layout keeps content inside the body, and nothing is silently cut. */
  .sheet { position:relative; box-sizing:border-box; width:${PAGE.width}px; height:${PAGE.sheetHeight}px; margin:0; padding:0; border:0;
           page-break-after:always; break-after:page; page-break-inside:avoid; break-inside:avoid; }
  .sheet:last-child { page-break-after:auto; break-after:auto; }

  .brandbar { position:absolute; top:0; left:0; right:0; height:${PAGE.headerHeight - 4}px; background:#0F2A52;
              padding:0 ${PAGE.sideInset}px; display:flex; align-items:center; justify-content:space-between; }
  .brandrule { position:absolute; top:${PAGE.headerHeight - 4}px; left:0; right:0; height:4px; background:#3FC77A; }
  .brandleft { display:flex; align-items:center; }
  .ulogo { width:52px; height:52px; margin-right:12px; display:block; }
  .brandmark { color:#FFFFFF; font-size:19px; line-height:22px; font-weight:700; letter-spacing:-0.2px; }
  .tagline { margin-top:3px; font-size:7.5px; line-height:10px; font-weight:600; letter-spacing:1.1px; }
  .t-green { color:#10B43E; } .t-blue { color:#5B9BF0; } .t-white { color:#FFFFFF; }
  .brandright { text-align:right; }
  .br1 { color:#FFFFFF; font-size:9px; line-height:12px; font-weight:700; letter-spacing:1.2px; }
  .br2 { color:#C6D2E4; font-size:8.5px; line-height:12px; margin-top:2px; }

  .sheet-body { position:absolute; top:${PAGE.bodyTop}px; left:${PAGE.sideInset}px; right:${PAGE.sideInset}px; height:${PAGE.bodyHeight}px;
                overflow-wrap:break-word; }
  .continued { height:${CONTINUED_HEIGHT}px; font-size:9.5px; line-height:14px; font-weight:700; letter-spacing:1.2px;
               text-transform:uppercase; color:#8A94A6; }
  .foot { position:absolute; left:${PAGE.sideInset}px; right:${PAGE.sideInset}px; bottom:${PAGE.footerBottom}px; height:${PAGE.footerHeight}px;
          border-top:1px solid #E2E6EC; padding-top:8px; display:flex; justify-content:space-between;
          font-size:8.5px; line-height:12px; color:#8A94A6; }

  .eyebrow { font-size:10px; line-height:14px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; color:#166E38; margin-bottom:8px; }
  .h1 { font-size:30px; line-height:36px; font-weight:700; color:#0F2A52; letter-spacing:-0.5px; margin-bottom:8px; }
  .h2 { font-size:25px; line-height:30px; font-weight:700; color:#0F2A52; letter-spacing:-0.4px; margin-bottom:8px; }
  .lbl { font-size:9px; line-height:12px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; color:#64748B; margin-bottom:10px; }
  .sublbl { font-size:11px; line-height:16px; color:#64748B; margin:-4px 0 6px 0; }
  .affiliate { font-size:10px; line-height:14px; color:#8A94A6; margin:0 0 6px 0; }
  .body { font-size:12.5px; line-height:21px; color:#3D4A5C; }
  .lead { font-weight:700; color:#0F2A52; }

  .photo-section, .viz-section { text-align:center; }
  .photo, .viz { display:block; margin:0 auto; border-radius:10px; border:1px solid #D7DCE3; }
  .cap { font-size:8.5px; line-height:12px; font-weight:700; letter-spacing:1.3px; text-transform:uppercase; color:#8A94A6; text-align:center; margin-top:10px; }

  .card { border-radius:10px; padding:16px 18px; }
  .summary { background:#F7F8FA; border:1px solid #E2E6EC; }
  .note { background:#F7F8FA; border:1px solid #E9ECF1; font-size:11.5px; line-height:16px; color:#5D6B7F; padding:15px 16px; }
  .pro-tip { background:#EAF7EF; border:1px solid #A8DDBF; }
  .pro-tip .lbl { color:#166E38; }
  .pro-tip .body { color:#1B5E34; }

  .contents-row { display:flex; justify-content:space-between; align-items:center; height:44px; border-bottom:1px solid #EDEFF3; }
  .contents-name { font-size:12.5px; line-height:16px; font-weight:700; color:#0F2A52; }
  .contents-meta { font-size:10px; line-height:14px; color:#6B7787; margin-top:2px; }
  .contents-page { font-size:10px; line-height:14px; font-weight:700; color:#166E38; white-space:nowrap; margin-left:12px; }

  .badge { display:inline-block; background:#EAF7EF; border:1px solid #A8DDBF; color:#166E38; border-radius:12px;
           font-size:9.5px; line-height:12px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase; padding:5px 11px; margin-bottom:8px; }
  .badge-sm { font-size:7.5px; line-height:10px; padding:2px 7px; margin:0 0 0 6px; vertical-align:2px; }
  .spend { font-size:11px; line-height:16px; color:#64748B; margin-bottom:6px; }
  .strategy { margin-top:8px; }

  .step { display:flex; padding:10px 0; border-bottom:1px solid #EDEFF3; }
  .stepno { width:38px; flex:0 0 38px; font-size:12px; line-height:19px; font-weight:700; color:#166E38; }
  .steptext { font-size:12px; line-height:19px; color:#3D4A5C; }

  .prodrow { display:flex; justify-content:space-between; align-items:stretch; padding-top:12px; }
  .product-card { width:${(W - 12) / 2}px; background:#F7F8FA; border:1px solid #E9ECF1; border-radius:8px;
                  padding:11px 12px; display:flex; align-items:flex-start; }
  .empty-cell { visibility:hidden; }
  .prodicon { width:17px; height:17px; flex:0 0 17px; border-radius:4px; background:#166E38; margin-right:10px; margin-top:1px; }
  .prodname { font-size:11.5px; line-height:16px; font-weight:700; color:#0F2A52; }
  .prodwhy { font-size:10.5px; line-height:16px; color:#6B7787; margin-top:3px; }
`;

function header(model, continuation) {
  return `<div class="brandbar">
      <div class="brandleft">
        ${model.logo ? `<img class="ulogo" src="${model.logo}"/>` : ""}
        <div>
          <div class="brandmark">Uncluttrd</div>
          <div class="tagline"><span class="t-green">MORE SPACE.</span> <span class="t-blue">MORE TIME.</span> <span class="t-white">MORE YOU.</span></div>
        </div>
      </div>
      ${continuation ? `<div class="brandright"><div class="br1">${escHtml(model.roomLabel)}</div><div class="br2">Organization Plan</div></div>` : ""}
    </div>
    <div class="brandrule"></div>`;
}

// Builds the whole document. Returns the HTML plus what went into it, which
// is also what the export's analytics report.
function buildComprehensivePlanPdf(input) {
  const model = normalizeComprehensiveModel(input || {});
  const sections = [{ id: "cover", newPage: true, blocks: pageOneBlocks(model) }];
  model.approaches.forEach((a, i) => sections.push({ id: a.id, newPage: true, blocks: approachBlocks(model, a, i) }));
  if (model.proTip) sections.push({ id: "final", newPage: false, blocks: [proTipBlock(model)] });

  const sheets = paginate(sections);

  // The contents list joins page 1 only if page 1 still has room for it.
  const contents = contentsBlock(model);
  const cover = sheets[0];
  const coverGap = cover.blocks.length ? contents.gapBefore : 0;
  if (model.approaches.length && cover.used + contents.height + coverGap <= PAGE.bodyHeight
      && cover.blocks.every((b) => !b.section)) {
    cover.blocks.push(contents);
    cover.used += contents.height + coverGap;
  }

  const pageOf = (id) => 1 + sheets.findIndex((s) => s.blocks.some((b) => b.isSectionHead && b.section === id));
  const total = sheets.length;
  const body = sheets.map((s, n) => {
    const first = s.blocks[0];
    const continued = n > 0 && first && first.section && !first.isSectionHead
      ? `<div class="continued">${escHtml((model.approaches.find((a) => a.id === first.section) || {}).name || "")} &middot; continued</div>`
      : "";
    return `<div class="sheet">
        ${header(model, n > 0)}
        <div class="sheet-body">${continued}${s.blocks.map((b, i) => b.html(i === 0, pageOf)).join("")}</div>
        <div class="foot"><span>Generated by Uncluttrd Pro</span><span>uncluttrd.app &middot; Page ${n + 1} of ${total}</span></div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>${body}</body></html>`;
  return {
    html,
    stats: {
      pageCount: total,
      approachCount: model.approaches.length,
      visualizationCount: model.approaches.filter((a) => a.visualization).length,
      taskCount: model.approaches.reduce((n, a) => n + a.tasks.length, 0),
      productCount: model.approaches.reduce((n, a) => n + a.products.length, 0),
      hasPhoto: !!model.photo,
      selectedApproach: model.selectedId,
    },
    // Estimated content height per sheet, for tests.
    sheets: sheets.map((s) => ({ used: s.used, sections: [...new Set(s.blocks.map((b) => b.section || "cover"))], blockHeights: s.blocks.map((b, i) => b.height + (i ? (b.gapBefore || 0) : 0)) })),
  };
}

// The pdf_exported event's parameters. Counts and the committed selection
// only - never plan text, and never preview state.
function comprehensivePdfAnalytics(stats) {
  const params = {
    format: "comprehensive",
    has_selected_approach: !!stats.selectedApproach,
    approach_count: stats.approachCount,
    visualization_count: stats.visualizationCount,
  };
  if (stats.selectedApproach) params.selected_approach = stats.selectedApproach;
  return params;
}

module.exports = {
  mergeUploadedPhotoUrl,
  buildComprehensivePlanPdf,
  comprehensivePdfAnalytics,
  imageDimensions,
  estimateLines,
  PDF_PAGE: PAGE,
  NO_PRODUCTS_MESSAGE,
  AFFILIATE_DISCLOSURE,
  SELECTED_LABEL,
};
