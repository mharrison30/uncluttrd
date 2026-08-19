# 2.0 Re-engagement Campaign — Preparation Audit

**Read-only, 2026-08-18. No emails sent, no code modified, no production
changed.** Firestore access was GETs only.

---

## CORRECTION — 2.0.0 IS LIVE IN BOTH STORES

**This section originally claimed 2.0.0 was not publicly available and called
it a hard blocker. That was wrong.** Verified against the stores themselves
rather than against our own submission records:

| Store | Live version | Released |
|---|---|---|
| **App Store** (`itunes.apple.com/lookup?id=6781513811`) | **2.0.0** | **2026-08-18** |
| **Google Play** (`com.mharrison.uncluttrd` listing) | **2.0.0** | — |

The error was reasoning from what *this session* had done — iOS build 37 to
TestFlight, Android versionCode 11 to the Play alpha track, public submission
explicitly held — instead of asking the stores. The releases were promoted
outside anything visible from here. **The public store listing is the source of
truth for what is live; our submission history is not.**

**Consequences:**

- **There is no store blocker.** The campaign can ship whenever the list and
  unsubscribe issues (Part 3) are resolved.
- **Production `config/appVersion.currentVersion = "2.0.0"` is correct and
  meaningful** — 1.0.4 users are genuinely behind a version they can actually
  download right now.
- **Part 2's finding matters more, not less.** The update exists in the store;
  the 1.0.4 users don't know. They cannot be told in-app, because
  `checkForAppUpdate` postdates their bundle. Reaching them still requires an
  OTA to runtime `d348c8b8` / `e55888d4` from a 1.0.4 checkout.

### The live release notes already commit to a feature list

Published with 2.0.0 on the App Store:

> Meet the new Uncluttrd.
> • Save your rooms and return anytime
> • Get multiple organizing approaches personalized to your space
> • Work through clear, practical steps at your own pace
> • Keep your progress and room history in one place
> • Visualize what your organized space could look like
> • Find helpful product recommendations along the way

Note bullets 4, 5 and 6 — progress/history, visualization, product
recommendations. Those are the three that Part 1 found **already existed in
1.0.4**. The store copy handles this correctly by not claiming they are new;
it presents the whole set as "the new Uncluttrd" rather than as six new
features. **The email should take the same posture** — lead with rooms and
approaches, and let the rest sit as part of the whole rather than as
individually new claims.

---

# PART 1 — What's Actually New in 2.0

Baseline `e3617972` (1.0.4, 2026-07-29) → HEAD (2026-08-18): **145 commits, 80
touching `App.js`.**

The scale is not incremental. `App.js` went from **4,207 lines to 14,263** —
3.4×. 1.0.4 was a single-file app with no `shared/` modules at all.

### What 1.0.4 actually was

A one-shot photo analyzer. You photographed a space and got a plan organized
into **three budget tiers** — Budget (under $50), Mid-Range ($50–200), Premium
($200+) — each with four tips and three products chosen so the three prices
*summed* into the tier's band. Plus a first-session checklist. Plans were saved
and there was a history list.

There were **no Rooms, no Areas, no approaches, and no sessions.** Verified by
marker counts in the 1.0.4 source:

| Marker | 1.0.4 | HEAD |
|---|---|---|
| `Rooms` | **0** | 131 |
| `areaId` | **0** | 135 |
| `approach` | **0** | 225 |
| `sessionScope` | **0** | 12 |
| `productRecommendations` | **0** | 14 |
| `Recently Deleted` | **0** | 15 |
| `analyzePhotoDetail` | **0** | 1 |
| **`tiers`** | **13** | 11 (legacy compat only) |
| `visualization` | **10** | 40 |

The last two rows are the story: **tiers were the organizing model in 1.0.4 and
are now legacy-compatibility code**, while visualization already existed.

## Verification of the five proposed bullets

### a. "Organize with Spaces" (Rooms/Areas) — ✅ **GENUINELY NEW**

