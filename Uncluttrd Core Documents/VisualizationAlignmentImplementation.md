# Approach-Aware AI Visualization (Implementation Report)

Restores the visualization feature for schemaVersion 3 plans, which had
been structurally unreachable since the approach redesign. Also closes a
real security hole in the `generateVisualization` Cloud Function.

Branch `feature/companion`. Client change (OTA) plus one Cloud Function
deploy. PDF and share remain tier-shaped and are explicitly out of scope,
per the task — see §7.

---

## 1. What was wrong

The audit that preceded this work found the feature was not broken and not
hidden: it was **structurally dark**. Not one line of `generateVisualization`
had changed. What changed was the container. The button lived inside
`results.tiers?.map(...)`, and `savePlanToHistory` writes **no `tiers` key
at all** on a new-format plan — that absence is itself the schema
discriminator. So the map iterated nothing and the button rendered zero
times on every plan created since the redesign.

Two consequences made it worse than a missing button:

- The feature **degraded silently by plan age**. It worked on pre-redesign
  plans and was invisible on everything newer, with no message explaining
  the difference — while the paywall still sold "AI visualizations" and the
  FAQ still gave instructions for a control that no longer appeared.
- Every approach carried an AI-written **`visualizationDirection`** — "one
  descriptive sentence describing what that approach's finished result
  should look like for this specific space" — generated on every plan,
  costing tokens, stored, and **read by nothing**. The redesign built the
  input for an approach-aware visualization and never wired the consumer.

---

## 2. Trigger, moved into the approach card

For a new-format plan the button now renders inside each **expanded**
approach card, below the product recommendations and above
"Start with {Approach} →". That position is deliberate: the visualization is
the last piece of evidence for the decision, not the decision itself, and
putting it after the commitment button would have made it read like a
post-commitment reward.

Each approach owns its own button, its own loading state, and its own
image. Generating Polished neither requires nor affects Simple or Elevated.

Pro gating is unchanged and shared: the same `if (!isPro) { setShowPaywall(true); return; }`
first line, the same `⭐ PRO` suffix on the button label.

**The old tier path is untouched.** Its call site is still the literal
`generateVisualization(t)` it always was — `generateVisualization` now
accepts *either* an old-format tier object or a `{ approachId, approach }`
descriptor and branches internally, which is what let the old rendering
path keep zero changes rather than "small, safe" ones.

---

## 3. The prompt

Two builders, one per format. Everything they genuinely share — the
architectural preservation clause and the photographic direction — lives in
one `VIZ_PROMPT_FRAME` object so the two cannot drift on the parts that are
the same requirement. `buildTierVizPrompt` was **extracted, not rewritten**:
evidence (f1) asserts byte-identity against the pre-change text.

`buildApproachVizPrompt` leads with `visualizationDirection`, because that
is the one field the analysis prompt wrote *for this purpose*, and it is
what makes three visualizations of one photo differ in ambition rather than
in tidiness. Then, in order:

| Element | Why it is there, and in that position |
|---|---|
| `"Transform this photo to show the {space} after implementing the '{Approach}' approach."` | Names the approach so the model has a stated target, not just a description |
| `visualizationDirection` | The primary instruction |
| Preservation clause | Same architecture, layout, finishes |
| `organizingGuidance` (first 4) | *Supporting* context, not a co-equal directive — guidance is written as advice to a person, and handing that to an image model verbatim produces literal-minded results |
| `productRecommendations` → **product types only** | The model needs to know a tray may appear, not how to shop for one |
| `itemsFound` | Without it the model empties the room instead of organizing it — the same reason the tier prompt carries it |
| Style + prohibitions | Shared frame |

Room/Area identity resolves through `spaceName` first (the Room's own
durable displayName, written from the Space, not from the AI), falling back
to `spaceType`/`suggestedRoomName`. A Room the user renamed "The Snug"
visualizes as the snug. An Area is rendered as a *qualifier*
(`"Dining Room (specifically the Credenza)"`), never as a replacement — the
model otherwise reframes around the sub-area and invents architecture
outside it.

`visualizationDirection` falls back to `strategyDescription` when absent, so
a plan written before that field existed still visualizes as **its** approach
rather than collapsing into a generic tidy-up.

---

## 4. Storage keyed by approachId

`vizImages.simple` / `.polished` / `.elevated`; old plans keep
`vizImages.{tierId}`. No migration — the two vocabularies never coexist on
one plan, since a plan has tiers or approaches and never both, so one flat
in-memory map (`vizImage`, `vizLoading`) serves both formats.

