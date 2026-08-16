# Remaining Real Users — Migration Dry-Run Mappings

**Read-only. Nothing executed.** Fresh Firestore pull 2026-08-16T00:30:48Z.

Excluded as instructed: `cgignqc28@yahoo.com` (migrated), `adamharrison4506@gmail.com`
(retail store).

**All 7 remaining users are still purely legacy** — 0 RC-touched plans, 0 Areas,
0 `sessionScope`, 0 `areaId`, 0 `canonicalSpaceId`. Nothing has changed since the
earlier audit.

---

## The headline: this cohort is mostly *not* a Room/Area problem

| | Users | Spaces | Plans |
|---|---:|---:|---:|
| Have Spaces to reclassify | 4 | 7 | 7 |
| **Have no Spaces at all** — 1 orphan plan each | **3** | **0** | **3** |

**Three of the seven users have nothing to migrate in the Space sense.** Their
single plan post-dates the 2026-08-03 shadow migration, so no Space document was
ever created. There is no Space to retire and no linkage to rewrite — a
migration would be pure creation from a single photo label.

Total real work in this cohort: **7 Spaces across 4 users.**

---

## Per-user mappings

### 1. `evangorke@gmail.com` — 2 Spaces · **MERGE CANDIDATE**

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 1 | Living Room | **Living Room** (rename in place, no create) | — | `room` | High | *"This living room is experiencing some overwhelm…"*; blankets on sofa, coffee table, side table |
| 2 | Living Room / Multi-Purpose Space | **merge into #1** | — | `room` | **Medium** | *"a well-loved living space currently serving many purposes"*; coffee table catch-all, black shelving |

**Parent Room:** already exists — Space #1 *is* "Living Room". No create needed.

**Shared identifying objects — flagged as requested:**

| #1 "Living Room" | #2 "Living Room / Multi-Purpose Space" |
|---|---|
| "Coffee table covered with bottles, papers, and miscellaneous items" | "Various items cluttering the **coffee table** surface" |
| "**Rolled paper towels** on floor" | "**Paper towels** and cleaning supplies" |
| — | "Multiple beverage containers" |

Both plans are dated **Jul 30, 2026** — the same day. A cluttered coffee table
and loose paper towels appear in both. This is very likely one living room
photographed twice.

**Questionable-result flag:** the confidence policy would classify #2 as
AMBIGUOUS purely because of the slash in its name, and leave it for Needs
Review. The *evidence* says merge. This is a case where the naming heuristic and
the photo content disagree, and the photo content should win — but only a human
can confirm from the images.

---

### 2. `aramsey.henry@gmail.com` — 2 Spaces

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 1 | Home Office | **Home Office** (exists, no create) | — | `room` | High | *"This cozy home office…"*; desk, bookshelf, filing cabinet, multiple chairs |
| 2 | Kitchen Counter & Windowsill | **CREATE Kitchen** | Counter & Windowsill | `area` | High | *"This kitchen counter has become a catch-all…"*; utensils, tea boxes, glass jars |

**Cleanest user in the set.** One genuine Room, one unambiguous Area whose
parent is named in its own title and confirmed by the overview.

**One caveat:** the Home Office plan has **no `photoUrl`** (`photo=no`, Jul 2 —
predates photo storage). Nothing breaks — it is a Room, not an Area, so no
`originalPhotoUrl` is needed — but that Room will have no thumbnail.

---

### 3. `teige.p@gmail.com` — 2 Spaces

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 1 | TV Console & Media Center | **CREATE Living Room** | TV Console | `area` | **Medium** | *"beautiful media console setup"*; flat-screen TV, remotes, gaming console, mesh-front cabinets, rug |
| 2 | Under-Stairs Closet | — | — | `unresolved` | — | *"This under-stairs nook…"*; LED bulbs, power drill, cardboard boxes, tools |

**Guess-vs-evidence flag — #1.** The evidence firmly establishes *what* it is (a
media console). It says nothing about *which room contains it*. "Living Room" is
the statistically likely home for a TV console, but that is inference from
convention, not from this photograph — no sofa, no seating, no room context
appears in the item list. **This is the clearest case in the cohort of a
proposed parent Room name that is a guess rather than evidence-based.**

**#2 genuinely ambiguous.** An under-stairs closet is arguably its own space
rather than a zone within one — it has no parent room in any normal sense. It
could be a Room ("Under-Stairs Closet"), or an Area under a Hallway or Entryway
that does not exist. The contents (drill, bulbs, boxes) are utility storage,
which fits none of the standard room vocabulary. Leave for Needs Review.

---

### 4. `village1026@gmail.com` — 1 Space · **every Space ambiguous**

| # | Current Space Name | → Room | → Area | sessionScope | Conf | Evidence |
|---|---|---|---|---|---|---|
| 1 | Corner Reading Nook | — | — | `unresolved` | — | *"This cozy corner features a beautiful curved corner shelf…"*; books, snow globe, decorative fabric, reed diffuser |