Zero occurrences of Rooms or `areaId` in 1.0.4. This is the largest single
change in the release, and it is legitimately new: Rooms, Areas within Rooms,
Area re-parenting, room merges, visual recognition of a returning space, visit
counts, and per-Area history.

> *Your spaces now have a home. Organize a room once, then come back to it —
> Uncluttrd remembers what you did and what's left.*

### b. "A better way to work through bigger projects" (session/approach) — ✅ **GENUINELY NEW**

1.0.4 sorted suggestions by **price band**. 2.0 replaces that entirely with
three **approaches** — Keep It Simple, Polished, Elevated — that differ by
ambition and method rather than budget, plus a session model that tracks scope
(whole room vs. one area) across visits. `approach` appears 225 times at HEAD
and zero times in 1.0.4.

> *Choose how far you want to take a space, and work through it across
> sessions instead of all at once.*

### c. "See what's possible before you start" (AI visualization) — ⚠️ **EXISTED — do not call it new**

`generateVisualization` is in the 1.0.4 source at line 2335 and wired to a
button at line 3284. It was a real, shipping feature.

**What actually changed:** it is approach-aware instead of tier-aware, can be
regenerated with safe replacement, is server-side Pro-gated, and no longer
produces ceiling fixtures.

> *Rewrite as improvement:* "Room previews now match the approach you chose —
> and you can regenerate one you don't like."

### d. "Smarter product recommendations" — ✅ **ACCURATE AS WORDED** (existed, substantially rebuilt)

Products existed in 1.0.4, but as three emoji-labelled items per tier
constrained to sum into a price band. 2.0 replaces that with recommendations
that must be **grounded in visible evidence** — each tied to a specific problem
found in the photo, or carrying an explicit justification sentence — plus real
icons, compact cards, and one-line benefit reasons.

"Smarter" correctly implies a pre-existing thing improved. Do **not** upgrade
this to "new".

> *Recommendations now point at something actually visible in your photo, and
> tell you in one line why it helps.*

### e. "Your progress stays with you" — ⚠️ **EXISTED — reframe or drop**

1.0.4 already had all of this: plans written to `users/{uid}/plans`, a history
UI (`showHistory`, `historyItem`), cross-batch progress (`batchHistory`), and
progress photo upload.

**What actually changed** is that progress is now organized **by Room and
Area** rather than as a flat list of plans, and survives renames, merges and
re-parenting.

> *Reframe:* "Your progress now lives with the room it belongs to — not in a
> list of past photos."

## Genuinely new, and missing from the proposed copy

Worth considering, since three of the five proposed bullets are weaker than the
sender likely assumes:

| Feature | Benefit |
|---|---|
| **Faster results** (two-stage analysis) | A usable summary appears quickly; detail fills in behind it |
| **Recently Deleted + Restore** | Deleting a room is no longer permanent — restore it |
| **Needs Review** | Older sessions that predate Rooms get sorted into the right space |
| **Swipe-to-delete** | Removing an area no longer needs a visible button cluttering the row |
| **Delete your account** | Full server-side deletion, in-app |
| **Accessibility** | Every audited text/background pair now meets WCAG AA |

**Recommended honest bullet set:** a, b, d (as worded), plus "faster results"
and "recently deleted" — with c and e reframed as improvements rather than
headlines.

---

# PART 2 — Version Detection and Upgrade Prompt

### a/b. CORRECTED — the check and the prompt both already exist

**Originally answered "No" to both. That was wrong.** `checkForAppUpdate()` was
added in commit `e29fc08`, is wired into `AppRoot`'s mount effect, and ships a
complete implementation: a `isVersionBehind` comparator, a Firestore config
read, platform-aware store URLs, and a non-blocking two-button `Alert.alert`.

The miss was a grep that looked for `expo-application`, `minVersion`,
`forceUpdate` and `checkForUpdate` — none of which appear, because the code
reads `Constants.expoConfig?.version` instead. **Absence of the terms I
searched for is not absence of the feature.**

