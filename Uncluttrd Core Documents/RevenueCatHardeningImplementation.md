# RevenueCat Mirror Hardening

**COMPLETE ON STAGING — 2026-08-15.** All four steps are done and every
verification listed below has been executed and passed. `isPro` is server-owned:
the client can no longer write it, and every paid action is authorized against
RevenueCat rather than against the Firestore mirror.

**Production is unchanged and this is not a production sign-off.** Promotion is
a separate, deliberate decision — see "Not done" at the end.

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
| Webhook writes `isPro` after client lockout | **VERIFIED** — see full lifecycle below |
| Client promotion still works post-edit | **VERIFIED** — Pro displayed on the new bundle |
| Client demotion still works post-edit | **VERIFIED** — app fell back to Free after `EXPIRATION` |
| Direct client write to `isPro` rejected | **VERIFIED** — Rules Playground, DENIED |
| `hasSeenTutorial` still writable | **VERIFIED** — Rules Playground, ALLOWED |

### Full sandbox lifecycle, uid `vGoBw6D4saV16PzwNi4HkaA6Cuu2`

The Firestore rule was tightened at ~15:35 and the client-write removal shipped
by OTA at ~15:47. **Everything from 15:50 onward is a write performed with the
client fully locked out.**

```
15:26:09  RENEWAL      -> isPro=true
15:26:10  TRANSFER     -> 8hD3iwG3… -> false,  vGoBw6D4… -> true
15:33:13  RENEWAL      -> isPro=true
--- 15:35  Firestore rule tightened to hasOnly(['hasSeenTutorial']) ---
15:42:37  RENEWAL      -> isPro=true
--- 15:47  OTA: client isPro writes removed ---
15:50:32  RENEWAL      -> isPro=true
15:59:37  RENEWAL      -> isPro=true
16:03:33  RENEWAL      -> isPro=true
16:07:26  RENEWAL      -> isPro=true
16:16:48  RENEWAL      -> isPro=true
16:23:59  RENEWAL      -> isPro=true
16:23:59  CANCELLATION -> isPro=true     (correct: entitlement runs to period end)
16:31:49  EXPIRATION   -> isPro=false    (demotion)
```

`Firestore write failed: 0` throughout. The Admin SDK wrote `isPro` in **both
directions** — true on every renewal and false on expiry — while client writes
to that field were forbidden by rules. That is the property the whole change
rests on, and it is now demonstrated rather than argued.

### Client demotion test — passed

After the `EXPIRATION` at 16:31:49, the staging app was observed to have fallen
back from **Pro member** to **Free** on its own.

That confirms the edited client paths still work in both directions. `isPro`
initialises to `false` and is only ever set from RevenueCat, so:

- Pro displayed on the new bundle → `setIsPro(true)` ran → the edited block is intact.
- Free after expiry → `setIsPro(false)` ran → demotion path intact.

Both call sites I edited ([App.js:13162](App.js#L13162) listener and
[App.js:13320](App.js#L13320) post-login seed) retain their `setIsPro` and
AsyncStorage calls with only the `updateDoc` removed, and one of the two
demonstrably fired.

### A correction on sandbox renewal behaviour

I twice predicted the subscription had reached the end of its renewal cycle —
first at six renewals, then again after the seventh. Both were wrong; it ran to
**nine** renewals plus a cancellation before expiring. Sandbox renewal counts
should not be predicted; read the actual `expires_at` in the webhook payload
instead.

### Rules Playground results — both passed

Run against the **deployed** staging ruleset (not a local copy), on
`/users/vGoBw6D4saV16PzwNi4HkaA6Cuu2`, simulation type `update`, authenticated
as that same uid:

| Payload | Result | Meaning |
|---|---|---|
| `{ "isPro": true }` | **DENIED** | The forgery path is closed. This is the exact attack the change exists to prevent — a signed-in user granting themselves Pro with one `updateDoc`. The stored value was `false` at the time (written by the `EXPIRATION` at 16:31:49), so this was a genuine privilege escalation attempt, not a no-op. |
| `{ "hasSeenTutorial": true }` | **ALLOWED** | The rule was not over-tightened. Onboarding-completion writes still work, so `hasSeenTutorial` is unaffected. |

Both are the intended outcomes. Together they show the `hasOnly` clause
discriminates correctly rather than simply denying everything — a rule that
denied both would have looked like a pass on the first test while silently
breaking onboarding.

**Why this was not automated.** It needs an authenticated Firebase ID token. The
canary mints one via `admin.auth().createCustomToken()`, which requires Admin SDK
credentials — unavailable here (`GOOGLE_APPLICATION_CREDENTIALS` unset, `gcloud`
non-functional for lack of Python). The alternative,
`@firebase/rules-unit-testing` against the Firestore emulator, needs Java, which
is not installed. Neither was installed unprompted. The Playground is in any case
the stronger test, because it evaluates the released ruleset rather than the
local file.

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

Nothing here is a defect; each is a deliberate boundary.

- **Production deploy — all three artifacts.** Promoting this means shipping
  *together*, and in this order:
  1. `functions` (`analyzePhoto` with `verifyProEntitlement`, plus the webhook)
  2. the client build/OTA with the `isPro` writes removed
  3. `firestore.rules`

  **The rule must go last.** Deploying it before the client change reaches
  production users would silently demote every paying customer on their next
  launch — the same lockout risk that gated this work from the start. Unlike
  staging, production users are not all on the latest bundle, so the client
  change needs time to propagate before the rule tightens.

- **Production webhook verification.** The staging webhook is proven. The
  production function is deployed but has **no retrievable invocation history**
  (§1e). Its signing secret and RevenueCat routing should be confirmed the same
  way — a test event — before the production rule change, not after.

- **A production sandbox/TestFlight purchase.** Worth one end-to-end pass in the
  production project before the rule lands there.
