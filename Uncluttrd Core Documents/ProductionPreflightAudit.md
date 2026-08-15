# Production Preflight Audit — Release Candidate Assessment

**Read-only audit, 2026-08-15. Nothing was deployed. No production command was run.**

---

## 0. RELEASE FREEZE BOUNDARY

Every subsequent production action must reference this boundary.

| Item | Value |
|---|---|
| **Release-candidate HEAD** | `523881af3bc70908004f2dc16513d92b1d45d8e2` |
| Branch | `feature/companion` |
| HEAD commit | `523881a` — "RevenueCat mirror hardening complete on staging", 2026-08-15 15:54:05 -0400 |
| **Working tree (tracked)** | **CLEAN** — no uncommitted modifications |
| Untracked files | 26 (build logs, marketing assets, service-account JSONs, `.obsidian/`) — none in the release path |
| **RC fingerprint, iOS (APP_ENV=production)** | `d348c8b83564dd3cc02c90d148b7ceee94c7e969` |
| **RC fingerprint, Android (APP_ENV=production)** | `e55888d4dca8d4d78dbd0febec6f33158f4571ba` |
| Staging EAS branch / channel | `staging` / `staging` (profile `preview`, internal distribution) |
| Staging runtime (iOS / Android) | `194c6294…` / `c266213e…` |
| Production EAS branch / channel | `production` / `production` |

### Production baseline

| Item | Value |
|---|---|
| **Baseline commit** | `e3617972095c4ad06f1c9df50e73a684b695c0da` — "Prepare 1.0.4 stabilization release", 2026-07-29 |
| Source | `gitCommitHash` recorded on iOS production build **#36** |
| Live iOS build | **#36**, v1.0.4, runtime `d348c8b8…` |
| Live Android build | **10**, v1.0.4, runtime `e55888d4…` |
| Last production OTA | **one only**, ~3 weeks ago: "Production baseline: RevenueCat logIn() race fix… (matches build #33)" |
| Production functions deployed | 9 (baseline set — none of the 5 new ones) |
| Ancestry | `e361797` **is an ancestor of HEAD** — delta is linear, no divergence |

### Delta size

**111 commits · 84 files · +30,044 / −463 lines.** This is a very large release.

---

## 1. Production RevenueCat webhook

**a. Deployed?** **Yes** — `revenueCatWebhook`, https trigger, 256 MiB, in `cluttrd-3e335`.

**b. Secrets bound?** **Could not be verified with available tooling.** `functions:list`
does not report secret bindings, no deployment audit entry was retrievable, and
`gcloud` is non-functional here (missing Python). Not evidence of a problem —
evidence of a blind spot.

**c. Invocation logs?** **None retrievable — zero lines.** A 200-entry sweep of
the whole production project returned only 17 lines, all from 2026-08-15, and
none from `revenueCatWebhook`:

```
6  analyzephotocanary      3  reengagementnudge
3  checkorphaneduserdeletions   3  analyzephoto
```

Production is alive and the canary is healthy — the webhook simply has no
retrievable history. Cloud Logging retention is ~30 days. **Per the audit
instruction, this is not treated as failure.** It is genuinely unknown.

**d. Code parity — VERIFIED IDENTICAL.** Hash comparison of the normalized
function bodies between the production baseline and HEAD:

```
revenueCatWebhook   baseline=1ce99fdc5cde2ef8   head=1ce99fdc5cde2ef8   IDENTICAL
syncProStatus       baseline=bc5fe75682e44f7a   head=bc5fe75682e44f7a   IDENTICAL
PRO_ENTITLEMENT_ID  "entl16a5fcafc4" in both
```

This is the most reassuring finding in section 1. The production webhook already
runs **exactly** the code proven on staging, including the corrected internal
entitlement id. The 2026-07-24 fix predates the 2026-07-29 baseline.

### → ACTION REQUIRED BEFORE PHASE 4

