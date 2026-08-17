# Michael Harrison — Production Migration Dry Run

**Read-only. Nothing executed.** Production `cluttrd-3e335`, pulled 2026-08-17T00:36:35Z.

**Account:** `michael@earthwiseenergy.net` — uid `m4ecZ9B9B1XmDrOiAQfFPjdjyNB3`
**21 plans · 21 Spaces (20 live, 1 retired) · 0 Areas · isPro true**
Every plan has a photo; every plan owns exactly one Space; no orphans.

Four other internal accounts matched the search — `mharrison30@yahoo.com` and
`mike.rhinstalls@gmail.com` (uid `t7MEIVOU…`) are **empty**, and
`mike.rhinstalls@gmail.com` (uid `yZ4FaeAW…`) holds a **separate 20-plan /
20-Space estate** that is out of scope here but will need its own pass.
`adamharrison4506` remains excluded (retail store).

---

## STOP — RC-created data exists, and it creates a live conflict

**Michael reclassified a Space in the app 12 minutes before this scan.**

| | |
|---|---|
| Plan `etF1AIYmFvr7xfmqz7lz` | `sessionScope: "room"`, `canonicalSpaceId: ceIIuNRAcWN7eEGlWygL`, `areaScope: "whole-room"`, `spaceName: "Home Office Desk"` |
| Space `etF1AIYmFvr7xfmqz7lz` | `retired: true`, `redirectTo: ceIIuNRAcWN7eEGlWygL`, `retiredAt: 2026-08-17T00:24:27Z` |

That is a genuine user decision made through the RC build, and the migration
**must not overwrite either document**.

### The conflict it creates

Michael's merge points at Space **`ceIIuNRAcWN7eEGlWygL` ("Home Office Desk",
#20 below)** — which is *also* a member of the six-Space desk cluster this
migration would otherwise fold into a single `Home Office / Desk` Area.

If the migration retires `ceIIuNRA…`, then plan `etF1AIYm…` — a plan we are
forbidden to touch — is left with `canonicalSpaceId` pointing at a **retired
Space**. That is a dangling reference the tombstone convention exists to
prevent.

**Three ways out, all requiring your decision:**

1. **`ceIIuNRA…` survives as the Home Office Room** (rename it in place rather
   than creating `room-home-office`). Michael's merge stays valid unchanged.
   Cleanest, and it reuses the same "existing Space becomes the Room" mechanic
   already used for `aramsey.henry` and `evangorke`.
2. **Hold the entire desk cluster** for a separate pass and migrate everything
   else. Safe, leaves 6 Spaces unmigrated.
3. **Re-point `etF1AIYm…`** — **rejected.** It overwrites an RC-created
   classification, which the brief forbids.

**Recommendation: option 1.**

Everything else on the account is untouched legacy: 20 of 21 plans have no
`sessionScope`, no `areaId`, no `canonicalSpaceId`, and there are **zero Areas**,
so nothing else can be clobbered.

---

## The dominant pattern: this is a test account, so it is merge-heavy

Three clusters are the same physical space photographed repeatedly during
testing. This is not a classification problem, it is a deduplication problem.

| Cluster | Spaces | Dates | Shared evidence |
|---|---:|---|---|
| **Dual-screen desk** | 6 | Jul 13 → Jul 22 | every overview describes a laptop-on-riser + external monitor + keyboard-with-wrist-rest setup |
| **Living Room** | 3 | Jul 10, 10, 16 | four *identical* itemsFound strings: "Gaming chair", "Wire basket on sofa", "Items scattered on coffee table", "Miscellaneous items on side table" |
| **Bathroom under-sink** | 2 | Jul 8, Jul 13 | four identical items: "Hair dryer and styling tools", "cleaning spray bottles", "Gray woven storage basket", "toilet paper rolls" |

The Living Room and Bathroom clusters are near-certain merges — the item strings
match verbatim. The desk cluster is highly likely but rests on overview prose
rather than identical strings, so it is **Medium**, and Michael himself already
started merging it by hand.

---

## Full mapping

### Group 1 — Obvious Rooms

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 4 | Living Room | **Living Room** (survivor) | — | `room` | High | *"This welcoming living room has great bones…"* |
| 5 | Living Room | **merge → #4** | — | `room` | High | identical items to #4 |
| 19 | Living Room | **merge → #4** | — | `room` | High | identical items to #4 |
| 7 | Home Office | **Home Office** | — | `room` | High | *"Your L-shaped office workspace…"*; HP printer, desk, papers |

**Parent Room:** created from #4 (survivor) and #7. Both names are already room
names — no invention.

