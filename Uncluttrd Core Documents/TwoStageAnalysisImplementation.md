# Two-Stage Analysis (Implementation Report)

Companion to `TwoStageAnalysisDesign.md`, which carries the state machine
and the two architecture decisions with their evidence. This document
records what was built, what was measured, and what did not meet target.

Branch `feature/companion`. Client change (OTA) plus one new Cloud Function.

---

## 1. What was built

**Prompts.** The 12 instruction blocks were hoisted from inside `analyze()`
to module scope so both prompts compose from one source, and
`roomAreaInstruction` with them. Done by script, not by hand — they are
~24k characters of single-line template literals and retyping them is
exactly how drift gets introduced. `vizAndSpendInstruction` was split into
its three real concerns. Two builders: `buildSummaryPrompt()` (17,467 chars,
down from 26,067) and `buildDetailPrompt(summary)` (21,626 chars).

**Cloud Function.** `analyzePhotoDetail` — text-only, auth required,
plan-ownership verified, `timeoutSeconds: 300`, `max_tokens: 6000`. Returns
`{ text, stopReason, outputTokens }`; the token count is returned
specifically so latency work has a real denominator.

**Client.** `analysisStage` written by `savePlanToHistory` (the single plan
write site, which `createReturningPlan` also routes through);
`planAnalysisStage()`; `runDetailCall()` with `detailInFlightRef`;
auto-resume effect; three-state Results rendering; retry inside the expanded
card.

**Signal change.** `finalizeAnalysisResult`'s `validBatch` check read
`approaches.simple.taskChecklist`, which Call 1 no longer produces. It now
checks for a strategy per approach (`summary_shown` / `summary_incomplete`);
the checklist's own event belongs with Call 2, where the checklist arrives.

---

## 2. Measured performance — 3 photos, deployed functions

Prompts extracted from `App.js`; both calls through the real staging
endpoints. Writes on a scratch uid, wiped afterwards; the user's plans were
read only, for their photos.

| Photo | Call 1 | Call 2 | Total | Call 2 tokens | stop_reason |
|---|---|---|---|---|---|
| dining-room | **33.9s** (6,569 ch) | 47.7s (10,961 ch) | 81.6s | 2,592 | `end_turn` |
| kitchen-diner | **30.7s** (5,609 ch) | 49.1s (11,111 ch) | 79.8s | 2,645 | `end_turn` |
| living-room | **34.7s** (6,168 ch) | 51.4s (10,714 ch) | 86.1s | 2,492 | `end_turn` |
| **mean** | **33.1s** | 49.4s | 82.5s | 2,576 | all `end_turn` |

### Call 1 does not meet the <30s target

**Mean 33.1s, range 30.7–34.7s.** The target was <30s and it is missed on
all three photos, by about 10%. Reported rather than rounded away.

Time-to-Results still improves from ~76s to ~33s — a **57% reduction** in
what the user actually waits for — but the stated bar was not cleared.

The remaining Call 1 cost is its own output: 5.6–6.6k characters, dominated
by `itemsFound` (up to 15 entries) and `problemsFound`. Two levers exist,
neither taken here because both trade something real:

- `roomReason` / `areaReason` are **evaluation-only** — logged to the dev
  buffer and never persisted or read again. Dropping them is free output
  savings and costs prompt-tuning visibility.
- Capping `itemsFound` would cut output directly, but that array *is* Call
  2's entire evidence base now (§4 of the design), so trimming it degrades
  detail grounding.

**Total wall-clock is slightly worse** — 82.5s mean versus the 74–78s
single-call baseline — because two calls each pay their own latency. That
is the accepted trade, not an unnoticed regression.

Call 2 at ~49s is comfortably inside the window before a user could commit
to an approach: it starts when Results appears, and reading three collapsed
cards takes longer than that.

---

## 3. Quality — no degradation from splitting

Across all three photos:

| Check | Result |
|---|---|
| Contradictions (Call 2 returning any established field) | **0** |
| `relatedProblemIds` not in Call 1's `problemsFound` | **0** |
| Ungrounded recommendations (no ids, no grounding) | **0** |
| `stop_reason` | `end_turn` on all three |
| Uncertain items still hedged in Call 2's output | yes, all 8 across the three photos |
| `suggestedAdditionTypes` not covered by a recommendation | 2 of 31, both on one photo |

