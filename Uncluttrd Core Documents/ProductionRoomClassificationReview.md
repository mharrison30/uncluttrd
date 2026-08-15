# Production Room Migration — Human Classification Review

**Read-only. No production data was changed.** Source: `prod-audit.json`
(Firestore REST, GET only, 2026-08-15). This document exists for you to review
and personally resolve; nothing here has been applied.

---

## Read this before the tables — four things that constrain the exercise

**1. The evidence you asked for mostly does not exist in production.**

| Field requested | Present on production plans |
|---|---|
| `spaceType` | **75 / 75** |
| `overview` | **75 / 75** |
| `itemsFound` | **75 / 75** |
| `photoUrl` | 49 / 75 |
| `schemaVersion` | 32 / 75 |
| `suggestedRoomName` | **0 / 75** |
| `suggestedAreaName` | **0 / 75** |
| `areaName` | **0 / 75** |
| `areaScope` | **0 / 75** |

`suggestedRoomName`, `suggestedAreaName`, `areaName` and `areaScope` are
RC-era fields. They were never written by any client that has run in
production, so they cannot inform these decisions.

**2. `spaceType` is not independent evidence — it *is* the Space name.**

`displayName` is byte-identical to the source plan's `spaceType` in **71 of 71**
cases. The Space name was derived directly from it, so it cannot be used to
cross-check the name. The only genuinely independent evidence is the
`overview` and `itemsFound` text, which describe the photograph. That is why
those are quoted in full for every ambiguous case.

**3. Every Space maps to exactly one plan.** All 71 have a `sourcePlanId` that
resolves. The "Plans" column is 1 everywhere, so no Space has accumulated
history and none is shared. Re-classifying a Space affects exactly one plan.

**4. Account attribution needs your eye on one row.**

`cgignqc28@yahoo.com` is **not** flagged `isTestAccount`, and is therefore
listed under real users. But `KNOWN_TEST_EMAILS` in `App.js:2607` contains
`cgignac28@yahoo.com` — differing at position 5 (`a` vs `q`). Either the
constant has a typo and this is an internal account wrongly counted as a real
user, or they are two different people. It changes the real-user blast radius
from 5 users to 4, so it is worth resolving before migration.

Also note `mike.rhinstalls@gmail.com` has `isTestAccount=false` despite being
the Firebase/EAS owner account. I have grouped it as internal by email, not by
the flag.

---

## Confidence key

| Value | Meaning |
|---|---|
| **High** | Name is unambiguous and, for AREA rows, the parent Room already exists on that user's account |
| **Medium** | Structure is clear (sub-zone + room qualifier) but the parent Room does not exist and would have to be created |
| **—** | AMBIGUOUS; I am deliberately not proposing a resolution |

`CREATE ROOM: X` means no Space with that Room name exists for that user today.

## Real users

