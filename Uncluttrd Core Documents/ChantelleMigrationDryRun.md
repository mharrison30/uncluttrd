# Chantelle Account — Production Migration Dry Run

**Read-only. Nothing was executed. No production data changed.**

Account: `cgignqc28@yahoo.com` · uid `Xb4VOeduxjWPqbN6YNDp28Xz4x43`
Live re-read: **2026-08-15T23:31:26Z** (not the earlier dump).

---

## Stop-and-read: the existing scripts cannot perform this migration

Before the mapping, three findings that change what "approve the mapping" means.

### 1. `backfillLegacyAreas.js` would do **nothing** on this account

It targets plans with a **non-empty `areaName` string and a null `areaId`**
(`scripts/backfillLegacyAreas.js:113-115`). Checked against her live data:

```
9U3AoknCd5   areaName/areaScope/areaId/canonicalSpaceId : NONE
OJefNhmUfO   NONE
WFRE91xNSp   NONE
cKU01Pa2to   NONE
d2yUIJLhLj   NONE
odGoGnG4Ny   NONE
tRqq9TkIEj   NONE

plans this script would target: 0 of 7
```

That script was built for Phase A plans that already carry a flat `areaName`.
Her plans predate that field entirely. **It is the wrong tool.**

### 2. No existing script creates Rooms, retires Spaces, or re-parents plans

`classifySessionScope.js` writes exactly one field and says so
(`"sessionScope is the only field it touches"`). `backfillLegacyAreas.js`
creates Areas *under an already-correct Room* — it never creates the Room, never
retires a Space, never changes `canonicalSpaceId` to a different Room.

**The migration described in this document does not exist as code yet.** It
would need a new script. What follows is therefore a *specification* for you to
approve, not a preview of an existing script's output.

### 3. I cannot execute even a dry run from here

Both scripts use `admin.credential.cert(...)` / ADC. There is no service-account
key in this environment (`GOOGLE_APPLICATION_CREDENTIALS` unset, `gcloud`
non-functional). Everything below is derived from a live read-only REST pull and
from reading the scripts, not from running them.

---

## Current state — verified live

**RC-artifact scan: `approaches` 0 · `sessionScope` 0 · `analysisStage` 0 ·
`areaId` 0 · `canonicalSpaceId` 0 · Areas 0 · `retired` 0.**

**She is still on v1.0.4 despite being in the 50% cohort.** Her newest plan
(`tRqq9TkI`, Aug 15) has `tiers`, not `approaches` — an RC-created plan would
have the latter. Consistent with `update:insights` reporting 0 installs.

| Plan | spaceType | Date | schemaV | Space? |
|---|---|---|---|---|
| `9U3AoknCd5` | Under-Sink Bathroom Storage | Jul 19 | — | yes |
| `OJefNhmUfO` | Bathroom Linen Cabinet | Jul 11 | — | yes |
| `WFRE91xNSp` | Corner Shelf Display | Jul 16 | — | yes |
| `cKU01Pa2to` | Office Workspace | Jul 16 | — | yes |
| `d2yUIJLhLj` | Living Room Corner | Jul 11 | — | yes |
| `odGoGnG4Ny` | Laundry/Utility Room | Jul 19 | — | yes |
| `tRqq9TkIEj` | Desk/Work Surface | **Aug 15** | 1 | **NO — orphan** |

`tRqq9TkIEj` has **no Space document**. The shadow migration ran 2026-08-03;
this plan is from Aug 15, so it was never shadowed. Any migration must handle a
plan with no Space, not just Spaces with plans.

Every Space is 1:1 with its plan (`sourcePlanId === activeProjectId === planId`).

---

## Proposed mapping — before → after

### Room set to be created

| Room | Created? | Holds |
|---|---|---|
| **Bathroom** | **CREATE** | 2 Areas |
| **Living Room** | **CREATE** | 2 Areas |
| **Home Office** | **CREATE** | 1–2 Areas |
| **Laundry Room** | **CREATE** | promoted whole-room |

Four new Rooms. **None exists today** — she has no Space with a bare room name.

### Per-Space mapping

#### 1. `9U3AoknCd5` — "Under-Sink Bathroom Storage" → **Bathroom / Under-Sink Cabinet**

- **Evidence:** *"This under-sink cabinet…"*; items include **"Plumbing pipes (P-trap)"**, "Megababe branded basket with toiletries", "Purple storage basket".
- **Confidence: High.** A P-trap under a cabinet with toiletries is unambiguously a bathroom vanity.

```
Room   : CREATE "Bathroom"                      (new Space document)
Area   : CREATE "Under-Sink Cabinet"            under Bathroom
Plan   : canonicalSpaceId  (absent) -> <BathroomRoomId>
         areaId            (absent) -> <UnderSinkAreaId>
         areaName          (absent) -> "Under-Sink Cabinet"
         sessionScope      (absent) -> "area"
Space 9U3AoknCd5 : RETIRE (deletedAt set) - superseded by the Bathroom Room
```

