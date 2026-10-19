# Evaluation suite and improvement loop

## Build the benchmark first

Create a versioned benchmark under `packages/deep-research/evals/`. Include at least 12 cases: four article PR cases with supplied article text/URL/date fixtures, four standalone current-events or market cases, two named-journalist/byline cases, and two negative or ambiguous cases where the correct result is limited evidence or an explicit gap. Include short and long headlines, an old article with a newer development, a common-word collision such as `identity`, and a year constraint. Keep private user requests out of fixtures.

For each case record the question, mode, fixed reference date, required entities and subquestions, expected evidence types, forbidden off-topic topics, and a small set of known relevant URLs where possible. The known URLs are a recall check, not a closed allowlist. Date-sensitive cases need a refresh procedure and an `as_of` field.

Create a held-out subset that is not used to tune prompts or thresholds. The agent must inspect sources and answers directly with a short, written rubric; save its judgments, source links, and reasons for later user review. Do not use the same model's unsupported opinion as the sole quality judge.

## Measures

Report these per case and in aggregate for baseline and candidate:

| Measure | How to score |
| --- | --- |
| Retrieval precision at 5 | Relevant, fetched sources among the first five selected sources divided by five; count fewer than five as missing slots. |
| Evidence coverage | Required subquestions with at least one supporting fetched passage divided by all required subquestions. |
| Citation support | Sample each factual claim and check that its linked passage supports the claim, not just shares words. |
| Answer correctness | Human judgment of material facts, entities, dates, and whether limitations are stated. |
| Byline precision | Correct named journalist and matching relevant article/byline, with no unsupported names. |
| Empty and bad-success rate | Runs marked completed despite an empty answer, zero accepted sources, or no required subquestion answered. |
| Efficiency | Prompt/completion tokens, search calls, fetched pages, provider cost, and wall time. |

Store query plans, provider responses, rank decisions, fetch outcomes, accepted passages, final output, and scores in a machine-readable trace. Redact keys and private user data. A deterministic replay mode must run the pipeline on captured provider/fetch fixtures without network or paid LLM calls; mock only the pieces needed for stable regression checks.

## Exit gates

Use the new baseline as the comparison point. The candidate must satisfy all of these before claiming success:

- The 12-case benchmark exists with manually inspected labels and source evidence; at least four cases remain held out until the final evaluation.
- On the held-out cases, retrieval precision at 5 is at least 0.70 overall, and no case has all five selected sources off-topic. If there are fewer than five suitable sources, the run must explain the shortage rather than fill slots with junk.
- At least 80% of required subquestions across the held-out set have accepted evidence or a truthful explicit evidence gap. Report both evidence-backed coverage and gaps separately.
- At least 95% of sampled factual claims have citations whose passages actually support them. Any unsupported named journalist or material numeric claim fails the gate until fixed.
- Zero empty or zero-source runs are marked completed. The current IAM diagnostic must either return relevant sources and a useful answer or a clear failure/partial explanation without unrelated sources.
- No regression in cancellation, SSRF protection, queue persistence, or existing unit tests. Build and relevant worker/web tests pass.
- Report median and worst-case latency and cost. If they rise materially, explain the gain and set a cap; do not hide the tradeoff.

These are initial release gates, not license to overfit the benchmark. If the 12 cases prove too easy or the labels are weak, strengthen the set and record the change before scoring the final implementation.

## Run sequence

1. Baseline: run current code on the fixed cases; capture failures and costs. A live run may use a small subset initially to control spend.
2. Provider bake-off: run the same query variants through each viable provider; label top results before modifying the pipeline.
3. Candidate-selection experiment: replay the captured result pools through competing ranking/filtering approaches. Select by relevance and false-negative review.
4. Integration: run deterministic tests, then live end-to-end cases. Inspect source and claim traces, not just final prose.
5. Hold-out review: score once after the design stabilizes. Record every failed gate and loop back to the responsible stage.

Live network tests must be opt-in and must not run in normal CI. Keep their output separate from deterministic fixtures so transient web changes do not break the test suite.
