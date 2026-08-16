# Pre-Production UX Fixes — Needs Review Photo + Login Keyboard

**Staging only. Production untouched.** Commit at bottom; OTA pushed to the
`staging` branch at runtime `194c6294…`, which matches the installed staging
build.

---

## Fix 1 — Needs Review photo opens full-screen

### What was wrong

The session thumbnail on a Needs Review card was a plain `<Image>` inside the
card's `TouchableOpacity`. Tapping anywhere on the card — photo included — ran
`openClassify(plan)`. There was no way to look at the photo before deciding
where the session belongs, which is precisely the decision the screen exists to
support.

### What changed

Two edits, both in the Needs Review screen (`App.js`).

**1. The thumbnail became its own touch target.**

```jsx
{plan.photoUrl ? (
  <TouchableOpacity
    onPress={() => { setVizModal(plan.photoUrl); setVizModalKey((k) => k + 1); }}
    accessibilityLabel={`View full-screen photo from ${formatSessionDate(plan)}`}
    accessibilityRole="imagebutton"
  >
    <Image source={{ uri: plan.photoUrl }} style={s.historyIcon} resizeMode="cover" />
  </TouchableOpacity>
) : ( … )}
```

A nested `Touchable` wins the press, so tapping the photo does **not** also fire
the card's `openClassify`. "Look at the photo" and "classify this session" are
now two distinct gestures on one card.

**2. The screen now renders the shared viewer.**

```jsx
{renderClassifyOptions()}
{renderRoomPicker()}
{renderAreaPicker()}
{renderClassifyNameSheet()}
{renderPhotoZoomModal()}      // added
```

### Reuse, not reinvention

`renderPhotoZoomModal()` already existed and already does everything required:

```jsx
<ImageZoom uri={vizModal} minScale={1} maxScale={5}
           isDoubleTapEnabled={true} resizeMode="contain" />
```

Pinch-zoom, pan, double-tap-to-zoom, and an X close button, wrapped in
`GestureHandlerRootView`. Results and Room Detail were already callers; Needs
Review is now the third. **No second zoom implementation was added**, and no new
dependency.

### State preservation

Closing sets `vizModal` to `null`. The viewer is a `<Modal>` overlaid on the
Needs Review screen — the screen never unmounts, so `unresolvedSessions`, scroll
position, and any open classify sheet are untouched by opening or closing it.
The modal is rendered last so it layers above the classify sheets.

**No migration or classification data is read or written by this change.**

---

## Fix 2 — Login password field and keyboard

### What was wrong

The auth screen's `ScrollView` had no keyboard props at all:

```jsx
<ScrollView contentContainerStyle={s.authScroll}>
```

The most consequential omission is `keyboardShouldPersistTaps`. Without it,
React Native swallows the first tap while a keyboard is open in order to
dismiss it — so the primary action (**Sign in** / **Create account**) needed
**two taps**. The button was visible but not actionable, which reads as a dead
button rather than a keyboard problem.

There was also no way to dismiss the keyboard by tapping outside a field, even
though the codebase already has that pattern on the rename sheet and elsewhere.

### What changed

```jsx
<ScrollView
  contentContainerStyle={s.authScroll}
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
>
  <TouchableOpacity activeOpacity={1} onPress={() => Keyboard.dismiss()}
                    accessibilityLabel="Dismiss keyboard" accessibilityRole="button">
    <View style={s.authLogo}> … </View>
  </TouchableOpacity>
```

- **`keyboardShouldPersistTaps="handled"`** — the primary action now responds to
  the first tap while the keyboard is open.
- **`keyboardDismissMode`** — dragging the screen dismisses the keyboard.
- **Logo as a dismiss target** — tapping the empty area above the card clears the
  keyboard. It dismisses the **keyboard only** and never clears the fields, the
  same principle as `renderRenameSheet`'s backdrop.

The existing `KeyboardAvoidingView` (`behavior: padding` on iOS) is unchanged.

**Login and signup are one screen** — `mode` only swaps the copy — so both paths
receive the identical fix and neither can regress relative to the other.

### A deliberate restraint worth recording

The codebase already contains a different, arguably better pattern from the
2026-08-12 keyboard audit, on the Home screen:

```jsx
<ScrollView
  automaticallyAdjustKeyboardInsets      // <- the prop that guarantees the
  keyboardShouldPersistTaps="handled"    //    focused field stays visible
  keyboardDismissMode="on-drag"
>
```

That screen has **no** `KeyboardAvoidingView`. Combining
`automaticallyAdjustKeyboardInsets` with `KeyboardAvoidingView` double-adjusts
on iOS and pushes content too far, so adopting it on the auth screen would mean
removing the `KeyboardAvoidingView`.

I did not make that change, because it restructures the layout of the screen a
user must pass through to use the app at all, and I cannot verify it on a
device from this environment. If the on-device test below shows the password
field still obscured, that is the next change to make, and it is a small one.

---

## Verification status — read this before treating the fixes as done

**The brief asked for on-device verification and said not to rely on code
inspection alone. I cannot run a device or emulator from this environment** —
there is no Java for an Android emulator and no macOS/Xcode for iOS. So the
device-observable evidence is genuinely outstanding, and I am not going to
present static checks as if they were device results.

What *was* verified here:

| Check | Method | Result |
|---|---|---|
| Syntax | `node -c App.js` | PASS |
| TDZ audit (the crash class from 2026-08-14) | `scripts/auditTdz.js` | CLEAN — 0 violations |
| Bundle builds | `npx expo export --platform ios` | PASS |
| Staging fingerprint matches installed build | `expo-updates fingerprint:generate` | `194c6294…` MATCH |
| Viewer reuse, not duplication | grep — `renderPhotoZoomModal` now has 3 callers | confirmed |
| Auth screen covers both login and signup | one screen, `mode` swaps copy only | confirmed |

### Device test protocol — the five required evidence items

Install first: force-quit, open, wait 10 s, force-quit, open.

**1. Needs Review image opens full-screen and zooms**
Menu → Needs Review → tap the **photo thumbnail** on a card.
Expect: full-screen viewer, pinch to zoom, drag to pan, double-tap to zoom, X to
close. Confirm tapping the photo does **not** open the classify flow.

**2. Returning preserves the card/session state**
Before opening, scroll partway down and note the card order. Close the viewer.
Expect: same scroll position, same cards, nothing re-fetched. Then tap the
card *body* — the classify flow should still open normally.

**3. Password field remains visible with the keyboard open**
Sign out. On the login screen tap the **password** field.
Expect: the password field and the Sign in button both remain visible.
**This is the one most likely to still fail** — if the field is covered, say so
and I will switch the screen to the Home-screen pattern.

**4. Login still succeeds** — enter real credentials and tap **Sign in once**.
Expect: it works on the *first* tap. Needing two taps means
`keyboardShouldPersistTaps` did not take effect.

**5. No regression to signup/auth**
Toggle to **Create account**, tap through both fields, tap outside to dismiss,
and confirm the button responds on the first tap. Also check **Forgot password**
still opens.

---

## Not done

No production changes. The 50% production rollout, the production `isPro` rule,
Cloud Functions, and all migrated data are untouched. No migration or
classification data was read or written by either fix.
