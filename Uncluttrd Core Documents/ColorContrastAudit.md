# Color Contrast Accessibility Audit — WCAG 2.1

**Run 2026-08-18. Read-only. Nothing fixed, no code modified.**

Ratios computed with the WCAG 2.1 relative-luminance formula
(`L = 0.2126R + 0.7152G + 0.0722B` on linearized sRGB;
`ratio = (L₁+0.05)/(L₂+0.05)`). Translucent colors are **composited over their
actual backing surface** before measurement — `rgba()` values cannot be rated
without doing this, and several in the header are only legible because of it.

Text size tiers follow WCAG: **large** = ≥18pt regular **or** ≥14pt bold;
everything else is **normal**. React Native `fontSize` is treated as pt.

---

## Two premise corrections up front

**1. The app does not inherit device dark mode, so nothing degrades in dark
mode.** `app.config.js:18` sets `userInterfaceStyle: "light"`, which Expo maps
to iOS `UIUserInterfaceStyle: Light` — the app is **forced to light appearance
regardless of the system setting**. There are also **zero** dark-mode APIs
anywhere in the codebase: no `useColorScheme`, no `Appearance`, no
`DarkTheme`, and `expo-system-ui` is **not installed**. Every color is fixed.
Details and the Android caveat in §3.

**2. Green text on dark blue is real, but it is not the header text and it is
not the worst failure.** Header text is white or translucent white and passes
comfortably (6.06:1 – 14.25:1). The genuine green-on-dark case is the **"Free"
badge at 3.19:1**. The worst failures in the app are small grey and green text
on *light* surfaces — down to **1.65:1**.

Neither correction makes the audit smaller. It relocates it.

---

## 1. Palette

`App.js:2686`. Relative luminance included because it explains every result
below.

| Token | Hex | L |
|---|---|---|
| white | `#FFFFFF` | 1.0000 |
| tanLight | `#FBF5EC` | 0.9187 |
| greenLight | `#E6F7EE` | 0.8952 |
| purpleLight | `#F3EEF9` | 0.8704 |
| blueLight | `#E8F0FC` | 0.8650 |
| offWhite | `#E6E9EE` | 0.8127 |
| stone | `#D7DCE3` | 0.7118 |
| tanBorder | `#E8D5B4` | 0.6804 |
| greenMid | `#A8DDBF` | 0.6380 |
| purpleBorder | `#CFC0E8` | 0.5679 |
| mist | `#B0B8BF` | 0.4727 |
| tan | `#C8A97A` | 0.4206 |
| **green** | **`#1E9E52`** | **0.2534** |
| purple | `#8B6BAE` | 0.1906 |
| slate | `#64748B` | 0.1706 |
| blue | `#1463D8` | 0.1403 |
| **navy / ink** | **`#0F2A52`** | **0.0237** |

`navy` and `ink` are **the same value** (`#0F2A52`) — one token for surfaces,
one for text, identical hex. Worth knowing before any remediation: changing one
changes both unless they are split first.

## 2. Green on dark blue — the specific question

**`#1E9E52` on `#0F2A52` = 4.12:1.**

| Tier | Requirement | Result |
|---|---|---|
| AA normal text | 4.5:1 | **FAIL** (short by 0.38) |
| AA large text | 3:1 | PASS |
| AAA normal text | 7:1 | FAIL |
| AAA large text | 4.5:1 | **FAIL** (short by 0.38) |

### Where green actually meets dark blue

Only **two** navy surfaces exist in the entire app:

| Location | Line |
|---|---|
| `s.hdr` — the app header | `App.js:13823` |
| one inline `<View>` | `App.js:11659` |

**No style renders `BRAND.green` as text directly on `s.hdr`.** The green in the
header is the **"Free" plan badge**, and it is worse than the bare 4.12:1
because of its own background:

```
freeBadge:     backgroundColor: "rgba(30,158,82,0.2)"   ← 20% green over navy
freeBadgeText: color: BRAND.green, fontSize: 11, Inter_700Bold
```

Composited: `rgba(30,158,82,0.2)` over `#0F2A52` = **`#124152`**.

**`#1E9E52` on `#124152` = 3.19:1 — FAIL** (needs 4.5:1 at 11pt).