| User | Current Space Name | Space ID | Plans | Class | Proposed Parent Room | Proposed Area Name | Conf | Why |
|---|---|---|---|---|---|---|---|---|
| aramsey.henry@gmail.com | Home Office | `1UQPFsLk9b` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| evangorke@gmail.com | Living Room | `IIbo7vSGBZ` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| adamharrison4506@gmail.com | Bedroom Corner Storage Area | `jioR7VZEDz` | 1 | AREA | **CREATE ROOM: Bedroom** | Corner Storage Area | Medium | Names a sub-zone/fixture ("Corner Storage Area") qualified by a room ("Bedroom"). |
| aramsey.henry@gmail.com | Kitchen Counter & Windowsill | `Ad8bsXXPk5` | 1 | AREA | **CREATE ROOM: Kitchen** | Counter & Windowsill | Medium | Names a sub-zone/fixture ("Counter & Windowsill") qualified by a room ("Kitchen"). |
| cgignqc28@yahoo.com | Bathroom Linen Cabinet | `OJefNhmUfO` | 1 | AREA | **CREATE ROOM: Bathroom** | Linen Cabinet | Medium | Names a sub-zone/fixture ("Linen Cabinet") qualified by a room ("Bathroom"). |
| cgignqc28@yahoo.com | Laundry/Utility Room | `odGoGnG4Ny` | 1 | AREA | **CREATE ROOM: Laundry Room** | Laundry/Utility Room | Medium | Names a sub-zone/fixture ("Laundry/Utility Room") qualified by a room ("Laundry Room"). |
| cgignqc28@yahoo.com | Living Room Corner | `d2yUIJLhLj` | 1 | AREA | **CREATE ROOM: Living Room** | Corner | Medium | Names a sub-zone/fixture ("Corner") qualified by a room ("Living Room"). |
| cgignqc28@yahoo.com | Office Workspace | `cKU01Pa2to` | 1 | AREA | **CREATE ROOM: Home Office** | Office Workspace | Medium | Names a sub-zone/fixture ("Office Workspace") qualified by a room ("Home Office"). |
| cgignqc28@yahoo.com | Under-Sink Bathroom Storage | `9U3AoknCd5` | 1 | AREA | **CREATE ROOM: Bathroom** | Under-Sink Storage | Medium | Names a sub-zone/fixture ("Under-Sink Storage") qualified by a room ("Bathroom"). |
| teige.p@gmail.com | TV Console & Media Center | `xfMLYQ1IUN` | 1 | AREA | **CREATE ROOM: Living Room** | TV Console & Media Center | Medium | Names a sub-zone/fixture ("TV Console & Media Center") qualified by a room ("Living Room"). |
| adamharrison4506@gmail.com | Creative classroom or therapy room | `LC2R5vDENV` | 1 | AMBIGUOUS | — | — | — | Name encodes two alternatives ("Creative classroom or therapy room"), so it may be one room, a room serving two functions, or the… |
| adamharrison4506@gmail.com | Product Display Cabinet | `iUqyqaIoEM` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| adamharrison4506@gmail.com | Retail Bath & Body Product Display | `nrX9NKJTy1` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| adamharrison4506@gmail.com | Retail Beauty Display | `HtMkN4BuI9` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| adamharrison4506@gmail.com | Retail Candle Display | `Ui4VYkxyXi` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| adamharrison4506@gmail.com | Retail Display / Beauty Store | `ERtquUm8bh` | 1 | AMBIGUOUS | — | — | — | Name encodes two alternatives ("Retail Display / Beauty Store"), so it may be one room, a room serving two functions, or the AI h… |
| adamharrison4506@gmail.com | Retail Display Shelf | `W6PuWoRiU8` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| adamharrison4506@gmail.com | Retail Store Interior | `QcR7SJNaHF` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| cgignqc28@yahoo.com | Corner Shelf Display | `WFRE91xNSp` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| evangorke@gmail.com | Living Room / Multi-Purpose Space | `2RvWGOocnP` | 1 | AMBIGUOUS | Living Room | Multi-Purpose Space | — | Name encodes two alternatives ("Living Room / Multi-Purpose Space"), so it may be one room, a room serving two functions, or the … |
| teige.p@gmail.com | Under-Stairs Closet | `JzPvV5leds` | 1 | AMBIGUOUS | **CREATE ROOM: Bedroom** | Under-Stairs Closet | — | Name matches more than one room vocabulary, so the parent cannot be inferred from the string alone. |
| village1026@gmail.com | Corner Reading Nook | `sZQh2FU7aQ` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |

### Ambiguous cases — full historical evidence (real users)

**Living Room / Multi-Purpose Space** — `2RvWGOocnPd0Wl8Yb4lv` — evangorke@gmail.com

