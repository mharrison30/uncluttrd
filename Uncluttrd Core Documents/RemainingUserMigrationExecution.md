# Remaining Real User Migrations — Execution Record

**Executed 2026-08-16T00:51Z against production `cluttrd-3e335`.**
Tag on every written document: `migrationSource: "remaining-users-room-migration-2026-08-16"`.

**30 writes planned, 30 succeeded, 0 failed. 107 verification checks, 107 pass.**

Untouched as instructed: `cgignqc28` (already migrated), `adamharrison4506` (retail
store), all internal/test accounts, the 50% production OTA rollout, the production
`isPro` Firestore rule, and every Cloud Function.

---

## One instruction conflict, and how it was resolved

`deb2731` and `paulhesson` **have no Space document** — they are two of the three
orphan-plan users identified in the dry run. So:

- Their per-user instructions ("CREATE Room … `sessionScope: "area"` … **Retire
  legacy Space**") name a retire target that does not exist.
- The generic **ORPHAN PLANS** rule ("any plans with no Space document: set
  `sessionScope: "unresolved"`") contradicts their explicit `sessionScope: "area"`.

**Resolved as:** the specific per-user mapping wins — those two mappings name a
Room *and* an Area deliberately, and the dry run rated `deb2731` the strongest
inference in the cohort. The retire step is a no-op. The orphan catch-all was
applied only to plans not otherwise specified.

**There were no such plans.** The only three orphans are `paulhesson`, `deb2731`
and `emmasterk31`, and all three are named explicitly. So the catch-all fired zero
times and the conflict has no residue.

---

## Pre-migration snapshots

Captured **before any write**, one directory per user, raw Firestore REST
documents verbatim (restorable):

```
scratchpad/migration-snapshots/{email}/snapshot-2026-08-16T00-45-*.json
scratchpad/migration-snapshots/{email}/snapshot-latest.json
```

| User | plans | spaces | areas | projects | sessions | batches | bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| aramsey.henry@gmail.com | 2 | 2 | 0 | 2 | 0 | 0 | 27,571 |
| deb2731@gmail.com | 1 | 0 | 0 | 0 | 0 | 0 | 21,668 |
| evangorke@gmail.com | 2 | 2 | 0 | 2 | 2 | 2 | 58,140 |
| teige.p@gmail.com | 2 | 2 | 0 | 2 | 2 | 2 | 57,114 |
| paulhesson@yahoo.com | 1 | 0 | 0 | 0 | 0 | 0 | 20,634 |
| village1026@gmail.com | 1 | 1 | 0 | 1 | 0 | 0 | 29,667 |
| emmasterk31@gmail.com | 1 | 0 | 0 | 0 | 0 | 0 | 20,336 |

Each snapshot also captures `mergeCandidates`, `reclassificationExecutions` and
`analysisIdempotency` — all empty for all seven.

---

## What was written, per user

### 1. `aramsey.henry@gmail.com` — 8 writes

| Op | Target |
|---|---|
| PATCH Room (reused) | `spaces/1UQPFsLk9bvaB9OpLIAo` "Home Office" |
| CREATE Room | `spaces/room-kitchen` "Kitchen" |
| CREATE Area | `room-kitchen/areas/area-counter-windowsill` "Counter & Windowsill" |
| CREATE Project ×2 | under both Rooms |
| UPDATE Plan ×2 | linkage + scope |
| RETIRE Space | `Ad8bsXXPk59OG5gjrfRt` → `redirectTo: room-kitchen` |

**Home Office was reused, not recreated.** The existing Space document *is* the
Room, so the migration touched only its summary and bookkeeping fields and never
its `displayName`, `createdAt`, or `sourcePlanId` — those already hold
user-visible truth.

### 2. `deb2731@gmail.com` — 4 writes

Room `room-kitchen` "Kitchen" → Area `area-counter-work-area` "Counter & Work
Area", plan linked at `sessionScope: "area"`. Shadow Project **synthesized** (no
legacy Project existed to copy). No retire — no Space existed.

### 3. `evangorke@gmail.com` — 6 writes · **the merge**

Both plans now point at the single Living Room Space `IIbo7vSGBZgtaaASTtkq`, which
carries **`visitCount: 2`** — the merge is visible in the Room summary, not just
inferred from the linkage. The duplicate `2RvWGOocnPd0Wl8Yb4lv` is retired with
`redirectTo: IIbo7vSGBZgtaaASTtkq`. Both plans are `sessionScope: "room"`, neither
has an `areaId`.

### 4. `teige.p@gmail.com` — 6 writes

`TV Console & Media Center` → Room `room-living-room` "Living Room" / Area
`area-tv-console` "TV Console"; legacy Space retired. `Under-Stairs Closet` set to
`sessionScope: "unresolved"` **only** — its Space was deliberately not retired.

### 5. `paulhesson@yahoo.com` — 4 writes

Room `room-home-office` "Home Office" → Area `area-desk` "Desk". Shadow Project
synthesized. No retire.

### 6. `village1026@gmail.com` — 1 write

`sessionScope: "unresolved"` on plan `sZQh2FU7aQA6TGoiWtGA`. Nothing else. Targeted
**uid `N48A63Qf5oXVjt2WVjkEG2Pe0ls2` specifically** — the only one of this email's
four user documents that holds data. The other three were never read or written.

### 7. `emmasterk31@gmail.com` — 1 write

`sessionScope: "unresolved"` on plan `7vkPHeoRR0iIswmYKpwc`. Nothing else.

---

## Verification — 107/107 pass

Run against a **fresh read**, not the write-side state.

| | Check | Result |
|---|---|---|
| a | Correct number of Rooms; no legacy Space name left as an unexpected Room | PASS (all 7) |
| b | Correct Areas under correct Rooms (4 Areas total) | PASS |
| c | `canonicalSpaceId` set on every linked plan; absent on unresolved | PASS |
| d | Correct `sessionScope` and `areaId` on all 10 plans | PASS |
| e | Legacy Spaces retired with `redirectTo`, **no `deletedAt`** | PASS (3 retirements) |
| f | Unresolved items: no retired Space, no linkage written | PASS |
| g | Plan count unchanged per user (vs. snapshot) | PASS (10 → 10) |
| h | Shadow Projects exist with correct `scopeId`/`areaId`/`sourcePlanId` | PASS (7 Projects) |

**Idempotency proven, not asserted:** a second dry run reports
`SKIP Plan (already correct)` for **all 10 plans**. Every created document uses a
deterministic id, so a re-run overwrites identically rather than duplicating.

**Photos:** 13/13 `plan.photoUrl` and `area.originalPhotoUrl` URLs return
200/206. The one plan with no photo is `aramsey.henry`'s Home Office (Jul 2,
predates photo storage) — flagged in the dry run, and harmless because it is a
Room, not an Area.

