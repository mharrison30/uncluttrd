# AI Analysis Redesign — Phase B.1 Implementation Report

Implements the redesigned prompt from `AIAnalysisRedesign.md`. All changes are in `App.js`. No changes to `functions/index.js` or `shared/spaceMigration.js`.

## What changed

**1. The live prompt** (`analyze()`'s `approachesInstruction` and the JSON schema it builds)

Replaced entirely with the design doc's redesigned instructions: `identificationInstruction` (fact-vs-inference cataloging with `certainty`), `certaintyFirewallInstruction` (the "never launder certainty downstream" rule), `opportunitiesInstruction` (organization vs. completion-opportunity problems, with the anti-hallucination guardrail), `visionApproachesInstruction` (ambition/scope-differentiated approaches, not price-differentiated), `taskDifferentiationInstruction` (explicit behavioral-difference requirement), `productInstruction` (opportunity-driven, non-organizing recommendations allowed), `keyChangesInstruction` (new field), `vizAndSpendInstruction` (unchanged spend-band table, one added clause), and `prohibitionsInstruction` (Section 9's closing block). `scopeClassificationInstruction` and `roomAreaInstruction` are untouched, exactly as the design doc scoped.

Before writing any of this, I diffed the new App.js prompt text against the exact text already real-tested in the investigation phase (`redesigned_prompt.txt`) — byte-identical everywhere except inside the untouched `roomAreaInstruction`, where the live file simply has more complete text than what I'd typed into the investigation's own standalone test script. Confirmed by isolating the comparison to before/after that section: **everything I actually changed is byte-for-byte identical to what was already validated at 9.5/10.**

JSON schema changes: `itemsFound` is now `[{description, certainty}]` (was a flat string array); `problemsFound` entries gain `type: "organization" | "opportunity"`; each approach gains `keyChanges: string[]`.

**2. `normalizeItemsFound(itemsFound)`** (new, module-level, next to `withLiveSpaceIdentity`)

One pure helper: accepts either shape (legacy strings or `{description, certainty}` objects, or a mix), returns a flat array of display strings. Malformed/missing entries are silently dropped rather than throwing.

Wired into `generateVisualization`'s image-gen prompt (`results.itemsFound?.join(", ")` → `normalizeItemsFound(results.itemsFound).join(", ")`) — the one place in the whole file that actually consumed `itemsFound` as a joinable list before this change.