**A fresh RevenueCat test event must be sent to the production webhook**, per the
audit instruction to stop rather than manufacture a request. One test event
verifies (b) and (c) together: reaching `Processed TEST (…): no uids updated`
proves the signing secret is bound and correct, routing works, and the handler
runs end to end.

This blocks **Phase 4 only**. It does not block Phases 1–3.

---

## 2. Release boundary — staging vs production delta

111 commits, grouped:

| Area | Count | Representative |
|---|---:|---|
| Room/Area identity | 47 | Space/Area migration, shadow model, rename validation, merge candidates, reclassification |
| Approach selection / AI analysis | 20 | Approach switching, visualization alignment + regeneration, evidence constraints, budget-selector removal |
| Two-stage analysis | 3 | Fast summary + background detail, launch auto-heal, stale-closure fix |
| Deletion lifecycle | 6 | Recently Deleted UI, retention cleanup, server-side account deletion |
| Product Intelligence resolver | 9 | Multi-source resolver, Amazon search enrichment, CJ/Awin POCs (docs only) |
| RevenueCat hardening | 4 | `verifyProEntitlement` on `analyzePhoto`, client writes removed, rule tightened |
| UX fixes | 8 | TDZ crash fix, keyboard audit, Session Recovery UI, swipe-to-delete |
| Cloud Functions | 1 | `analyzePhoto` timeout → 300s |
| Other | 13 | Session scope field + classification, `.gitignore` revert, OTA bookkeeping |

### Cloud Functions

**New (5)** — none currently exist in production:
`analyzePhotoDetail` · `compareAreaCandidates` · `cleanupExpiredDeletions` ·
`hardDeleteAccount` · `runExpiredDeletionSweep`

**Modified config:**

| Function | Baseline | Release candidate |
|---|---|---|
| `analyzePhoto` | `[ANTHROPIC_KEY]`, no timeout | `[ANTHROPIC_KEY, REVENUECAT_SECRET_API_KEY]`, **timeout 300s** |
| `generateVisualization` | `[OPENAI_KEY]`, 300s | `[OPENAI_KEY, REVENUECAT_SECRET_API_KEY]`, 300s |
| `analyzePhotoDetail` (new) | — | `[ANTHROPIC_KEY]`, 300s |
| `hardDeleteAccount` (new) | — | `maxInstances: 5`, 300s |
| `revenueCatWebhook` | unchanged | unchanged |

**New secret requirement: `REVENUECAT_SECRET_API_KEY` on two additional
functions.** The secret already exists in production (the webhook uses it), so
this is a binding change, not a provisioning one — but it must be confirmed
present before deploy or those functions will fail to start.

### Firestore rules — two independent changes in one file

```diff
- affectedKeys().hasOnly(['isPro', 'hasSeenTutorial']);
+ affectedKeys().hasOnly(['hasSeenTutorial']);
```
plus **new subcollection rules**: `spaces/{spaceId}` (+ `areas`, `projects`,
`sessions`, `batches`), `mergeCandidates/{id}` (+ `history`),
`reclassificationExecutions/{planId}`, and a public-read `config/{document}`.

**These two changes have opposite deployment timing requirements. See §7.**

### Firestore indexes

`firestore.indexes.json` **did not exist at baseline** — it is entirely new:

- `spaces.deletedAt` — COLLECTION_GROUP, ASC + DESC
- `areas.deletedAt` — COLLECTION_GROUP, ASC + DESC
- `plans.sessionScope` — COLLECTION and COLLECTION_GROUP, ASC + DESC

---

## 3. Production configuration and secrets

**a. Secrets.** Required across the release boundary: `ANTHROPIC_KEY`,
`OPENAI_KEY`, `RESEND_API_KEY`, `REVENUECAT_WEBHOOK_SECRET_IOS`,
`REVENUECAT_WEBHOOK_SECRET_ANDROID`, `REVENUECAT_SECRET_API_KEY`.

