# Production Legacy Data Audit + Migration Compatibility

**Read-only audit, 2026-08-15, project `cluttrd-3e335`.** No production data was
changed. The 50% rollout was not modified.

Method: Firestore REST API, GET requests only, using the existing Firebase CLI
credential. The audit script contains no POST/PATCH/DELETE/`:commit` against
Firestore — its single POST is the OAuth token exchange. Raw dump:
`scratchpad/prod-audit.json` (469 KB).

---

## Headline findings

Three facts reshape the whole migration question:

1. **Production data is 100% legacy. There is not one RC-created artifact.**
   All 75 plans carry `tiers`; **zero** carry `approaches`, `sessionScope`,
   `analysisStage`, `areaId`, or `canonicalSpaceId`. There are **zero** Area
   documents and **zero** reclassification records.
2. **`canonicalSpaceId` does not exist in production at all.** It appears on 0
   of 75 plans and is absent from the field census entirely. The Space→plan
   link runs the *other* way, via `spaces/{id}.sourcePlanId`.
3. **v1.0.4 never reads or writes `spaces`.** It is entirely plan-centric, so
   the entire Room/Area hierarchy is invisible to it.

Together these mean the migration is **far safer than the preflight assumed**,
and Section 3's compatibility question has a clean answer.

**Plan count correction:** the brief stated 159 production plans. The measured
figure is **75**, across 12 users with data (39 user documents exist; 27 have
no plans and no spaces).

---

## SECTION 1 — Data inventory

### Totals

| | |
|---|---|
| User documents | 39 |
| **Users with any data** | **12** |
| Spaces | 71 |
| **Area subdocuments** | **0** |
| Plans | 75 |
| Merge candidates | 5 (3 users) |
| Reclassification executions | 0 |

Every Space has exactly one `projects` subdocument, so the shadow model is
populated 1:1. Space fields are uniformly `syncedAt`, `sourceVersion`,
`displayName`, `shadowSchemaVersion`, `createdAt`, `sourcePlanId`,
`activeProjectId` — **71/71 for every field**. That is the signature of the
admin shadow-migration script, not of client writes.

### Room vs Area classification of the 71 Spaces

| Class | Count | Share |
|---|---:|---:|
| Legitimate **Room** name | 11 | 15% |
| **Area-in-Room-slot** | 34 | 48% |
| Ambiguous | 26 | 37% |

**Only 15% of Spaces are actually Rooms.** Representative Area-in-Room-slot
values: *"Under-Sink Bathroom Storage"*, *"Bathroom Linen Cabinet"*, *"Corner
Shelf Display"*, *"TV Console & Media Center"*, *"Multi-Monitor Home Office
Desk"*, *"Retail Candle Display"*, *"Corner Reading Nook"*.

Ambiguous cases are genuinely ambiguous, not lazy classification — e.g.
*"Living Room / Multi-Purpose Space"*, *"Laundry/Utility Room"*,
*"Overwhelmed Closet/Dressing Area"*, *"Creative classroom or therapy room"*.
These are exactly the cases a script should **not** decide.

### How many plans reference each Space as `canonicalSpaceId`?

**Zero, for every Space** — the field does not exist on any production plan.
The relationship is recorded as `spaces/{id}.sourcePlanId → plans/{id}`.

This matters for migration design: there is no `canonicalSpaceId` to
*re-point*. The migration would be **creating** that linkage, not rewriting it.
Nothing can be clobbered because nothing is there.

### Does a plausible parent Room already exist?

Mostly **no**. Per-user:

| User | Area-like Spaces | Parent Room exists | Parent Room missing |
|---|---:|---:|---:|
| michael@earthwiseenergy.net (test) | 10 | 5 (`Home Office`, `Living Room`) | 5 |
| adamharrison4506@gmail.com | 7 | 0 | 7 |
| cgignqc28@yahoo.com | 4 | 0 | 4 |
| aramsey.henry@gmail.com | 1 | 0 | 1 |
| teige.p@gmail.com | 1 | 0 | 1 |
| village1026@gmail.com | 1 | 0 | 1 |

**Only the internal test account has usable parent Rooms.** For real users,
consolidation would require *inventing* Rooms — e.g. creating a "Bathroom" Room
for `cgignqc28@yahoo.com` purely to hold "Under-Sink Bathroom Storage" and
"Bathroom Linen Cabinet".

One user is a special case: `adamharrison4506@gmail.com` has 7 retail-display
Spaces ("Retail Candle Display", "Product Display Cabinet"…). These are a
commercial store, not a home. Inferring a domestic Room parent would be wrong.

### Users affected

| Segment | Users | Plans |
|---|---:|---:|
| Real users with Area-in-Room-slot Spaces | 5 | 21 |
| Internal/test accounts (`michael@`, `mike.rhinstalls@`, `reviewer@`) | 3 | 49 |
| Users with plans but **no** Spaces at all | 4 | 4 |
| Users with no data | 27 | 0 |

