# Runtime Fingerprint Map

`runtimeVersion.policy: "fingerprint"`. An OTA is only ever offered to a binary
whose fingerprint matches exactly. Publishing to the wrong one silently orphans
the update — it has happened on this project before, which is why this map
exists.

**Always check this table before `eas update --branch production`.**

| App version | Platform | Runtime fingerprint | Status |
|---|---|---|---|
| **1.0.4** | iOS | `d348c8b83564dd3cc02c90d148b7ceee94c7e969` | **LIVE in the App Store** (build 35/36, released 2026-07-30). Existing installs receive OTAs on this runtime |
| **1.0.4** | Android | `e55888d4dca8d4d78dbd0febec6f33158f4571ba` | **LIVE in Play** (versionCode 10) |
| **2.0.0** | iOS | `ba7137904a20ad6eb94024cb326e99373f393cc5` | **NEW** — no binary built yet. Do not publish OTAs here until a binary exists and is tested |
| **2.0.0** | Android | `620988bd97df1d8024c3115c0e11ca1195efa558` | **NEW** — same |

Historical, for reference:

| Version | Platform | Fingerprint | Note |
|---|---|---|---|
| 1.0.3 | iOS | `a5cfa2b999028021ab789657eb8ab6696a401827` | build 34 |
| 1.0.3 | Android | `ce8998b22b…` | versionCode 9 |
| — | iOS | `aee93ad702abb19a4517158abcdb4dd57d0f86ce` | **Orphaned.** The June "Production baseline" OTA sits on this fingerprint and **no build matches it**. It cannot reach any device |
| staging | iOS | `194c6294ae70b8bf34cd79c67f09187a2289a4a1` | preview builds 18–23 |
| staging | Android | `c266213e8d2ef2dcba1adcae706e94c1a1495fb8` | preview build 1 |

## Why 2.0.0 changed the fingerprint

`app.config.js` is a fingerprint input, so editing `version` changes the hash
even though **no native module, permission, plugin or asset changed**. The app
code is byte-identical to what 1.0.4 already serves.

## The two-runtime period

Until users update from the stores, both runtimes are live in parallel:

- **1.0.4 installs** keep receiving OTAs on `d348c8b8` / `e55888d4`.
- **2.0.0 installs** will only receive OTAs on `ba713790` / `620988bd`.

An OTA published to one is invisible to the other. Publishing to production
during this period means deciding, explicitly, which population it is for — or
publishing twice.

## Recorded

2026-08-17, at commit `428be52` ("Bump version to 2.0.0"). Computed with
`APP_ENV=production npx expo-updates fingerprint:generate`, both platforms, and
the 1.0.4 values re-verified at the same commit immediately before the version
edit.