All are already in use by currently-deployed production functions, so all should
exist. **Not directly verified** — the CLI does not list secret names without
exposing values, and `gcloud secrets list` is unavailable. Confirm via
`firebase functions:secrets:access --project cluttrd-3e335` (names only) or the
Console before deploying.

**b. Environment variables.** `CANARY_TEST_UID` and `REVENUECAT_PROJECT_ID` come
from `functions/.env` (tracked, loaded on every deploy). `REVENUECAT_PROJECT_ID`
has a code default of `projc4cb5734` and is explicitly documented as identical
across environments. `CANARY_TEST_UID` has a hardcoded default of
`m4ecZ9B9B1XmDrOiAQfFPjdjyNB3`; production's canary is currently running
successfully, so its value resolves correctly today.

**c. Timeouts.** `analyzePhoto` 300s is **new for production** and is required —
production currently has no `timeoutSeconds`, i.e. the 60s default, and the
two-stage split was introduced specifically because Call 1 was exceeding it.
`analyzePhotoDetail` ships at 300s.

**d. Indexes.** The three field overrides in §2 must be deployed. The
COLLECTION_GROUP entries are the ones that genuinely require deployment;
single-field COLLECTION queries would otherwise use automatic indexes.

---

## 4. Staging-only / debug / test artifact audit

**a. Hardcoded project IDs — correct by construction.** Both configs are present
and selected at runtime by `IS_PRODUCTION` (`App.js:2592`), which reads
`extra.APP_ENV` set at build time by `app.config.js`. Same pattern for the
RevenueCat iOS key (`App.js:13154`) and the bundle identifier. **No leakage
risk**, provided the production build is made with `APP_ENV=production` — which
the `production` EAS profile sets explicitly.

**b. Debug UI — correctly gated.**

| Element | Gate | Ships to production? |
|---|---|---|
| Staging banner | `IS_STAGING` (`App.js:11743`, `13379`) | **No** |
| Space Inspector menu item | `hide: !__DEV__` (`App.js:10168`) | **No** |
| Space Inspector screen | `__DEV__` (`App.js:11186`) | **No** |
| Shadow-migration validation | `if (__DEV__)` (`App.js:5763`) | **No** |
| Dev reset row | `__DEV__` (`App.js:9719`) | **No** |

**c. Test identifiers — present, low risk, worth a decision.**
`KNOWN_TEST_EMAILS` (`App.js:2607`) ships in the bundle with four real addresses
including a personal Yahoo account. It drives `isTestAccount` on the user doc.
Not a credential and not a security hole, but it is PII in a shipped artifact and
is extractable from any installed build. `CANARY_TEST_UID`'s default uid is in
`functions/index.js` — server-side only, not shipped to devices.

**d. Logging.** Three `console.log` calls emit a uid or entitlement state
(`App.js:5305`, `5551`, `6888`). These go to the device console only, are not
transmitted, and expose nothing the local user does not already own. Cosmetic.

**e. Canary against production — VERIFIED RUNNING.** `analyzePhotoCanary`
appears 6 times in today's production logs. Its exemption is short-circuited
*before* the RevenueCat call in the new `analyzePhoto`, so it does not gain a
dependency on RevenueCat reachability.

**f. TODO/HACK/FIXME tied to staging behaviour:** **none found.**

---

## 5. Database / rules / index compatibility

**a. Will the new client work against CURRENT production rules? NO.**

The release-candidate client reads and writes `users/{uid}/spaces/**`,
`mergeCandidates/**` and `reclassificationExecutions/**`. Production rules have
**no match blocks for those paths**, so Firestore denies by default. **Rules must
deploy before the client OTA.**

**b. Indexes before the client OTA? YES.** The COLLECTION_GROUP overrides back
deletion-lifecycle and Area queries. Index builds are asynchronous and can take
minutes to hours on a populated database, so they must be deployed *and observed
to reach Enabled* before the client ships.

**c. Data migration required — YES, for 159 production plans.**
Legacy Area backfill (`areaName` → durable Area docs + `areaId`) via
`scripts/backfillLegacyAreas.js`, and `sessionScope` classification via
`scripts/classifySessionScope.js`. Both exist and were exercised on staging.