**Two-thirds of production plans (49/75) belong to internal accounts.** The real
user-facing blast radius is 5 users and roughly 21 plans.

### Which resolution path?

**(c) Combination — but weighted far more toward (b) than expected.**

- A script can safely handle the *mechanical* parts: creating Area documents,
  setting `areaId`/`canonicalSpaceId`, classifying `sessionScope`.
- A script **cannot** safely decide the 26 ambiguous names, nor invent parent
  Rooms for the 34 Area-like Spaces where none exists. Choosing "Bathroom" as a
  parent for someone's data is a product decision about *their* home.
- Needs Review exists precisely for this and is already built.

Given that only 5 real users and ~21 plans are affected, and no automatic
consolidation is unambiguous for any of them, **user-driven resolution through
Needs Review is the right default**, with a script limited to backfilling
non-judgemental fields.

---

## SECTION 2 — Mixed-version migration state

Determined from Firestore data, not from rollout percentage, as instructed.

### Per-user RC-vs-legacy state

```
user                          plans  tiers  approaches  sessScope  analysisStage  areaId  merge  recl
paulhesson@yahoo.com              1      1           0          0              0       0      0     0
deb2731@gmail.com                 1      1           0          0              0       0      0     0
evangorke@gmail.com               2      2           0          0              0       0      0     0
aramsey.henry@gmail.com           2      2           0          0              0       0      0     0
emmasterk31@gmail.com             1      1           0          0              0       0      0     0
teige.p@gmail.com                 2      2           0          0              0       0      0     0
village1026@gmail.com             1      1           0          0              0       0      0     0
adamharrison4506@gmail.com        9      9           0          0              0       0      0     0
cgignqc28@yahoo.com               7      7           0          0              0       0      0     0
michael@earthwiseenergy.net      21     21           0          0              0       0      3     0
mike.rhinstalls@gmail.com        20     20           0          0              0       0      1     0
reviewer@uncluttrd.app            8      8           0          0              0       0      1     0
```

### For every affected user, has the RC already…

| Question | Answer |
|---|---|
| Created new Room/Space documents? | **No** — all 71 Spaces carry admin-script shadow fields; v1.0.4 never writes `spaces` |
| Created Area subdocuments? | **No** — 0 Areas exist |
| Recognised/reused an existing Room? | **No** |
| Re-parented anything? | **No** |
| Created sessions/plans on the new identity model? | **No** — 0 plans have `approaches`, `sessionScope`, or `analysisStage` |
| Created merge candidates? | **Yes, but not by the RC** — see below |
| Created reclassification records? | **No** — 0 |
| Modified legacy records? | **No** |

**The 5 merge candidates are not RC artifacts.** All carry
`detectedAt: 2026-08-03T11:53:32Z` — an identical timestamp across three
different users, which no client interaction produces. They were seeded by the
admin merge-proposal script on 2026-08-03, the same day the production rules
gained `mergeCandidates` coverage. All have `resolutionStatus: pending` and
`resolvedAt: null`.

### Conclusion for Section 2

**Migration state is uniformly "legacy-only" across all 12 users.** No
mixed-version state exists in production today. This is corroborated
independently by `eas update:insights`: 0 installs and 0 unique users on both
50% groups, and 0 installs on the 3-week-old baseline OTA over 30 days.

That does **not** remove the idempotency requirement — it removes the *urgency*.
The requirement stands because the moment a device does install the RC, mixed
state begins. The migration must still be:

- Safe on a legacy-only user *(the only case that exists today)*
- Safe on a user who has opened the RC *(no such user yet — untestable in prod)*
- Resumable after partial failure
- Re-runnable without duplicating Rooms/Areas
- **Never overwrite newer RC classifications with inferred legacy ones**

The last point is the one with no production test data. The only way to
exercise it is on staging, where RC-shaped data exists.

---

## SECTION 3 — Compatibility with v1.0.4 — **SAFE**

