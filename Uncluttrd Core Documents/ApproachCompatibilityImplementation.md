# PDF + Share — Approach Schema Compatibility (Implementation Report)

The last two tier-shaped consumers, brought onto the approach schema.
`shareResults` and `generatePDF` both iterated `results.tiers`, which a
schemaVersion 3 plan does not have, so both produced documents with no
plan content in them. Branded PDF is a Pro benefit listed on the paywall.

Branch `feature/companion`. Client-only: no Cloud Function, no rule, no
index. Ships by OTA.

---

## 1. Audit of both consumers

### `shareResults`

**(a) Tier-shaped data it read.** `results.tiers[]`, and per tier
`t.label`, `t.range`, `t.suggestions[]`, `t.products[]` with `p.name` and
`p.price`. Identity came from `getSpaceDisplayName(results)`, which reads
the plan's own `spaceName`/`spaceType`.

**(b) Output it produced.** On an old plan: a header line, the overview,
then one block per tier with numbered suggestions and a priced product
list. On a **new** plan: header, room line, overview, then
`results.tiers?.forEach` iterating nothing — no approach, no guidance, no
recommendations. The optional chain meant it failed silently rather than
throwing, which is why it looked like it worked.

**(c) What had to change.** A format branch; approach-shaped content for
the selected approach; a no-selection path; product output without prices
(the approach schema has no price field at all); and canonical identity.

### `generatePDF`

**(a) Tier-shaped data it read.** `pdfTiers = results.tiers || []`, then
`.find(t => t.id === "budget"|"mid"|"premium")`, and inside `buildTier`:
`t.label`, `t.range`, `t.suggestions[]`, `t.products[]` (`p.icon`,
`p.name`, `p.price`). A hardcoded `tierColors` map keyed by tier id.
Identity again via `getSpaceDisplayName(results)`.

**(b) Output it produced.** Two pages: branded header, room eyebrow,
"Your Organization Plan", overview card, Budget and Mid-Range cards on
page 1, Premium plus Pro Tip on page 2. On a **new** plan all three
`.find()` calls return `undefined`, every `${pdfBudget ? … : ""}` collapses
to empty, and the export is a branded shell containing a room name, the
overview, and a Pro Tip — with the entire plan missing. It still "worked":
a PDF was produced and shared. Notably it never included the photo.

**(c) What had to change.** All of the above, plus optional media (photo
and visualization) that can never block the export, and a genuine
no-selection layout rather than three empty slots.

---

## 2. Format detection

`results.approaches` present → new; otherwise the untouched tier path.
Presence-based, the same discriminator every other reader in the file uses,
because a plan has approaches or tiers and never both — `savePlanToHistory`
writes no `tiers` key at all on a new-format plan.

---

## 3. Canonical Room/Area identity

`resolveExportIdentity()` is shared by both consumers. Room resolution is
`resolveResultsRoomName` itself — live Space from the loaded `rooms` list
first, plan fields only when the Space is genuinely unavailable (deep link,
or My Rooms not visited this session).

Area resolution had no equivalent to reuse. There is no loaded Area list at
export time the way there is a loaded `rooms` list: `roomDetailAreas` is
scoped to whichever Room the user last opened, frequently not this plan's
Room. So the resolver reads the Area document directly — one read is
cheaper than keeping a second cache correct. It follows a `redirectTo`
breadcrumb exactly once (an Area retired by a merge or re-parent), because
those flows already repoint the plan's own `areaId`, so a chain would mean
something else is wrong and looping on user data is never worth it.

The Area **qualifies** the Room and never replaces it — `Corner Shelf`
alone is meaningless to whoever receives the share — so the label is
`Room · Area`.

This matters more for exports than for the Results header: a share or a
PDF is an artifact the user sends to other people, and it should carry the
names the user currently uses, not the label the AI wrote the day the photo
was taken.

---

## 4. Share