The tint is the problem. It lifts the background *toward the text color*,
dropping contrast from 4.12:1 to 3.19:1. **A 20%-opacity green wash behind
green text actively harms legibility**, which is not obvious from reading the
style.

### The rest of the header passes comfortably

| Style | Colour (composited) | Size | Ratio | Result |
|---|---|---|---|---|
| `hdrMarkText` | `#FFFFFF` | 22 bold | **14.25:1** | PASS |
| `hdrName` | `#FFFFFF` | 22 bold | **14.25:1** | PASS |
| `hdrPageName` | `rgba(255,255,255,.85)` → `#dbdfe5` | 14 semibold | **10.66:1** | PASS |
| `ChevronLeft` icon | `rgba(255,255,255,.9)` → `#e7eaee` | 26 | **11.81:1** | PASS |
| `signOutText` | `rgba(255,255,255,.7)` → `#b7bfcb` | 12 | **7.69:1** | PASS |
| `hdrTag` | `rgba(255,255,255,.6)` → `#9faaba` | 11 | **6.06:1** | PASS |
| **`freeBadgeText`** | `#1E9E52` on `#124152` | 11 bold | **3.19:1** | **FAIL** |
| **`freeBadgeUpgradeText`** | `#FFFFFF` on tan `#C8A97A` | 11 bold | **2.23:1** | **FAIL** |

`freeBadgeUpgradeText` — white on tan, **2.23:1** — is the worst thing in the
header, and it is the **Upgrade** badge, i.e. the paid-conversion affordance.

## 3. Dark mode behaviour

**a. Explicit, not inherited.** `userInterfaceStyle: "light"` →
`UIUserInterfaceStyle: Light` on iOS. The app renders light regardless of the
device setting.

**b. Which colours change: none.** Every colour is a literal or a `BRAND`
token. No `useColorScheme`, no `Appearance` listener, no theme context, no
`DarkTheme`. `expo-system-ui` is not a dependency. `StatusBar barStyle` is
hardcoded per screen (`"light-content"` on navy screens, `"dark-content"` on
light ones) — consistent with a deliberately fixed light design.

**c. Combinations that pass in one mode and fail in the other: none exist**,
because there is only one mode. **Every failure listed here fails in all
conditions on every device**, which makes them worse than mode-specific bugs,
not better — nothing is hiding.

**d. The navy header + green badge in dark mode looks identical to light mode:**
`#1E9E52` on `#124152`, 3.19:1. Unchanged.

**Android caveat, stated as a limitation rather than a finding.** Android 10+
"Force Dark" can auto-invert apps, and it is opt-in via
`android:forceDarkAllowed="true"` in the app theme. This is a managed Expo
project with no `android/` directory, so the generated theme cannot be read
from the repo, and a `node_modules` search for `forceDarkAllowed` timed out
before completing. Standard Expo/RN templates do **not** enable it, so
auto-darkening is very unlikely — **but I did not verify it.** Confirming it
needs either an Expo prebuild or an on-device check with system dark mode on.

## 4. Verified failing pairings

**Method note, because it bounds what follows.** Automatically resolving each
text style's *containing background* by regex proved unreliable — my first
attempt paired `slate` text onto green buttons and produced impossible
self-pairs. Rather than report inferred numbers, the table below is restricted
to pairings where the parent's `backgroundColor` is **structurally certain**
(the container style declares it, or the value is composited from a known
surface). Every row was read in source.

| Ratio | Need | Size | Tier | Component / style | Severity |
|---|---|---|---|---|---|
| **1.65:1** | 4.5 | 9 | normal | `prodRow` / `amznText` — mist on offWhite | HIGH |
| **2.01:1** | 4.5 | 12 | normal | Paywall / `paywallCtaSub` — mist on white | HIGH |
| **2.01:1** | 4.5 | 12 | normal | Tier card / `tcardRange` — mist on white | HIGH |
| **2.23:1** | 4.5 | 11 | normal | Header / `freeBadgeUpgradeText` — white on tan | **CRITICAL** |
| **2.84:1** | 4.5 | 12 | normal | Rec card / `recLink` — green on offWhite | **CRITICAL** |
| **3.19:1** | 4.5 | 11 | normal | Header / `freeBadgeText` — green on tinted navy | HIGH |
| **3.46:1** | 4.5 | 13 | normal | `reviewItemBtnOutlineText` — green on white | **CRITICAL** |
| **3.91:1** | 4.5 | 12 | normal | Rec card / `recReason` — slate on offWhite | HIGH |

