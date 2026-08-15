# RevenueCat Mirror Hardening

Sequence tracker. Step 2 is complete and deployed to staging; steps 1, 3 and 4
remain blocked or pending.

| Step | Status |
|---|---|
| 1. Prove the webhook end-to-end (sandbox purchase) | **Pending** — needs a manual sandbox purchase |
| **2. `analyzePhoto` → `verifyProEntitlement`** | **DONE — deployed to staging 2026-08-14** |
| 3. Remove the two client `isPro` writes | Pending |
| 4. Tighten the Firestore rule | **Blocked** on 1 and 3 |

---

# Step 2 — analyzePhoto server-side Pro entitlement

**Deployed to `cluttrd-staging` 2026-08-14.** `analyzePhoto` and
`analyzePhotoDetail` both updated successfully. Nothing deployed to production.
No client code changed. Firestore rules untouched.

## What changed

Three edits in `functions/index.js`, all inside `analyzePhoto`.

### 1. Secret binding

```diff
- { secrets: [ANTHROPIC_KEY], maxInstances: 10, timeoutSeconds: 300 },
+ { secrets: [ANTHROPIC_KEY, REVENUECAT_SECRET_API_KEY], maxInstances: 10, timeoutSeconds: 300 },
```

Required — the function now makes a server-to-server RevenueCat call.

### 2. The pre-check gate (was line ~183)

```diff
- if (userData.isPro !== true && uid !== CANARY_TEST_UID.value()) {
-   const effectiveCount = ...;
-   if (effectiveCount >= FREE_MONTHLY_LIMIT) throw new HttpsError("resource-exhausted", ...);
- }
+ if (uid === CANARY_TEST_UID.value()) {
+   entitled = true;
+ } else {
+   const verified = await verifyProEntitlement(uid);
+   if (verified === null) {
+     entitled = userData.isPro === true;          // outage fallback only
+     console.warn(`[analyzePhoto] uid=${uid} RevenueCat unreachable, falling back to cached isPro=${entitled}`);
+   } else {
+     entitled = verified;
+   }
+ }
+ if (!entitled) {
+   const effectiveCount = ...;
+   if (effectiveCount >= FREE_MONTHLY_LIMIT) throw new HttpsError("resource-exhausted", ...);
+ }
```

Two deliberate choices:

- **The canary short-circuits *before* the RevenueCat call.** The existing
  comment is explicit that the canary must be exempt "independent of
  isPro/RevenueCat state" — it monitors `analyzePhoto`'s availability, not
  subscription gating. Calling RevenueCat first would make canary health depend
  on RevenueCat being reachable, which is precisely what that exemption exists
  to prevent. Verified: 0 RevenueCat calls for the canary uid.
- **The outage fallback matches `generateVisualization` exactly.** `null` means
  RevenueCat is unreachable or unparseable, not that the user is unentitled. A
  RevenueCat outage must not block paying users from the app's core feature.
  The residual exposure narrows from "anyone can forge `isPro`" to "forged
  `isPro` **and** RevenueCat down simultaneously".

### 3. The counting transaction (was line ~297)

```diff
- if (freshData.isPro === true || uid === CANARY_TEST_UID.value()) {
+ if (entitled) {
```

`entitled` is resolved once, in the pre-check, and reused. Re-querying inside
the transaction would double the added latency and could disagree with the
decision the request was already admitted under; re-reading `freshData.isPro`
would reintroduce the exact forgeable path being removed. The transaction still
re-reads the **count**, which is the value that genuinely races between
concurrent requests — entitlement does not race on that timescale.

### Remaining `isPro` reads in `analyzePhoto`

**One**, and it is the documented outage fallback:

```
userData.isPro in actual code (comments stripped): 1
freshData.isPro in actual code:                    0
```

Both authorization reads are gone.

## `analyzePhotoDetail` — no change needed

Audited and confirmed it never had an independent Pro or limit check. It
enforces authentication and plan ownership only:

```
isPro references            : 0
verifyProEntitlement calls  : 0
FREE_MONTHLY_LIMIT refs     : 0
resource-exhausted throws   : 0
```

Correct as-is — Call 2 is the continuation of an already-authorized analysis.
Nothing was removed.

## Latency

One extra serial HTTPS call before the Anthropic request. `verifyProEntitlement`
against RevenueCat measured ~200–500 ms elsewhere in this codebase, against a
Call 1 baseline of ~33 s — under 2%. Not optimized away, because the decision is
needed regardless: the transaction must know whether to increment the count and
whether to return `analysesRemaining: null`.

---

## Test results

Harness: `scratchpad/proGateTests.js`. It **extracts the real
`verifyProEntitlement` and the real gate block out of `functions/index.js`** and
executes them against stubbed RevenueCat responses. Nothing is reimplemented, so
the tests cannot drift from the deployed logic.

