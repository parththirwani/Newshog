# Architecture decisions

Status: checkpoint 2 retrieval changes implemented and tested; provider selection and final evidence/status architecture remain open.

## Search provider

The current native path is DuckDuckGo HTML first with Bing HTML fallback. A bounded live probe on 2026-10-20 found DDG HTML returned HTTP 202 with zero parsed results for two topical queries; Bing returned HTTP 200 and ten parsed results, but the current Bing redirect resolver did not remove the `bing.com/ck/a` URLs in that probe. Brave Search HTML returned relevant identity-security results, but it is not an existing configured provider and no credential/configuration was added. The web-search gateway returned relevant results but is not an injectable Newshog provider.

No provider bake-off quality claim is made yet. Required configuration discovered in the repository: `DDG_SEARCH_URL`, optional `JINA_API_KEY`, and `OPENROUTER_API_KEY`; values are intentionally omitted. Exact live provider cost is unavailable for the current HTML providers and was not invented. Next step: isolate provider adapters, log failures/retries, normalize redirects/canonicals, and replay labeled result pools.

## Candidate selection

Baseline replay uses current first-five selection. Candidate replay uses a deterministic title/URL/passage relevance score, hard penalties for dictionary/calendar/glossary/definition collisions, and URL deduplication. On held-out v1, precision at five improved from 0.40 to 0.50 overall; `article-04` improved from 0.60 to 1.00, while `standalone-04` and `byline-02` remained 0.60 and 0.40. Useful-source false negatives, diversity, and production latency are not yet measured. The threshold must remain a candidate experiment, not a release decision.

## Evidence and synthesis

Existing code asks the model for excerpts and filters source URLs to the candidate set; `Verify.ts` validates excerpts using token overlap. The benchmark exposes the remaining gaps: snippet-only material can be treated as content on scrape failure, visited URLs can inflate article coverage, and zero-source runs can still be persisted as completed. Next checkpoint will make fetched content and accepted passages explicit, fail closed for snippet-only support, and count only accepted relevant dated sources in article coverage.

## Compatibility and operations

No schema change has been made. Queue, cancellation, SSRF protection, and existing APIs are untouched. Replay is deterministic and opt-in live smoke remains separate. The existing `.gitignore` modification is unrelated and remains unstaged. Rollback for checkpoint 1 is reverting only the benchmark/evaluation files; no credentials or private traces are committed.
