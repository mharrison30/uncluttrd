# RevenueCat Mirror Hardening — Audit

**Run 2026-08-14. Read-only audit. No rules were deployed. No code changed.**

## Verdict: **the rule change is BLOCKED. Gate 2b fails unambiguously.**

The task defined a gate before deploying the rules change. Two of its three
conditions are not met:

| Gate | Status |
|---|---|
| **2a** Webhook deployed, healthy, successfully invoked at least once | **Partially** — deployed on both projects; one successful staging invocation, but it predates the entitlement-ID fix and produced `isPro=false`. No post-fix delivery observed. |
| **2b** No client-side code path WRITES `isPro` | **FAILS** — the client writes `isPro` from **two** paths today, plus a third on user creation. |
| **2c** Client SDK records purchases and RevenueCat delivers the webhook | **Unverified** — cannot be confirmed without a sandbox purchase. |

Per the task's own instruction (2d / §5), the rule change was **not deployed**.
This is the exact lockout risk flagged when the gap was found — and the audit
shows it is not hypothetical.

---

## 1. Webhook audit

`exports.revenueCatWebhook`, `functions/index.js:912`.

### a. Events handled

**None specifically — and that is the correct design.** There is no event-type
switch. Any authenticated delivery is treated as "something changed, go
verify", and the handler re-fetches the authoritative entitlement state from
RevenueCat's REST API rather than trusting the event body:

```
GET https://api.revenuecat.com/v2/projects/{project}/customers/{uid}/active_entitlements
```

So `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`,
`BILLING_ISSUE`, `PRODUCT_CHANGE`, `SUBSCRIBER_ALIAS` and `RESTORE` are all
handled identically and correctly. `TRANSFER` is the one special case, handled
explicitly (below).

Security is genuine: HMAC-SHA256 over `{timestamp}.{rawBody}` verified against
**both** store secrets (iOS and Android integrations sign with different keys)
before any parsing, using `crypto.timingSafeEqual` with a length pre-check.
Unset secrets are filtered out so an unconfigured platform cannot match via an
empty-secret HMAC.

### b. What it writes

Two things, and nothing else:

1. `users/{uid}` → **`{ isPro }` only.** No subscription details, no product
   id, no expiry, no timestamp.
2. `users/{uid}/revenueCatWebhookEvents/{event.id}` → `{ type, processedAt,
   isPro }`, for per-(uid, event) idempotency.

Side effect: a "Welcome to Uncluttrd Pro" email on a genuine `false → true`
transition only.

**Gap worth noting:** because only `isPro` is written, there is no stored
expiry or product info. Nothing downstream can reason about *when* Pro lapses
without calling RevenueCat again.

### c. User identification

`event.app_user_id` **is** the Firebase uid, by construction — the client calls
`Purchases.logIn(u.uid)` at sign-in. No mapping table, no lookup.

`TRANSFER` events carry no `app_user_id`; they carry `transferred_from` /
`transferred_to` arrays. The handler re-syncs every real uid on both sides and
filters RevenueCat's anonymous ids (`$RCAnonymousID:…`), which have no
Firestore doc.

### d. Deployment

Deployed and ACTIVE on **both** projects, `us-central1`, gen 2, nodejs24:

```
cluttrd-staging   revenueCatWebhook  https  256Mi   created 2026-07-21
cluttrd-3e335     revenueCatWebhook  https  256Mi
```

Staging has all four secrets bound (`REVENUECAT_WEBHOOK_SECRET_IOS`,
`..._ANDROID`, `REVENUECAT_SECRET_API_KEY` v2, `RESEND_API_KEY`).
Last redeploys: 2026-08-08 and 2026-08-10.

### e. Invocation history — the problem

Cloud Logging retention (~30 days) has rolled off most history. What is still
retrievable:

**Staging** — real deliveries did occur, all in the 2026-07-21/22 setup window:

```
2026-07-21T11:57:28  [revenueCatWebhook] Missing signature header
2026-07-21T12:22:47  [revenueCatWebhook] active_entitlements fetch failed
                     for uid=test-uid-does-not-exist: HTTP 404
                     [revenueCatWebhook] active_entitlements raw response
                     for uid=8hD3iwG3MYOrbfww2g4QsVwHFsr1
                     [revenueCatWebhook] Processed RENEWAL for
                     uid=8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=false
                     [revenueCatWebhook] Malformed event payload  (x3)
```

**Production** — no handler invocations retrievable at all.

**Two things make that one success insufficient as proof of health:**

1. **It produced `isPro=false` for a `RENEWAL`** — which should yield `true`.
   That is the known entitlement-ID bug: the code compared against the
   developer-facing lookup key `"Uncluttrd Pro"` instead of the internal id
   `entl16a5fcafc4`. Fixed 2026-07-24 (`functions/index.js:54-66`).
2. **Its log format is the pre-fix one.** Current code emits
   `Processed {type} (event {id}): {uid}->isPro={v}`; the logged line is the
   older `Processed RENEWAL for uid=… -> isPro=…` shape. That line was written
   by superseded code.

**No delivery has been observed exercising the fixed code.** Absence of logs is
not proof of failure — retention genuinely rolled off — but it is also not the
positive confirmation the gate requires.

---

## 2. Client writes to `isPro` — the blocking finding

The task's precondition was that the client only *reads* `isPro`. It does not.

| # | Location | Trigger | Call |
|---|---|---|---|
| 1 | `App.js:13167` | RevenueCat `addCustomerInfoUpdateListener` — fires on purchase, restore, refund, renewal while the app is open | `updateDoc(doc(db,"users",uid), { isPro: proActive })` |
| 2 | `App.js:13317` | Post-login `Purchases.getCustomerInfo()` | `updateDoc(doc(db,"users",u.uid), { isPro: proActive })` |
| 3 | `App.js:2627` | User-doc creation | `setDoc(..., { isPro: false, … })` — a *create*, permitted by the separate `allow create` rule, unaffected by this change |

Sites 1 and 2 are the live mirror. **They are currently how a paying user's
`isPro` actually becomes `true` in Firestore** — the webhook is the *intended*
mechanism but is unproven, and the client path is what has been carrying it.

Both calls are `.catch()`-ed and only `console.log` the failure, so tightening
the rule would not crash anything. It would fail **silently**, which is worse.

### What deploying the rule change today would do

1. User purchases Pro. Client SDK fires; `setIsPro(true)` and AsyncStorage
   update, so **the current session looks correct**.
2. `updateDoc({isPro:true})` → `PERMISSION_DENIED`, swallowed by `.catch`.
3. If the webhook does not land, Firestore keeps `isPro:false`.
4. Next launch reads Firestore → **the paying user is demoted to Free.**
5. Worse, server-side: `analyzePhoto` gates the free monthly limit on
   `userData.isPro` (§3). A real Pro user would hit
   `resource-exhausted: Free plan limit reached` — a hard functional block on
   the app's core feature, not a cosmetic badge.

That is the lockout scenario, reached through the ordinary purchase path.

---

## 3. Every `isPro` consumer

### Server-side — authorization

| Location | Purpose | Source | Verdict |
|---|---|---|---|
| `functions/index.js:183` `analyzePhoto` | Free monthly limit gate | **Firestore `userData.isPro`** | **NOT ACCEPTABLE** |
| `functions/index.js:297` `analyzePhoto` tx | Same gate, inside the transaction | **Firestore `freshData.isPro`** | **NOT ACCEPTABLE** |
| `functions/index.js:593` `generateVisualization` | Cached fallback *only* when RevenueCat is unreachable, after `verifyProEntitlement` | Firestore, deliberately | **Acceptable** — documented outage tradeoff; failure mode requires forged `isPro` **and** a RevenueCat outage simultaneously |
| `functions/index.js:877` `syncProStatus` | `wasPro`, to decide whether to send the upgrade email | Firestore | **Acceptable** — not authorization |

**`analyzePhoto` is a real finding independent of the rules.** It is
server-side authorization reading a field the client can currently forge with
one `updateDoc`. A user who sets `isPro:true` today gets unlimited analyses,
each costing an Anthropic vision call. `generateVisualization` was hardened
with `verifyProEntitlement`; `analyzePhoto` was not.

