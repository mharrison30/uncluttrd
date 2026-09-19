# Build Freshness Gate

A mandatory checklist around paid EAS builds. It exists because of a real
failure, described below, and every rule here traces back to it.

---

## The failure this prevents

The welcome email's button pointed at `https://uncluttrd.app/...`. Tapping it on
an iPhone with the production app installed opened Safari instead of the app.

Everything on the server side was correct:

- `https://uncluttrd.app/.well-known/apple-app-site-association` returned 200,
  valid JSON, `application/json`, no redirect, no compression.
- Apple's CDN copy at `app-site-association.cdn-apple.com/a/v1/uncluttrd.app`
  was **byte-identical** to it.
- The `appID` was exactly `D372SHAVT3.com.mharrison.uncluttrd`, which matches
  the `application-identifier` in the shipped binary's own entitlements.
- `app.config.js` at HEAD resolved `associatedDomains: ["applinks:uncluttrd.app"]`
  for production.

And it still did not work, because **no binary carrying the entitlement had
ever been built**:

| | |
|---|---|
| iOS production build 43 created | 2026-09-17 00:15 UTC, from commit `6dc4707` |
| `associatedDomains` added | 2026-09-17 12:24 UTC, commit `9fe3d5b` |
| AASA published to the website | 2026-09-17 12:24 UTC, commit `f13318a` |

`git show 6dc4707:app.config.js` contains no `associatedDomains`, no
`applinks`, no `intentFilters`. Grepping build 43's own Xcode log for
`associated-domains` and `applinks` returns **zero** hits. The same is true of
build 40, and of Android production build 15 (`b490994`, 2026-09-15).

A green EAS status told us the build succeeded. It did. It just did not do the
thing the build was for.

---

## Two distinct failures, not one

Keep these separate. Conflating them produces a rule that cannot be followed.

### 1. Built-invalid

The build was **already wrong at its own commit**. Build 43 is this case: the
capability was simply absent from `6dc4707`. Nothing later is involved, and
nothing later *could* have been — `9fe3d5b` did not exist when build 43 was
made, so no comparison against a future branch head could have prevented it.

This is caught by a **purpose-specific preflight**: state what the build is
for, then prove the commit being built actually declares it. That check is
entirely self-contained in the build commit.

### 2. Became-stale

The build was **valid when made**, and a later commit changed native
configuration so the artifact no longer represents the branch. This one is only
visible after the fact, by re-comparing the built commit against the approved
head before submitting.

The first is a preflight problem. The second is a post-build problem. A build
can suffer either, both, or neither.

---

## Before a paid build

1. **Identify the exact commit being built.** Not "the branch" — the SHA.
2. **Identify the local branch head and the remote branch head.** Record all
   three SHAs even when they are identical.
3. **State the build's purpose in one line**, naming every native capability it
   depends on. "Universal links must work" is a purpose. "Latest changes" is not.
4. **Prove the build commit contains those capabilities.** Resolve the
   configuration for that commit and read the values back. For deep links,
   `node --test scripts/deepLinkConfig.test.js` asserts exactly this. Generate
   the temporary native output where the capability only becomes visible after
   prebuild.
5. **If the intended build commit is behind either approved head**, list every
   intervening commit touching:
   - `app.config.js`
   - `app.json`
   - `package.json`
   - `package-lock.json`
   - `eas.json`
   - any Expo config plugin
   - iOS native configuration
   - Android native configuration
   - Firebase client configuration (`GoogleService-Info*.plist`,
     `google-services*.json`)
6. **Stop** if any unexplained native-impacting difference exists. "Probably
   unrelated" is not an explanation.

```
git rev-parse HEAD
git rev-parse @{u}
git log --oneline <build-commit>..<approved-head> -- \
  app.config.js app.json package.json package-lock.json eas.json \
  GoogleService-Info.plist GoogleService-Info.staging.plist \
  google-services.json google-services.staging.json
```

---

## After the build, before submitting or declaring success

1. **Compare the built commit against the current approved branch head again.**
   The branch may have moved while the build ran.
2. **List every intervening native-impacting commit**, using the same path list.
3. **Stop** if the branch gained a required native change after the build
   started. The artifact is stale for its stated purpose.
4. **Inspect the actual signed build**, or the authoritative signing output,
   for the required entitlement. For iOS the Xcode log from
   `eas build:list --json` carries it (brotli-compressed; decompress, then grep
   for `associated-domains`, `application-identifier`,
   `com.apple.developer.team-identifier`).
5. **A successful EAS status is not proof that the build accomplished its
   purpose.** Build 43 finished green and shipped to the App Store without the
   capability it was later assumed to have.

---

## What the automated tests do and do not cover

`scripts/deepLinkConfig.test.js` proves the **resolved configuration** claims
`uncluttrd.app` for production and does not claim it for staging. It runs
offline against the real `app.config.js`.

`scripts/liveAssociation.test.js` proves the **server side**: the AASA, Apple's
CDN copy, and `assetlinks.json`. It is opt-in behind
`RUN_LIVE_ASSOCIATION_TESTS=1` so the offline suite never depends on the
network.

Neither proves anything about a **signed binary**. That gap is exactly where
build 43 failed, and step 4 above is the only thing that closes it.

### Known limitation: the Android signing fingerprint

`assetlinks.json` declares a `sha256_cert_fingerprints` value that must match
the certificate Google Play signs the app with. With Play App Signing enabled
that key exists only in Play Console, and it is **not** the upload key EAS
builds with. Nothing in this repository, in EAS build metadata, or in the
production Android Gradle log exposes it — that log contains no SHA-256
fingerprint at all.

So the live tests assert the file's structure, package name, relation and
fingerprint *format*, and cross-check that Google's Digital Asset Links API
parses the same values back. They do **not** assert the fingerprint is the
correct key. Confirming that requires Play Console → Setup → App signing, by
hand.