**Selected approach** — canonical `Room · Area`, "What we noticed" +
overview, then the selected approach only: name, strategy, numbered
organizing guidance, and recommendations as `type - reason`. Then the Pro
Tip and the existing sign-off.

Reasons come from `resolveRecommendationReason(item, results.problemsFound)`
— the same function the expanded card uses — so the share says what the
user read on screen rather than a second, divergent phrasing.

**No approach selected** — overview, the line *"Three organizing approaches
available in the app."*, and the Pro Tip. Sharing one arbitrary approach
here would misrepresent a decision the user has not made.

**No prices, no retailer links**, by design and not merely by omission: the
approach schema has no price field, a shared message outlives whatever
prices existed when it was sent, and the Amazon search is a live app
affordance rather than something that belongs in a forwarded message.

---

## 5. PDF

A separate document, not a reskin. The tier PDF is a *catalogue* — three
priced options, all shown, because choosing was what the old Results screen
asked the user to do afterwards. An approach plan has already been chosen
inside the app, so its PDF is a *brief* for the approach the user committed
to.

**Selected approach**: header, canonical eyebrow, the original photo
captioned "Your space today", "What we noticed", then the approach card
(pill in the approach's own colour, strategy, organizing guidance,
recommendations as type + reason). Page two carries the visualization for
that approach, the Pro Tip, and the branding footer.

**No selection**: the three approaches as a comparison — name, strategy,
key changes — at the depth the collapsed Results cards themselves show,
plus a line pointing back into the app. Full guidance and products for all
three would be three times the document for a decision not yet made.

**Optional media.** Both the photo and the visualization go through
`imageToDataUri`, which returns `null` on any failure. Images are inlined
as data URIs rather than left as `https` sources because the print renderer
fetches remote images on its own schedule and silently produces a blank box
when it loses the race; a data URI is already there when layout runs. A
missing, deleted, or unreachable image degrades to absent — evidence (k)
and (k2) prove both the absent and the dead-URL cases export normally.

**Escaping.** New PDF text goes through `escHtml`. The existing tier
template interpolates raw, which has been harmless only because tier text
happened never to contain markup; a single `&` or `<` in a product reason
is enough to break the layout.

---

## 6. Staging evidence

Run against `cluttrd-staging`. **13 of 13 passed.**

Builders were extracted from `App.js` and evaluated, so the run produces
the **shipped** artifacts. The PDF HTML was rendered to a real PDF with
headless Chrome and then inspected **as a file** — test (l) is explicit
that the final artifact is what must be checked.

The user's plans were read only. The one write was a scratch Space + Area
created to prove canonical identity, deleted afterwards.

| # | Evidence | Result |
|---|---|---|
| a | Share, new format, approach selected | PASS — 1607 chars; strategy, 4/4 guidance items, 2/2 product types, overview, Pro Tip |
| b | Share, new format, no selection | PASS — 704 chars; overview + Pro Tip + the "three approaches" line, and no approach detail leaks |
| c | Share, old format | PASS — approach branch not entered; tier text still 2748 chars with Budget/Premium/prices |
| d | PDF, new format, selected | PASS — 436 KB, all approach content present in the extracted PDF text |
| e | PDF, new format, no selection | PASS — all three named, all three strategies present, full guidance withheld |
| f | PDF, old format | PASS — plan has no `approaches`, so it reaches the untouched tier template |
| g | Approach names, no tier terminology | PASS |
| h | Products: type + reason, no prices, no links | PASS — no price-like or link-like text; both reasons present |
| i | Visualization present when it exists | PASS — 3 embedded images (header, photo, visualization) + caption |
| k | No visualization → still exports | PASS — 220 KB, exactly one fewer image, no caption |
| k2 | Unloadable visualization → degrades to absent | PASS — exported despite a dead image URL |
| j | Canonical identity beats historical labels | PASS — resolved "RENAMED ROOM (canonical) · RENAMED AREA (canonical)"; zero stale labels in either artifact |
| l | Final artifact verification | PASS — 6 artifacts (2 share strings, 4 rendered PDFs) |

