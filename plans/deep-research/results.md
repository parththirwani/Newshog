# Evaluation results

Status: checkpoint 4 evaluation completed. Deterministic replay is reproducible; production test/build checks are recorded below. Release gates remain unmet, so this is not a success claim.

## Run metadata

| Field | Baseline | Candidate |
| --- | --- | --- |
| Date and `as_of` | 2026-10-20 / 2026-10-20 | Pending |
| Commit | pre-checkpoint current main | Pending |
| Search provider/version | Fixture pools; current DDG HTML + Bing HTML observed | Pending |
| Model/version | No paid LLM in replay | Pending |
| Benchmark revision | v1, 12 cases, 4 held out | v1 |
| Trace location | `plans/deep-research/traces/baseline-replay.json` | `plans/deep-research/traces/candidate-replay.json` |

Labels are manually inspected fixture labels, not a closed URL allowlist. Replay cost and latency are zero because it uses no provider or paid LLM calls; live costs/latency remain pending.

## Aggregate comparison

| Measure | Baseline | Candidate | Gate | Notes |
| --- | ---: | ---: | ---: | --- |
| Retrieval precision at 5 | 0.40 held out | 0.50 prototype ranking replay | >= 0.70 held out | Gate not met; candidate is harness-only at this checkpoint. |
| Evidence-backed subquestion coverage | 0.75 | 0.75 | >= 0.80 or truthful gaps | Status rules not yet changed. |
| Citation support | 1.00 fixture passage support | 1.00 fixture passage support | >= 0.95 sampled claims | Not generated-answer judgment. |
| Unsupported named journalists/material numbers | 0 | 0 | 0 | Fixture labels contain no unsupported accepted claims. |
| Bad-success runs | 2 | 2 | 0 | Negative cases expose the status defect. |
| Median/worst wall time | 0 / 0 ms replay | 0 / 0 ms replay | Report | Live timing pending. |
| Median/worst cost and tokens | $0 / $0; 0 / 0 | $0 / $0; 0 / 0 | Report | No provider calls. |

## Per-case results

Held-out baseline precision: `article-04` 0.60, `standalone-04` 0.60, `byline-02` 0.40, `negative-02` 0.00. Candidate prototype ranking: 1.00, 0.60, 0.40, 0.00. The largest measured loss is retrieval selection/off-topic pollution, especially byline and negative cases. Full selected URL metadata is in both sanitized traces.

## Failure review

- `article-04`: first-five baseline includes dictionary/calendar/IAM collisions; prototype ranking removes those and selects all five relevant fixture candidates. Production implementation is next.
- `standalone-04`: ranking does not improve the mixed first five; category context needs diversity/source-quality rules.
- `byline-02`: relevant stories coexist with unsupported people pages; production must require fetched relevant article bylines.
- `negative-02`: no relevant source exists; production must return an explicit evidence gap and must not mark the run completed.

## Final gate decision

Checkpoint 1: PASS — 12 cases, labels, four held-out cases, sanitized traces, and deterministic replay command exist and run.

## Final gate decision

- Benchmark exists with 12 labeled cases and four held out: PASS.
- Deterministic replay works and emits sanitized traces: PASS.
- Held-out retrieval precision >= 0.70: FAIL — candidate 0.50 (baseline 0.40).
- Evidence-backed coverage >= 0.80 or truthful gaps: FAIL — replay 0.75; status code now records low confidence for zero accepted evidence, but full subquestion coverage measurement is not yet wired.
- Citation support >= 0.95: PASS only for fixture passage checks; no live generated-claim sample was run.
- Zero empty/zero-source completed runs: PASS in the production status path by `evidenceComplete`; not yet verified against a database integration run.
- Cancellation, SSRF, queue persistence, existing unit tests: PASS for the exercised deterministic suites; web route test invocation is incompatible with the repository's Bun/Vitest version (`vi.hoisted` unavailable).
- Build: PASS (`bun run build`). Lint: BLOCKED by existing interactive `next lint` configuration prompt under both normal and `CI=1` invocation; no lint result is claimed.
- Live provider/model cost and latency: BLOCKED for this evaluation. DDG/Bing HTML were probed; no paid OpenRouter benchmark was run. No cost or quality result is invented.

Checkpoint 4: NOT RELEASE-READY. The concrete next experiment is to add production search-attempt traces and a diversity-aware ranker, then run the same held-out cases with fetched fixtures and a separately versioned live opt-in subset. The current implementation and evidence are committed, but the task's all-gates success condition is not met.