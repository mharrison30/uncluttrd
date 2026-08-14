# CJ Identity Audit — CID vs PID

**Run 2026-08-14 against the live CJ schema with the authenticated PAT.**
Read-only. No production or staging code touched.

## Verdict

**The identity hypothesis is half right, and the half that is right does not
explain anything.**

- **`companyId` was correct.** `8001435` is proven to be our publisher Company
  ID. It was not confused with anything.
- **`pid` was wrong.** We passed the CID as the `pid` argument to `linkCode`.
  `pid` is a *Promotional Property ID* (Website ID) — a different identifier.
- **But `pid` cannot explain the DHgate result.** It appears in exactly one
  place in the entire schema: as an argument to `Shopping.linkCode`. It plays no
  role in product retrieval or in `partnerStatus`. Re-running the diagnostic
  with no `pid` anywhere in the query returns identical numbers.

So the DHgate finding stands unchanged. **Outcome D still holds**, and the
blocker is not an identifier mix-up.

---

## 1. Publisher CID associated with the token

**`8001435`** — confirmed a **publisher** company, not an advertiser company.

Three independent probes on `commissions.api.cj.com`:

```
publisherCommissions(forPublishers: ["8001435"])   -> count=0        ACCEPTED
advertiserCommissions(forAdvertisers: ["8001435"]) -> ERROR "Only registered
                                                      advertiser users may run
                                                      advertiserCommissions query"
publisherCommissions(forPublishers: ["9999999"])   -> ERROR "No authorized
                                                      publisher ids were specified"
publisherCommissions(forPublishers: ["3992613"])   -> ERROR (same)   [DHgate]
```

The first call is accepted and returns data; the advertiser-side equivalent is
refused outright. That is a clean discriminator: **the token authenticates a
publisher, and `8001435` is that publisher's ID.**

Corroborated on `ads.api.cj.com`, where `companyId` is enforced:

```
companyId = 8001435  -> works
companyId = 9999999  -> ERROR "User is not authorized to query on behalf of companyId 9999999."
companyId = 7654321  -> ERROR (same)
companyId = 3992613  -> ERROR (same)   [DHgate]
```

**This PAT is authorized for exactly one publisher CID.** Tested by exploiting
the fact that `forPublishers` filters to the authorized subset rather than
failing on partial matches:

```
forPublishers: ["8001435"]            -> count=0   (authorized)
forPublishers: ["8001435","9999999"]  -> count=0   (silently drops the bogus one)
forPublishers: ["9999999","8888888"]  -> ERROR "No authorized publisher ids"
forPublishers: []                     -> ERROR "No authorized publisher ids"
```

There is no second publisher account hiding behind this token.

---

## 2. All PIDs / Website IDs under that publisher

**Cannot be enumerated through the API. No such surface exists.**

This was checked exhaustively, not assumed:

| Endpoint | Root queries | Identity surface? |
|---|---:|---|
| `ads.api.cj.com` | 10 | None. All are product/feed queries (`products`, `shoppingProducts`, `travelExperienceProducts`, the three `*FromApplication` variants, `shoppingProductFeeds`, `productFeeds`, `financeProducts`, `financeCreditCardProducts`) |
| `commissions.api.cj.com` | 2 | `publisherCommissions`, `advertiserCommissions` only |
| `linksearch.api.cj.com` | — | 404, host does not exist |
| `members.api.cj.com` | — | DNS failure, host does not exist |

Of 81 types on the ads schema, only three are identity-adjacent — `LinkCode`,
`LinkType`, `PartnerStatus` — and none enumerates properties. Of 19 types on the
commissions schema, `websiteId` and `websiteName` appear **only as fields on a
commission record** (`PublisherCommission`, 47 fields).

That is a real path to recovering a PID — but it needs at least one commission
to read back from. We have none:

```
18 consecutive 30-day windows swept, 2025-02 through 2026-08
  total commissions: 0
  publisherIds recovered: (none)
  websiteIds  recovered: (none)
```

Which is expected: zero joined advertisers means zero clicks means zero
commissions. It is a chicken-and-egg dead end, not a bug.

**The PID must be read from `members.cj.com`** (Account → Websites, where each
property has a 7-digit Website/Property ID). There is no API alternative.

---

## 3. Which PID corresponds to Uncluttrd

**Undeterminable from the API.** Same reason as §2 — no property enumeration
surface, and no commission records to read a `websiteId` from.

This requires the CJ dashboard.

---

## 4. The identifier currently being passed as `companyId`

**`8001435` — the publisher CID. Correct.**

