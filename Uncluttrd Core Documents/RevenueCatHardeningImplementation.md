# RevenueCat Mirror Hardening

**Status as of 2026-08-15: `isPro` is server-owned on staging.** The client can
no longer write it, and every paid action is authorized against RevenueCat
rather than against the Firestore mirror.

| Step | Status |
|---|---|
| 1. Prove the webhook end-to-end | **DONE** — 2026-07-29 and 2026-08-15 evidence below |
| 2. `analyzePhoto` → `verifyProEntitlement` | **DONE** — deployed to staging (`ed74936`) |
| 3. Remove the two client `isPro` writes | **DONE** — 2026-08-15 |
| 4. Tighten the Firestore rule | **DONE** — deployed to staging 2026-08-15 |

**Nothing has been deployed to production.** Production still runs the old rule
and the old client, and is unaffected by everything below.

---

## Correction to the original audit

The first version of this document concluded:

> No delivery has been observed exercising the fixed code. […] the sole
> retrievable successful invocation is from 2026-07-21/22, produced
> `isPro=false` for a `RENEWAL`, and used the pre-fix log format.

**That was wrong, and the error was mine.** It was a log-retrieval limitation,
not a real gap. `firebase functions:log` returns inconsistent windows depending
on `-n` — three different "newest entry" answers for the same stream — and my
original query happened to land on a window that missed the relevant days.
Widening and unioning the windows surfaced them.

The webhook had in fact been working correctly since shortly after the
2026-07-24 entitlement-id fix. The corrected evidence follows.

### Evidence: 2026-07-29 (already existed; I missed it)

```
16:09:56  Processed RENEWAL      (EB7BDA67-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
16:14:13  Processed RENEWAL      (BC51EB3F-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
16:20:51  Processed RENEWAL      (D6E917AD-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
16:49:09  Processed RENEWAL      (CA32171D-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
16:58:18  Processed RENEWAL      (32C95ABD-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
17:05:28  Processed CANCELLATION (FA05ADBF-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
17:05:28  Processed RENEWAL      (A2F529AD-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=true
17:14:31  Processed EXPIRATION   (3AF27F86-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=false
```

with the raw payload showing `entitlement_id: "entl16a5fcafc4"` — the internal
id, confirming the fix.

Note `CANCELLATION` correctly held `isPro=true`: cancelling does not revoke an
entitlement until the paid period ends. Only `EXPIRATION` flipped it to `false`.
That is the event-agnostic design working — the handler re-queries RevenueCat's
API rather than inferring state from the event name.

### Evidence: 2026-08-15, this session

**Webhook test event** (15:07:57) — proved signature verification end to end:

```
[revenueCatWebhook] active_entitlements fetch failed for
    uid=73f855d8-b6fa-4f08-9039-9bc597ec91f4: HTTP 404
[revenueCatWebhook] Processed TEST (28FE24F8-…): no uids updated
```

Reaching `Processed` means the HMAC verified past all three 401 gates. The 404
is correct behaviour for a placeholder uid — "unknown customer", not an outage —
so `syncProStatus` returned `null` and wrote nothing.

**Sandbox purchase** (15:26) — on Firebase uid `vGoBw6D4saV16PzwNi4HkaA6Cuu2`:

```
15:26:09  Processed RENEWAL  (A879A151-…): vGoBw6D4saV16PzwNi4HkaA6Cuu2 -> isPro=true
15:26:10  Processed TRANSFER (8B0C597D-…): 8hD3iwG3MYOrbfww2g4QsVwHFsr1 -> isPro=false,
                                            vGoBw6D4saV16PzwNi4HkaA6Cuu2 -> isPro=true
```

Entitlement payload:
`{"items":[{"entitlement_id":"entl16a5fcafc4","expires_at":1786807859000}]}`

**No `INITIAL_PURCHASE` was delivered**, because the sandbox Apple account
`sandbox2@uncluttrd.app` retained purchase history from the July testing. Apple
treated the purchase as a renewal, and RevenueCat fired a `TRANSFER` to move the
entitlement from the old Firebase uid to the new one.

That turned out to be a better test than the one planned: it exercised the
`TRANSFER` branch, which has no `app_user_id` and must read
`transferred_from`/`transferred_to` and re-sync **both** sides. It did so
correctly in a single event — source demoted, destination promoted.

`Firestore write failed: 0` across all of it, so every write landed.

---

## Step 3 — client `isPro` writes removed

Two `updateDoc` calls deleted from `App.js`:

| Was | Trigger |
|---|---|
| `App.js:13167` | `Purchases.addCustomerInfoUpdateListener` — fired on purchase, restore, refund, renewal |
| `App.js:13317` | Post-login `Purchases.getCustomerInfo()` |

**What was deliberately kept.** Both sites still call `setIsPro(proActive)` and
write `AsyncStorage`. That is the instant in-session feedback that makes a
purchase feel immediate without waiting on the webhook round trip. It is a UI
cache, never an authority — every paid action is checked server-side
(`verifyProEntitlement` in `analyzePhoto` and `generateVisualization`).

All ~75 client `isPro` references remain for reads and UI gating: the header Pro
wordmark, the account badge, menu Pro badges, paywall triggers, the
visualization button, the PDF/share branch, and the effects keyed on the
`isPro` transition.

**Exhaustive write audit.** Multiline-aware scan of every `updateDoc`/`setDoc`
call whose payload mentions `isPro`, comments stripped:

```
line 2621  setDoc  -> userRef, { uid, email, displayName, createdAt, …, isPro: false, … }
```

**One remains, and it is correct.** It is a **create**, not an update — the
signup seed of `isPro: false` — governed by the separate `allow create` rule and
therefore unaffected by the change. It also seeds `false`, so it grants nothing.

Repo-wide, only `App.js` and `functions/index.js` mention `isPro` at all.

---

## Step 4 — Firestore rule tightened

```diff
- affectedKeys().hasOnly(['isPro', 'hasSeenTutorial']);
+ affectedKeys().hasOnly(['hasSeenTutorial']);
```

Deployed to **`cluttrd-staging` only**:

```
+  cloud.firestore: rules file firestore.rules compiled successfully
+  firestore: released rules firestore.rules to cloud.firestore
Deploy complete!
```

The rule now has a comment recording the three preconditions that had to hold
first, so nobody re-loosens it without knowing why it was safe:

1. The webhook demonstrably writes `isPro=true` for a genuinely entitled customer.
2. No client code path writes `isPro`.
3. Server-side authorization no longer trusts the field.

Tightening without (2) would have silently demoted paying users on next launch —
the lockout risk flagged when the gap was first found.

**Why the webhook is unaffected:** `syncProStatus` writes through the Firebase
**Admin SDK**, which bypasses security rules entirely. Rules govern client SDK
access only. This is architectural, not incidental.

---

## Verification status — what is and is not proven

| Check | Status |
|---|---|
| Client code contains no `isPro` write path | **Verified** — multiline-aware scan, repo-wide |
| Rules source correct | **Verified** — compiled and released |
| Rules deployed to staging only | **Verified** — production untouched |
| Webhook writes `isPro` after client lockout | **Not yet observed** — see below |
| Direct client write to `isPro` rejected | **Not yet executed** — see below |
| `hasSeenTutorial` still writable | **Not yet executed** |
| Staging UI follows server-written changes | **Not yet observed** |

### Why the client-rejection test was not automated

It needs an authenticated Firebase ID token for a staging user. The canary mints
one via `admin.auth().createCustomToken()`, which requires Admin SDK credentials
— unavailable in this environment (`GOOGLE_APPLICATION_CREDENTIALS` unset,
`gcloud` non-functional for lack of Python). The alternative, a
`@firebase/rules-unit-testing` suite against the Firestore emulator, needs Java,
which is not installed. Neither was installed unprompted.

**The authoritative test is the Firebase Console Rules Playground**, which
evaluates the *deployed* rules rather than a local copy — see the chat summary
for the exact steps.

### Why the post-lockout webhook write is not yet confirmed

The sandbox entitlement expired at `2026-08-15T15:30:59Z`, and sandbox
subscriptions auto-renew roughly every 5 minutes for about 6 cycles. Those
renewals and the eventual expiration will each write `isPro` via the Admin SDK
with the client fully locked out — the exact proof required. At the time of
writing, the log CLI's pagination had not surfaced any event after 15:26.

---

## Residual risk

The client UI cache (`setIsPro` + AsyncStorage) can still be made to *look* Pro
locally — by tampering with device storage, for example. That grants nothing:
`analyzePhoto` and `generateVisualization` both verify against RevenueCat.

The one remaining soft spot is `generateVisualization`'s deliberate outage
fallback, which reads cached `isPro` when RevenueCat is unreachable. Exploiting
it now requires writing `isPro` — which the rules forbid — **and** a RevenueCat
outage at the same time. Before today, it required neither.

---

## Not done

- **Production deploy.** Rules, client and functions all still need promoting,
  and only after staging soak.
- **`analyzePhoto` production deploy** — step 2 is staging-only so far.