Independence is not a convention here, it is the write shape: persistence
uses the **dotted field path** `` `vizImages.${vizKey}` ``, so the other
approaches' images are never read, never rewritten, and never present in the
payload. "Generate Polished, then Elevated" is additive rather than
last-writer-wins on the map. Evidence (e) checks the stored document after
*each* of three sequential writes, not only at the end.

---

## 5. Cloud Function security

`generateVisualization` had **no auth check whatsoever**. The Pro gate lived
entirely in the client, so anyone holding the callable's URL could spend
this project's OpenAI image credits without an account, let alone a
subscription. Two gates now:

1. **`request.auth?.uid` required** → `unauthenticated` otherwise.
2. **Ownership.** The client now sends `planId`; the function requires it to
   resolve under *that caller's own* `users/{uid}/plans` subcollection →
   `permission-denied` otherwise. A signed-in user cannot visualize someone
   else's plan by id.

`planId` is null when the background save has not finished — a real and
common state when the user taps quickly — and that case falls back to the
authenticated-only gate rather than blocking a legitimate visualization.
The client surfaces `unauthenticated`/`permission-denied` as "Please sign in
again and retry" instead of the generic retry message.

Note the gate is **authentication and ownership, not entitlement**: the
function does not verify Pro status, because Pro state is not currently
readable server-side in a form this function can trust. This closes
anonymous abuse; a signed-in free user calling the raw endpoint is still
possible and is recorded in §7.

---

## 6. Copy

- **FAQ, visualization entry** — now: *"open any approach and tap 'See the
  transformation' to preview the result… Each approach has its own
  visualization, so you can generate one, several, or all three and compare
  them."*
- **FAQ, "What's the difference between the budget tiers?"** → **"…between
  the three approaches?"**, rewritten to describe Keep It Simple / Polished
  & Practical / Elevated Finish and to say plainly that they differ in
  ambition, not just price.
- **FAQ, "How does Uncluttrd work?"** — "three budget levels" → "three
  different approaches".
- **Results budget banner** — said *"Best Match highlighted below"* on every
  plan. That badge is rendered by `getBestMatch()` **inside the tier map**,
  which a new-format plan never enters, so the banner pointed at a badge
  that does not exist on the screen. Now branches on `results.approaches`.
- **Paywall** — verified, not changed: "AI visualizations" is present and
  accurate, with no tier language anywhere in the block.

Zero occurrences of "tier" remain in the FAQ (evidence i).

**One thing was deliberately not removed.** The Home screen's "CHOOSE YOUR
BUDGET LEVEL" selector and custom budget field are still live UI, so the FAQ
entry describing the budget field stays — deleting copy that explains a
visible control would have made the FAQ wrong in the other direction. See
§7: that control has a real problem, but it is not this task's.

---

## 7. Vestigial code and what was left alone

`vizImages: {}` is no longer written by `savePlanToHistory`. Every reader
already spells it `item.vizImages || {}`, and the dotted-path write creates
the map on demand, so the empty map carried no information and only made
"has this plan ever been visualized?" unanswerable without inspecting size.
The two admin mirrors (`scripts/runSpaceMigration.js`,
`functions/scripts/runSpaceMigration.js`) still write it; an empty map and
an absent field are behaviourally identical to every reader, so they were
left rather than taking deploy risk for no gain.

Tier-based rendering was **not** removed — old plans still need it.

Three things are out of scope but should not be lost:

1. **PDF and share are still tier-shaped.** `shareResults` iterates
   `results.tiers?.forEach` and the PDF builds from
   `pdfTiers = results.tiers || []`. Both produce plans with no content on
   new-format data. Explicitly deferred to a follow-up pass by the task;
   flagged here because a Pro user's "branded PDF" is in the same paywall
   list as the feature this document restores.
2. **The budget selector no longer influences anything.** The analysis
   prompt was rewritten in Approach Selection Phase A and does not receive
   `tier` or `budget` at all — the comment on `roomAreaInstruction` records
   that it "replaces the old per-tier budget-math… entirely". So Home still
   asks for a budget level that reaches neither the AI nor the output. The
   banner is now honest about what it does, but a live control that changes
   nothing is a product decision, not a copy fix.
3. **Entitlement enforcement** for the visualization endpoint (§5).

---

## 8. Staging evidence

Run against `cluttrd-staging`, through the **deployed** function.
**13 of 13 checks passed.**

Prompts were extracted from `App.js` itself and evaluated, so the run
exercises shipped text — a reimplementation would prove only that the
harness agrees with itself. Image generation went through the real callable
with a real Firebase ID token, so the auth gate under test is the one
serving traffic.

