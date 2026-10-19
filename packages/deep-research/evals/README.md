# Deep research evaluation

The benchmark is `benchmark.v1.json`. It contains 12 public, synthetic/fixture-backed cases: four article cases, four standalone cases, two byline cases, and two negative cases. Four cases are held out (`article-04`, `standalone-04`, `byline-02`, `negative-02`). Labels are fixture labels and were manually inspected against the supplied passages and URLs on 2026-10-20; they are not a closed web allowlist.

Run deterministic replay (no network, paid model, or credentials):

    bun run packages/deep-research/evals/replay.ts --run baseline
    bun run packages/deep-research/evals/replay.ts --run candidate

The replay writes sanitized JSON traces to `plans/deep-research/traces/` and prints per-case and aggregate metrics. `--run baseline` models the pre-change behavior: preserve result order, select the first five, and count discovered candidates. `--run candidate` uses the production ranking/evidence rules once implemented. Live evaluation is opt-in and separate:

    DEEP_RESEARCH_LIVE=1 bun --env-file=.env run apps/worker/src/deep-research-smoke.ts --depth 1 --breadth 2 --prompts 3

Live output must not be committed. Provider availability and exact limits belong in `plans/deep-research/decisions.md`.