Passing, for contrast:

| Ratio | Component | Note |
|---|---|---|
| 3.46:1 | `ctaText` 16 bold on green | **PASS** — large-text tier only |
| 3.46:1 | `paywallCtaText` 16 bold on green | PASS — large only |
| 3.46:1 | `approachStartBtnText` 15 bold on green | PASS — large only |
| 3.46:1 | `startOverText` / `contactBtnText` 15–16 bold | PASS — large only |
| 11.71:1 | `prodName`, `recName` — ink on offWhite | PASS all tiers |

**The primary CTA passes only because it is 16pt bold.** White on `#1E9E52` is
3.46:1 — above the 3:1 large-text floor, below the 4.5:1 normal floor. Any
future button at 13pt, or at regular weight, silently becomes a failure. It also
fails **AAA large (4.5:1)** everywhere.

### Three pairings from code written this session

`recCard` (`App.js:13894–13899`) — added during the product-card redesign:

| Style | Colour on `offWhite` | Ratio | Result |
|---|---|---|---|
| `recName` | ink 14 semibold | 11.71:1 | PASS |
| `recReason` | slate 12 regular | **3.91:1** | **FAIL** |
| `recLink` | green 12 semibold | **2.84:1** | **FAIL both tiers** |

`recLink` is the **"Find options →"** affordance — the tap target that opens the
retailer. At 2.84:1 it fails normal text *and* large text. Mine, and the worst
interactive-element failure in the app.

## 5. Severity grouping

### CRITICAL — interactive elements the user must read and tap

1. **`recLink` — 2.84:1.** "Find options →". Primary commerce affordance. Fails
   every tier.
2. **`reviewItemBtnOutlineText` — 3.46:1** at 13pt. An outline **button label**;
   13pt semibold is normal text, so 4.5:1 applies.
3. **`freeBadgeUpgradeText` — 2.23:1.** The Upgrade badge. Lowest ratio of any
   interactive element.

### HIGH — secondary text and status indicators

4. `freeBadgeText` — 3.19:1. Plan-state indicator.
5. `recReason` — 3.91:1. The sentence explaining each recommendation.
6. `amznText` — 1.65:1 at **9pt**. Retailer attribution — a disclosure label,
   which is why it is not LOW.
7. `paywallCtaSub` — 2.01:1. Pricing sub-copy under the paywall CTA.
8. `tcardRange` — 2.01:1. Price ranges on tier cards.

### LOW — decorative, non-essential

- `stone` `#D7DCE3` on white (**1.38:1**) — borders and dividers only. WCAG
  1.4.11 (non-text contrast, 3:1) applies to UI-component boundaries, so a
  divider is fine but a **focus ring or input border** at this value would not
  be. Not separately enumerated; flagged as a category to check during any fix.

### Marginal — passing but fragile

- All green CTAs at **3.46:1**. Compliant as large text; one size or weight
  change away from failing, and failing AAA large already.

## 6. Recommended fix approach

### a. How many distinct pairings must change?

**7 distinct colour pairs** cover all 8 verified failures:

| Pair | Ratio | Affected |
|---|---|---|
| green → offWhite | 2.84 | `recLink` |
| green → white | 3.46 | `reviewItemBtnOutlineText` and other green links at <14pt |
| green → tinted navy `#124152` | 3.19 | `freeBadgeText` |
| slate → offWhite | 3.91 | `recReason` |
| mist → white | 2.01 | `tcardRange`, `paywallCtaSub` |
| mist → offWhite | 1.65 | `amznText` |
| white → tan | 2.23 | `freeBadgeUpgradeText` |

### b. Targeted swaps, or a full light/dark system?

**Targeted swaps. A light/dark system is not required for compliance**, and
building one would be the larger, riskier change for no accessibility gain —
because §3 establishes there is no dark mode to be compliant *in*.

What *is* needed is a small **token split**, and this is the structural insight:

> **A darker green fixes light surfaces and breaks dark ones.**
> `#166E38` (already used elsewhere in the file) scores **6.32:1 on white** and
> **5.19:1 on offWhite** — but only **2.25:1 on navy** and **1.74:1 on the
> tinted badge**. There is no single green that satisfies both.