The uncertain-item firewall holding across the boundary is the result worth
noting. Call 2 never sees the photo, so its only source for those items is
Call 1's hedged text — and phrases like *"large flat rectangular item on the
table, possibly a tray or board"* survived into the detail intact rather
than resolving into a confident noun. The split did not create a laundering
opportunity; if anything it closed one.

Two `suggestedAdditionTypes` ("coasters", "decorative objects") did not map
to a recommendation. That is the *permitted* behaviour — the prompt says to
omit rather than invent a justification — but it means the collapsed card
can preview a category the expanded card then doesn't carry. Minor, and
recorded rather than hidden.

---

## 4. Test coverage — what was and was not verified

Runtime-verified against deployed staging (a, c, h, i, k, l, m, n):

- **(a)** Call 1 produces a valid summary plan — 3/3, though at 33.1s not <30s.
- **(c)** Call 2 completes and merges — 3/3, `end_turn`, merge asserted field-by-field.
- **(h)** Call 2 consistent with Call 1 — zero contradictions across 8 forbidden fields × 3 approaches × 3 photos.
- **(i)** Uncertain items stay uncertain — 8/8.
- **(k)** Performance across 3 photos — table above.
- **(l)** No duplicate plans — structural: `runDetailCall` contains no create path; retry re-runs the same `updateDoc`.
- **(m)** Stage transitions — `summary-ready` written at save, `complete` written by the merge; legacy plans resolve to `complete`.
- **(n)** Evidence rule holds in Call 2 — zero ungrounded, zero invented ids; the rule ships in *both* prompts.

**Code-verified only** (b, d, e, f, g, j) — no emulator or device is
available in this environment, and these are render-layer and lifecycle
claims:

- **(b)** Results renders after Call 1 — the collapsed card falls back to
  `suggestedAdditionTypes`, so it renders identically in both stages.
- **(d)** Transition without reload — the merge calls `setResults` on the
  mounted screen; no navigation occurs.
- **(e)** "Start with X" only after completion — structural: it lives inside
  the `stage !== "summary-ready"` branch.
- **(f)** Failure shows retry, collapsed cards still work — the failure path
  writes nothing, so the plan stays `summary-ready`.
- **(g)** Auto-resume on reopen — effect fires whenever Results shows a
  `summary-ready` plan.
- **(j)** Old plans unchanged — `planAnalysisStage` resolves absence to
  `complete`; the legacy branch is the untouched original JSX.

Metro production export clean.

---

## 5. What was deliberately not kept

The single-call path is **gone**, not retained as a fallback. `analyze()`
now issues only the summary call. No failure mode was found that requires
the 74–78s legacy path: Call 2 failing leaves a usable plan and a retry, and
that is a strictly better outcome than a second 78-second attempt at the
whole thing.

---

## 6. Risks and follow-ups

- **Call 1 at 33s misses its target.** The `roomReason`/`areaReason` lever
  is the cheapest next step.
- **Optional-enhancement grounding is unproven without the photo.** No test
  photo produced one. If a space ever needs a recommendation that solves no
  named problem, Call 2 can only cite what Call 1 recorded.
- **Two calls, two failure surfaces.** Mitigated by the durable state, but
  the detail call is now a thing that can be quietly failing for a subset of
  users. `analysis_detail_failed` is logged with reason and retry flag.
- **Not device-verified.** The six render/lifecycle tests above.

---

## 7. Addendum — Call 1 output optimization (2026-08-12)

### Field audit

Every field Call 1 generates, checked against its actual consumers in code.
"Required before Results" means the Results screen cannot render correctly
without it. Percentages are measured from the three baseline responses.