**(j) is the strongest of these.** A real Space and Area were created, the
plan pointed at them, and the plan's own `spaceName`, `spaceType` and
`areaName` were set to `STALE HISTORICAL …`. Anything echoing the plan's
stored labels fails loudly. Neither artifact contained them.

**(l) checked the rendered files**, not the data behind them: extracted
text (no `undefined`/`null`/`NaN`/`[object Object]`, no tier terminology,
no double-escaped entities, no empty sections), byte size, and embedded
image counts. The counts are themselves an assertion — the with-visualization
build carries exactly one more image than the without.

Both layouts were additionally rendered to PNG and inspected visually,
which is the only way to see clipping and broken layout. Both are correct:
branding, eyebrow, photo, overview card, approach card with its coloured
pill, guidance bullets, recommendation rows, and page two with the
visualization or the comparison note.

### Harness bugs found and fixed (none were app bugs)

1. Both share branches open with the identical `let text = "✨ Uncluttrd
   Organization Plan\n";` line, so the extractor's end marker matched
   *inside* the new branch and truncated it mid-block.
2. The first PDF text extractor returned zero characters. Chrome writes
   text as 2-byte CIDs into subset fonts, so the ToUnicode CMaps have to be
   parsed and applied; and `indexOf("stream")` matches `endstream`, which
   alone was enough to find no content streams. The rewritten extractor
   reports font count, code collisions (0) and unmapped glyphs (0), so a
   garbled extraction cannot be mistaken for a passing assertion.
3. PDF text comes out letter-spaced and kern-split ("Y our", "D I N I N G"),
   so containment had to ignore whitespace entirely rather than collapse it.
4. The harness first stubbed `BRAND`, which made the rendered card borders
   and pills look broken in a way the shipped document is not. The real
   palette is now extracted from `App.js`.
5. Earlier crashed runs leaked four scratch Rooms into the user's staging
   Spaces. Found by post-run verification and deleted; the account is back
   to its original 4 active Rooms.

---

## 7. Not verified on a device

No emulator is available here. The share string is pure text and is exactly
what `Share.share` receives. The PDF was rendered by headless Chrome, which
is the same Blink engine Android's `printToFileAsync` uses, but **not** the
identical pipeline — iOS uses UIPrintPageRenderer, and page breaks in
particular can differ. Metro production export is clean.

---

## 8. Out of scope, and one thing worth flagging

The old tier paths are untouched, deliberately, and evidence (c) and (f)
assert it.

**Flagged, not fixed:** the Dining Room plan's Polished approach carries
the recommendation *"Pendant light fixture or chandelier"* and the guidance
*"Add a statement light fixture over the dining table"*. That is the same
evidence-constrained intervention problem the visualization work addressed
on the image side, and these exports now reproduce it faithfully in a Pro
PDF. It was **not** sanitized here on purpose: share and PDF must say what
the app shows on the Results screen, and quietly editing the plan in the
export would make the document disagree with the product. The fix belongs
upstream in the analysis prompt. Note that plan predates the all-fields
evidence rule, and no new-format plan has been created since it shipped,
so whether current analyses still do this is untested.

---

## 9. Deployment

Commit `bcdf13a`, published to `staging`:

| Platform | Update group | Update ID |
|---|---|---|
| Android | `e543ef65-e0c4-4a1f-b0fd-08b167a554d1` | `019ff3c7-2870-7f1f-9067-3c61bb74a4b5` |
| iOS | `a0ba0096-bc1d-499b-8689-a0d7ed4c574c` | `019ff3c7-2870-7b54-9c15-bbdc8623ff36` |

Client-only; no Cloud Function deploy and no index change. Whether a device
has pulled the update cannot be observed from here.