Traced against `git show e361797:App.js` (the exact commit behind build #36).

### What v1.0.4 actually does

```
mentions of "spaces"        : 7   — ALL UI copy ("3 spaces/month", "saved spaces")
Firestore reads of spaces   : 0
canonicalSpaceId references : 0
retired / deletedAt filters : 0   (no such concept)
Room-UI markers             : 0   (no Rooms screen exists)
```

It loads plans and nothing else:

```js
const q = query(collection(db, "users", user.uid, "plans"),
                orderBy("createdAt", "desc"), limit(20));
```

Its only writes are `addDoc(.../plans)`, plus `updateDoc`/`deleteDoc` on
`users/{uid}`. It **never** writes `spaces`, `areas`, `mergeCandidates`, or
`reclassificationExecutions`.

### Answering each migration action

| Migration action | v1.0.4 behaviour |
|---|---|
| A legacy Space is retired | **Invisible.** Never reads `spaces`. |
| Its plans re-parented to a different Space | **Invisible.** Doesn't read `canonicalSpaceId`. |
| An Area created under another Room | **Invisible.** No Area concept. |
| `canonicalSpaceId` changes on a plan | **Invisible.** Field never read. |
| New Room/Area fields added to plan docs | **Harmless.** It spreads `...doc.data()` and renders only known fields; unknown keys are ignored. |

### Would v1.0.4 lose plans, recreate Spaces, or corrupt classifications?

- **Lose plans? No.** It queries the flat `plans` collection with no filter on
  Space, `retired`, or `deletedAt`. Plans stay visible regardless of hierarchy.
- **Recreate legacy Spaces? No.** It has no `spaces` write path.
- **Corrupt classifications? No.** It cannot write any classification field.
- **Fight the migration? No.** There is no field both sides write.

### One real interaction, and it is not a conflict

A v1.0.4 user who runs a *new* analysis after migration creates a plan via
`addDoc(.../plans)` with legacy shape — no `canonicalSpaceId`, no
`sessionScope`, no Space document. That plan is simply un-migrated and would be
picked up by a later pass.

**This is an argument for the migration being re-runnable, not for delaying it.**

### Verdict

**Migration can safely proceed while v1.0.4 clients remain active.** The two
data models do not overlap: v1.0.4 owns `plans` documents and is blind to the
Space/Area hierarchy the migration operates on. The preflight's concern here
does not materialise.

The one caveat worth stating plainly: this conclusion rests on v1.0.4 being the
*oldest* client in the field. Build #33/#34 users on older embedded bundles were
not traced. Given those predate #36 and the Space model is newer still, they are
almost certainly also blind to it — but that is inference, not verification.

---

## SECTION 4 — Migration strategy

### What actually needs doing is smaller than expected

There is no re-parenting to perform, because there is nothing to re-point:
`canonicalSpaceId` does not exist on any production plan. The work is
*establishing* identity, not correcting it.

### Recommended: do the mechanical backfill, defer every judgement call

**Phase 3a — non-judgemental backfill (script, safe, idempotent)**

1. **`sessionScope` classification** — `scripts/classifySessionScope.js`.
   Deterministic, derived from plan content, no Room/Area judgement. Covers
   75 plans.
2. **`canonicalSpaceId` linkage** — derivable without inference from the
   existing `spaces/{id}.sourcePlanId` back-reference. Pure mechanical
   inversion of a link that already exists.

Both are idempotent by construction: skip any plan that already has the field,
so a re-run is a no-op and an RC-written value is never overwritten.

**Phase 3b — hold. Do not auto-consolidate Rooms and Areas.**

The Area backfill (`scripts/backfillLegacyAreas.js`) should **not** run against
production yet:

- 34 Spaces are Area-like, and for real users **none** has an existing parent
  Room. The script would invent Rooms.
- 26 Spaces are genuinely ambiguous.
- 7 belong to a retail store where domestic Room inference is simply wrong.
- Only 5 real users and ~21 plans are affected — small enough that Needs Review
  is proportionate and a bad automated guess is not.

**Phase 3c — let Needs Review do the work**, once RC adoption is real.

### Idempotency requirements, restated concretely

```
for each plan:
  if plan.sessionScope exists      -> skip          (never overwrite)
  if plan.canonicalSpaceId exists  -> skip          (RC may have set it)
  if plan.approaches exists        -> RC-era plan, skip entirely
for each space:
  if space has areas               -> RC touched it, skip
  key new Areas by (spaceId, normalisedName) -> re-run cannot duplicate
```

The "never overwrite newer RC classifications" rule is satisfied by
skip-if-present on every field. **This rule has no production test data** and
must be validated on staging, where RC-shaped plans exist.

### Sequencing against the rollout

Because v1.0.4 is blind to the hierarchy (§3), the backfill is **not** blocked
on rollout percentage and does not need to wait for old clients to age out.

The genuine gate is different: **run Phase 3a while production is still
uniformly legacy**, because that is the simplest possible input. Every install
that lands makes the data more heterogeneous. Right now there are zero installs
— the cleanest migration window there will ever be.

### Preconditions before any write

1. **Firestore export first.** No script has been run against production before.
2. **Dry-run mode**, diff reviewed, on all 12 users.
3. **Explicit per-run approval** — the production service-account credential is
   read-only by standing rule, and every step here is a write.
4. Start with an internal account (`michael@` or `reviewer@`) before touching
   any of the 5 real users.

---

## What was NOT done

No production data was read-modified-written. The 50% rollout is untouched. No
`isPro` rule change, no backfill, no migration. Nothing was deployed.