**28 assertions, 28 pass.**

### `verifyProEntitlement` response matrix (11/11)

| RevenueCat response | Returns | |
|---|---|---|
| 200, Pro entitlement present | `true` | ✓ |
| 200, no entitlements | `false` | ✓ |
| 200, different entitlement id | `false` | ✓ |
| 200, `"Uncluttrd Pro"` lookup_key (the old bug) | `false` | ✓ |
| 404 unknown customer | `false` | ✓ |
| 401 / 403 | `false` | ✓ |
| 500 / 503 | `null` | ✓ |
| network throw | `null` | ✓ |
| unparseable body | `null` | ✓ |

The lookup_key row matters: it proves the 2026-07-24 entitlement-id fix holds,
by asserting the *old* wrong value is now rejected.

### Required scenarios

| # | Scenario | Result |
|---|---|---|
| **a** | Pro user, RevenueCat says entitled | **PASS** — `entitled=true`, not blocked, even at count 99 |
| **b** | Free user under limit | **PASS** — `entitled=false`, not blocked |
| **c** | Free user at limit | **PASS** — `entitled=false`, **blocked** |
| **d** | **Forged `isPro=true`, RevenueCat says no** | **PASS — blocked.** The security fix. |
| **d2** | Forged `isPro` under limit | **PASS** — treated as free, count still applies |
| **e** | RevenueCat outage + cached `isPro=true` | **PASS** — allowed, paying user not locked out |
| **e2** | RevenueCat outage + cached `isPro=false`, at limit | **PASS** — blocked |
| **f** | `analyzePhotoDetail` enforces nothing | **PASS** — 4/4 checks |

Plus: canary exempt with **0** RevenueCat calls; non-canary makes **exactly 1**;
transaction branches on `entitled`, reads no `freshData.isPro`, makes no second
RevenueCat call; `REVENUECAT_SECRET_API_KEY` present in the secrets array.

### Deployment

```
functions[analyzePhotoDetail(us-central1)]  Successful update operation.
functions[analyzePhoto(us-central1)]        Successful update operation.
Deploy complete!
```

First attempt failed with `User code failed to load. Cannot determine backend
specification. Timeout after 10000`. Investigated rather than blind-retried:
`require('./index.js')` locally loaded clean in **544 ms**, confirming the
timeout was the Firebase CLI's discovery handshake, not the change. Retry
succeeded.

### Runtime evidence — NOT yet obtained

`analyzePhotoCanary` runs **every 15 minutes** and calls `analyzePhoto`
end-to-end with `CANARY_TEST_UID` — exactly the branch that was restructured, so
a clean post-deploy cycle would be genuine runtime confirmation.

**No post-deploy canary run has been observed.** The last canary success I could
retrieve is `2026-08-14T23:38`; the deploy completed at approximately
`2026-08-15T02:05`. That is not evidence of failure — it is a tooling limit.
`firebase functions:log` returns inconsistent windows depending on `-n`:

```
-n 40   -> newest entry 2026-08-14T23:38
-n 80   -> newest entry 2026-08-14T19:08
-n 300  -> newest entry 2026-08-13T16:38
```

Three different "newest" answers for the same stream, so the CLI cannot be used
to establish a recent timeline. `gcloud logging read` would resolve it but
`gcloud` is non-functional in this environment (missing Python).

**To confirm**, ~15 minutes after deploy:

```
firebase functions:log --only analyzePhotoCanary --project cluttrd-staging -n 40
```

Expect a line newer than the deploy:
`[canary] analyzePhoto OK | analysisId=canary-… | responseLength=…`

A canary failure would also self-report by email to
`michael@earthwiseenergy.net` via `sendCanaryAlertEmail`, so silence there is
weak positive evidence in the meantime.

## What is NOT proven here

Scenarios a–e are verified against the **real extracted logic** with stubbed
RevenueCat responses — they prove the decision table is correct. They do not
prove RevenueCat's live API returns what is expected for a real Pro customer;
that is step 1 (sandbox purchase), still outstanding. The two are independent:
this change is correct regardless of webhook health, which is why it was safe to
ship first.

---

## Next in the sequence

**Step 3 — remove the two client writes** (`App.js:13167`, `App.js:13317`),
leaving `setIsPro` + AsyncStorage for instant local feedback. Ship via OTA and
let it propagate before step 4.

**Step 4 — tighten the rule** to `hasOnly(['hasSeenTutorial'])`, only after
steps 1 and 3.

Note that step 2 has already removed the *cost* consequence of a forged `isPro`
— unlimited Anthropic vision calls. What remains forgeable is UI-level Pro
appearance plus the visualization outage-fallback window.