| Field | Required before Results | Consumed by Room/Area confirmation | Persisted | % of output | Verdict |
|---|---|---|---|---|---|
| `itemsFound` | no | no | **yes** | 25.6% | **keep** — Call 2's entire evidence base, plus the visualization prompt |
| `approaches.*.strategyDescription` | **yes** | no | **yes** | 25.0% | **keep** — collapsed card |
| `problemsFound` | **yes** | no | **yes** | 15.4% | **keep** — `relatedProblemIds` link to it |
| `overview` | **yes** | no | **yes** | 6.9% | **keep** — "What we noticed" |
| `approaches.*.keyChanges` | **yes** | no | **yes** | 6.3% | **keep** — collapsed card |
| `proTip` | yes (renders on Results) | no | **yes** | 4.8% | **keep** — considered and rejected, see below |
| `approaches.*.suggestedAdditionTypes` | **yes** | no | **yes** | 3.5% | **keep** — collapsed card preview |
| `areaReason` | no | **no** | **no** | 2.7% | **REMOVE** |
| `roomReason` | no | **no** | **no** | 1.7% | **REMOVE** |
| `suggestedRoomName` | no | **yes** | yes (as `spaceType`) | 0.2% | **keep** |
| `areaScope` | no | **yes** | **yes** | 0.2% | **keep** |
| `scopeSize` | no | no | **yes** | 0.2% | **keep** — drives spend ranges |
| `suggestedAreaName` | no | **yes** | **yes** | 0.1% | **keep** |

### The two known candidates, confirmed

The Room/Area confirmation flow reads **only** `suggestedRoomName`,
`suggestedAreaName` and `areaScope`. `roomReason` and `areaReason` appear
nowhere in `shared/spaceMigration.js` — which is where
`routeRoomConfirmation` and both resolvers live — nowhere in `scripts/`, and
nowhere in `functions/`. In `App.js` they appeared in the prompt, in five
comments, and in **one** dev-only `dlog`. Never persisted, never rendered.

Was that logging worth the latency? No — though it turned out to be worth
less than expected, see below. **No other field is in the same category:**
every remaining one is either rendered, persisted, or read by Call 2.

**`proTip` was considered and rejected.** At 4.8% it is larger than both
removed fields combined, and it is not strictly required *before* Results —
it renders below the approach cards. Moving it to Call 2 would have saved
more than the removal did. It was left alone deliberately: it is real
content the user sees, relocating it would make it pop in late, and that is
exactly the "removing useful content to chase the number" the task warned
against.

### What was removed

1. The two keys from `SUMMARY_JSON_TAIL`.
2. The one sentence in `roomAreaInstruction` requiring the justifications to
   be written out.
3. The `dlog` reference.

**Not removed:** the three-question ordering and the self-consistency check
in `roomAreaInstruction` both stay. Only the requirement to *emit* the
justification is gone. That distinction mattered — writing a justification
can act as a reasoning forcing-function — so classification quality was
re-verified rather than assumed.

### Re-measurement, and why the first result was not the real one

| Photo | Pre-trim | Optimized run 1 | Optimized run 2 |
|---|---|---|---|
| dining-room | 33.9s | 32.5s | — |
| kitchen-diner | 30.7s | 29.4s | — |
| living-room | 34.7s | 29.7s | — |
| **mean** | **33.1s** | **30.5s** | **33.0s** |

Run 1 looked like a 2.6s win. **Run 2 of the identical prompt came back at
33.0s** — indistinguishable from pre-trim. Run-to-run variance dominates a
change this size, which is unsurprising once the field audit is read: the
removed fields were 4.4% of output, and measured response size fell 6.5%
(5,217 → 4,880 chars) in run 1 and not at all in run 2 (5,236 chars).

Pooling both optimized runs gives **~31.8s** against 33.1s — about 1.4s,
consistent with the output reduction and well inside the noise band of a
three-photo sample.

**Verdict against the acceptance criteria: this is the "mean barely
changes" case. The removed fields were not the bottleneck. Shipped anyway,
because less output is strictly better and the fields were dead — and
optimization stops here.**

### Quality re-verified

- `stop_reason: end_turn` on all six runs.
- **Room, `areaScope` and `scopeSize` identical to the pre-trim run on all
  three photos, in both runs.** Removing the written justification did not
  cost classification accuracy.
- Neither removed field appeared in any response.
- `strategyDescription` briefly looked shorter in run 1 (248 vs 507 chars on
  one photo). Run 2 came back at 270–593, at or above pre-trim. That was
  variance, not degradation — recorded because "did I damage the protected
  content?" is not a question to answer from one sample.
- `keyChanges` counts unchanged at 3–4 per approach.

### Deployment note

**No Cloud Function change was needed.** The prompt is built client-side and
passed to `analyzePhoto` as request data, so this pass touches `App.js` only
and ships by OTA. `functions/` is byte-identical to the previous deploy.