**d. Graceful degradation for un-backfilled data — YES, verified in code.**

```js
const planAnalysisStage = (plan) => {
  if (!plan) return "complete";
  if (!plan.approaches) return "complete";   // old tier-format plan
  return plan.analysisStage || "complete";   // pre-split approach plan
};
```

- **No `approaches`** → treated as old tier-format; the tier renderer handles it.
- **No `analysisStage`** → resolves to `"complete"`, so no phantom "Finishing the
  details…" state.
- **No `sessionScope`** → the recovery query matches `== "unresolved"`, so
  un-classified plans simply do not appear in Needs Review. Safe.
- **No `areaId`/`canonicalSpaceId`** → `resolveResultsRoomName` falls back
  through `spaceName` then `getSpaceDisplayName`.
- **Old `relatedProblemId` (singular)** → normalized by
  `normalizeProductRecommendation`.

The client can therefore ship **before** the backfill runs. That is a real
scheduling freedom and it lowers risk substantially.

**e. Fingerprint safety — VERIFIED SAFE ON BOTH PLATFORMS.**

This is the check that matters most, because the staging outage was caused
precisely by getting it wrong.

| Platform | RC tree fingerprint | Live production build | Match |
|---|---|---|---|
| iOS | `d348c8b83564dd3cc02c90d148b7ceee94c7e969` | #36 v1.0.4 → `d348c8b8…` | **YES** |
| Android | `e55888d4dca8d4d78dbd0febec6f33158f4571ba` | 10 v1.0.4 → `e55888d4…` | **YES** |

An OTA published from HEAD **will** be delivered to live production users. The
`.gitignore` revert (`ed51de1`) is what preserves this; re-applying the
hardening would change the fingerprint and orphan the OTA.

> **Do not touch `.gitignore`, `app.config.js`, `eas.json`, `package.json`, the
> lockfile, or any config-plugin dependency between this audit and the Phase 2
> OTA.** Any of them changes the fingerprint and silently breaks delivery.

**Anomaly worth noting:** the single existing production OTA has iOS runtime
`aee93ad702abb19a4517158abcdb4dd57d0f86ce`, which matches **none** of production
builds #33 (`a2212e52…`), #34 (`a5cfa2b9…`), or #35/#36 (`d348c8b8…`). It was
almost certainly never delivered to anyone — the same failure mode as staging,
already latent in production. Production users have therefore only ever run
embedded bundles. Not a blocker, but it means **Phase 2 will be the first OTA
production has actually received**, and should be treated with that weight.

---

## 6. RevenueCat hardening — deployment integration

**Yes — the function and client components can safely ship in Phases 1 and 2
while leaving the production `isPro` rule unchanged.** No separate client release
is required.

The three components are independent:

| Component | Phase | Safe with the OLD production rule? |
|---|---|---|
| `verifyProEntitlement` on `analyzePhoto` / `generateVisualization` | 1 (functions) | **Yes.** Strictly tightens server-side authorization. Independent of rules. |
| Client `isPro` writes removed | 2 (OTA) | **Yes.** Removing a write cannot fail against a permissive rule. |
| Rule `hasOnly(['hasSeenTutorial'])` | 4 (after soak) | — |

The hardened client stops writing `isPro`; the webhook keeps writing it. With the
old permissive rule still in place, older clients that *do* still write it also
continue to work. Both populations converge on the same correct value because the
webhook is authoritative either way. **This is precisely why the rule must go
last** — it is the only step that breaks older clients.

### The rules-file conflict — the single most important finding in this audit

`firestore.rules` at HEAD contains **both** changes:

1. New subcollection rules — **required BEFORE** the client OTA (§5a)
2. `isPro` tightening — **required AFTER** the soak (§6)

Deploying HEAD's rules file as-is in Phase 1 would tighten `isPro` immediately
and demote every production user still on an older client. **The rules deployment
must be split.**