**Flagged as requested: this user's *only* Space is ambiguous, so the policy
produces nothing at all for them.** A reading nook with a corner shelf could sit
in a living room, a bedroom, an office, or a landing. The item list — books,
snow globe, reed diffuser — is decor that appears in any of them. There is no
evidence-based parent.

Migrating this user means either inventing a Room or leaving them exactly as
they are with one Needs Review item. **Recommend the latter.**

**Duplicate-account flag:** `village1026@gmail.com` has **four** Firestore user
documents:

```
5LmCbEKZCJW5VLcR26IpC8cfHnv2   spaces=0 plans=0
Gn0lFNDqPHTq4Sy9rCvuecXg2jv2   spaces=0 plans=0
N48A63Qf5oXVjt2WVjkEG2Pe0ls2   spaces=1 plans=1   <- the only one with data
YdvF3IrEhiZr4NwT4jjyCVpT8hJ2   spaces=0 plans=0
```

Only `N48A63Qf…` holds anything. Any per-user migration must target that uid
specifically. (`mike.rhinstalls@gmail.com` has the same pattern — 2 accounts,
one with 20 plans — but that is internal.)

---

### 5–7. Users with **no Spaces** — one orphan plan each

No Space exists, so there is nothing to retire and no linkage to rewrite.

| User | Plan | spaceType | Date | Proposed Room | Proposed Area | Scope | Conf |
|---|---|---|---|---|---|---|---|
| `paulhesson@yahoo.com` | `0oqxGMdcOP` | Office Desk | Aug 14 | **CREATE Home Office** | Desk | `area` | **Medium** |
| `deb2731@gmail.com` | `oTM2CLIFqv` | Kitchen counter and work area | Aug 10 | **CREATE Kitchen** | Counter & Work Area | `area` | High |
| `emmasterk31@gmail.com` | `7vkPHeoRR0` | Jewelry & Accessories Display | Aug 9 | — | — | `unresolved` | — |

**`paulhesson` — Medium, and a guess-flag.** *"You've got a lovely functional
workspace here… that little succulent"*; loose papers, reading glasses, pen,
sticky notes, cup, succulent. Clearly a desk. But nothing establishes it is in a
*home office* rather than a bedroom, kitchen, or living-room corner. Same failure
mode as teige.p's TV console: the object is certain, the room is inferred.

**`deb2731` — High.** *"This kitchen has wonderful character… the counters are
doing triple duty"*; brewing vessels, cutting board on dishwasher, mixing bowls
near sink, groceries. Dishwasher and sink are structural kitchen fixtures, so
this is evidence, not convention. **The strongest inference in the cohort.**

**`emmasterk31` — genuinely ambiguous, second "every Space ambiguous" user.**
*"this jewelry organizer with its dark wood shelf"*; necklaces and earrings on
hooks, crystal jar, candle, gift bags. Jewelry storage lives in a bedroom, a
dressing area, a closet, or a bathroom — the photo gives no room context. Their
only plan, so the policy again yields nothing.

---

## Summary of flags

**Every Space ambiguous — policy yields nothing (2 users)**
`village1026@gmail.com` and `emmasterk31@gmail.com`. Both have exactly one item
and no evidence-based parent. Migration would produce an invented Room or no
change. **Recommend no change.**

**Automated Room-name inference could be wrong (3 cases)**

| Case | Object certain | Room inferred from |
|---|---|---|
| `teige.p` — TV Console → Living Room | yes | convention, not the photo |
| `paulhesson` — Office Desk → Home Office | yes | the word "Office" in the AI's own label |
| `evangorke` #2 — slash name | yes | naming heuristic contradicts the photo evidence |

None is as wrong as the retail store would have been, but all three assert a
room the photograph does not show.

**Potential merge (1)**
`evangorke@gmail.com` — the two Jul 30 Spaces share a cluttered coffee table and
paper towels. Likely one room, two photos.

**Proposed parent feels like a guess rather than evidence (2)**
`teige.p` → Living Room, and `paulhesson` → Home Office. Both defensible; neither
provable from the data.

**Data-integrity findings**
- 3 of 7 users have an orphan plan with no Space — the shadow migration ran
  2026-08-03 and these plans are from Aug 9/10/14.
- `village1026@gmail.com` has 4 user documents; only one holds data.
- `aramsey.henry`'s Home Office plan has no `photoUrl`.

---

## Recommendation

**Migrate 2 users, hold 5.**

| Action | Users | Why |
|---|---|---|
| **Migrate** | `aramsey.henry`, `deb2731` | Every mapping is High confidence and evidence-based. Kitchen is established by a dishwasher and sink; Home Office already exists as a Room. |
| **Human decision first** | `evangorke`, `teige.p`, `paulhesson` | Each needs one judgement: is it a merge; is the TV in the living room; is the desk in a home office. All three are one-glance questions with the photos. |
| **No change** | `village1026`, `emmasterk31` | Single ambiguous item each; migration would invent a Room. Leave for Needs Review. |

This is **7 Spaces and 3 orphan plans across 7 users** — small enough that the
per-user review costs less than building inference rules that would be wrong for
at least three of them.

**Nothing executed. No production data changed. The 50% rollout, the production
`isPro` rule and Cloud Functions are untouched.**
