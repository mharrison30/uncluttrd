# Approach Selection — Phase B Implementation Report

Results Screen approach-selection UI, built on Phase A's new AI schema (`ApproachSelectionDesign.md` Section 4). All changes are in `App.js`.

## What shipped

**Results screen (new-format plans, `results.approaches` present, not yet started)**
- Section header "How would you like to approach this?" followed by three stacked cards (`APPROACH_ORDER` = simple/polished/elevated), driven by a new `APPROACH_META` table (display name + brand colors per id, client-owned copy, not AI-authored).
- Collapsed card: approach name, `estimatedSpendRange` (still the Phase A deterministic table, untouched), 1-2 sentence `strategyDescription`.
- Tapping a card calls `setPreviewApproach(id)` unconditionally — no toggle/collapse logic needed, since `expanded = previewApproach === id` is single-source-of-truth: exactly one of three ids can equal the state at a time, so only one card is ever expanded, and tapping the already-expanded card is a no-op (matches the design doc's explicit "doesn't collapse back to nothing" rule) for free.
- Expanded card: `organizingGuidance` (checklist-style rows), then product recommendations (icon, `productType`, one-line `reason`, "Shop options →" in green, no prices). Zero-product approaches (real in production data — Keep It Simple frequently has none) render no product section at all rather than an empty one.
- "Start This Plan →" button (`s.companionBtn`, same visual weight as the old "Let's Get Started") renders only once a card has been expanded; hidden entirely otherwise.
- Old-format plans (`results.tiers`) are byte-for-byte untouched — confirmed via `git diff` showing zero changes inside that block.

**Preview vs. commitment**
- `previewApproach` (new local state) is the only thing card taps touch. No Firestore call exists anywhere in the render/tap path — verified by code inspection and by a real-staging test that reads the plan doc back after simulated "browsing" and confirms `selectedApproach`/`approachHistory` are untouched.
- `handleStartThisPlan` is the only place that persists anything: one `updateDoc` writing `selectedApproach` and `arrayUnion`-ing an `approachHistory` entry, awaited before any local state changes or navigation. On success it seeds `batchItems`/`companionStage` from the chosen approach's own `taskChecklist` and only then flips `showCompanion`. On failure (`catch`) it shows an `Alert` and returns — `previewApproach`, `results`, and `batchItems` are never touched in the catch path, so the user lands back exactly where they were and the same button tap retries cleanly.
- No spinner: the button label swaps to "Starting..." (disabled) for the duration of the single write; no `ActivityIndicator`, no AI call anywhere in `handleStartThisPlan`.

**Removed (Phase A temporary code)**
- `savePlanToHistory`: `currentBatch` is now unconditionally `null` on save (was: seeded from `simple.taskChecklist`). Added `approachHistory: []` to the saved shape.
- The `[results]` effect's `else if (Array.isArray(results.approaches?.simple?.taskChecklist))` branch is gone; a fresh new-format plan now falls through to `setBatchItems([])`, and Results renders the approach cards instead of Companion having pre-seeded content.
- The dashed-red dev-inspection block is gone, replaced entirely by the real UI above.
- `finalizeAnalysisResult`/`completeRoomConfirmation`'s `validBatch` analytics checks were intentionally left as-is (still checking `simple.taskChecklist` as an "analysis produced usable content" proxy for the `batch_shown` event) — only their comments were updated to drop the "TEMPORARY" framing, since they serve an ongoing purpose unrelated to Companion seeding.

**Shop options**
- Reuses the existing `openProduct(searchTerms)` (Amazon search + `tag=uncluttrd20-20`, opened via `Linking.openURL`) directly — no new resolver, no stored URL, no retailer chooser.

**Future service-recommendation extensibility (Section 5, not implemented)**
- Each expanded card builds `recommendationGroups = [{ kind: "product", items: a.productRecommendations || [] }].filter(g => g.items.length > 0)` and renders by iterating that array rather than calling `.productRecommendations.map(...)` inline. A future `serviceRecommendations` field becomes a second `{ kind: "service", items }` entry in that same array; the per-item renderer already branches on `group.kind`, so adding the "service" branch is the only change needed — the card layout itself never changes.

**Icons**
- New `getProductCategoryIcon(iconKey)` maps the AI's fixed 10-value icon vocabulary to real `lucide-react-native` components (verified against the installed package's actual exports before use): cable→Cable, basket→ShoppingBasket, bin→Box, shelf→ShelvingUnit, hook→Anchor, label→Tag, drawer-organizer→Archive, hanger→Shirt (already imported), bag→ShoppingBag (already imported), other→Package. Falls back to Package for any unrecognized value, mirroring the existing `getRoomTypeIcon` keyword-table-with-fallback pattern.