**A scope note worth being upfront about:** the task asked for "Results, PDF export, native share" to all use this helper. I checked all three (`shareResults`, `generatePDF`, and the Results screen's approach-card UI) and none of them currently render `itemsFound` at all — `shareResults` and `generatePDF` are both still entirely `results.tiers`-only (old-format), a pre-existing gap from Phase B that this task didn't ask me to close, and the Results screen's approach cards (also Phase B) never showed `itemsFound` either. I built the helper generically so whenever new-format share/PDF/itemsFound-display support is added, it's ready — but I didn't add new visible `itemsFound` UI to any of the three, since that would mean designing and shipping new user-facing content beyond an AI-prompt-redesign task's scope, not just "use the helper." Flagging this rather than silently doing nothing or silently expanding scope.

**3. `savePlanToHistory`**: `schemaVersion` bumped 2 → 3. `itemsFound`/`problemsFound`/`approaches` are still stored as whole objects (`itemsFound: plan.itemsFound`, etc.) — no reconstruction needed, since nothing in that function inspects their internal shape. `keyChanges` flows through automatically as part of `plan.approaches`, with no dedicated storage line needed.

No other code reads `schemaVersion` at runtime anywhere in the file (confirmed by grep) — the real format discriminator remains `plan.approaches` vs. `plan.tiers` presence, unchanged. The bump is documentation/lineage only, matching the existing 1→2 comment's own precedent.

**4. Old-format rendering**: confirmed untouched by direct diff inspection — zero changed lines anywhere near the `results.tiers?.map(...)` block, and zero references to `problemsFound`'s new `type` field or `keyChanges` anywhere in rendering code (neither is rendered anywhere yet, so no shim was needed for either — only `itemsFound` had a real consumer to fix).

## Testing (real staging, `cluttrd-staging`)

`node -c App.js` and a full `expo export --platform ios` (bundle compiled clean) after every edit.

### Prompt-fidelity check (before spending API calls on it)

Reconstructed the exact prompt App.js now builds (by literally copying its own const declarations into a Node script) and diffed it character-for-character against the prompt already validated in the investigation phase. Identical except inside the deliberately-untouched `roomAreaInstruction` (see above) — confirmed by isolating the comparison to the text before and after that section.

### Test 1: same dining room photo (plan `YuUjInu510F0peWF6e0H`'s photo), live prompt, real `analyzePhoto` call

Full real output:

```json
{
  "suggestedRoomName": "Dining Room",
  "suggestedAreaName": null,
  "areaScope": "whole-room",
  "overview": "Your dining room has a clean foundation with a modern table, seating, and storage credenza, but it's not quite pulling together as a cohesive, finished space. With a few intentional touches and some purposeful styling, this room can feel warm, inviting, and completely put together.",
  "itemsFound": [
    { "description": "round wooden dining table with dark metal base", "certainty": "confirmed" },
    { "description": "four black upholstered dining chairs with metal frames", "certainty": "confirmed" },
    { "description": "one black bar stool or counter-height chair at left edge", "certainty": "confirmed" },
    { "description": "black credenza with glass-fronted doors containing glassware and bottles", "certainty": "confirmed" },
    { "description": "three liquor or spirit bottles on top of credenza", "certainty": "confirmed" },
    { "description": "clear glass decanter on top of credenza", "certainty": "confirmed" },
    { "description": "small framed item, possibly a photograph, on top of credenza", "certainty": "confirmed" },
    { "description": "flat rectangular item on table surface, appears to be a tray or placemat", "certainty": "uncertain" },
    { "description": "boxed item or package on table surface with orange and white coloring", "certainty": "uncertain" },
    { "description": "small electronic device or router on floor in lower right corner", "certainty": "uncertain" },
    { "description": "framed artwork depicting an animal in the recessed niche", "certainty": "confirmed" },
    { "description": "recessed wall niche behind dining table", "certainty": "confirmed" },
    { "description": "recessed ceiling lighting fixtures", "certainty": "confirmed" },
    { "description": "light-colored walls throughout the room", "certainty": "confirmed" },
    { "description": "dark wood-tone flooring", "certainty": "confirmed" },
    { "description": "wall to the right of the niche with no decor or art", "certainty": "confirmed" },
    { "description": "wall to the left of the niche with no decor or art", "certainty": "confirmed" }
  ],
  "problemsFound": [
    { "id": "table-clutter", "type": "organization", "description": "The dining table has a flat rectangular item and a boxed item on its surface, preventing it from being ready for meals or gatherings." },
    { "id": "floor-device", "type": "organization", "description": "A small electronic device or router is sitting exposed on the floor in the corner, creating visual clutter." },
    { "id": "bare-right-wall", "type": "opportunity", "description": "The wall to the right of the niche is completely bare, leaving the room feeling unfinished." },
    { "id": "bare-left-wall", "type": "opportunity", "description": "The wall to the left of the niche is completely bare, missing an opportunity for visual interest." },
    { "id": "credenza-top-styling", "type": "opportunity", "description": "The credenza top has bottles and a decanter arranged in a line without intentional styling or cohesion." },
    { "id": "niche-lighting", "type": "opportunity", "description": "The recessed wall niche has no accent lighting to highlight the artwork and create depth." },
    { "id": "table-centerpiece", "type": "opportunity", "description": "The dining table has no centerpiece or styling element to anchor the space and add warmth." }
  ],
  "scopeSize": "whole-room",
  "approaches": {
    "simple": {
      "strategyDescription": "Clear the table surface completely and relocate the floor device to a hidden or more appropriate location. This approach focuses on making the dining room immediately functional and tidy using what you already have.",
      "taskChecklist": [
        "Remove the flat rectangular item and the boxed item from the table and return them to their proper storage locations.",
        "Relocate the small electronic device from the floor to a concealed spot, such as inside the credenza or tucked behind furniture, managing the cord so it's not visible.",
        "Rearrange the three bottles and decanter on top of the credenza into a small grouped vignette on one side, leaving the rest of the surface clear and balanced."
      ],
      "keyChanges": ["Table cleared completely", "Floor device concealed", "Credenza top regrouped"],
      "productRecommendations": []
    },
    "polished": {
      "strategyDescription": "Clear the immediate clutter and begin addressing the room's unfinished feel by adding one or two pieces of wall art to the bare walls flanking the niche and styling the credenza top with a cohesive tray. This approach makes the room feel intentional and put together.",
      "taskChecklist": [
        "Clear the flat rectangular item and boxed item from the table, and relocate the floor device to a hidden location.",
        "Select and hang one piece of framed artwork on the bare wall to the right or left of the niche to begin balancing the room visually.",
        "Place the three bottles and decanter on a decorative tray on top of the credenza, grouping them together as a styled bar vignette.",
        "Measure the dining table and consider a low, simple centerpiece element like a bowl or small plant to anchor the table without cluttering it."
      ],
      "keyChanges": ["Wall art added", "Table cleared and styled", "Credenza bottles corralled"],
      "productRecommendations": [
        { "productType": "Framed wall art or print", "reason": "To address the bare right wall and begin creating a finished, balanced look in the room.", "icon": "other", "relatedProblemId": "bare-right-wall" },
        { "productType": "Decorative tray for credenza", "reason": "To corral the bottles and decanter on the credenza top into an intentional styled grouping.", "icon": "other", "relatedProblemId": "credenza-top-styling" },
        { "productType": "Simple table centerpiece bowl or planter", "reason": "To anchor the dining table with a low centerpiece element that adds warmth without clutter.", "icon": "other", "relatedProblemId": "table-centerpiece" }
      ]
    },
    "elevated": {
      "strategyDescription": "Transform the dining room into a fully finished, designer-quality space by clearing all clutter, adding curated wall art to both flanking walls, installing accent lighting in the niche to highlight the artwork, and styling both the credenza and table with intentional decorative elements. This approach addresses every opportunity to make the room feel cohesive and complete.",
      "taskChecklist": [
        "Clear the table surface and relocate the floor device permanently to a concealed location with proper cord management.",
        "Select and hang framed artwork on both the right and left bare walls flanking the niche, ensuring they are at consistent heights and complement the existing niche art.",
        "Install a small battery-operated or plug-in accent light in the recessed niche to illuminate the framed artwork and create a focal point.",
        "Style the credenza top with a decorative tray holding the bottles and decanter, and add one or two complementary objects like a small sculpture or vase to complete the vignette.",
        "Place a low, elegant centerpiece on the dining table, such as a shallow bowl, sculptural object, or a small arrangement, to anchor the table without interfering with dining.",
        "Step back and adjust the overall room balance, ensuring the credenza, table, and walls all feel cohesive and intentionally styled together."
      ],
      "keyChanges": ["Both walls styled with art", "Niche accent lighting installed", "Credenza fully styled", "Table centerpiece added"],
      "productRecommendations": [
        { "productType": "Pair of framed wall art or prints", "reason": "To address both the bare right wall and bare left wall, creating symmetry and a finished look throughout the dining room.", "icon": "other", "relatedProblemId": "bare-right-wall" },
        { "productType": "Accent lighting for recessed niche", "reason": "To install lighting in the recessed niche, highlighting the artwork and adding depth and drama to the space.", "icon": "other", "relatedProblemId": "niche-lighting" },
        { "productType": "Decorative tray and styling accessories", "reason": "To create an intentional styled vignette on the credenza top, corralling bottles and adding complementary decorative objects.", "icon": "other", "relatedProblemId": "credenza-top-styling" },
        { "productType": "Low elegant centerpiece for dining table", "reason": "To anchor the dining table with a centerpiece that adds warmth and visual interest without cluttering the surface.", "icon": "other", "relatedProblemId": "table-centerpiece" }
      ]
    }
  },
  "proTip": "In a dining room, the table surface should be kept completely clear day to day so the room always feels ready to gather and share a meal. Save decorative styling for the credenza, walls, and a single low centerpiece that won't interfere with conversation or serving."
}
```
*(`productRecommendations`/`taskChecklist` trimmed of `searchTerms`/`approachId` for report length; full raw response saved at `scratchpad/approach_test/live_impl_parsed_response.json` this session.)*

### Criteria a–m

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| a | No "printer" | **PASS** | Zero occurrences (grep-verified). Table item stays a neutral, hedged description ("flat rectangular item... tray or placemat") through every field, including every taskChecklist reference to it. |
| b | Blank wall → completion opportunity | **PASS** | Two bare walls flagged this run (`bare-right-wall`, `bare-left-wall`) — both genuinely bare in the source photo. |
| c | Niche → styling opportunity | **PASS, with the same accurate nuance as the investigation phase.** The niche already holds real artwork (correctly `confirmed` in itemsFound) — the model again correctly avoided calling it "empty" and instead found the real, narrower gap: no accent lighting (`niche-lighting`, type `opportunity`). |
| d | Three approaches differ in scope, not price | **PASS** | Simple = decluttering only, 0 products. Polished = decluttering + one wall art + tray + centerpiece consideration, 3 products. Elevated = decluttering + both walls + niche lighting + full credenza styling + centerpiece, 4 products. |
| e | Simple: functional only | **PASS** | Table clearing, floor-device relocation, credenza regrouping — no purchases, no wall/lighting work. |
| f | Elevated includes opportunity items Simple doesn't | **PASS** | Wall art (both walls), niche accent lighting, styled centerpiece — none present in Simple. |
| g | Products differ meaningfully | **PASS** | 0 → 3 → 4, escalating in both count and category (single vs. paired wall art; lighting appears only at Elevated). |
| h | Each checklist behaviorally different | **PASS** | Simple: 3 steps, pure decluttering. Polished: 4 steps, adds one art-hanging task. Elevated: 6 steps, adds lighting install + full styling + a final balance-check task. |
| i | No task promotes an uncertain item to a fact | **PASS, with the same minor, already-disclosed nuance as the investigation phase.** No task ever asserts a wrong specific identity. One soft paraphrase recurred: itemsFound hedges the floor item as "small electronic device or router," and tasks shorten this to "small electronic device" — narrower than the full hedge, but still neutral, never a wrong confident noun. Same class of drift flagged in `AIAnalysisRedesign.md`, not a new regression. |
| j | No hallucinated improvements | **PASS** | Every flagged opportunity checks out against the actual photo (verified by direct visual inspection of the downloaded image) — two real bare walls, a real unlit niche, a real styling gap on the credenza and table. Nothing invented on the windows, floor, or ceiling. |
| k | `keyChanges` present and useful | **PASS** | All three approaches return 3–4 short, distinct outcome phrases exactly as designed. |
| l | `itemsFound` is `{description, certainty}` | **PASS** | 17 entries, all well-formed, mix of `confirmed`/`uncertain`. |
| m | `problemsFound` has `type` | **PASS** | 7 entries — 2 `organization`, 5 `opportunity`, correctly split. |

**13/13.** Zero em dashes (grep-verified). `stop_reason=end_turn`, confirmed via a direct Cloud Logging API query matched to this exact call by response length (13,214 chars = 6a7a78f0... log entry) — not inferred, directly queried.

### Test 2 (item 5): max_tokens / truncation

Response was 13,214 characters (~3,300 tokens) of the 6,000 `max_tokens` budget — about 55% utilization, comfortable headroom, no truncation. Confirmed the same (`end_turn`, no truncation) on the second test photo too (12,270 chars). Left `max_tokens` at 6,000 — no change needed; flagging for a future bump only if real usage patterns show tighter headroom later, per the investigation report's own note.

### Test 3 (item 6): known-identity grounding still works

Spliced a real `knownIdentityNote` (verbatim from App.js's own construction, with test names "The Media Wall" / "Family Den" deliberately different from what the AI would naturally guess) into the exact live prompt at its real interpolation point, and called `analyzePhoto` for real against the entertainment-center photo.

- `overview` used "Media Wall"/"Family Den" correctly: *"Your Media Wall in the Family Den has a solid foundation..."*
- The entire approaches JSON never once reverted to "entertainment center" (checked via regex).
- New schema fields (`itemsFound` objects, typed `problemsFound`, `keyChanges` on all three approaches) all still present and well-formed alongside the grounding note — the two features compose without conflict.

Confirmed by direct diff inspection, separately: the `priorContextNote`/`knownIdentityNote` construction code itself has zero changed lines — this mechanism was never touched.

### Test 4 (item 8): different photo (entertainment center, Phase A's own test photo)

Full output saved at `scratchpad/approach_test/live_impl_second_parsed_response.json`. Confirms generalization: correctly split `problemsFound` into 2 organization (visible cable, shelf clutter) + 1 opportunity (bare wall above the TV — genuinely bare in the photo); correctly hedged ambiguous shelf contents as `uncertain` rather than naming specific electronics; three approaches escalate from cable-concealment-only (Simple, 1 product) through storage + wall art (Polished, 3 products) to full accent lighting + premium styling + statement art (Elevated, 4 products); did not hallucinate an opportunity on the already-blinded windows or the plants. `stop_reason=end_turn`, no truncation.

## Regression benchmark: plan `YuUjInu510F0peWF6e0H` (durable, for future prompt-regression testing)

Real before/after for the exact same photo, both pulled from real API calls (OLD = the actual buggy plan document already on staging from on-device testing; NEW = this session's real test above).

| | OLD (original buggy prompt, live on-device output) | NEW (redesigned prompt, this implementation) |
|---|---|---|
| Table item | **"printer on dining table"** (itemsFound, stated as fact) | "flat rectangular item on table surface, appears to be a tray or placemat" (`uncertain`) |
| Table clutter | "stacked boxes and papers" (plural, overstated — only one box-like object is actually visible) | "boxed item or package on table surface with orange and white coloring" (`uncertain`, singular, matches what's visible) |
| Niche | `problemsFound`: *"The recessed niche feels incomplete with only a single piece of artwork, creating visual emptiness"* — self-contradictory (calls it both non-empty and "empty") | `problemsFound`: *"niche-lighting"* — accurately identifies the real gap (no accent lighting), never claims the niche is empty |
| Blank walls | **Never mentioned.** No `opportunity` concept existed in the schema at all. | Both flanking walls identified: `bare-right-wall`, `bare-left-wall`, type `opportunity` |
| Simple approach | "Find a permanent home for the printer... Consolidate the boxes and papers... Arrange the bottles..." | "Remove the flat rectangular item and the boxed item... Relocate the small electronic device... Rearrange the three bottles and decanter..." — same conservative scope, now honestly worded |
| Polished approach | "Relocate office items... Group the bottles using a decorative tray... Add a floating shelf... in the niche" | "...hang one piece of framed artwork on the bare wall... styled bar vignette... simple centerpiece" — a genuinely different action (wall art) instead of a niche-shelf upsell on a niche that already has art |
| Elevated approach | "Conceal bar items behind glass doors... Transform the niche into a focal point with... lighting, layered art" | "...framed artwork on BOTH bare walls... accent lighting in the niche... credenza styled with tray + objects... table centerpiece... final balance check" |
| Approach differentiation | All three: clear table → relocate printer → organize bottles → (optionally) touch the niche. Same plan, escalating budget. | Simple: decluttering only. Polished: + one new category (wall art). Elevated: + two more new categories (dual wall art, lighting) + finishing pass. Genuinely different scope at each tier. |
| Products | 0 → 2 (tray, niche shelf) → 3 (bar cabinet, niche lighting, decor object) | 0 → 3 (wall art, tray, centerpiece) → 4 (paired wall art, lighting, styling accessories, centerpiece) |
| `itemsFound` shape | Flat string array, no certainty signal anywhere | `{description, certainty}` objects |
| `problemsFound` shape | Flat, no `type` | `type: "organization" | "opportunity"` |
| Collapsed-card data | None (`keyChanges` didn't exist) | 3–4 short outcome phrases per approach |

This table (and the full raw JSON for both sides, in `scratchpad/approach_test/dining_room_plan.json` and `live_impl_parsed_response.json`) is meant to be a durable reference — the next time this prompt changes, re-running against this same photo and diffing against the NEW column above is a fast regression check.

## Known, disclosed limitations (not fixed this phase, by design)

- `shareResults`/`generatePDF` don't support new-format (`approaches`) plans at all yet — pre-existing Phase B gap, out of this task's scope (see "What changed," item 2).
- `keyChanges` is parsed and stored but not yet rendered in the Results screen's approach cards — a UI phase, not part of this AI-redesign implementation.
- Section 6 of `AIAnalysisRedesign.md` (spend-range recalibration) remains an open, undecided follow-up, per its own explicit "investigate, don't pre-decide" instruction — the spend-band table itself is unchanged in this implementation.
- The `itemsFound`/`problemsFound` certainty "verbatim" rule is followed in spirit but occasionally paraphrased rather than copied exactly (test i) — never enough to produce a wrong confident noun, but worth tightening in a future prompt pass if it matters.

## OTA

Committed and pushed to the `staging` EAS Update branch — IDs recorded below once published.