### Group 2 — Obvious Areas whose parent Room exists (from Group 1)

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 3 | Living Room Entryway | Living Room | Entryway | `area` | High | *"clean entryway with high ceilings"*; snake plant, door with transom |
| 11 | Living Room Media Center | Living Room | Media Center | `area` | High | TV above console, media equipment, decorative letters |
| 18 | Living Room Corner | Living Room | Reading Corner | `area` | Medium | armchair, plant stand, floor lamp, side table with books |
| 2 | Home Office Corner | Home Office | Reading Corner | `area` | Medium | *"cozy office nook"*; armchair, floor lamp, plant stand — a seating zone, **not** the desk |
| 10 | Home Office Workstation | Home Office | Desk | `area` | Medium | Dell laptop on riser, Acer monitor, trackball |
| 13 | Home Office Workstation | **merge → Desk** | Desk | `area` | Medium | dual-monitor, standing desk, tangled cables |
| 14 | Home Office Workspace | **merge → Desk** | Desk | `area` | Medium | laptop on riser, external monitor, wrist rest |
| 15 | Home Office Desk Setup | **merge → Desk** | Desk | `area` | Medium | dual-screen, monitor stands, organizer caddy |
| 16 | Home Office / Desk Setup | **merge → Desk** | Desk | `area` | Medium | laptop on stand, caddy, tissue box |
| 20 | Home Office Desk | **merge → Desk** ⚠️ | Desk | `area` | Medium | dual-screen, laptop riser, notebook — **this is Michael's merge target, see STOP above** |

**#2 vs the desk cluster is a real distinction, not a duplicate.** "Home Office
Corner" is an armchair-and-plant seating nook; the six desk Spaces are all the
workstation. Same Room, two different Areas.

### Group 3 — Areas whose parent Room must be CREATED

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 1 | Bathroom Cabinet Under Sink | **CREATE Bathroom** | Under-Sink Cabinet | `area` | High | *"This under-sink cabinet is currently overcrowded…"* |
| 9 | Bathroom Cabinet Under Sink | **merge → #1** | Under-Sink Cabinet | `area` | High | four identical items to #1 |
| 8 | Bedroom Bookshelf & Display Unit | **CREATE Bedroom** | Bookshelf & Display | `area` | High | *"modern bookshelf…"*; Steelers pennant, medals, framed photos |

Both parent Rooms are named in the Space's own title and confirmed by the
overview — evidence-based, not convention.

### Group 4 — Genuinely ambiguous → Needs Review

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Why |
|---|---|---|---|---|---|---|
| 6 | Overwhelmed Closet/Dressing Area | — | — | `unresolved` | Low | Is a walk-in closet its own Room, or an Area under a Bedroom that does not exist? The photo shows no room context |
| 12 | Commercial Restroom | — | — | `unresolved` | Low | **Not a residence.** Public restroom, dual-sink vanity, paper towel dispensers |
| 17 | Restaurant Service Station | — | — | `unresolved` | Low | **Not a residence.** Staff service station, condiment bottles, napkin dispensers |

**#12 and #17 are the same class of problem as the excluded retail store.** No
home-room vocabulary fits them, and inventing "Commercial Restroom" as a Room
would pollute My Rooms with a non-residential entry. Leave for Needs Review.

---

## Totals

| | Spaces | Result |
|---|---:|---|
| Group 1 — Rooms | 4 | 2 Rooms (Living Room, Home Office) after 2 merges |
| Group 2 — Areas, parent exists | 10 | 3 Living Room Areas + 2 Home Office Areas after 5 merges |
| Group 3 — Areas, parent created | 3 | 2 new Rooms (Bathroom, Bedroom), 2 Areas after 1 merge |
| Group 4 — Ambiguous | 3 | unresolved, Spaces **not** retired |
| **Live Spaces** | **20** | **→ 4 Rooms, 7 Areas, 3 Needs Review** |
| RC-protected | 1 plan + 1 retired Space | **untouched** |

Auto-migrate under the confidence policy: **17 of 20** (all High/Medium).
Needs Review: **3**.

---

## What I recommend before executing

1. **Decide the `ceIIuNRA…` conflict** (option 1 above). Nothing should run
   until that is settled — it is the one issue that could corrupt data Michael
   created by hand.
2. **Confirm the three merge clusters from the photos.** The Living Room and
   Bathroom merges are backed by verbatim-identical item strings and I would
   execute them on that basis; the six-Space desk merge deserves one glance at
   the images, since it rests on prose similarity.
3. **Confirm #12 and #17 stay out.** If you would rather they simply disappear
   from My Rooms, retiring them without a `redirectTo` is the same one-line
   treatment applied to `teige.p` and `village1026`.

**Nothing executed. No production data changed. The 100% OTA rollout, the
`isPro` rule, Cloud Functions and all previously migrated accounts are
untouched.**