- **Why ambiguous:** Name encodes two alternatives ("Living Room / Multi-Purpose Space"), so it may be one room, a room serving two functions, or the AI hedging between two identifications.
- `spaceType` (the AI's own label): `Living Room / Multi-Purpose Space`
- source plan: `2RvWGOocnPd0Wl8Yb4lv` · date `Jul 30, 2026` · schemaVersion `1` · photo yes
- items found: _Multiple beverage containers (water bottles, cups, cans)_; _Food items and snack packages on coffee table_; _Paper towels and cleaning supplies_; _Stacked boxes and items on black shelving unit_; _Lamp and decorative items on desk area_; _Various items cluttering the coffee table surface_
- overview: This is a well-loved living space that's currently serving many purposes at once, with a coffee table that's become a catch-all for drinks, snacks, and daily essentials. With some gentle ed…

**Under-Stairs Closet** — `JzPvV5leds5RfSzi0ycr` — teige.p@gmail.com

- **Why ambiguous:** Name matches more than one room vocabulary, so the parent cannot be inferred from the string alone.
- `spaceType` (the AI's own label): `Under-Stairs Closet`
- source plan: `JzPvV5leds5RfSzi0ycr` · date `Jul 26, 2026` · schemaVersion `1` · photo yes
- items found: _Box of EcoSmart LED light bulbs_; _Orange and black power drill_; _Cardboard shipping boxes_; _Gray storage container or case_; _Plastic bags with red items_; _Miscellaneous tools and green ties_
- overview: This under-stairs nook has wonderful potential with its multi-shelf setup, but right now it's housing a mix of light bulbs, power tools, cardboard boxes, and miscellaneous items without cle…

**Corner Reading Nook** — `sZQh2FU7aQA6TGoiWtGA` — village1026@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Corner Reading Nook`
- source plan: `sZQh2FU7aQA6TGoiWtGA` · date `Jul 14, 2026` · schemaVersion `1` · photo yes
- items found: _Books on multiple shelves_; _Snow globe or decorative dome_; _Decorative fabric or patterned item_; _Reed diffuser_; _Small decorative containers and frames_; _Snake plant in gray pot_
- overview: This cozy corner features a beautiful curved corner shelf that's working hard to display books, decorative items, and personal treasures. With a few thoughtful touches, we can transform thi…

**Retail Display / Beauty Store** — `ERtquUm8bhllJqRPqFYs` — adamharrison4506@gmail.com

- **Why ambiguous:** Name encodes two alternatives ("Retail Display / Beauty Store"), so it may be one room, a room serving two functions, or the AI hedging between two identifications.
- `spaceType` (the AI's own label): `Retail Display / Beauty Store`
- source plan: `ERtquUm8bhllJqRPqFYs` · date `Jul 27, 2026` · schemaVersion `1` · photo yes
- items found: _Large promotional poster with 'FRUIT FUSION' branding_; _Three sculptural fruit-shaped display stands (orange tanger…_; _White multi-level display counters with product inventory_; _Organized product bottles in orange, purple, and pink packa…_; _Overhead pendant lighting fixtures_; _Background shelving with additional product stock_
- overview: This is a vibrant retail beauty display featuring a 'Fruit Fusion' promotional setup with colorful product stands and white display fixtures. The space is professionally merchandised with c…

**Retail Beauty Display** — `HtMkN4BuI9xurfvddsAw` — adamharrison4506@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Retail Beauty Display`
- source plan: `HtMkN4BuI9xurfvddsAw` · date `Jul 27, 2026` · schemaVersion `1` · photo yes
- items found: _Tiered promotional display with pink gradient product bottl…_; _Large celebrity endorsement banner with Hilary Duff_; _Orange promotional sign advertising free gift with purchase_; _Black decorative berries or spheres as visual elements_; _Orange skincare jars stacked on adjacent white platform_; _Illuminated shelving unit in background with hair care prod…_
- overview: This is a beautifully merchandised retail beauty display featuring a tiered promotional setup for a hydration skincare line with celebrity endorsement. The space is professionally organized…

**Creative classroom or therapy room** — `LC2R5vDENVyn5wUUE2L4` — adamharrison4506@gmail.com

- **Why ambiguous:** Name encodes two alternatives ("Creative classroom or therapy room"), so it may be one room, a room serving two functions, or the AI hedging between two identifications.
- `spaceType` (the AI's own label): `Creative classroom or therapy room`
- source plan: `LC2R5vDENVyn5wUUE2L4` · date `Jul 23, 2026` · schemaVersion `1` · photo yes
- items found: _Stack of guitar instruction books on upper shelf_; _Colorful pool noodles or foam tubes stored horizontally_; _Pink bean bag chair_; _Rolling cart with mixed supplies_; _Multiple storage bins and shelving units_; _Whiteboard with scattered markers on ledge_
- overview: This colorful space has wonderful creative potential with its musical instruments, sensory tools, and teaching materials. With a bit of intentional organizing, you can transform it into an …

**Retail Store Interior** — `QcR7SJNaHFR4pV1xL0qA` — adamharrison4506@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Retail Store Interior`
- source plan: `QcR7SJNaHFR4pV1xL0qA` · date `Jul 25, 2026` · schemaVersion `1` · photo yes
- items found: _Halloween-themed display items on black tables in foreground_; _Wall-mounted shelving with organized product jars and conta…_; _Black display tables throughout the space_; _Pendant lighting fixtures hanging from ceiling_; _Track lighting along ceiling rails_; _Window signage for Halloween promotion_
- overview: This is a beautifully designed retail space with excellent visual merchandising and thoughtful lighting. The store appears well organized with clear product displays, seasonal Halloween dec…

**Retail Candle Display** — `Ui4VYkxyXiwKMHThrQpo` — adamharrison4506@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Retail Candle Display`
- source plan: `Ui4VYkxyXiwKMHThrQpo` · date `Jul 25, 2026` · schemaVersion `1` · photo yes
- items found: _Multiple rows of white and cream candles in jars arranged o…_; _Blue and green colored candles grouped together on middle s…_; _White ceramic decorative pieces (candlestick holders or vas…_; _Promotional signage reading 'World's Best Candle. Guarantee…_; _Upper shelf with 'Designed for modern aesthetics' marketing…_; _Lower black drawer unit partially open with additional cand…_
- overview: This is a beautifully curated candle shop display with warm wood shelving and thoughtful product arrangements. The space showcases excellent visual merchandising with organized rows of cand…

**Retail Display Shelf** — `W6PuWoRiU8npXUiIybMe` — adamharrison4506@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Retail Display Shelf`
- source plan: `W6PuWoRiU8npXUiIybMe` · date `Jul 25, 2026` · schemaVersion `1` · photo yes
- items found: _Multiple rows of spray bottles in various colors and scents_; _Boxed fragrance products on the third shelf_; _Blue-packaged items on the fourth shelf_; _Miscellaneous items in clear containers on the bottom shelf_; _White Barn branded wooden box at base_; _Decorative pricing bubbles along the right edge_
- overview: This is a beautifully crafted wooden display shelf showcasing White Barn room sprays and car fragrances in an organized, retail-style presentation. The multi-tiered shelving with warm light…

**Product Display Cabinet** — `iUqyqaIoEMqa9JYcPROb` — adamharrison4506@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Product Display Cabinet`
- source plan: `iUqyqaIoEMqa9JYcPROb` · date `Jul 27, 2026` · schemaVersion `1` · photo yes
- items found: _Multiple rows of refill pouches (yellow/green packaging) on…_; _Spray bottles in various colors (amber, pink, green, clear)…_; _Signature Collection products and Everyday Basics signage v…_; _Small price signs and promotional materials scattered throu…_; _Decorative wheat stems and natural elements in upper displa…_; _White storage drawers beneath the main display cabinet_
- overview: This beautifully lit display cabinet showcases personal care products in a retail-inspired way, with clear sections for refills and foaming products. The white shelving and LED lighting cre…

**Retail Bath & Body Product Display** — `nrX9NKJTy1wk36GGcu9f` — adamharrison4506@gmail.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Retail Bath & Body Product Display`
- source plan: `nrX9NKJTy1wk36GGcu9f` · date `Jul 25, 2026` · schemaVersion `1` · photo yes
- items found: _Multiple Bath & Body Works candle/body care products in col…_; _Row of concentrated room spray bottles on top shelf_; _Bath & Body Works single-wick candles or body care items in…_; _Blue-labeled Bath & Body Works items (possibly hand soaps o…_; _Sale signage visible in upper left corner (2 for $16 promot…_
- overview: This is a beautifully merchandised retail shelf featuring Bath & Body Works products, concentrated room sprays, and various body care items arranged in a visually appealing way. The display…

**Corner Shelf Display** — `WFRE91xNSpXcXCOAYg2g` — cgignqc28@yahoo.com

- **Why ambiguous:** No room vocabulary present; the name describes a zone or object without indicating which room contains it.
- `spaceType` (the AI's own label): `Corner Shelf Display`
- source plan: `WFRE91xNSpXcXCOAYg2g` · date `Jul 16, 2026` · schemaVersion `(absent)` · photo yes
- items found: _Books stacked horizontally and vertically_; _Decorative glass globe or snow globe_; _Yellow/green coffee mug_; _Owl artwork or photograph_; _Reed diffuser_; _Small framed sign_
- overview: This beautiful wavy corner shelf unit adds character to your space but could benefit from more intentional styling and organization. The mix of books, decorative items, and personal touches…


## Internal / test accounts

| User | Current Space Name | Space ID | Plans | Class | Proposed Parent Room | Proposed Area Name | Conf | Why |
|---|---|---|---|---|---|---|---|---|
| michael@earthwiseenergy.n… | Home Office | `py8SbeVMQW` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| michael@earthwiseenergy.n… | Living Room | `1HwEwc27GA` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| michael@earthwiseenergy.n… | Living Room | `5lWU3mwPu6` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| michael@earthwiseenergy.n… | Living Room | `P511XWzW9A` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| mike.rhinstalls@gmail.com | Entryway | `ucmq1mcwRN` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| mike.rhinstalls@gmail.com | Home Office | `XvV6U4h5Nf` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| reviewer@uncluttrd.app | Bathroom | `8d5RexpOX1` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| reviewer@uncluttrd.app | Bathroom | `WuuCcg0E1y` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| reviewer@uncluttrd.app | Living Room | `IM2qtnIV2o` | 1 | ROOM | — | — | High | Exact whole-room noun with no sub-zone qualifier. |
| michael@earthwiseenergy.n… | Home Office Corner | `l7uRwWgNi2` | 1 | AREA | Home Office | Corner | High | Names a sub-zone/fixture ("Corner") qualified by a room ("Home Office"). |
| michael@earthwiseenergy.n… | Home Office Desk | `ceIIuNRAcW` | 1 | AREA | Home Office | Desk | High | Names a sub-zone/fixture ("Desk") qualified by a room ("Home Office"). |
| michael@earthwiseenergy.n… | Home Office Desk Setup | `WLy4oR8x6V` | 1 | AREA | Home Office | Desk Setup | High | Names a sub-zone/fixture ("Desk Setup") qualified by a room ("Home Office"). |
| michael@earthwiseenergy.n… | Home Office Workspace | `e2DZUouLW5` | 1 | AREA | Home Office | Workspace | High | Names a sub-zone/fixture ("Workspace") qualified by a room ("Home Office"). |
| michael@earthwiseenergy.n… | Home Office Workstation | `f1j65OmClO` | 1 | AREA | Home Office | Workstation | High | Names a sub-zone/fixture ("Workstation") qualified by a room ("Home Office"). |
| michael@earthwiseenergy.n… | Home Office Workstation | `jEkiOAEDqS` | 1 | AREA | Home Office | Workstation | High | Names a sub-zone/fixture ("Workstation") qualified by a room ("Home Office"). |
| michael@earthwiseenergy.n… | Living Room Corner | `O9qcABhRvR` | 1 | AREA | Living Room | Corner | High | Names a sub-zone/fixture ("Corner") qualified by a room ("Living Room"). |
| michael@earthwiseenergy.n… | Living Room Media Center | `1mGS5EolBI` | 1 | AREA | Living Room | Media Center | High | Names a sub-zone/fixture ("Media Center") qualified by a room ("Living Room"). |
| michael@earthwiseenergy.n… | Multi-Monitor Home Office Desk | `etF1AIYmFv` | 1 | AREA | Home Office | Multi-Monitor Desk | High | Names a sub-zone/fixture ("Multi-Monitor Desk") qualified by a room ("Home Office"). |
| mike.rhinstalls@gmail.com | Creative Home Office | `4OhDBsVaBN` | 1 | AREA | Home Office | Creative | High | Names a sub-zone/fixture ("Creative") qualified by a room ("Home Office"). |
| mike.rhinstalls@gmail.com | Home Office Workstation | `wSTqPzwNLE` | 1 | AREA | Home Office | Workstation | High | Names a sub-zone/fixture ("Workstation") qualified by a room ("Home Office"). |
| mike.rhinstalls@gmail.com | Two-Story Entry & Living Area | `RW3mFV4SVM` | 1 | AREA | Entryway | Two-Story Entry & Living Area | High | Names a sub-zone/fixture ("Two-Story Entry & Living Area") qualified by a room ("Entryway"). |
| reviewer@uncluttrd.app | Living Room Corner | `RcCXie81dY` | 1 | AREA | Living Room | Corner | High | Names a sub-zone/fixture ("Corner") qualified by a room ("Living Room"). |
| michael@earthwiseenergy.n… | Bathroom Cabinet Under Sink | `S24dU1V6oO` | 1 | AREA | **CREATE ROOM: Bathroom** | Cabinet Under Sink | Medium | Names a sub-zone/fixture ("Cabinet Under Sink") qualified by a room ("Bathroom"). |
| michael@earthwiseenergy.n… | Bathroom Cabinet Under Sink | `iXWMCT5owX` | 1 | AREA | **CREATE ROOM: Bathroom** | Cabinet Under Sink | Medium | Names a sub-zone/fixture ("Cabinet Under Sink") qualified by a room ("Bathroom"). |
| michael@earthwiseenergy.n… | Bedroom Bookshelf & Display Unit | `odpchwU2kO` | 1 | AREA | **CREATE ROOM: Bedroom** | Bookshelf & Display Unit | Medium | Names a sub-zone/fixture ("Bookshelf & Display Unit") qualified by a room ("Bedroom"). |
| michael@earthwiseenergy.n… | Commercial Restroom | `6zTNMjTGn9` | 1 | AREA | **CREATE ROOM: Bathroom** | Commercial Restroom | Medium | Names a sub-zone/fixture ("Commercial Restroom") qualified by a room ("Bathroom"). |
| michael@earthwiseenergy.n… | Overwhelmed Closet/Dressing Area | `cDFMNpDLMc` | 1 | AREA | **CREATE ROOM: Bedroom** | Overwhelmed Closet/Dressing Area | Medium | Names a sub-zone/fixture ("Overwhelmed Closet/Dressing Area") qualified by a room ("Bedroom"). |
| mike.rhinstalls@gmail.com | Bathroom Cabinet Under Sink | `pF630R2RkN` | 1 | AREA | **CREATE ROOM: Bathroom** | Cabinet Under Sink | Medium | Names a sub-zone/fixture ("Cabinet Under Sink") qualified by a room ("Bathroom"). |
| mike.rhinstalls@gmail.com | Bedroom Closet | `aS0sX8kL92` | 1 | AREA | **CREATE ROOM: Bedroom** | Closet | Medium | Names a sub-zone/fixture ("Closet") qualified by a room ("Bedroom"). |
| mike.rhinstalls@gmail.com | Cozy Living Room Nook | `BBJ181Gbtd` | 1 | AREA | **CREATE ROOM: Living Room** | Cozy Nook | Medium | Names a sub-zone/fixture ("Cozy Nook") qualified by a room ("Living Room"). |
| mike.rhinstalls@gmail.com | Overflowing Walk-In Closet | `O1MlruWI5l` | 1 | AREA | **CREATE ROOM: Bedroom** | Overflowing Walk-In Closet | Medium | Names a sub-zone/fixture ("Overflowing Walk-In Closet") qualified by a room ("Bedroom"). |
| reviewer@uncluttrd.app | Exterior Front Yard & Entry | `TlaYhYisMw` | 1 | AREA | **CREATE ROOM: Entryway** | Exterior Front Yard & Entry | Medium | Names a sub-zone/fixture ("Exterior Front Yard & Entry") qualified by a room ("Entryway"). |
| michael@earthwiseenergy.n… | Home Office / Desk Setup | `19yMlaMNdS` | 1 | AMBIGUOUS | Home Office | Desk Setup | — | Name encodes two alternatives ("Home Office / Desk Setup"), so it may be one room, a room serving two functions, or the AI hedgin… |
| michael@earthwiseenergy.n… | Living Room Entryway | `kYMmSxSdUe` | 1 | AMBIGUOUS | Living Room | Entryway | — | Name matches more than one room vocabulary, so the parent cannot be inferred from the string alone. |
| michael@earthwiseenergy.n… | Restaurant Service Station | `3SoZEqkzWI` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Basement Storage Area | `PbKFk0U7s2` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Basement Storage Area | `uZ2M9Klhdl` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Bathroom Vanity & Countertop | `nIw7yPXgSq` | 1 | AMBIGUOUS | **CREATE ROOM: Bathroom** | Vanity & Countertop | — | Name matches more than one room vocabulary, so the parent cannot be inferred from the string alone. |
| mike.rhinstalls@gmail.com | Desk Drawer & Counter Workspace | `dXw5g2fDRL` | 1 | AMBIGUOUS | **CREATE ROOM: Kitchen** | Desk Drawer & Counter Workspace | — | Name matches more than one room vocabulary, so the parent cannot be inferred from the string alone. |
| mike.rhinstalls@gmail.com | Front Yard & Home Exterior | `6HwnsAHiOL` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Home Bar Display | `nrwlgwAocW` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Kitchen Island Workspace | `e9Zll17P9b` | 1 | AMBIGUOUS | **CREATE ROOM: Kitchen** | Island Workspace | — | Name matches more than one room vocabulary, so the parent cannot be inferred from the string alone. |
| mike.rhinstalls@gmail.com | Outdoor Fire Pit Area | `xkISM7hCgB` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Outdoor Patio Dining Area | `0GC3b75YDz` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Restaurant Bar Area | `QPAT0hOjFc` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| mike.rhinstalls@gmail.com | Sunroom / Enclosed Porch | `iOPu1PimeW` | 1 | AMBIGUOUS | — | — | — | Name encodes two alternatives ("Sunroom / Enclosed Porch"), so it may be one room, a room serving two functions, or the AI hedgin… |
| reviewer@uncluttrd.app | Bar/Beverage Station | `BKLPqpoBFu` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| reviewer@uncluttrd.app | Community Entrance Landscaping | `qWUzjlCreU` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |
| reviewer@uncluttrd.app | Front Yard & Home Exterior | `doDJwZeegB` | 1 | AMBIGUOUS | — | — | — | No room vocabulary present; the name describes a zone or object without indicating which room contains it. |

---

## Summary and what I would and would not automate

| | Real users | Internal/test |
|---|---:|---:|
| ROOM | 2 | 9 |
| AREA | 8 | 23 |
| AMBIGUOUS | 12 | 17 |
| **Total** | **22** | **49** |

**Of the 8 real-user AREA rows, 0 have an existing parent Room.** Every one is
`CREATE ROOM`. There is no case among real users where consolidation is purely
mechanical.

### The retail account is a categorical problem, not a naming one

`adamharrison4506@gmail.com` accounts for **7 of the 12** real-user ambiguous
rows, and the `overview`/`itemsFound` text makes the reason plain — this is a
commercial beauty/candle retail store: *"promotional poster with 'FRUIT FUSION'
branding"*, *"celebrity endorsement banner with Hilary Duff"*, *"Halloween
promotion window signage"*, *"World's Best Candle"*.

These are not mis-slotted domestic Areas. There is no "Bathroom" or "Bedroom"
to parent them under, and inventing one would be wrong in a way the user would
notice immediately. Their one genuinely domestic Space, *"Bedroom Corner
Storage Area"*, is the exception.

**Recommendation: exclude this account from automated migration entirely** and
let Needs Review handle it, or leave it alone.

### What is safe to automate

Nothing in the Room/Area dimension, for real users. Every AREA row needs a Room
created, and creating Rooms on someone's behalf from a single photo label is a
product decision, not a data fix.

What *is* safe is the non-judgemental backfill already identified in
`ProductionLegacyDataAudit.md` — `sessionScope` classification and
`canonicalSpaceId` linkage. Neither touches Room/Area identity.

### The two rows I would resolve automatically if forced

- `evangorke@gmail.com` — *"Living Room / Multi-Purpose Space"* alongside an
  existing *"Living Room"* Space. The overview (*"a well-loved living space
  currently serving many purposes"*) supports treating it as the same Living
  Room. This is the one plausible merge in the entire real-user set — and note
  it is a **merge**, not an Area extraction.
- `cgignqc28@yahoo.com` — *"Under-Sink Bathroom Storage"* and *"Bathroom Linen
  Cabinet"* both clearly belong to one created *Bathroom*. Two Areas, one new
  Room, internally consistent.

Everything else I would put in front of the user.

---

## What was not done

No production data was read-modified-written. No migration script was run. The
50% rollout, the production `isPro` rule, and all Cloud Functions are untouched.