### Two expected outcomes that look like findings but are not

**`teige.p` and `village1026` each still show a legacy Space name as a Room** —
"Under-Stairs Closet" and "Corner Reading Nook". This is the direct consequence
of "Do NOT retire this Space", and it is correct per the instructions. Both plans
*also* appear in Needs Review as `unresolved`, so each user sees the item in two
places until they classify it. Retiring those Spaces is the one-line change if
that double-presentation is not wanted.

**`emmasterk31` now has zero non-retired Spaces** — she had none to begin with.
Her single plan is in Needs Review.

---

## Two deliberate deviations from the Chantelle script

Both are additions, flagged rather than folded in silently.

**1. Room and Area summaries are recomputed using the real production helpers.**
The migration script `require`s `computeRoomSummaryFields` and
`computeAreaSummaryFields` from `shared/spaceMigration.js` and feeds them the
exact Project document set that will exist after the writes land — rather than
reimplementing the derivation. So `visitCount`, `lastOrganizedAt`,
`latestPhotoUrl`, `latestAreaName` and `latestAreaScope` match what the client
itself would compute.

**2. `areaScope` is now written alongside `areaId`/`areaName`.**
`App.js:793` derives it as `"sub-area"` when an area is targeted and
`"whole-room"` otherwise. Readers default an **absent** `areaScope` to
`"whole-room"` (`App.js:2178`, `App.js:2325`) — which would be wrong for an
area-scoped plan, and would surface if the user later reclassified it.

**Follow-up this implies, not executed:** Chantelle's migration did not write
`areaScope`, so her **5 area-scoped plans** carry the same gap. A one-field
backfill would close it. Her account was out of scope here, so nothing was
touched.

---

## Cohort state after this migration

| | Before | After |
|---|---:|---:|
| Real users on purely legacy data | 7 | 0 |
| Rooms | 0 | 6 |
| Areas | 0 | 4 |
| Plans in Needs Review (`unresolved`) | 0 | 3 |
| Retired legacy Spaces | 0 | 3 |

The 3 remaining Needs Review items are the genuinely ambiguous ones —
`teige.p`'s under-stairs closet, `village1026`'s reading nook, `emmasterk31`'s
jewelry display. Each is a one-glance human decision in the app itself, which is
where it belongs.

---

## Artifacts

| File | Purpose |
|---|---|
| `scratchpad/snapshotRemaining.js` | Pre-migration snapshot capture (GET only) |
| `scratchpad/migrateRemaining.js` | The migration. Dry run by default; `--execute` to write; `--only=<email>` to scope |
| `scratchpad/verifyRemaining.js` | Independent post-migration verification (a)–(h), read-only |
| `scratchpad/migration-snapshots/{email}/` | Per-user restorable snapshots |

Rollback path: each snapshot holds the verbatim pre-migration documents. Reverting
a user means restoring their plan documents' fields and deleting the created
`room-*` Space subtree; the retired Spaces are tombstones, so clearing
`retired`/`redirectTo`/`retiredAt` restores them to view.
