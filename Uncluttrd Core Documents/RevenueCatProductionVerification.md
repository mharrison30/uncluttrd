# RevenueCat Production Webhook Verification

**Status: COMPLETE — iOS and Android.** Recorded 2026-08-18.

Production project `cluttrd-3e335`, function `revenueCatWebhook`, revision
`revenuecatwebhook-00004-leh` (deployed 2026-08-15T21:21Z).

## Synthetic TEST deliveries

| | iOS | Android |
|---|---|---|
| Received | **2026-08-18T01:45:12Z** | **2026-08-18T01:51:31Z** |
| Event ID | `E4E6430B-42D9-4A12-94D0-07CC1241B619` | `5A0472B2-4995-46B8-B50B-A278CC41CBEA` |
| Fabricated `app_user_id` | `b02b0f02-a4e5-4d1d-bfe0-c0b40ff96b9e` | `ef840f85-8a52-4217-800a-ff2455a3e9c3` |
| Signature verification | passed | passed |
| Payload validation | passed (`event.id` + `app_user_id` present) | passed |
| `active_entitlements` | **HTTP 404**, as expected | **HTTP 404**, as expected |
| `syncProStatus` | returned `null` -> `continue` | returned `null` -> `continue` |
| Log line | `Processed TEST (...): no uids updated` | `Processed TEST (...): no uids updated` |
| HTTP response | **200** | **200** |
| Stray `users/{uid}` doc | none (404) | none (404) |
| Stray idempotency record | none (404) | none (404) |

The 404 is the designed path, not a fault. RevenueCat's TEST event carries a
fabricated `app_user_id` that has no customer record, and `syncProStatus`
deliberately maps a failed entitlement fetch to `null` so the uid is skipped
without writing a wrong value — see the comment block above `syncProStatus`
in `functions/index.js`. Returning 200 is also correct: a 500 would make
RevenueCat retry a synthetic event indefinitely.

`users/` held 42 documents after both tests, unchanged.

## Error sweep

Zero occurrences of every failure marker, across two independently queried
windows — the full life of the current revision (2026-08-15T21:21Z onward)
and a tight window bracketing both deliveries:

`Invalid signature`, `Missing signature`, `Malformed signature`,
`Malformed event payload`, `Firestore write failed`, `Unhandled error`,
`Duplicate event`, `[sendEmail]`.

### Query method — and why not `firebase functions:log`

`firebase functions:log -n N` returned **inconsistent windows** on repeated
calls: `-n 200` returned recent entries, while `-n 80` returned only 16
entries from 2026-07-24. Any "no errors in the last N lines" claim built on
it is unsound, because N does not reliably mean "most recent N".

Verification therefore used the **Cloud Logging REST API** (`entries:list`)
with explicit `timestamp>=` filters and `orderBy: "timestamp asc"`, paging
to exhaustion. Use that for any future log assertion that has to hold up.

## Signing secrets

Both are configured in Secret Manager, both non-empty, both 64 characters,
and **cryptographically distinct** from each other (compared by SHA-256 of
the values; values never printed, logged, or written to disk).

### Known limitation — per-platform attribution is not observable

The handler validates with `.some()` across both secrets and **does not log
which one matched**. So the logs prove:

- **Proven:** each delivery carried a signature valid under a genuine
  RevenueCat signing secret. Forged and unsigned requests are rejected —
  this is the security property that matters, and it holds.
- **Not proven:** that the Android delivery validated specifically against
  `REVENUECAT_WEBHOOK_SECRET_ANDROID`. If RevenueCat's Android integration
  were misconfigured with the iOS secret, the request would still pass, and
  nothing in the logs would reveal it.

Closing that gap needs either a temporary log of the matching secret's
identity, or a visual check of the two secrets in the RevenueCat dashboard
against Secret Manager. Neither was done. This is a configuration-drift
blind spot, not a vulnerability.

## End-to-end verification — real production purchase

The TEST events exercise signature, validation and the 404 skip path. They
**cannot** exercise the entitlement and write path, because the fabricated
uid has no entitlement. That path was verified by a genuine purchase:

**Shirley Howard** — `howardshirley8@gmail.com`, uid
`2j55Wm52CTXjYlDtbsu6WujmQNv1`. **First real production Pro conversion.**

| Step | Evidence |
|---|---|
| Signed up | 2026-08-18T00:18:30Z (`isNewSignup: true`) |
| Welcome email | `sendWelcomeEmail` fired 00:18:31Z |
| Purchased | 2026-08-18T00:23:31Z — **5 minutes after signup** |
| Event | `NON_RENEWING_PURCHASE`, `6F58D7B0-5033-4549-93CD-345D1E605C70` |
| Entitlement returned | `entl16a5fcafc4` — matches `PRO_ENTITLEMENT_ID` exactly |
| Firestore write | `users/2j55Wm52.../isPro = true` — **confirmed present** |
| Idempotency record | present: `type=NON_RENEWING_PURCHASE`, `isPro=true`, `processedAt=00:23:31.542Z` |
| Pro upgrade email | conditions all held (`isPro && !wasPro && doc exists`); zero `[sendEmail]` failures logged |

Together the synthetic and real events cover the whole pipeline: signature ->
validation -> entitlement fetch -> `isPro` write -> idempotency -> email.

## Follow-ups (not actioned)

1. **Remove the temporary raw-payload debug log.** `functions/index.js` ~line
   908 logs the full `active_entitlements` response on every delivery and
   carries its own removal condition: *"Remove once confirmed correct against
   a real event."* Shirley's purchase satisfies that condition. Until it is
   removed, customer IDs, entitlement IDs and expiry timestamps are written
   to Cloud Logging on every delivery.
2. **Firestore `isPro` rule tightening** — still deliberately held for the
   soak period. Not changed.