The user's own plans were **read only**. Writes landed on scratch uids
seeded with verbatim copies of two real plans (new-format Dining Room
`oROoygRSvV96oM2xBCVp`, old-format Living Room `Dn2YPgPdKSASkaDqDVt0`);
generating visualizations onto their real plans would have silently changed
what they see on Results. Scratch uids, their Storage objects (8), and their
Auth users were removed afterwards. Confirmed unchanged: 30 plans, 3
new-format, 1 carrying `vizImages`.

| # | Evidence | Result |
|---|---|---|
| a | Button inside each expanded approach card | **Code-verified** — see §9 |
| b | Generates using the approach's `visualizationDirection` | PASS — all three prompts embed their own direction verbatim and name their approach |
| c1 | The three prompts are distinct instructions | PASS — 1986 / 2195 / 2496 chars, all distinct |
| c2 | Generated images differ per approach | PASS — three distinct images, ~1.5 MB each |
| d | Stored at `vizImages.{approachId}` | PASS — keys `[elevated, polished, simple]` |
| e | One approach's generation does not affect others | PASS — checked after each of three sequential writes |
| f1 | Old-format tier prompt byte-identical to pre-change text | PASS — 1567 chars, exact match |
| f2 | Old-format tier visualization still generates and stores | PASS — `vizImages.premium` written |
| g1 | Unauthenticated call rejected | PASS — HTTP 401 `UNAUTHENTICATED` |
| g2 | Authenticated user cannot visualize a plan they don't own | PASS — HTTP 403 `PERMISSION_DENIED` |
| g3 | Missing image/prompt still rejected | PASS — HTTP 400 `INVALID_ARGUMENT` |
| h | Pro gating: badge + paywall on tap | **Code-verified** — see §9 |
| i | FAQ updated, no "tier" in user-facing FAQ text | PASS — 0 occurrences |
| i2 | Paywall lists AI visualizations, no tier language | PASS |
| j | `vizModal` shows the visualization for the approach being viewed | **Code-verified** — see §9 |
| k | Several approach visualizations coexist on one plan | PASS — three keys, three distinct URLs |

### (c) is the evidence worth looking at

File-size difference proves nothing about content, so the three images were
inspected. On the same Dining Room photo, with the same architecture
preserved in all three (doorway, framed owl picture, windows, exterior door,
flooring, chairs, table):

- **Keep It Simple** — nothing added. Cleared table, tidied credenza,
  original recessed lighting, blank wall left blank.
- **Polished & Practical** — one pendant light, one framed landscape on the
  blank wall, styled credenza (plant, barware, tray), a single vase on the
  table.
- **Elevated Finish** — statement chandelier, larger layered artwork, full
  credenza vignette with table lamp and glassware lit behind glass,
  centrepiece tray with candle.

That is the approach ladder the redesign describes — ambition, not
tidiness — and it is produced by `visualizationDirection` doing the work it
was written for. A generic cleanup prompt cannot produce this spread.

### A harness bug, found and fixed

(f1) failed on the first run. The cause was in the harness, not the app: the
prompt builders close over `results`, and the harness had loaded one builder
instance bound to the new-format plan and then used it to build the
old-format plan's prompt, so the closure read the wrong plan's `itemsFound`.
Bound correctly, the two strings are identical at 1567 characters with zero
differing characters. Worth recording because the same closure property is a
live trap for any future caller.

---

## 9. What was not verified on a device

No Android emulator or device is available in this environment. Evidence
(a), (h) and (j) are render-layer claims and are **code-verified only**:

- (a) the button is inside the `expanded && (…)` block of the approach card,
  between the recommendations block and the `!results.selectedApproach`
  commitment button;
- (h) the Pro branch is the first statement of `generateVisualization` and
  the `⭐ PRO` suffix is bound to the same `isPro`;
- (j) the thumbnail's `onPress` passes `vizImage[id]` for the card it is
  rendered in, so the modal necessarily shows that approach's image.

Everything else above is real Firestore reads and writes, real Storage
uploads, real ID tokens, and real OpenAI image generation. Metro production
export clean.

---

## 10. Deployment

- Cloud Function `generateVisualization` deployed to `cluttrd-staging`
  (Node 24, 2nd gen) — required for the auth fix; the client sends `planId`
  and would otherwise be sending a field nothing reads.
- Client shipped by OTA to the `staging` branch.

Commit `6bacd3c`:

| Platform | Runtime version | Update group | Update ID |
|---|---|---|---|
| Android | `c266213e8d2ef2dcba1adcae706e94c1a1495fb8` | `be67867f-13c0-4942-896c-dda34988fb2e` | `019ff28d-354a-73b3-a631-d8f2105a1b76` |
| iOS | `194c6294ae70b8bf34cd79c67f09187a2289a4a1` | `5b7d12e6-64cb-4d72-81ea-3979d023ddb1` | `019ff28d-354a-7029-83f5-38a20102bb00` |

