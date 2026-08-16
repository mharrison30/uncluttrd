# Product Recommendation Cards — Compact Layout with Short Display Reason

Compresses the expanded-approach product rows from a wall of text into a
scannable ~78px card, **without touching the underlying data or adding an AI
call.** Every change is display-layer.

---

## The layout

```
┌──────────────────────────────────────────────┐
│  ┌────────┐   Decorative Object              │   ~78px
│  │  icon  │   Add height and interest to...  │
│  │ 48x48  │   Find options →                 │
│  └────────┘                                  │
└──────────────────────────────────────────────┘
```

`recCard` = 12px vertical padding × 2 around a ~54px text column ≈ **78px**,
inside the 70–90px target. The 48px icon tile never drives row height.

---

## 1. New styles, deliberately NOT shared

`prodRow` / `prodIco` / `prodName` / `prodPrice` are still used by the legacy
tier-based **SUGGESTED PRODUCTS** list (App.js:12405–12426). Restyling them
would have silently changed every old-format plan — the exact backward-compat
requirement. So the compact card gets its own names:

| Style | Purpose |
|---|---|
| `recCard` | row container, 12px padding, 8px gap between cards |
| `recIcon` | **48×48**, `borderRadius: 10`, `overflow: "hidden"` |
| `recBody` | `flex: 1, minWidth: 0` — lets `numberOfLines` actually clip |
| `recName` | 14px semibold |
| `recReason` | 12px regular, one line |
| `recLink` | 12px semibold green |

**Thumbnail-ready by construction.** `recIcon` is a fixed 48×48 box with
`overflow: hidden`, and the row height is driven by the text column beside it.
Swapping the `<Icon>` for an `<Image>` is a one-element change inside that box —
no layout change anywhere else.

---

## 2. `shortDisplayReason` — display transform, no AI call

The input is already space-specific: `resolveRecommendationReason` returns the
grounding sentence, the linked `problemsFound` descriptions, or the AI's own
`reason` — all written about the photographed space. So this only has to
**shorten**, never summarize, which is what keeps it a display transform rather
than a second inference step.

Order is load-bearing — **first sentence, then first clause**:

```
"The recessed niche is largely empty and needs additional objects at varying
 heights to create a finished focal point."          (117 chars)
  → "The recessed niche is largely empty and needs additional..."   (59)

"A rug anchors the seating zone. The hard flooring currently leaves it
 visually adrift."                                    (86)
  → "A rug anchors the seating zone."                              (31)

"Cables run loose behind the console."                 (36) → unchanged
```

Clause-first would have cut *"The niche is empty, and the shelf below is
crowded"* at the comma and lost the sentence's real subject on inputs that were
already short enough.

Limit is 58 chars, so output is at most 61 with the ellipsis. Trims at a word
boundary, strips orphaned punctuation, and returns `""` for null/undefined/
non-string input (all tested).

---

## 3. Icons — 15px → 30px, and genuinely differentiated

The old icons rendered at **15px**, half the 28px floor in the brief. Now 30px
in a 48px tile at `strokeWidth: 2`.

Six mappings changed for semantic accuracy:

| Category | Was | Now | Why |
|---|---|---|---|
| `decor` | `Sparkles` | **`Amphora`** | An actual vase, as specified |
| `tray` | `Utensils` | **`ConciergeBell`** | Cutlery ≠ tray; this is a serving dome |
| `plant` | `Leaf` | **`Sprout`** | Reads as a plant, not foliage |
| `textile` | `Layers` | **`Blinds`** | `Layers` collided with `shelf` |
| `bin` | `Box` | **`Container`** | `Box` was indistinguishable from `Boxes` (`storage`) |
| `drawer-organizer` | `Archive` | **`Grid2x2`** | Grid = dividers, as specified |

**Every name verified against installed `lucide-react-native@1.21.0`.** The code
carries an explicit warning that an unavailable name imports as `undefined` and
crashes at render — that is how `Shelf` was lost previously. All six were
confirmed present in the package's 5,948 exported names before use, not assumed.

**One weak mapping, flagged rather than hidden:** `hook` → `Anchor` is unchanged.
Lucide has no `Hook`; an anchor's barbs are at least hook-shaped. `textile` →
`Blinds` is the other compromise — Lucide has no rug or fabric icon.

---

## 4. `displayProductName` — shorter heading

Shares `shortProductNoun`'s first rule (cut at the connector) and deliberately
diverges on the other two, because a heading is a different job from an
inline preview:

- **Descriptor kept when it carries the meaning.** `shortProductNoun` always
  strips it, which is right mid-sentence but leaves a bare `"Objects"` as a
  heading. Now dropped only when a real noun phrase survives.
- **First two words, not last two.** `"cable management box"` → `"Cable
  Management"`, not `"Management Box"`.
- **Singular**, with `-ies`/`-ves`/`-ches`/`-s` rules; `-ss`/`-us` left alone.

| Input | Output |
|---|---|
| `decorative objects or vases for niche styling` | **Decorative Object** ✓ |
| `Modern wall art or framed prints` | **Wall Art** ✓ |
| `woven storage baskets` | Storage Basket |
| `cable management box` | Cable Management |
| `drawer organizer inserts for the top drawer` | Drawer Organizer |
| `floating shelves` | Floating Shelf |
| `Decorative tray or bar tray for credenza surface` | Decorative Tray |

