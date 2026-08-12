# Two-Stage Analysis (Design)

Splits the single `analyzePhoto` call into a fast summary call and a
background detail call. This is a durable state machine, not a performance
hack: the intermediate state is a real, valid, renderable plan, and every
failure path resolves through it rather than around it.

---

## 1. Why now

The single call measured **74–78s** end to end, and it had just breached
`analyzePhoto`'s 60s timeout entirely — no new plan could be created on
staging until the timeout was raised. Measurement isolated the cost: with
the full 26k prompt but a one-line response the call returns in **1.8s**,
versus 2.0s for a trivial prompt. Prompt length is free; **generating the
three-approach JSON is the entire cost**. Trimming instructions would not
have helped. The only lever is generating less at once.

---

## 2. The state machine

```
photo → CALL 1 (summary) → plan saved, analysisStage: "summary-ready"
                         → Results renders (collapsed cards fully functional)
                         → CALL 2 (detail) starts
                         → merge into the SAME document
                         → analysisStage: "complete"
```

`analysisStage` is the machine's only durable field. It is written at the
moment a plan first exists — Call 1 returned, Room confirmed, document
complete and useful on its own.

**"summary-ready" is a valid resting state, not a half-written document.**
Collapsed cards work, Room/Area identity is settled, the Companion simply
has nothing to start yet. A plan that never reaches "complete" stays usable
rather than becoming garbage to reconcile.

| Event | Behaviour |
|---|---|
| Call 2 fails | Plan untouched at "summary-ready". Collapsed cards keep working. Expanded cards show a retry affordance. |
| App closes between calls | Plan is durable at "summary-ready". Reopening Results auto-resumes Call 2. |
| Retry | Reuses Call 1's stored output. No re-analysis, no photo re-upload. |
| Duplicate risk | `runDetailCall` only ever `updateDoc`s a planId handed to it. It has no code path that creates anything, so a duplicate plan is unrepresentable rather than merely unlikely. |

Three entry points (post-create, auto-resume, user retry) converge on one
function, guarded by `detailInFlightRef` — a Set of planIds rather than a
boolean, because two plans can legitimately be in flight at once.

Auto-resume deliberately does **not** re-fire after a failure in the same
session; the user gets an explicit retry instead, so a persistent failure
cannot become a silent request loop.

---

## 3. The prompt split

The 12 instruction blocks moved from inside `analyze()` to module scope, so
both prompts compose from one source. Nothing about the text changed in the
move, with one exception: `vizAndSpendInstruction` bundled three separate
concerns and became three constants — `visualizationDirectionInstruction`
and `spendCalibrationInstruction` (Call 2) and `proTipInstruction` (Call 1).
Their text is unchanged; only the boundaries between them are new.

| Block | Call 1 | Call 2 |
|---|---|---|
| scopeClassification, identification, opportunities, keyChanges, proTip, roomArea | ✓ | |
| suggestedAdditionTypes *(new)* | ✓ | |
| visionApproaches (strategy differentiation) | ✓ | |
| taskDifferentiation, product, visualizationDirection, spendCalibration | | ✓ |
| **certaintyFirewall, evidenceConstraint, prohibitions** | ✓ | ✓ |

The last row is the important one: the certainty firewall and the
evidence-constrained intervention rule run in **both** calls. They are the
two rules a split could most easily break, so neither call is without them.

`suggestedAdditionTypes` is new and exists solely to keep the collapsed
card's "Suggested additions" line identical in both stages — category nouns
only, no reasons or search terms. Generating grounded, problem-linked
recommendations is the single most expensive part of the response, and
moving it to Call 2 is most of why Call 1 is faster.

---

## 4. Decision: Call 2 does not get the photo

**Tested, not assumed.** Same established summary, same detail prompt, one
variable — whether the photograph is attached:

| | With photo | Without photo |
|---|---|---|
| Elapsed | 59.6s | 57.4s |
| Recommendations | 11 | 11 |
| Ids not in problemsFound | 0 | 0 |
| Ungrounded recommendations | 0 | 0 |
| Grounding unanchored in the established record | 0 | 0 |
| Uncertain items still hedged | yes | yes |

The two outputs proposed the *same five products* for the polished
approach, both referencing exactly the established items ("large flat white
rectangular item", "blank wall to the left of the doorway", "niche above the
doorway", "wood-look flooring"). The with-photo version was marginally more
specific in one task ("typically 8x10 for a round table"), which is generic
knowledge rather than visual grounding.

**Decision: text only.** Reasoning:

1. **The evidence is already in text.** Call 1's entire job is cataloguing
   what is visible; `itemsFound` and `problemsFound` *are* the visual record.
2. **Withholding the photo is the strongest possible enforcement** of "must
   not re-analyze" — stronger than any instruction, because the capability
   is absent rather than forbidden.
3. **Retry and resume become cheap and offline-friendly.** The spec requires
   retry with "no re-upload of photo"; a resume on reopen would otherwise
   have to re-download the image from Storage before it could even start.
4. No measurable quality cost, and ~2s faster.

The risk this accepts: an optional-enhancement `grounding` sentence can only
cite what Call 1 recorded. Neither variant produced one in testing, so that
capability is **unproven either way** — recorded here rather than claimed.

---

## 5. Decision: a separate Cloud Function

`analyzePhotoDetail`, not a mode flag on `analyzePhoto`. Three reasons, each
individually sufficient:

1. **Quota.** `analyzePhoto` decrements the free monthly allowance when
   `uid` + `analysisId` are present. Call 2 is the *same* analysis
   continuing, so routing it through that function would either charge the
   user twice for one photo or need a "don't count this one" flag — a flag
   that, sent wrongly, silently gives analyses away. Separation makes the
   miscount unrepresentable.
2. **Signature.** Call 2 sends no image; `analyzePhoto` requires one.
3. **Operations.** Different latency profiles, and different failure
   meanings: Call 1 failing means "no plan", Call 2 failing means "plan
   exists, detail pending". They should be separately monitorable.

Auth is required outright, with plan-ownership verification. Unlike
`analyzePhoto` there is no legacy App Store build calling it, so no
compatibility shim is needed.

---

## 6. Client states

| State | Collapsed cards | Expanded cards | "Start with X" |
|---|---|---|---|
| `summary-ready` | Fully functional | "Finishing the details…" or retry | Absent |
| `complete` | Fully functional | Full detail | Present |
| Legacy (no `analysisStage`) | Unchanged | Unchanged | Unchanged |

The transition is a state change on the already-mounted screen — the merge
updates `results` in place, so no reload occurs.

The Start button needs no separate guard: it lives inside the
`stage !== "summary-ready"` branch, so its absence in state 1 is structural.

---

## 7. Backward compatibility

`planAnalysisStage()` resolves absence to `"complete"`:

- no `approaches` → old tier-format plan → complete
- `approaches` but no `analysisStage` → pre-split approach plan → complete

Additive; no migration, no backfill.

---

## 8. The merge is enforced in code, not trusted to the prompt

Call 2's output is merged field-by-field: each approach keeps everything
Call 1 wrote and gains only the four detail fields. A Call 2 that returned a
contradictory `strategyDescription` **could not overwrite** the one the user
has already read. Spend ranges are recomputed from the *established*
`scopeSize`, never from anything Call 2 said.

---

## 9. Known trade-off

Total wall-clock is slightly **worse**: ~82s mean versus the 74–78s
single-call baseline, because two calls each pay their own latency. That is
the correct trade — time-to-Results is what the user experiences, and it
drops from ~76s to ~33s. It should be stated plainly rather than hidden
behind the improvement.
