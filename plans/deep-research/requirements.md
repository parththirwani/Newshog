# Product and engineering requirements

## User outcomes

### Article research

Given a story URL, the system must identify the story's specific entities, event, date, market, and PR angle from the scraped article. It must find recent comparable coverage, distinguish the original story from later reporting, identify named journalists only when a byline on a relevant article supports the name, and surface evidence that affects novelty or saturation. Research unrelated to the article must not change its score.

### Standalone research

Given a question and any clarifications, the system must answer the requested subquestions with relevant evidence and direct links. If evidence is scarce, it must say what it could not establish. An empty or unsupported report must never have `completed` status.

## Required behavior

- Search plans state each subquestion, target evidence type, important entities, geography, and time window. Short web queries may differ from the full user request, but must preserve its constraints.
- Retrieval records provider, query, result rank, title, snippet, URL, and failure reason. Normalize redirects and canonical URLs before deduplication. Reject search-engine redirect pages as final evidence URLs.
- Search has bounded retries for empty, irrelevant, blocked, or malformed result sets. A retry changes the query or provider, and every retry is logged. Limits prevent runaway cost.
- Candidate selection uses topical relevance first, then source authority, recency where needed, and diversity. Inspect more than the first five raw hits. Search results alone do not count as supporting evidence.
- Full-page fetch records success, content type, title, publish date, byline when relevant, final URL, and extracted text. A snippet fallback may guide another search but cannot support a factual claim or verified source status.
- Extraction maps each atomic claim to an exact source passage and URL. Validate that the passage actually occurs in the fetched text. Reject claims with no supporting passage. Distinguish the source's assertion from independent confirmation.
- The agent can inspect coverage gaps and search again within a bounded budget. It should stop when the subquestions are sufficiently answered or a budget is reached, with the remaining gaps recorded.
- The answer includes linked evidence for factual claims. Clearly label inference. If sources conflict, describe the conflict instead of silently selecting one.
- `completed` requires a nonempty answer and minimum evidence coverage. `low_confidence`, `failed`, or a clear partial state must carry a reason that the UI and stored run can explain.
- Coverage/saturation counts only relevant, dated, distinct external articles that were actually fetched. A discovered URL, a redirect, or the submitted article itself must not inflate the signal.
- Cancellation, token ceilings, network limits, and per-run cost limits remain enforced. No unbounded provider calls or unbounded prompt context.
- Continue to protect URL fetches against private-network targets and redirect-based SSRF. Do not send secrets or private user content to a new provider without an explicit product decision.

## Compatibility

- Preserve the existing standalone queue flow, clarification flow, events, cancellation, and the article analysis integration.
- Keep response and database changes additive when possible. If a migration is needed, include it with tests and a rollback note.
- Keep provider and model choices injectable for deterministic tests. Do not require live network access for the normal unit test suite.
- Avoid a provider-specific implementation in `Service.ts`; isolate provider adapters and errors.

## Outside this pass

Do not redesign the whole product UI, alter quotas or billing, or attempt to reproduce proprietary Perplexity internals. A provider comparison is a measured selection for Newshog's use case, not a claim about another company's private architecture.