Recommended: deploy Phase 1 from a temporary rules file identical to HEAD's
except that the update clause retains `['isPro', 'hasSeenTutorial']`. Phase 4
then deploys HEAD's file unmodified. The Phase 1 variant should not be committed
to the branch — build it at deploy time from HEAD with a one-line substitution,
so there is no risk of the permissive version becoming the tracked state.

---

## 7. Proposed deployment order, verification, rollback

### PHASE 0 — Pre-flight gates (no deploys)

1. Confirm working tree still clean and HEAD still `523881a`.
2. Re-run both fingerprints; confirm `d348c8b8…` / `e55888d4…`.
3. Confirm production secrets exist (names only).
4. **Send a RevenueCat test event to the production webhook** and confirm
   `Processed TEST` in production logs. *(Gates Phase 4, not 1–3.)*

### PHASE 1 — Infrastructure

**1a. Indexes first.**
```
firebase deploy --only firestore:indexes --project cluttrd-3e335
```
*Verify:* Console → Firestore → Indexes; all three field overrides **Enabled**,
not Building. **Wait for this** — builds are asynchronous.
*Rollback:* indexes are additive and harmless; leave them.

**1b. Rules — Phase-1 variant (isPro clause left permissive).**
```
firebase deploy --only firestore:rules --project cluttrd-3e335
```
*Verify:* Rules Playground on a production user doc — `{"isPro": true}` must
still be **ALLOWED** at this stage (old clients depend on it), and a read of
`users/{uid}/spaces/{id}` must be ALLOWED.
*Rollback:* redeploy the baseline rules file from `e361797`.

**1c. Functions.**
```
firebase deploy --only functions --project cluttrd-3e335
```
*Verify:* `functions:list` shows all 5 new functions; `analyzePhoto` timeout is
300s; production canary still logs `[canary] analyzePhoto OK` within 15 minutes.
*Rollback:* `git checkout e361797 -- functions/` and redeploy. **The canary is
the tripwire** — a failure emails `michael@earthwiseenergy.net`.

> Functions are backward-compatible with the *old* client (all additions), so
> 1c can safely precede Phase 2.

### PHASE 2 — Client OTA

```
npx eas update --branch production --message "<RC 523881a>"
```
*Contents:* the entire 111-commit client delta — Room/Area identity, two-stage
analysis, deletion lifecycle, approach switching, Product Intelligence resolver,
RevenueCat client hardening, UX fixes.

*Verify:*
- Publish output shows runtime `d348c8b8…` (iOS) / `e55888d4…` (Android). **If it
  shows anything else, stop — it will not be delivered.**
- On a production device: double-restart, confirm new behaviour, and confirm
  `product_clicked` is absent from Analytics (that event was deleted).
- Watch Crashlytics/analytics for 30–60 minutes.

*Rollback:* `eas update:republish` the previous production update group, or
publish a revert build from `e361797`. **Note the asymmetry:** because production
has never successfully received an OTA (§5e), rollback-by-OTA is itself unproven
here. Treat Phase 2 as the highest-risk step.

### PHASE 3 — Data operations

Run **after** Phase 2 has soaked and the client is confirmed stable. Ordering is
deliberate: §5d proves the client tolerates un-backfilled data, so there is no
need to migrate under time pressure.

1. `node scripts/backfillLegacyAreas.js` — dry-run first, then execute.
2. `node scripts/classifySessionScope.js` — dry-run first, then execute.

*Verify:* `scripts/validateSpaceMigration.js` (validate mode is strictly
read-only) against a sample of the 159 plans.
*Rollback:* these are additive field writes; a targeted revert script would be
needed. **Take a Firestore export first.**

> Standing constraint: the production service-account key is read-only by
> default. Each of these is a write operation and needs explicit per-run
> approval.

### PHASE 4 — RevenueCat rule hardening

**Preconditions, all required:**
- Production webhook proven healthy (Phase 0 gate 4)
- Phase 2 OTA soaked
- Older-client population sufficiently cleared