**One brief example not matched, deliberately.** The brief asked for `"Bar
Tray"` from *"Decorative tray or bar tray for credenza surface"* — that requires
picking the *second* alternative as more specific, which is semantic judgment.
Automating it would mean an AI call, which is explicitly forbidden. `"Decorative
Tray"` is the honest mechanical answer.

---

## 5. Data integrity — nothing weakened

`productType` and `reason` are untouched in the plan document. Confirmed by
tracing every consumer:

| Consumer | Uses |
|---|---|
| `resolveProductDestination` (search query) | **full** `productType` + `searchTerms` |
| PDF export (App.js:7602) | **full** `resolveRecommendationReason` |
| Text share (App.js:8300) | **full** `productType` + **full** reason |
| Compact card (App.js:12708) | shortened — *the only shortened surface* |

The AI prompt, schema and `PRODUCT_ICON_VOCAB` are unchanged. `PRODUCT_ICON_VOCAB`
is derived from the icon map, so the six swaps changed rendering only — the key
names the model is told to choose from are identical.

---

## 6. Backward compatibility

Old-format tier plans render through a separate branch (App.js:12405) using the
untouched `prodRow`/`prodIco`/`prodName`/`prodPrice` styles. **Zero lines of that
path changed.**

`approachProdReason` and `approachShopLink` are now unused but left in place —
removing them was outside the brief and they may be reused.

---

## 7. Verification

| Check | Result |
|---|---|
| `node -c App.js` | PASS |
| `scripts/auditTdz.js` | CLEAN, 0 violations |
| `expo export --platform ios` | PASS |
| All 6 new icon names exported by lucide 1.21.0 | confirmed against 5,948 names |
| Transform unit tests (14 names, 11 reasons + null/undefined/number) | all correct |
| Legacy `prod*` styles still referenced only by the tier path | confirmed |

### Still needs a device — tests (a)–(i)

Code-verified only. `node -c` and `expo export` cannot measure a rendered card.

- **(a)** card height ~70–90px — computed 78px, needs measuring
- **(b)** reason is one line and space-specific
- **(c)(d)** icons visually distinct and clearly ≥28px (now 30px)
- **(e)** "Find options →" visible and tappable on every card
- **(f)** full `reason` intact in Firestore — inspect a plan doc after viewing
- **(g)** 3+ cards visible without excessive scrolling
- **(h)** an old-format tier plan renders unchanged
- **(i)** names read cleanly across real recommendations

**(c) is the one I would check first** — `Blinds` for `textile` and `Anchor` for
`hook` are the two mappings chosen from a constrained vocabulary, and only
looking at them settles whether they communicate the category.

---

# Addendum — shortened to 45 chars / 5–9 words (2026-08-16)

The 58-char limit still wrapped on a phone. Now **45 chars, 5–9 words, no
ellipsis**, tuned against **54 real staging recommendations** (37 unique
reasons) rather than invented examples.

**Why the "complete thought" rule does all the work here.** The median resolved
reason in real staging data is **137 characters** (min 81, max 499), so
essentially every one is cut. A plain 45-char word-boundary trim produces *"The
recessed niche is largely empty and needs"* — a sentence stopped mid-air. An
ellipsis only advertises that instead of repairing it.

So after fitting the budget, trailing words are dropped while the last word is
still *waiting* for something: determiner, preposition, conjunction, auxiliary,
degree adverb, attributive adjective, or a transitive verb/participle with no
object. Plus a suffix test (`-ous`, `-ial`, `-ative`, `-able`, `-ful`, …) that
catches adjectives the list doesn't name, never applied to a plural noun.

Predicate adjectives that legitimately end a thought — *"is largely empty"*,
*"feels incomplete"* — are deliberately excluded from the list.

## Before / after on real staging data

| | |
|---|---|
| **countertop tray** | |
| old (57c, 9w) | The vanity counter has multiple items scattered across it |
| **new (37c, 6w)** | **The vanity counter has multiple items** |
| **framed wall art** | |
| old (60c, 11w) | The walls around the toilet and beside the vanity have no... |
| **new (27c, 5w)** | **The walls around the toilet** |
| **plush bath mat** | |
| old (58c, 10w) | The white tile floor provides a clean foundation that a... |
| **new (20c, 4w)** | **The white tile floor** |
| **Lazy Susan turntable** | |
| old (59c, 11w) | The deep corner area appears to have items pushed to the... |
| **new (42c, 8w)** | **The deep corner area appears to have items** |

Note the old column: every one ends on a dangling `the`, `a`, or `no` and
needed an ellipsis. None of the new ones do.

## Results across all 37 unique reasons

| | |
|---|---|
| over 45 chars | **0** |
| ellipsis anywhere | **none** |
| words min / median / max | 2 / 5 / 9 |

The three sub-5-word results (*"The white tile floor"*, *"Canned goods"*, *"The
bookshelf corner"*) are the rule working as specified — taking fewer words
rather than emitting a fragment.

All three brief examples pass through **unchanged**: *"Add height to the empty
niche."*, *"Anchor the dining zone visually."*, *"Organize bottles into a bar
display."* Null / undefined / empty / non-string all return `""`.

**Two known imperfections**, both from genuine noun/verb ambiguity: *"The
shelves currently display"* (`display` is a noun in *"as a display"* and a verb
here — blocking it would break the other) and *"The room relies solely on
recessed ceiling"* (wants "lighting"). 2 of 37.

`node -c`, TDZ audit (0 violations) and `expo export` all pass. Full `reason`
still untouched in the data, and PDF/text share still emit it in full.
