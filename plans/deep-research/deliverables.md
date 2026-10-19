# Required deliverables and completion report

The agent should leave reviewable files, not just a summary in chat.

## In the repository

1. Production changes in the deep research package and article/worker integrations needed by the chosen architecture, with any additive schema migration and compatibility handling.
2. A deterministic evaluation harness and versioned cases under `packages/deep-research/evals/`. Include a documented command to run replay and an explicit opt-in command for live evaluation.
3. Tests for the observed failures: off-topic top hits, empty providers, redirect normalization, snippet-only fetches, unsupported claims, zero-source status, and article coverage counting. Include positive cases so filters do not reject useful evidence.
4. Complete the existing `plans/deep-research/results.md` template with baseline and final per-case metrics, aggregate scores, costs, latency, representative accepted/rejected URLs, and links to sanitized trace artifacts. State the date and provider/model versions used.
5. Complete the existing `plans/deep-research/decisions.md` template with the selected provider, ranking method, alternatives tried, measurable reasons for the choice, configuration required, and fallback behavior.
6. Update relevant README or configuration documentation with needed environment variables, provider limits, evaluation commands, and how to diagnose a low-confidence run. Never place credential values in docs or logs.

## Final agent report

State what changed and why, exact tests and evaluation commands run, before/after results for both article and standalone flows, any failed gate, operational requirements, and remaining risks. Distinguish a measured improvement from a proposed next step. Include a short list of files changed and any migration or deployment steps.

## Completion check

- [ ] Baseline captured before implementation.
- [ ] Search provider and candidate-ranking decision backed by labeled results.
- [ ] Deterministic replay and live opt-in evaluation work.
- [ ] Relevant unit, integration, worker, and build checks pass.
- [ ] All exit gates in `evaluation.md` are met, or unmet gates are documented with traces and a concrete next experiment.
- [ ] `results.md` and `decisions.md` reflect the implementation that is actually present.
- [ ] No secrets, private user content, or unreviewed provider charges are hidden in committed artifacts.
