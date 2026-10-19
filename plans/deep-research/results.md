# Evaluation results

Status: checkpoint 6 in progress. Bing RSS fallback now recovers parsed results when HTML is challenged; excerpt validation is fail-closed per cited source. Live quality remains unverified.

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
| Retrieval precision at 5 | 0.40 held out | 0.50 production selector replay | >= 0.70 held out | Candidate now calls `rankSearchResults` directly; fixture relevance labels are used only after selection for scoring. |
| Evidence-backed subquestion coverage | 0.208 | 0.208 | >= 0.80 or truthful gaps | Coverage is now based on subquestion token matches in accepted fixture passages, not source count. |
| Citation support | 1.00 fixture passage support | 1.00 fixture passage support | >= 0.95 sampled claims | Replay still has no synthesized claims; production excerpt validation is now tested. |
| Unsupported named journalists/material numbers | 0 | 0 | 0 | Fixture labels contain no unsupported accepted claims. |
| Bad-success runs | 2 | 2 | 0 | Negative cases expose the status defect. |
| Median/worst wall time | 0 / 0 ms replay | 0 / 0 ms replay | Report | Live timing pending. |
| Median/worst cost and tokens | $0 / $0; 0 / 0 | $0 / $0; 0 / 0 | Report | No provider calls. |

## Per-case results

Held-out baseline precision: `article-04` 0.60, `standalone-04` 0.60, `byline-02` 0.40, `negative-02` 0.00. Candidate production-selector replay: 1.00, 0.60, 0.40, 0.00. Held-out evidence coverage is 0.208 for both runs under the new subquestion-level score. The largest measured loss remains retrieval selection/off-topic pollution, followed by insufficient subquestion evidence.

## Failure review

- `article-04`: first-five baseline includes dictionary/calendar/IAM collisions; prototype ranking removes those and selects all five relevant fixture candidates. Production implementation is next.
- `standalone-04`: ranking does not improve the mixed first five; category context needs diversity/source-quality rules.
- `byline-02`: relevant stories coexist with unsupported people pages; production must require fetched relevant article bylines.
- `negative-02`: no relevant source exists; production must return an explicit evidence gap and must not mark the run completed.
- Reproduced unsupported excerpt: a gardening page plus an invented funding excerpt previously passed. The parser now requires the excerpt to occur in at least one fetched source text; regression test covers this exact failure.

## Final gate decision

The release gates remain active and the current candidate is not release-ready. The next checkpoint is intentionally open until the production replay and live comparison are complete.
- Benchmark exists with 12 labeled cases and four held out: PASS.
- Deterministic replay works and emits sanitized traces: PASS.
- Held-out retrieval precision >= 0.70: FAIL — candidate 0.50 (baseline 0.40).
- Evidence-backed coverage >= 0.80 or truthful gaps: FAIL — production-selector replay is 0.208 under subquestion-level scoring; status code now records low confidence for zero accepted evidence.
- Citation support >= 0.95: PASS only for fixture passage checks; no live generated-claim sample was run.
- Zero empty/zero-source completed runs: PASS in the production status path by `evidenceComplete`; not yet verified against a database integration run.
- Cancellation, SSRF, queue persistence, and existing suites: PASS per the workspace rerun (35 deep-research tests, 149 worker tests, 226 web tests). The previously reported `vi.hoisted` web-test blocker no longer reproduces.
- Build: PASS (`bun run build`). Lint: BLOCKED by existing interactive `next lint` configuration prompt under both normal and `CI=1` invocation; no lint result is claimed.
- Live provider/model cost and latency: provider comparison probe ran 2 topical queries through DDG and Bing. DDG produced 0 parsed results; Bing produced 10 parsed results per query through the RSS fallback, but the top results were mostly listicles/market pages. A bounded live IAM end-to-end run completed in 59,062 ms, used 22,412 prompt and 4,978 completion tokens, fetched 2 accepted sources, and returned a 1,374-character report. Verification removed 2 claims and flagged low confidence. Provider price was not available, so cost is unreported rather than estimated.
- `plans/deep-research/traces/` is generated replay output and remains untracked; it contains only public fixture metadata and no credentials.

Checkpoint 6: NOT RELEASE-READY. The Bing RSS fallback recovers sources and the bounded live IAM run completed, but the report was low-confidence, search relevance remained weak, and no independent provider comparison or claim-level live scoring was run. Next experiment: add trace persistence for provider attempts and run one independent-provider/live-source comparison with sampled claim support.