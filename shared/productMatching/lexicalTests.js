// ===========================================================================
// LEXICAL REGRESSION TESTS
// ===========================================================================
//
//   node shared/productMatching/lexicalTests.js     standalone
//   (also run automatically as section 0 of evaluate.js)
//
// Every NEGATIVE case here is a real collision observed against the 491-row
// Mosaic Awin feed, not an invented one (AwinMosaicFeedValidation.md). Every
// negative is paired with a POSITIVE using the same term, because a matcher
// that fixes false positives by refusing to match anything is not fixed.
// ===========================================================================

const {
  tokenizeText, tokenizeRaw, normalizeToken, matchToken, matchPhrase, findPhrase,
} = require("./lexical");

function run(log = console.log) {
  let pass = 0, fail = 0;
  const ck = (label, ok, detail = "") => {
    ok ? pass++ : fail++;
    log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
  };
  const inText = (text, term) => matchToken(tokenizeText(text), term);

  // -------------------------------------------------------------------------
  log("\n  --- required negatives: term must NOT match inside a longer word ---");
  const NEGATIVES = [
    ["bin", "the ideal combination of comfort and support"],
    ["out", "part of your nighttime routine, ensuring rest"],
    ["art", "a fun, lighthearted vibe to any room"],
    ["mat", "offers the ultimate in comfort"],
    ["light", "make him a delightful addition to the bed"],
    ["table", "universal fit: suitable for all sleepers"],
  ];
  for (const [term, text] of NEGATIVES) {
    const legacy = text.toLowerCase().includes(term);      // the old behaviour
    const now = inText(text, term);
    ck(`"${term}" does NOT match "${text.slice(0, 44)}..."`, now === false,
       legacy ? "old String.includes() matched here" : "");
  }

  // -------------------------------------------------------------------------
  log("\n  --- required positives: the same terms MUST still match legitimately ---");
  const POSITIVES = [
    ["bin", "Stackable Clear Pantry Bin, Set of 6"],
    ["bin", "Fabric Storage Cube Bins"],                    // plural
    ["out", "Pull-Out Cabinet Drawer Organizer"],           // hyphen separator
    ["art", "Framed Wall Art, 16x20 Neutral"],
    ["art", "Gallery wall arts collection"],                // plural
    ["mat", "Memory Foam Bath Mat, Plush Gray"],
    ["mat", "Cotton Tufted Bath Mats"],                     // plural
    ["light", "Battery-Operated LED Puck Light, 6-Pack"],
    ["light", "Rechargeable LED Picture Lights"],           // plural
    ["table", "Ceramic Table Lamp with Linen Shade"],
    ["table", "Console Tables"],                            // plural
  ];
  for (const [term, text] of POSITIVES) {
    ck(`"${term}" MATCHES "${text.slice(0, 44)}"`, inText(text, term) === true);
  }

  // -------------------------------------------------------------------------
  log("\n  --- capitalization, punctuation, separators, possessives ---");
  ck("capitalization ignored", inText("FRAMED WALL ART", "art"));
  ck("comma separated", inText("Bamboo Tray, Large", "tray"));
  ck("hyphen splits into words", inText("3-Tier Kitchen Counter Shelf", "tier"));
  ck("slash splits into words", inText("counter/shelf organizer", "shelf"));
  ck("period does not glue words", inText("Steel. Powder-coated.", "steel"));
  ck("possessive stripped", inText("Mosaic's Weighted Blanket", "mosaic"));
  ck("numbers survive as tokens", inText("11-Inch Rotating Turntable", "11"));
  ck("ampersand splits", inText("Brass & Marble Lamp", "marble"));
  ck("trailing punctuation ignored", inText("a basket.", "basket"));

  // -------------------------------------------------------------------------
  log("\n  --- singular / plural, both directions ---");
  ck("singular query -> plural text", inText("Decorative Bookends", "bookend"));
  ck("plural query -> singular text", inText("Decorative Bookend", "bookends"));
  ck("irregular: shelves -> shelf", inText("Floating Wall Shelf", "shelves"));
  ck("irregular: boxes -> box", inText("Clear Stackable Shoe Box", "boxes"));
  ck("-es plural: dishes -> dish", inText("Stoneware Soap Dish", "dishes"));
  ck('"glass" not stripped to "glas"', inText("Crystal Decanter Glass", "glass"));
  ck('"gas" is not a plural', normalizeToken("gas") === "gas", normalizeToken("gas"));

  // -------------------------------------------------------------------------
  log("\n  --- synonym normalization is SYMMETRIC (both sides) ---");
  ck('query "art" matches text "Artwork"', inText("Framed Artwork", "art"));
  ck('query "artwork" matches text "Art"', inText("Framed Wall Art", "artwork"));
  ck('"artworks" normalizes to "art"', normalizeToken("artworks") === "art",
     normalizeToken("artworks"));

  // -------------------------------------------------------------------------
  log("\n  --- phrase matching: contiguous words only ---");
  ck('"wall art" matches ["framed","wall","art"]',
     matchPhrase(tokenizeText("framed wall art"), tokenizeText("wall art")));
  ck('"wall art" does NOT match ["small","wall","artistic"]',
     !matchPhrase(tokenizeText("small wall artistic piece"), tokenizeText("wall art")),
     "old joined-string check matched this");
  ck('"bath mat" does NOT match ["bath","matte","finish"]',
     !matchPhrase(tokenizeText("bath matte finish"), tokenizeText("bath mat")),
     "old joined-string check matched this");
  ck('"wall art" matches plural ["walls","art"]',
     matchPhrase(tokenizeText("walls art"), tokenizeText("wall art")),
     "old joined-string check MISSED this");
  ck('phrase must be contiguous - "wall big art" does not match',
     !matchPhrase(tokenizeText("wall big art"), tokenizeText("wall art")));
  ck("findPhrase reports position", findPhrase(tokenizeText("a framed wall art print"),
     tokenizeText("wall art")) === 2);

  // -------------------------------------------------------------------------
  log("\n  --- degenerate inputs ---");
  ck("empty text matches nothing", !inText("", "art"));
  ck("empty term matches nothing", !inText("Framed Wall Art", ""));
  ck("punctuation-only text", !inText("!!! ---", "art"));
  ck("term longer than text", !matchPhrase(tokenizeText("art"), tokenizeText("wall art")));
  ck("tokenizeRaw does not normalize", tokenizeRaw("Bookends")[0] === "bookends");
  ck("tokenizeText does normalize", tokenizeText("Bookends")[0] === "bookend");

  return { pass, fail };
}

if (require.main === module) {
  console.log("\n  LEXICAL REGRESSION TESTS");
  const { pass, fail } = run();
  console.log(`\n  ${"=".repeat(50)}`);
  console.log(`  PASS ${pass}   FAIL ${fail}\n`);
  process.exit(fail ? 1 : 0);
}

module.exports = { run };
