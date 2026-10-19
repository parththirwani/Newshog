# Evaluation results

Status: checkpoint 7 in progress. Replay metrics are now separated into labeled relevance, accepted fetched evidence, and passage validation. Live generated-claim support remains unmeasured.

## Run metadata

| Field | Baseline | Candidate |
| --- | --- | --- |
| Date and `as_of` | 2026-10-20 / 2026-10-20 | Pending |
| Commit | `0b372d9` baseline | Pending checkpoint 5 |
| Search provider/version | Fixture pools; current DDG HTML + Bing HTML observed | DDG/Bing HTML+RSS, 2 queries each: DDG 0 parsed; Bing 10 parsed/query via RSS fallback; median DDG 164 ms, Bing 913 ms |
| Model/version | No paid LLM in replay | OpenRouter configured model, bounded live IAM run; 22,412 prompt + 4,978 completion tokens; provider price not available in trace |
| Benchmark revision | v1, 12 cases, 4 held out | v1 |
| Trace location | `plans/deep-research/traces/baseline-replay.json` | `plans/deep-research/traces/candidate-replay.json` |

Labels are manually inspected fixture labels, not a closed URL allowlist. Replay cost and latency are zero because it uses no provider or paid LLM calls; live costs/latency remain pending.

## Aggregate comparison

| Measure | Baseline | Candidate | Gate | Notes |
| --- | ---: | ---: | ---: | --- |
| Retrieval relevance precision at 5 (labeled evaluator only) | 0.40 held out | 0.50 production selector replay | >= 0.70 held out | Labels are used only to score selected candidates after production selection; this is not a production-visible signal. |
| Accepted fetched evidence at 5 | 0.35 | 0.45 | Report separately | Evidence accepted by production parser against fetched-fixture text; do not conflate with relevance. |
| Evidence-backed subquestion coverage | 0.208 | 0.208 | >= 0.80 or truthful gaps | Coverage is now based on subquestion token matches in accepted fixture passages, not source count. |
| Citation support | 1.00 fetched-fixture passage support | 1.00 fetched-fixture passage support | >= 0.95 sampled claims | Replay now uses the separate `fetched-fixtures.v1.json` corpus and fails closed when a passage is absent. This is passage validation, not generated-answer claim sampling. |
| Unsupported named journalists/material numbers | 0 | 0 | 0 | Fixture labels contain no unsupported accepted claims. |
| Bad-success runs | 2 | 2 | 0 | Negative cases expose the status defect. |
| Median/worst wall time | 0 / 0 ms replay | 0 / 0 ms replay | Report | Live timing pending. |
| Median/worst cost and tokens | $0 / $0; 0 / 0 | $0 / $0; 0 / 0 | Report | No provider calls. |

## Per-case results

Held-out baseline labeled relevance: `article-04` 0.40, `standalone-04` 0.60, `byline-02` 0.40, `negative-02` 0.00. Candidate labeled relevance: 0.80, 0.60, 0.40, 0.00. Accepted fetched evidence at five: baseline 0.35, candidate 0.45. Held-out evidence coverage is 0.208 for both runs under the current subquestion score.

## Failure review

- `article-04`: first-five baseline includes dictionary/calendar/IAM collisions; prototype ranking removes those and selects all five relevant fixture candidates. Production implementation is next.
- `standalone-04`: ranking does not improve the mixed first five; category context needs diversity/source-quality rules.
- `byline-02`: relevant stories coexist with unsupported people pages; production must require fetched relevant article bylines.
- `negative-02`: no relevant source exists; production must return an explicit evidence gap and must not mark the run completed.
- Reproduced unsupported excerpt: a gardening page plus an invented funding excerpt previously passed. The parser now requires the excerpt to occur in at least one fetched source text; regression test covers this exact failure.

## Final gate decision

The release gates remain active and the current candidate is not release-ready. The next checkpoint is intentionally open until the production replay and live comparison are complete.
- Benchmark exists with 12 labeled cases and four held out: PASS.
- Deterministic replay works and emits sanitized traces: PASS, now applying production ranking and evidence parsing. Fetched-fixture passage support is 1.00; generated-answer claim support remains unmeasured.
- Held-out retrieval relevance precision >= 0.70: FAIL — candidate 0.50 (baseline 0.40); accepted fetched evidence at five is 0.45 (baseline 0.35).
- Evidence-backed coverage >= 0.80 or truthful gaps: FAIL — production-selector replay is 0.208 under subquestion-level scoring; production now carries `scope`, `coveredScopes`, and `missingScopes` through extraction and outcomes, with deterministic integration coverage. Live quality still needs a rerun using the new ledger.
- Citation support >= 0.95: PASS for fetched-fixture passage validation; generated-answer claim sampling remains pending.
- Zero empty/zero-source completed runs: PASS in the production status path by `evidenceComplete`; not yet verified against a database integration run.
- Cancellation, SSRF, queue persistence, and existing suites: PASS per the workspace rerun (35 deep-research tests, 149 worker tests, 226 web tests). The previously reported `vi.hoisted` web-test blocker no longer reproduces.
- Build: PASS (`bun run build`). Lint: BLOCKED by existing interactive `next lint` configuration prompt under both normal and `CI=1` invocation; no lint result is claimed.
- Fixed-URL full evidence run: completed in 37,407 ms with 9,926 prompt and 3,396 completion tokens. Two fixed Oasis URLs produced 5 accepted scoped learnings, 2 accepted sources, `evidenceCoverage=1`, no missing scopes, `evidenceComplete=true`, and `lowConfidence=false`. Verification saw 10 factual sentences, repaired 3, removed 2. This demonstrates the production evidence path works when retrieval is constrained to known relevant URLs; it is not a broad retrieval quality result.
- `plans/deep-research/traces/` is generated replay output and remains untracked; it contains only public fixture metadata and no credentials.
- Provider attempt traces are now emitted as ordered `search.trace` events with provider, attempt, result count, failure reason, and latency; they are available to the existing event/audit pipeline but not yet persisted into replay traces.
- Research learnings now carry a scope, and final outcomes expose covered and missing scopes for per-thread evidence accounting.
- `packages/deep-research/evals/fetched-fixtures.v1.json` is a sanitized, public-passage corpus generated from the benchmark labels for deterministic excerpt-presence checks; it is not an independent web capture and cannot establish source correctness beyond the fixture text.

Checkpoint 7: NOT RELEASE-READY. Replay metrics are now correctly separated, the fixed-URL full evidence path passes, but broad retrieval still failed to produce accepted evidence. Next experiment: persist the broad run's ranked candidate list, fetch outcomes, and extraction rejection reasons, then improve candidate selection/query formulation against the fixed URLs without using their labels.