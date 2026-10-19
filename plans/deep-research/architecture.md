# Target architecture and decisions to test

This is a proposed architecture, not a mandate to add every component. Implement only the components needed to pass the evaluation gates, and record why the chosen design is simpler or stronger than alternatives.

## Research flow

`request/article -> intent and constraints -> subquestions -> query variants -> search candidates -> URL normalization and dedup -> relevance selection -> fetch and extract -> evidence ledger -> gap check and bounded follow-up -> synthesis -> citation validation -> outcome/status`

### 1. Research brief

Create a typed brief carrying the original question, article URL and extracted article context when present, target subquestions, time window, geography, named entities, and evidence requirements. For article mode, use the body and date as context, while keeping generated web queries short. Keep the brief visible in a diagnostic trace.

### 2. Search adapter

Use a `SearchProvider` interface that returns structured result metadata plus provider and rank. Compare at least two viable approaches where credentials allow: a supported search API and the current HTML fallback. Evaluate with the same query set before selecting a default. Treat an HTTP 200 challenge page, zero organic results, or unrelated result set as a provider failure. Keep provider-specific parsing inside adapters.

### 3. Candidate selection

Collect enough candidates to rank them before fetching. Use a cheap first pass over title, snippet, URL, date hints, query goal, and entity match. Then fetch a diverse shortlist and rerank against extracted content. Hard-reject obvious topic collisions such as dictionary pages for an identity-security funding query or calendar pages for a year-constrained query. Avoid filling the shortlist with one domain, duplicate syndication, or search redirects. Store selection scores/reasons for audit, not as user-facing claims.

### 4. Evidence ledger

Store each candidate's discovery, fetch, relevance, date, byline, and evidence status separately. A claim cites a fetched passage and source URL. Search snippets can inform discovery only. Validate passage presence programmatically; use a semantic check for whether a passage supports the claim if lexical overlap proves too weak. Test negative examples where words overlap but the claim is false.

### 5. Adaptive stopping

After each batch, compare the evidence ledger to the subquestions. Search unresolved subquestions with revised entity-specific queries. Cap searches, fetched pages, tokens, elapsed time, and provider spend per run. Stop early if coverage is adequate. If caps hit first, return a candid partial result and missing-evidence list.

### 6. Synthesis and status

Write from accepted evidence only. Validate every final citation against the ledger. Keep the current citation enforcement as a defense, but do not treat token overlap as proof of factual support. Status must reflect answer completeness and evidence quality, not merely successful LLM output. Preserve the audit trail needed to explain a poor run.

## Implementation checkpoints

1. Write an architecture decision record comparing search providers and candidate selection methods on the benchmark. Include cost and operational dependencies.
2. Add typed result and trace data without breaking current consumers.
3. Implement search reliability and candidate selection, then test before changing synthesis.
4. Implement evidence validation and correct outcome status.
5. Update article coverage signal to count accepted relevant sources only.
6. Run both standalone and article flow evaluations, then remove obsolete parsing or fallback code only if the replacement is proven and safe.

## Risks to measure

- Search APIs may return good general results but weak byline or local-news coverage.
- Strict relevance rules may reject useful sources. Record false negatives, not just false positives.
- Recency needs a publish date from the article, not a date mentioned in body text or an index timestamp.
- The same funding announcement may appear as a press release and several syndicated copies. Source count should reflect independent coverage where the task asks for it.
- Additional searches can improve recall while increasing time and spend. Compare quality per unit cost, not quality alone.