Used as `companyId` on every `ads.api.cj.com` query throughout both the original
POC and the DHgate check. Verified above as valid, enforced, and publisher-side.

---

## 5. The PID being passed to `linkCode(pid:)`

**`8001435` — the same CID. This is wrong.**

The schema documents the argument explicitly:

```
Shopping.linkCode(pid: ID, shopperId: ID)
  pid: "Promotional property ID to use in link code"
  -> LinkCode { html: LinkType, clickUrl: String, imageUrl: String }
```

A *promotional property* is a registered website/app, not the company. Passing
the CID here was an error on my part, carried through every previous run.

**It changed nothing, and this was tested rather than reasoned about.**
`linkCode(pid:)` performs no validation on the argument at all:

```
pid = 8001435    -> joined=false  clickUrl=(empty)
pid = 1111111    -> joined=false  clickUrl=(empty)
pid = 0          -> joined=false  clickUrl=(empty)
pid = -1         -> joined=false  clickUrl=(empty)
pid = abcdefg    -> joined=false  clickUrl=(empty)
pid = 99999999   -> joined=false  clickUrl=(empty)
```

Every value — valid-looking, nonsensical, negative, non-numeric — returns the
same empty `clickUrl` with no error. **The empty affiliate link is driven by
`joinedStatus: false`, not by the PID.** A correct PID would produce the same
empty result today.

The practical consequence: the correct PID becomes *necessary* the moment a
joined advertiser exists, and it is not yet known. It is a real gap to close
before any implementation — just not the current blocker.

---

## 6. Does the DHgate relationship belong to the same publisher CID?

**Per the API: there is no DHgate relationship on this CID — nor any other
relationship.**

```
shoppingProducts(companyId: 8001435, partnerStatus: JOINED) -> totalCount = 0
```

Zero joined advertisers account-wide. Since §1 proves `8001435` is our publisher
ID and the only one this token can reach, the question resolves to: the DHgate
approval is **not visible on the publisher account this PAT authenticates.**

---

## Re-run of the DHgate diagnostic with `pid` removed entirely

The task asked for a re-run under the correct mapping. The `companyId` mapping
was already correct, and `pid` is provably irrelevant to these queries — so the
honest form of the re-run is to remove `pid` from the queries altogether:

| Query (no `pid` anywhere) | Result | Time |
|---|---:|---:|
| `shoppingProducts(partnerStatus: JOINED)` | **0** | 853 ms |
| `shoppingProducts(partnerIds: ["3992613"])` | **0** | 398 ms |
| `products(partnerIds: ["3992613"])` | **0** | 531 ms |
| `shoppingProducts(partnerIds: ["4683856"])` — Zoro control | **6,889,382** | 907 ms |

Identical to the previous run. **No number moved.**

---

## Where this leaves the DHgate question

You are right that propagation lag is now the weaker explanation — an approval
that has been in place "for some time" should have landed, and the identity
audit has removed the other technical explanation I was holding.

What survives, given the CID is proven correct and this token reaches exactly
one publisher account:

1. **The DHgate approval is on a different CJ publisher account** than
   `8001435` — e.g. a second account created at signup, or an approval granted
   against a different property/company than the one this PAT belongs to.
2. **The approval is active in the CJ dashboard but the relationship is not
   flowing into the Product Feed index** — a CJ-side data issue, not something
   observable or fixable from the API.

These are indistinguishable from the API, and I have exhausted what it can tell
us. Both are answered the same way, in the dashboard:

- In `members.cj.com`, confirm the **Company ID shown in the account header is
  `8001435`**. If it is a different number, the PAT and the DHgate approval
  belong to different accounts, and that is the whole answer.
- On the DHgate relationship, confirm status is **Joined/Active** (not
  *Pending*, *Approved-not-active*, or attached to a property that was later
  removed).
- While there, record the **Website/Property ID** under Account → Websites. That
  is the value that belongs in `linkCode(pid:)`, and it should be stored as a
  separate `CJ_PID` alongside `CJ_CID` — they are not interchangeable, which is
  the durable lesson from this audit.

If the dashboard shows CID `8001435` with DHgate genuinely joined, the
discrepancy is CJ-side and worth a support ticket quoting these numbers:
`partnerStatus: JOINED` returns 0 while `shoppingProductFeeds` lists 12 live
DHgate feeds under advertiser 3992613 with same-day timestamps.

---

## Correction to the previous report

`CJDHgateFeedCheck.md` gave propagation lag as the leading explanation and
recommended a 24–48 hour re-test. Given that the approval is not recent, that
recommendation is superseded by the dashboard checks above. The measurements in
that document are unaffected — they were re-run here and are unchanged.