It had nevertheless **never fired for anyone**, for two independent reasons:

| Environment | Why it was inert |
|---|---|
| Production | `config/appVersion` did not exist → `if (!snap.exists()) return` |
| Staging | `if (!IS_PRODUCTION) return` disabled it outright — despite a staging config doc set to `9.9.9` specifically to force the prompt |

Both are now resolved (commit `ca22003`): the environment guard is removed, the
config document exists in both projects, and the schema accepts
`currentVersion` / `updateMessage` alongside the original per-platform fields.

**Still true, and now the operative constraint:** 1.0.4 users do **not** have
this code — it postdates their bundle — so they cannot be nudged in-app until
it is OTA'd to runtime `d348c8b8` / `e55888d4` from a 1.0.4 checkout.

### c. Can Expo's Updates API detect a *native* update? **No.**

`expo-updates` only knows about OTA updates matching **the runtime the binary
already has**. `Updates.checkForUpdateAsync()` asks "is there a newer JS bundle
for *my* fingerprint?" — it has no concept of a newer binary in the store.

The current usage is debug-only: `Updates.updateId`, `Updates.channel`,
`Updates.createdAt`, logged once per mount.

**And the failure mode is silent.** A 1.0.4 user's runtime is `d348c8b8`. Once
`version` moved to 2.0.0 the fingerprint changed, so nothing new is ever
published to `d348c8b8` — the app simply stops receiving updates and says
nothing. That is exactly the state 1.0.4 users are in right now.

### d. How hard to add a minimum-version check? **Genuinely easy — and, importantly, deliverable to 1.0.4 users.**

The non-obvious part: **we can still reach 1.0.4 users by OTA.**

`App.js` is **not** a fingerprint input. So an upgrade banner can be added to
the 1.0.4 source tree and published to runtime `d348c8b8` / `e55888d4` without
a rebuild and without changing their fingerprint. Both dependencies needed are
already in the 1.0.4 `package.json`:

| Dependency | In 1.0.4? |
|---|---|
| `expo-constants` (read running version) | ✅ `~18.0.13` |
| `firebase` (read a config doc) | ✅ `^12.14.0` |
| `expo-application` | ❌ not installed — **and adding it needs a native build, so avoid it** |

**Sketch:** read `Constants.expoConfig.version`, compare against a
`config/appVersion` Firestore doc holding `minSupportedVersion` and
`latestVersion`, show a dismissible banner with a store link when behind.
Firestore is already initialized; no new dependency, no native change.

**Effort:** roughly half a day, dominated by testing rather than code.

**Sequencing constraint:** publishing to `d348c8b8` requires checking out the
1.0.4 tree, adding the banner there, and publishing from that checkout — the
same detached-checkout procedure used for the 6e19833 hotfix. It cannot be
published from HEAD, which fingerprints elsewhere.

**Recommend Firestore over Remote Config**: `@react-native-firebase/remote-config`
is not installed, and installing it is a native change — which cannot reach the
users we are trying to reach.

---

# PART 3 — Email Capability and User Source

### a. Where are emails stored? **Firestore `users/{uid}.email`, and Firebase Auth.**

Present on **42/42** user documents. Firestore is the practical source for a
campaign since it also carries `displayName`, `isPro`, `createdAt` and
`isTestAccount`.

### b. Email service — **Resend**, single-send API.

`POST https://api.resend.com/emails`, from `Uncluttrd <hello@uncluttrd.app>`.
Three transactional senders exist: `sendWelcomeEmail`, the Pro-upgrade email
inside `syncProStatus`, and `reengagementNudge`. A separate sandbox sender
(`onboarding@resend.dev`) is used only for canary alerts.

### c. Has the welcome email reached real users? **Yes — with a caveat.**