#### 2. `OJefNhmUfO` — "Bathroom Linen Cabinet" → **Bathroom / Linen Cabinet**

- **Evidence:** *"This linen cabinet has good bones with pull-out drawers"*; towels, cleaning supplies, personal care items.
- **Confidence: High.** Same Bathroom as #1 — this is the merge that makes creating the Room worthwhile.

```
Room   : REUSE "Bathroom"                       (created in #1 - must not duplicate)
Area   : CREATE "Linen Cabinet"
Plan   : canonicalSpaceId -> <BathroomRoomId>;  areaId -> <LinenAreaId>
         areaName -> "Linen Cabinet";           sessionScope -> "area"
Space OJefNhmUfO : RETIRE
```

#### 3. `d2yUIJLhLj` — "Living Room Corner" → **Living Room / TV Corner**

- **Evidence:** *"cozy living room corner features a TV entertainment area with a corner bookshelf"*; wall-mounted TV, TV stand, snake plant.
- **Confidence: High.**

```
Room   : CREATE "Living Room"
Area   : CREATE "TV Corner"
Plan   : canonicalSpaceId -> <LivingRoomId>;    areaId -> <TVCornerAreaId>
         areaName -> "TV Corner";               sessionScope -> "area"
Space d2yUIJLhLj : RETIRE
```

#### 4. `WFRE91xNSp` — "Corner Shelf Display" → **Living Room / Corner Shelf** *(evidence-based inference)*

This is the one I want you to look at hardest, because the evidence is strong
but circumstantial.

| `WFRE91xNSp` "Corner Shelf Display" | `d2yUIJLhLj` "Living Room Corner" |
|---|---|
| "Books stacked horizontally and vertically" | "**Wooden corner shelf unit with books and decor**" |
| "**Reed diffuser**" | "**Reed diffuser on shelf**" |
| "Decorative glass globe or snow globe" | — |
| "Owl artwork or photograph" | — |

*"This beautiful wavy corner shelf unit…"* vs the Living Room plan's *"corner
bookshelf"*. A corner shelf holding books with a reed diffuser on it appears in
**both** photographs, five days apart.

**Read:** one wide shot of the living-room corner, one close-up of the same
shelf. If that is right, this is a second Area in the same Living Room, not a
separate space.

**Confidence: Medium.** Reed diffusers and book-filled corner shelves are common
enough that this could be a different corner in a different room. **Your call —
the photos will settle it in seconds.**

```
Room   : REUSE "Living Room"                    (from #3)
Area   : CREATE "Corner Shelf"
Plan   : canonicalSpaceId -> <LivingRoomId>;    areaId -> <CornerShelfAreaId>
         areaName -> "Corner Shelf";            sessionScope -> "area"
Space WFRE91xNSp : RETIRE
```

*If you disagree:* promote it to its own Room, or leave `sessionScope:
"unresolved"` and let Needs Review ask her.

#### 5. `cKU01Pa2to` — "Office Workspace" → **Home Office / Desk**

- **Evidence:** *"lovely dark countertop and cabinet storage… overwhelmed by a large priority mail box, scattered papers, and tech clutter"*; USPS Priority Mail box, monitor, keyboard, desk phone, filing trays.
- **Confidence: High** that it is a Home Office. **Medium** on the Area name — "Desk" vs "Command Center"; her own overview uses *"command center"*.

```
Room   : CREATE "Home Office"
Area   : CREATE "Desk"
Plan   : canonicalSpaceId -> <HomeOfficeId>;    areaId -> <DeskAreaId>
         areaName -> "Desk";                    sessionScope -> "area"
Space cKU01Pa2to : RETIRE
```

#### 6. `odGoGnG4Ny` — "Laundry/Utility Room" → **Laundry Room** *(promote to Room, no Area)*

- **Evidence:** *"This compact laundry area…"*; utility sink, cleaning supplies, cabinet above sink. This is a whole small room, not a zone within one.
- **Confidence: High** on Room. The slash in the name is a naming artifact, not two places.

```
Room   : CREATE "Laundry Room"
Area   : none
Plan   : canonicalSpaceId -> <LaundryRoomId>;   areaId stays absent
         sessionScope -> "room"
Space odGoGnG4Ny : RETIRE (replaced by the "Laundry Room" Room)
```

#### 7. `tRqq9TkIEj` — "Desk/Work Surface" → **AMBIGUOUS — do not auto-resolve**

- **Evidence:** *"This workspace has good bones but needs a little breathing room"*; clear plastic cup with straw, insulated tumbler with pink lid, gray/olive bag or backpack, scattered papers/receipts, corrugated metal containers.
- **Why ambiguous:** it shares *no* identifying object with `cKU01Pa2to` — no monitor, no keyboard, no desk phone, no Priority Mail box, no dark countertop. Either the same desk cleared and re-photographed a month later, or a different surface entirely (kitchen table, dining table). The drinks-and-backpack signature reads more like a temporary drop zone than a computer desk.
- It is also the **only plan with no Space**, and the only one created after the shadow migration.