The Cloud Function was deployed **before** the evidence run, so (g1)–(g3)
are observations of the live staging endpoint rather than of local source.
Whether any device has pulled the client update cannot be observed from
here — the IDs above are what EAS reports as published.

---

## Addendum — Evidence constraint on the image prompt (2026-08-11)

### Device confirmation of §9's code-verified items

Three visualizations were generated from a real device against the Dining
Room plan shortly after the OTA (Storage objects timestamped 20:48:10,
20:48:56 and 21:54:11), landing at `vizImages.simple`, `.elevated` and
`.polished` on the user's own plan. That is (a), (h), (j) and (k) observed
in the product rather than read off the source: the button rendered inside
expanded approach cards, generated per approach, and wrote three
independent keys. Those images were left in place.

### The problem

The visualizations were inventing ceiling pendants and chandeliers in a
room with no visible ceiling electrical infrastructure — the same failure
the evidence-constrained intervention rule already prevents in text.

Two diagnostic findings:

1. **The prompt was actively requesting them.** The stored
   `visualizationDirection` read *"a clear table illuminated by a stylish
   pendant light"* (Polished) and *"layered lighting from a statement
   chandelier"* (Elevated), and that field is the prompt's primary
   instruction. A third channel was also feeding fixtures in:
   `productRecommendations` contained *"Pendant light fixture or
   chandelier"* and *"Designer pendant light or chandelier with
   professional installation"*.
2. **There was no constraint at all.** `preserve` forbids *altering* the
   ceiling and says nothing about *mounting something new* to it — a
   direction naming a chandelier satisfies it completely.

That plan was created at `15:13Z`; the all-fields evidence rule (which does
name `visualizationDirection`) shipped at `17:05Z`, so it predates the fix.
No new-format plan has been created since, so **whether the current
analysis prompt still writes fixture requests into that field is unproven.**

### What was tried, and what the measurements said

Each variant was sampled on the real Dining Room photo. Compliance means no
ceiling-mounted fixture in the output.

| Variant | Polished | Elevated |
|---|---|---|
| The prohibition alone, as specified | 0/2 | 0/2 |
| + affirmative ceiling statement, + sanitizing all three input channels | 0/3 | 3/3 |
| + conditional outcome clause (final) | 2/2 | 2/2 |

**The prohibition alone did not work.** With it present as the final
instruction and the direction still asking for a pendant, the model
returned a pendant, and a crystal chandelier where one was named. An image
model resolves a contradiction in favour of the affirmative, concrete
request, and naming a fixture inside a negation makes it *more* likely to
appear. The only reliable way to not get a chandelier is to never ask for
one.

So `stripInfrastructureClaims` removes fixture requests from the three
channels that carry them — `visualizationDirection`, `organizingGuidance`,
and `productRecommendations` — at the point of use. It runs three passes,
because one clause routinely carries both something wanted and something
forbidden: *"a clear table illuminated by a stylish pendant light"* must
lose the pendant and keep the clear table. Pass 1 strips the verb phrase
(*"illuminated by …"*), pass 2 the bare prepositional form (*"with layered
lighting from …"*, which must run second or it would swallow the clear
table), pass 3 drops any whole clause still naming one.

`itemsFound` is deliberately **not** sanitized. On another plan it reads
*"recessed ceiling lights providing overhead illumination"* — that is an
observation of a fixture that is genuinely there, and telling the model
what already exists is how it knows what to preserve.

Sanitizing alone still left Polished at 0/3. What closed it was making the
constraint state an *outcome* conditional on the photo — *"If no hanging
light fixture is visible on the ceiling in the original photo, then no
hanging light fixture appears in the result and the space above the table
remains open and empty"* — which gives the model something to render rather
than only a concept to avoid.

### Honest limits

- 4/4 on the final build, on **one photo, one plan, two approaches**. This
  is a prompt-level mitigation against a strong model prior ("dining table
  → hanging light"), not a guarantee. Image generation is stochastic; a
  larger sample or a different room may still produce a fixture.
- Nothing verifies the output. A genuine guarantee needs a different
  mechanism — a masked/inpainting edit that locks the ceiling region, or a
  post-generation check — not a longer prompt.
- The upstream analysis prompt is untested against this, per above.
- Applied to the **approach prompt only**. The old-format tier prompt is
  asserted byte-identical to its pre-refactor text by evidence (f1), and
  changing what an old plan renders was not this fix's business. Extending
  it there is one line.

Client-only; no Cloud Function change, so this ships by OTA alone.