**Soak period: minimum 7 days, ideally 14.** The constraint is not the OTA — it
is App Store build adoption. Users who never open the app do not receive OTAs,
and any user still on build #33/#34 with an older embedded bundle still writes
`isPro`.

**Signals that it is safe:**
- Zero `Sync isPro error` reports (the old client's swallowed failure path)
- Production webhook showing regular `Processed … isPro=` writes
- Analytics confirming the overwhelming majority of sessions are on the new bundle

**Then:**
```
firebase deploy --only firestore:rules --project cluttrd-3e335   # HEAD's file, unmodified
```
*Verify:* Rules Playground — `{"isPro": true}` **DENIED**,
`{"hasSeenTutorial": true}` **ALLOWED**. Then confirm a real production purchase
or renewal still results in `isPro=true` via the webhook.
*Rollback:* redeploy the Phase-1 variant. Fast, one command, and the failure mode
(paying users demoted) is loud and immediate.

---

## 8. Risk assessment

### HIGHEST — Phase 2 OTA, 111 commits at once

*What could go wrong:* any regression across a 30k-line delta reaches 100% of
active production users simultaneously. There is no staged rollout configured.
*Detection:* Crashlytics, the `analyzePhotoCanary` email alert, analytics volume.
*Recovery:* republish the prior update — **but production has never successfully
received an OTA**, so this path is unproven.
*Should it be split?* **Yes, ideally.** EAS supports `--rollout-percentage`.
Recommend 10% → observe → 50% → 100%.

### HIGH — Rules file contains two changes with opposite timing

*What could go wrong:* deploying HEAD's rules in Phase 1 demotes every paying
production customer on next launch.
*Detection:* immediate — support reports and paywall analytics.
*Recovery:* redeploy permissive rules; users recover on next launch.
*Mitigation:* the split described in §6. **This is the single most likely way to
cause a paying-customer incident in this release.**

### HIGH — `analyzePhoto` 300s timeout is new to production

*What could go wrong:* production currently runs the 60s default. The two-stage
split exists because Call 1 exceeded it. If functions deploy without the timeout,
analyses fail; if the client ships expecting two-stage behaviour against a
one-stage function, plans strand at `summary-ready`.
*Detection:* canary; `analysisStage: "summary-ready"` plans accumulating.
*Recovery:* the launch auto-heal sweep already recovers stranded plans.
*Mitigation:* **Phase 1c must precede Phase 2.**

### MEDIUM — Production webhook unverified

*What could go wrong:* if the signing secret has drifted, `isPro` silently stops
tracking reality; Phase 4 would then lock out paying customers permanently.
*Detection:* the Phase 0 test event.
*Recovery:* fix the secret; re-run.
*Mitigation:* the Phase 0 gate. Code parity is already proven identical, so the
only plausible fault is configuration.

### MEDIUM — Index build latency on a populated database

*What could go wrong:* client ships before indexes are Enabled; queries fail.
*Detection:* Console index status; `failed-precondition` errors.
*Recovery:* wait.
*Mitigation:* Phase 1a first, with an explicit wait.

### LOW — `KNOWN_TEST_EMAILS` PII in the bundle

Four real addresses shipped in every build. Not exploitable; worth a deliberate
decision about whether it should move server-side.

---

## Summary

**No blocking defects were found in the release candidate itself.** The code is
clean, the working tree is clean, fingerprints match on both platforms, debug UI
is correctly gated, and the client degrades gracefully against un-backfilled
production data.

**Two things must be settled before any deploy:**

1. **Split the rules deployment.** Shipping HEAD's `firestore.rules` in Phase 1
   would demote paying customers.
2. **Send the production webhook test event.** It gates Phase 4 and is the only
   unknown in an otherwise verified chain.

**One recommendation beyond the brief:** use a staged OTA rollout for Phase 2.
111 commits reaching every user at once, on a channel whose rollback path has
never been exercised, is the largest avoidable risk here.