So the palette needs **two greens plus one darker neutral** — three tokens, not
a theme engine:

| New token | Value | On white | On offWhite | On navy |
|---|---|---|---|---|
| `greenText` (light surfaces) | `#166E38` | **6.32** | **5.19** | 2.25 |
| `greenOnDark` (dark surfaces) | **`#10B43E`** — **the logo green** | 2.76 | 2.26 | **5.17** |
| `slateText` (secondary) | `#54607A` | **6.30** | **5.18** | — |

### `greenOnDark` comes from the logo, not from the palette

An earlier draft of this section proposed `#A8DDBF` (the existing `greenMid`).
It scores higher on navy — 9.34:1 — but it is a pale mint that does not read as
the brand. **Sampling `assets/icon.png` directly gives a better answer.**

The "U" mark is a green left panel, a blue right panel and a navy base. The
green panel's **modal pixel value is `#10B43E`**, which scores **5.17:1 on
navy** — comfortably AA for normal text, and unmistakably the brand colour.

**Gradient caveat, and it matters.** The panel is a glossy gradient, not a flat
fill — 22,796 distinct greens across 67,819 sampled pixels:

| Region | Hex | vs navy |
|---|---|---|
| brightest band (upper) | `#2DBD4E` | 5.77:1 ✅ |
| mid band | `#22B84F` | 5.46:1 ✅ |
| **modal pixel (chosen)** | **`#10B43E`** | **5.17:1 ✅** |
| panel mean | `#22B14A` | 5.06:1 ✅ |
| **darkest band (shadowed base)** | `#0F873F` | **3.09:1 ❌** |

`#10B43E` is taken from the **upper/mid panel**, where the brand colour actually
reads. Sampling the shadowed base would have produced a value that fails AA, so
"the logo green" is not a single fact to be looked up — it is a choice within a
range, and this is the range it was chosen from.

**This also explains the whole problem.** The same sampling on the blue panel
gives modal `#0157E8` against `BRAND.blue` `#1463D8` — the identical
relationship. **The BRAND tokens are darkened derivatives of the logo, tuned
for light backgrounds.** That is exactly why they underperform on dark ones, and
why the logo colours are the natural dark-surface counterparts.

`greenOnDark` is a **dark-surface token only** — at 2.76:1 on white it must
never be used for text on a light background.

`BRAND.green` itself **stays unchanged** as a *background* and *border* colour —
that is 39 of its uses and none of them are failing.

### c. Minimum change to bring all CRITICAL items to AA

Four edits:

1. **`recLink`** → `greenText` `#166E38`: 2.84 → **5.19:1** ✅
2. **`reviewItemBtnOutlineText`** → `greenText`: 3.46 → **6.32:1** ✅
3. **`freeBadgeUpgradeText`** → `BRAND.navy` on tan: 2.23 → **6.39:1** ✅
   (or darken tan to `#8A6A33` and keep white: 5.01:1)
4. **`freeBadgeText`** → `greenOnDark` `#10B43E` **and remove the tint**:
   3.19 → **5.17:1** ✅ (#4 is HIGH, included because it is the pairing the
   audit was requested for)

**The Free badge needed both changes, not just a recolour.** On the *tinted*
background `#124152` the logo green reaches only **4.00:1** — still short of
4.5. The tint had to go regardless of which green was chosen.

Then HIGH, four more edits: `recReason` and `amznText`/`tcardRange`/
`paywallCtaSub` → `slateText` `#54607A` (5.18–6.30:1).

**Eight style-line edits, three palette tokens, zero structural change.** No
component moves, no theming layer, no new dependency.

### d. Should the app explicitly control dark mode?

**It already does, and that should stay.** `userInterfaceStyle: "light"` is a
deliberate opt-out and it is the right call for now: a single fixed palette is
far easier to keep accessible than two, and the app has no dark palette
designed.

Two caveats worth recording:

- **Verify the Android side** (§3) before claiming dark-mode immunity in any
  store listing or accessibility statement.
- If dark mode is ever *added*, the `navy`/`ink` collision becomes a real
  problem: one token is a surface and the other is body text, and in dark mode
  they must move in opposite directions. **Splitting `ink` from `navy` is
  cheap now and expensive later** — worth doing as part of this fix even though
  it changes no rendered pixel today.