### Client-side — UI gating (all acceptable)

`isPro` arrives as a prop into `MainApp` from `App.js:13120` state, hydrated
from Firestore/AsyncStorage. Consumers are presentational or paywall-triggering:

- Header "Pro" wordmark and free-rooms counter — ~12 render sites
- Account badge (`11379-11380`), upgrade rows (`11383`, `11389`)
- Menu Pro badges and gating (`10165`, `10171`, `10176`)
- Paywall triggers: `6891` (free-analysis limit), `7781` (visualization),
  `12893`
- Visualization button label (`12231`, `12603`, `12617`), Pro-only branch
  (`12586`)
- PDF/share sheet branch (`12063-12064`)
- Companion Pro path (`5027`), mid-session upgrade re-run (`5977-6043`)
- Data-loading effects keyed on the `isPro` transition (`5321`, `5361`, `5394`)

All are UI affordances with a server-side backstop, which the task explicitly
allows. **Caveat:** `6891`'s backstop is `analyzePhoto:183` — itself the
forgeable check above. So that particular pairing is not actually backstopped.

---

## 4. Test scenarios

Not run. The rule change was not deployed, so scenarios (a)–(d) — which all
test post-deploy behaviour — have no meaning yet. Reported as **not executed**
rather than assumed.

**(e) webhook fires on a test purchase** — not attempted. It requires a
sandbox purchase on a device signed into a sandbox Apple ID, which is a manual
action.

**(f) What would need to happen to test the webhook**, in order:

1. On the staging build, sign in as a test user and complete a **sandbox**
   purchase of Uncluttrd Pro.
2. Watch `firebase functions:log --only revenueCatWebhook --project
   cluttrd-staging` for a line in the **current** format:
   `Processed INITIAL_PURCHASE (event …): {uid}->isPro=true`.
3. Confirm `users/{uid}.isPro === true` in Firestore, and that
   `users/{uid}/revenueCatWebhookEvents/{eventId}` was created.
4. Confirm the Pro welcome email arrived.

Step 2 producing **`isPro=true`** is the specific evidence missing today. Until
it exists, the fixed entitlement-id path has never been proven end-to-end.

**Is the rule change safe on the strength of the audit alone? No** — and not
because of the webhook uncertainty. It is unsafe because of §2: the client is
still the active writer of this field. That is a code fact, not an inference.

---

## 5. What has to happen, in order

The rule change is the **last** step, not the first.

1. **Prove the webhook end-to-end** — the sandbox purchase above, producing
   `isPro=true` under the current code. Non-negotiable.
2. **Move `analyzePhoto` to `verifyProEntitlement`** (`functions/index.js:183`
   and `:297`). This is the larger security gap and is independent of the
   rules; it should not wait on them. Note `verifyProEntitlement`'s existing
   semantics: `404 → false`, other `4xx → false`, `5xx`/network → `null`
   (fall back to cache).
3. **Remove the two client writes** (`App.js:13167`, `:13317`), leaving
   `setIsPro` + AsyncStorage for instant local feedback and letting the webhook
   own Firestore. Ship via OTA and let it propagate.
4. **Then** tighten the rule to `hasOnly(['hasSeenTutorial'])` and deploy to
   staging.

Doing 4 before 3 breaks paying users. Doing 4 before 1 breaks them with no
recovery path. Doing 2 at any point is a strict improvement.

Once steps 1–3 land, the rule change becomes the small, safe edit it was
intended to be:

```diff
- affectedKeys().hasOnly(['isPro', 'hasSeenTutorial']);
+ affectedKeys().hasOnly(['hasSeenTutorial']);
```

`hasSeenTutorial` writes (`App.js:13286`, `:13348`) are unaffected, and the
`allow create` rule already handles the `isPro: false` seed at signup — so
scenario (c) would pass and (b) would then correctly reject.

---

## Files touched

**None.** `firestore.rules`, `App.js` and `functions/index.js` are unchanged.
Nothing was deployed to staging or production.