**Recommendation: leave unassigned.** Stamp `sessionScope: "unresolved"` and let
Needs Review ask her on her phone — which is exactly the flow you want to verify
anyway. It gives the on-device test something to actually do.

```
Room   : none
Area   : none
Plan   : sessionScope (absent) -> "unresolved"
         canonicalSpaceId       -> unchanged (absent)
Space  : none exists; none created
```

---

## Complete write manifest

Everything that would be written. Nothing else.

**Creates — 4 Room Spaces**

```
users/{uid}/spaces/{new}  displayName "Bathroom"     + createdAt, shadowSchemaVersion
users/{uid}/spaces/{new}  displayName "Living Room"
users/{uid}/spaces/{new}  displayName "Home Office"
users/{uid}/spaces/{new}  displayName "Laundry Room"
```

**Creates — 5 Areas**

```
spaces/{Bathroom}/areas/{new}    "Under-Sink Cabinet"   originalPhotoUrl from 9U3AoknCd5
spaces/{Bathroom}/areas/{new}    "Linen Cabinet"        from OJefNhmUfO
spaces/{LivingRoom}/areas/{new}  "TV Corner"            from d2yUIJLhLj
spaces/{LivingRoom}/areas/{new}  "Corner Shelf"         from WFRE91xNSp
spaces/{HomeOffice}/areas/{new}  "Desk"                 from cKU01Pa2to
```

**Updates — 7 plans**

| Plan | canonicalSpaceId | areaId | areaName | sessionScope |
|---|---|---|---|---|
| `9U3AoknCd5` | → Bathroom | → Under-Sink Cabinet | "Under-Sink Cabinet" | `area` |
| `OJefNhmUfO` | → Bathroom | → Linen Cabinet | "Linen Cabinet" | `area` |
| `d2yUIJLhLj` | → Living Room | → TV Corner | "TV Corner" | `area` |
| `WFRE91xNSp` | → Living Room | → Corner Shelf | "Corner Shelf" | `area` |
| `cKU01Pa2to` | → Home Office | → Desk | "Desk" | `area` |
| `odGoGnG4Ny` | → Laundry Room | — | — | `room` |
| `tRqq9TkIEj` | unchanged | — | — | `unresolved` |

**Retires — 6 legacy Spaces** (`deletedAt` set; documents kept, not deleted)

`9U3AoknCd5` · `OJefNhmUfO` · `WFRE91xNSp` · `cKU01Pa2to` · `d2yUIJLhLj` ·
`odGoGnG4Ny`

**Not touched:** `tiers`, `overview`, `itemsFound`, `photoUrl`, `proTip`,
`vizImages`, `createdAt`, `date`, `schemaVersion`, `currentBatch`,
`batchHistory`, `progressPhotos`, and every `users/{uid}` field including
`isPro`. No plan is deleted.

### Net result on her phone

Before: 6 flat Spaces, each holding one plan, no hierarchy.
After: **4 Rooms · 5 Areas · 1 plan in Needs Review.**

---

## Risks worth naming before you approve

**The `sessionScope` values differ from what the existing script would produce.**
`classifySessionScope.js` maps *"no `areaScope` at all → `unresolved`"*
(lines 20-22). Run as-is today, it would mark **all 7** plans `unresolved`,
not the 5 `area` / 1 `room` / 1 `unresolved` above. The mapping in this document
assumes a new script that sets scope from the assigned hierarchy. If you would
rather use the existing script, the outcome is "everything goes to Needs Review"
— which is defensible, just a different product decision.

**Retirement is the only destructive-feeling step.** It sets `deletedAt`; it
does not delete. And per the v1.0.4 compatibility trace, her current client
never reads `spaces` at all, so retirement is invisible to her until she
actually installs the RC.

**She is still on v1.0.4.** Migrating now means she sees no change until the OTA
installs. To verify on her phone you need the RC actually running — worth
confirming before, not after, the migration.

**Idempotency requirements** for the new script: key Rooms by
`(uid, normalised displayName)` and Areas by `(roomId, normalised displayName)`
so a re-run reuses rather than duplicates; skip any plan that already has
`areaId` or `canonicalSpaceId`; never overwrite a non-null `sessionScope`.

---

## Recommendation

Approve or amend the mapping — specifically **#4 Corner Shelf** (Medium
confidence) and **#7 Desk/Work Surface** (recommend leaving unresolved).

Then, before any write: Firestore export, new script authored with the
idempotency rules above, dry-run output reviewed against this document, and
explicit go-ahead. The production credential is read-only by standing rule and
every step here is a write.

**Nothing executed. OTA still at 50%. No `isPro` rule change. No other account touched.**