`sendWelcomeEmail` invoked on **8 distinct dates in August** (11 cold starts),
and there are **zero `[sendEmail]` failures logged in 90 days** across all
functions. Every Resend call returned OK.

**Caveat:** "accepted by Resend" is not "landed in the inbox." There is **no
delivery, bounce, open or complaint tracking**, and `sendWelcomeEmail` writes
no per-user marker — `welcomeEmailSentAt` exists on **0/42** docs. Only
`reengagementEmailSentAt` is recorded (3/42). So per-user delivery cannot be
confirmed from data we hold.

### d. Bulk or transactional only? **Transactional only today.**

Everything is event-triggered — doc creation, webhook, or scheduler. There is
no campaign path, no list, no batching. Sending a campaign through the current
single-send helper would be a loop over addresses, which is exactly how domain
reputation gets damaged.

### e. Opt-out / unsubscribe — ❌ **NONE. This is a hard CAN-SPAM blocker.**

- No `optOut`, `unsubscribe`, `marketingConsent` or equivalent field on **any**
  of the 42 user documents.
- No unsubscribe link in any of the three email templates.
- No `List-Unsubscribe` header — `sendEmail` sends only `from`, `to`,
  `subject`, `text`.
- No suppression list anywhere.

The three existing emails are defensibly transactional/onboarding, which is why
this has not bitten yet. **A "What's New in 2.0" email is marketing**, and
sending it without a functioning unsubscribe would violate CAN-SPAM.

### f. How many real email addresses? **37 real users → 34 distinct addresses.**

| | |
|---|---|
| Total user documents | 42 |
| Internal / test accounts | 5 |
| **Real users** | **37** |
| With an email address | 37/37 (100%) |
| **Distinct real addresses** | **34** |

**Quality warnings for a send list:**

- **`village1026@gmail.com` appears on 4 separate accounts** — one of 3
  duplicate addresses. Dedupe before sending or that person gets four copies.
- **`jazzyj@example.com` is not a real address.** `example.com` is reserved;
  it will hard-bounce.
- A cluster of accounts created 2026-07-12 → 07-16 share a naming pattern
  (`barakatullah…`, `khademshahid4`, `khalidkhadem2023`, `ahsansadat60`,
  `simonjan2090`, `fkhadimsofian`). Not verifiable either way from here, but
  worth eyeballing — **on a 34-address list, a handful of hard bounces is a
  double-digit bounce rate**, which is how a young sending domain gets
  throttled.

### g. Users without an email? **Zero.** All 37 real users have one.

### h. Does Resend support bulk? **Yes — no separate tool needed.**

Resend provides **Audiences** (contact lists, CSV import, segments, topics) and
**Broadcasts** (campaign sends). Critically, Broadcasts *"handle all your
unsubscribe flows for you automatically"* — which resolves (e) without building
a preference centre.

**Recommendation: use Resend Broadcasts, not Mailchimp/SendGrid.** The domain
(`uncluttrd.app`) is already authenticated and warm from transactional sending;
moving marketing to a second provider would start a cold domain reputation from
zero for no benefit at this volume.

---

## Summary of blockers, in order

1. ~~2.0.0 is not in the stores.~~ **RESOLVED - it is live in both stores as of 2026-08-18.** See the correction at the top.
2. **No unsubscribe mechanism.** Resolved by sending via Resend Broadcasts
   rather than the current single-send helper.
3. **No version detection**, so nobody can be told in-app to update — fixable
   by OTA to the 1.0.4 runtime, which is still reachable.
4. **List hygiene** — dedupe 3 addresses, drop the `example.com` one, review
   the July cluster. 34 addresses leaves no margin for bounces.

## And a proportionality note

The audience is **34 people**. That is worth doing carefully and worth doing
personally, but it does not warrant campaign tooling investment. The in-app
upgrade banner (Part 2d) will likely reach more of them than the email will,
since it reaches anyone who opens the app regardless of whether they read
mail from a product they used once.
