# Deep research quality rebuild: overnight agent brief

## Mission

Make Newshog's deep research return useful, current, source-backed evidence for its two real jobs: researching an article before scoring its PR opportunity, and answering a standalone research request. Diagnose retrieval, implement the smallest sound architecture that fixes the measured failures, and prove the change with repeatable evaluations. Work through the loop below until the exit gates pass or a concrete blocker is documented.

Read [requirements.md](requirements.md), [architecture.md](architecture.md), [evaluation.md](evaluation.md), and [deliverables.md](deliverables.md) before editing code. These files are the task contract. Record deviations and reasons in the decision log required by `deliverables.md`.

For a persistent Codex run, paste the prompt in [goal-prompt.md](goal-prompt.md) into `/goal` from the repository root.

## Starting evidence

- The current search layer scrapes DuckDuckGo HTML and falls back to Bing HTML: `packages/deep-research/src/Search.ts`.
- `Service.ts` takes the first five results per query without relevance ranking. It substitutes a snippet when scraping fails.
- `apps/worker/src/deep-analyze.ts` starts article research mainly from the headline and runs breadth 3, depth 2. Its coverage signal can count dated discovered URLs even if they did not support a finding.
- The existing smoke runner treats any nonempty answer as a pass. Its saved output includes a pass with zero sources.
- A live diagnostic on 2026-10-20 asked which IAM startups raised funding in 2026 and which journalists covered the rounds. Two plausible generated queries yielded 20 discovered URLs about dictionary definitions of identity or calendars. The run spent 37,415 prompt tokens, produced zero learnings, zero sources, and an empty answer. Another live check returned zero results for two topical queries.
- The 33 deep research unit tests pass. Most quality-critical integration paths use stubbed search and LLM responses.

Treat these as hypotheses and baseline observations, not a substitute for a new reproducible evaluation.

## Work loop

1. Establish a baseline with the evaluation set in `evaluation.md`. Save raw candidate metadata, selected sources, judgments, output, cost, and latency. Keep credentials and private content out of artifacts.
2. Identify the largest measured loss point: query formulation, search retrieval, candidate selection, fetch/extraction, evidence extraction, coverage, or final synthesis. Make one coherent change at a time.
3. Run deterministic tests, then the same live evaluation set. Compare against the baseline with the same scoring rules and record regressions, cost, and latency.
4. Inspect every failed case. Revise the design or implementation and repeat. Do not mark a run successful because it returned text or a citation.
5. Stop when the exit gates in `evaluation.md` pass, the required artifacts exist, and normal repo checks pass. If a gate remains unmet after a serious attempt, report the failed cases and the next specific experiment; do not silently lower the gate.

## Scope and order

1. Fix retrieval reliability and URL normalization. A zero-result or off-topic search should trigger a bounded retry with a different query or provider, then fail visibly if still empty.
2. Rank and filter candidates before full scrape and LLM extraction. Preserve why each source was chosen or rejected.
3. Ground extracted claims in fetched source text, not search snippets alone. Detect missing, stale, duplicate, and conflicting evidence.
4. Improve article-specific research context and the PR outputs that consume it. Evaluate standalone and article flows separately.
5. Add quality measurement and operational observability so future regressions are visible.

Do not spend the night polishing report prose while source relevance is broken. Do not deploy or change billing/quotas as part of this task. Keep the existing API and persisted run shape compatible unless a migration is necessary and tested.

## Code map

| Concern | Current location |
| --- | --- |
| Search providers and parsing | `packages/deep-research/src/Search.ts` |
| Retrieval, extraction, follow-ups, synthesis | `packages/deep-research/src/Service.ts` |
| Prompts and JSON parsing | `packages/deep-research/src/Prompts.ts`, `Json.ts` |
| Fetch and text extraction | `packages/deep-research/src/Scrape.ts` |
| Citation checks | `packages/deep-research/src/Verify.ts` |
| Article research and coverage signal | `apps/worker/src/deep-analyze.ts` |
| Standalone worker and persistence | `apps/worker/src/deep-research.ts` |
| Existing tests and smoke run | `packages/deep-research/src/__tests__/`, `apps/worker/src/deep-research-smoke.ts` |

## Decision authority

Choose the implementation using measured relevance, reliability, latency, and cost. A search API may need a new credential; inspect available configuration without printing secrets. If no usable provider credential is available, implement the provider interface and deterministic evaluation, use the best viable configured provider for the live trial, and document the exact blocked comparison. Never invent a quality result or commit credentials.