## Bug caught during testing (not in the original spec)

The spec's literal `approachHistory` entry shape — `{ approach, selectedAt: serverTimestamp() }` — is not actually writable: Firestore rejects the `serverTimestamp()` sentinel inside an `arrayUnion()` element ("cannot be used inside of an array"), in both the Admin and client SDKs. Confirmed with a real write against staging before fixing. `handleStartThisPlan` now uses `Timestamp.now()` (a real, already-resolved client timestamp) for the array entry instead — precise enough for "when did the user pick this," and nothing reads it as server-authoritative. Every other `serverTimestamp()` use in the file (top-level fields, not array elements) is unaffected and was left alone.

## Testing (real staging, project `cluttrd-staging`, test uid `ZYe7h9hM25UB7Pk6YRbPysg2cGC3`)

`node -c App.js` and a full `expo export --platform ios` (3348 modules) both passed clean after every edit, including after the `Timestamp.now()` fix.

Persistence/data-model tests ran against a real Firestore plan document seeded with real Phase A approach data (an entertainment-center photo's actual AI response — Keep It Simple has 0 products, Polished has 2, Elevated has 3):

| # | Test | Result |
|---|------|--------|
| e | Browsing does not persist (`selectedApproach`/`approachHistory` untouched before any "Start" tap) | PASS |
| f | "Start This Plan" persists `selectedApproach` + one `approachHistory` entry with the correct approach and a real timestamp; chosen approach's `taskChecklist` is what Companion would seed from | PASS |
| g | Write completes before navigation (structural: `await` blocks all subsequent code in `handleStartThisPlan`) | PASS (by construction) |
| h | A genuine Firestore failure (update on a nonexistent doc) throws; the real target plan doc is unaffected by an unrelated failed write, confirming retry-safety | PASS |
| i | Amazon URL built from real `searchTerms` + `tag=uncluttrd20-20` matches exactly | PASS |
| j | Zero-product approach (`simple`) produces an empty `recommendationGroups` (no rendered section); non-zero approaches produce populated groups | PASS |

13/13 automated assertions passed. Test script: `test_phaseB.js` (scratchpad, cleans up its own test plan doc).

Tests a-d, k, m, n, l were verified by direct code inspection (no RN simulator/device available in this environment):
- **a-d** (three cards render correctly, tapping expands/collapses exclusively, expanded shows guidance+products, CTA gated on expansion): guaranteed by construction — `expanded = previewApproach === id` against a single string state variable makes "exactly one card expanded" structural, not a runtime race; the CTA's conditional render (`{previewApproach && (...)}`) makes gating structural too.
- **k**: `git diff` shows zero changed lines inside the `results.tiers?.map(...)` block.
- **l**: `grep` confirms the Companion-seeding fallback is gone from both the `[results]` effect and `savePlanToHistory`; the only remaining `simple.taskChecklist` references are the two intentionally-kept analytics checks plus one debug log line.
- **m**: `handleStartThisPlan` contains exactly one `updateDoc` call, no `fetch`/AI call, no `ActivityIndicator` — button label swap only.
- **n**: `recommendationGroups` array structure confirmed present and iterated generically (see Extensibility section above).

## OTA

Committed and pushed to the `staging` EAS Update branch. Update IDs recorded in the commit that follows this report.