### One thing this audit could not do

A complete automated map of *every* text style to *every* background it can
render on needs JSX ancestry analysis, not regex — my attempt produced false
pairings and was discarded. The 8 failures above are the structurally certain
subset. There are **149 styles carrying a `color`** in `StyleSheet.create`, and
a full pass would likely surface more failures among the mist/slate/tan
families, which already fail on the surfaces measured here. **Treat 8 as a
floor, not a total.**

A reliable full sweep would mean parsing App.js with a JS/JSX parser and
walking the component tree — a few hours of work, and worth doing before
declaring AA compliance rather than before starting the fix.

---

## 7. IMPLEMENTED — 2026-08-18

All 8 failing pairs fixed. **8/8 now pass WCAG AA normal text (4.5:1), with
zero regressions** against pairings that were already passing.

### Free badge — Option 2 chosen: green border, no fill

```js
// before
freeBadge: { backgroundColor: "rgba(30,158,82,0.2)", borderRadius: 20, ... }
freeBadgeText: { color: BRAND.green }        // 3.19:1  FAIL

// after
freeBadge: { backgroundColor: "transparent", borderWidth: 1.5,
             borderColor: BRAND.greenOnDark, borderRadius: 20, ... }
freeBadgeText: { color: BRAND.greenOnDark }  // 5.17:1  PASS
freeBadgeDot:  { backgroundColor: BRAND.greenOnDark }
```

The translucent fill was **removed, not recoloured**. It composited to
`#124152`, lifting the background toward the text and costing **0.93 of ratio**
— the same green measured 4.12:1 on plain navy against 3.19:1 on the tint. A
same-hue tint behind text always works against legibility. Border radius
unchanged at 20; the dot moved to `greenOnDark` for consistency and improves
from 4.12:1 to 5.17:1.

### Results — all 8 pairs, measured from the edited source

| Before | After | Size | Component / style | Token applied |
|---|---|---|---|---|
| 3.19:1 | **5.17:1** | 11 | `freeBadgeText` | `greenOnDark` + tint removed |
| 2.23:1 | **6.39:1** | 11 | `freeBadgeUpgradeText` | `BRAND.ink` — see note |
| 2.84:1 | **5.19:1** | 12 | `recLink` | `greenText` |
| 3.91:1 | **5.18:1** | 12 | `recReason` | `slateText` |
| 3.46:1 | **6.32:1** | 13 | `reviewItemBtnOutlineText` | `greenText` |
| 1.65:1 | **5.18:1** | 9 | `amznText` | `slateText` |
| 2.01:1 | **6.30:1** | 12 | `tcardRange` | `slateText` |
| 2.01:1 | **6.30:1** | 12 | `paywallCtaSub` | `slateText` |

Non-text (WCAG 1.4.11, 3:1): badge border **5.17:1** ✅, badge dot **5.17:1** ✅.

**One pair took a token outside the three specified.** `freeBadgeUpgradeText` is
white on **tan** `#C8A97A` — neither a light nor a dark surface, so none of
`greenText` / `greenOnDark` / `slateText` applies. It uses `BRAND.ink`
(**6.39:1**), which was this document's original §6c recommendation. The
alternative — darkening tan to `#8A6A33` and keeping white text (5.01:1) —
would have changed a brand colour rather than a text colour, so it was not
taken.

`BRAND.green` `#1E9E52` is **unchanged**, as specified. It remains correct for
backgrounds, borders and fills — 39 of its uses — none of which were failing.

### Still outstanding

The floor/total caveat in §6 stands. There are **22 remaining `color:
BRAND.mist`** and **51 remaining `color: BRAND.slate`** declarations that were
not structurally verified and therefore not changed. `mist` fails on white
(2.01:1) and offWhite (1.65:1) *wherever* it is used as small text, and `slate`
fails on offWhite (3.91:1). **These 8 fixes bring the audited set to AA; they
do not make the app AA-compliant.** A JSX-parser sweep remains the prerequisite
for that claim.

---

## Provenance

Ratios computed from `App.js` at commit `0612c22` with a WCAG 2.1
implementation written for this audit; palette read from `App.js:2686`;
appearance configuration from `app.config.js:18`; dependency check from
`package.json`. Translucent values composited over their verified backing
surface. No code, configuration or asset was modified.
