# Newshog security and deployment checklist

This checklist follows the product phases in `implementation.md` and uses the current stack in this repo:

- Web app: Next.js on Vercel
- Worker: Bun worker container from `apps/worker/Dockerfile`, deployed separately
- Database: Neon or Supabase Postgres
- Queue and cache: Upstash Redis
- Billing: Stripe
- Email ingestion: IMAP now, webhook-capable provider later
- Local dev stack: `docker-compose.yml` for Postgres, Redis, and the worker

Use this as a ship checklist. A phase is not done until its security and deployment items are also done.

## Cross-phase baseline

Do this once, then keep it true for every later phase.

### Security baseline
- [ ] Keep secrets only in host-managed env vars. Never commit `.env` files with real values.
- [ ] Keep `.env.example` current whenever a new required variable is added.
- [ ] Validate request bodies and query params on every route.
- [ ] Reject non-HTTP(S) URLs anywhere the app fetches remote content.
- [ ] Add server-side logging for failed jobs, failed webhooks, and failed third-party API calls.
- [ ] Review new dependencies before adding them, especially scraping, HTML parsing, auth, and billing packages.
- [ ] Run tests for the touched package before shipping.

### Deployment baseline
- [ ] Keep separate environments for local, preview, and production.
- [ ] Document which service owns each env var: Vercel, worker host, Postgres, Redis, Stripe.
- [ ] Make sure web and worker deploy from the same compatible schema and queue contract.
- [ ] Roll out schema changes before code that depends on them.
- [ ] Make sure the worker can start cleanly with production env vars and network access to Postgres and Redis.
- [ ] Keep one smoke test for each critical path: analyze, billing webhook, worker job pickup, and DB connectivity.

## Phase 1: foundation and zero-friction input

Goal: URL in, job enqueued, scrape starts, status is visible.

### Security
- [ ] Add request validation for `POST /api/analyze` and status routes.
- [ ] Add SSRF protection before article fetches: scheme allowlist, private IP rejection, metadata IP rejection, timeout, and response size cap.
- [ ] Add rate limiting in front of public analyze routes before any DB write or queue enqueue.
- [ ] Make sure anonymous cookies are signed and `httpOnly`.
- [ ] Confirm scrape failures do not leak internal fetch errors or host details to the client.
- [ ] Confirm raw article text is stored server-side only and never exposed accidentally in public responses.

### Deployment
- [ ] Provision Vercel project for `apps/web`.
- [ ] Provision Postgres and Redis instances for non-local environments.
- [ ] Configure `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, and LLM API key in each environment.
- [ ] Deploy the worker service from `apps/worker/Dockerfile` with the same `DATABASE_URL` and `REDIS_URL` as the web app.
- [ ] Run schema push or migrations before enabling the analyze flow.
- [ ] Verify end-to-end flow in the deployed environment: submit URL, queue job, worker picks it up, status updates.

## Phase 2: core AI analysis pipeline

Goal: stable score, why-now, angles, pitch, and per-stage LLM accounting.

### Security
- [ ] Treat scraped article text as untrusted input inside prompts.
- [ ] Keep structured output validation on every LLM response before persistence.
- [ ] Add bounded retries only. Never allow open-ended regeneration loops.
- [ ] Log token and cost data per stage without logging prompts that contain secrets or sensitive user context.
- [ ] Confirm prompt and critique failures fail closed to a retry or a clear error, not a partial corrupt row.
- [ ] Add tests for malformed model output, stale-story handling, and score normalization.

### Deployment
- [ ] Add the LLM API key to all deployed environments used by web and worker.
- [ ] Verify the deployed worker has enough timeout and memory headroom for scrape plus analysis.
- [ ] Ship schema updates for `analyses` and `llm_calls` before code that writes new fields.
- [ ] Add dashboards or logs for analysis success rate, latency, and per-stage token cost.
- [ ] Run at least one production-like smoke test with a fresh article and an old article.

## Phase 3: deep research

Goal: standalone research runs and optional research-enriched analysis.

### Security
- [ ] Gate deep research behind auth and pro checks on every entry point.
- [ ] Add stricter rate limits for `/api/analyze/deep`, `/api/deep-research`, and `/api/deep-research/prepare`.
- [ ] Enforce hard per-run token ceilings and bounded search depth and breadth.
- [ ] Confirm cancellation works and cannot leave runaway worker tasks behind.
- [ ] Reuse SSRF protections on every search result fetch and follow-up scrape.
- [ ] Ensure citations and returned sources are sanitized before rendering.
- [ ] Log cost spikes and repeated truncated runs.

### Deployment
- [ ] Deploy any new queue consumers before exposing deep research routes publicly.
- [ ] Verify Redis throughput and connection limits can handle both analyze and deep-research queues.
- [ ] Roll out schema for `deep_research_runs` and `deep_research_sessions` first.
- [ ] Add monitoring for run duration, cancellation rate, truncation rate, and per-run cost.
- [ ] Smoke test both paths: standalone research and analysis with `deepResearch: true`.

## Phase 4: context profiles

Goal: attach individual or enterprise context safely.

### Security
- [ ] Store only the minimum profile data needed for later analysis.
- [ ] Verify profile ownership on every read and write.
- [ ] Protect third-party tokens for Apify and X API.
- [ ] Validate and sanitize all profile URLs before fetching them.
- [ ] Apply SSRF controls to company-site crawling and document fetching.
- [ ] Make it clear when profile-derived claims are inferred, not verified facts.
- [ ] Add deletion or overwrite paths for profile data before collecting more of it.

### Deployment
- [ ] Add `APIFY_TOKEN` and `X_API_KEY` only to environments that actually use profile enrichment.
- [ ] Schedule bounded enterprise recrawls with backoff so a bad site cannot flood the worker.
- [ ] Roll out profile schema changes before enabling profile UI.
- [ ] Verify deployed jobs can reach the third-party APIs from the worker host.
- [ ] Smoke test individual and enterprise profile creation end to end.

## Phase 5: journalist matching

Goal: ingest free journalist-request feeds and show matches.

### Security
- [ ] Verify inbound email authenticity if using webhook delivery.
- [ ] If using IMAP polling, keep mailbox credentials only in server env vars and never in the web app bundle.
- [ ] Validate extracted request structure before storing it.
- [ ] Sanitize raw email content before showing any part of it in the UI.
- [ ] Add expiry handling so old requests are not shown as active.
- [ ] Prevent prompt injection from raw email bodies in the extraction step.

### Deployment
- [ ] Configure mailbox or webhook delivery for each source feed in non-local environments.
- [ ] Deploy the ingestion worker path on a schedule or as a persistent consumer.
- [ ] Verify the worker host has stable outbound access to the mailbox provider.
- [ ] Add monitoring for ingestion failures, parsing failures, and time since last successful fetch.
- [ ] Smoke test one real or fixture-backed ingestion from raw message to stored request.

## Phase 6: pitch generation and result page UX

Goal: complete result page with editable pitch and section-level fallbacks.

### Security
- [ ] Escape and sanitize all generated text before rendering it into the UI.
- [ ] Keep profile-private content out of any public or shared response payloads.
- [ ] Add server-side auth checks for pitch regeneration and any edit endpoints.
- [ ] Prevent a pitch regenerate action from re-running unrelated expensive pipeline stages.
- [ ] Add content safety checks for unverifiable, defamatory, or overclaimed output.

### Deployment
- [ ] Verify client and server builds both succeed with the new result page sections.
- [ ] Add monitoring for regenerate-pitch volume and failure rate.
- [ ] Smoke test section-level failures so one broken dependency does not blank the whole result page.

## Phase 7: shareability and public pages

Goal: public read-only analysis pages that do not leak private data.

### Security
- [ ] Confirm public pages only expose context-free analysis data.
- [ ] Add rate limiting to public analyze and public page generation paths.
- [ ] Add security headers in `next.config.ts`: HSTS, `X-Content-Type-Options`, frame denial, and a baseline CSP.
- [ ] Review OG image generation so user-controlled text cannot break rendering or cause remote fetches.
- [ ] Lock API CORS to same-origin unless a route is intentionally public.
- [ ] Check that analytics events do not include secrets, raw article text, or private profile data.

### Deployment
- [ ] Configure the public site URL for production metadata and OG generation.
- [ ] Verify Vercel preview and production both render public pages correctly.
- [ ] Add cache and revalidation rules intentionally for public result pages.
- [ ] Smoke test a shared URL while logged out.

## Phase 8: Medialyst funnel

Goal: one-way handoff to an external signup flow.

### Security
- [ ] Sign or encode outbound profile handoff parameters so they cannot be tampered with silently.
- [ ] Do not include more profile data than Medialyst needs to prefill signup.
- [ ] Validate any inbound conversion webhook or return redirect before trusting it.
- [ ] Prevent open redirects when sending users off-site and when handling return URLs.
- [ ] Log click-through and conversion events without exposing personal profile text.

### Deployment
- [ ] Configure the external destination URL in env vars, not code.
- [ ] Coordinate the handoff contract with Medialyst before enabling conversion tracking.
- [ ] Deploy webhook or return-route handling before turning on attribution.
- [ ] Smoke test CTA click, prefill payload, and attribution callback.

## Phase 9: hardening and scale prep

Goal: reliability, visibility, and controlled spend under real traffic.

### Security
- [ ] Keep per-IP rate limits and abuse logging in place before broader launch.
- [ ] Add alerting for spikes in analyze volume, deep-research spend, webhook failures, and anonymous-cookie churn.
- [ ] Run dependency review with extra attention to `jsdom`, `@mozilla/readability`, billing, and email-parsing packages.
- [ ] Confirm URL dedupe never serves a broken or scoreless row as a completed result.
- [ ] Review structured logs to ensure they do not contain secrets, session tokens, or raw provider credentials.
- [ ] Decide whether Cloudflare or another WAF is justified from actual traffic data.

### Deployment
- [ ] Load test `/api/analyze` and the worker queue with a viral-story spike.
- [ ] Verify worker concurrency and queue backpressure settings before increasing traffic.
- [ ] Add dashboards for provider ceilings: Vercel, Upstash, Postgres, X API, and email provider.
- [ ] Confirm rollback steps for web deploy, worker deploy, and schema change.
- [ ] Verify the same build and schema version is running across web and worker after each deploy.

## Phase 10: accounts, gating, and dashboard

Goal: real account system with anonymous gating and saved history.

### Security
- [ ] Make magic links single-use and short-lived.
- [ ] Rate limit magic-link requests by IP and by email.
- [ ] Return the same response for known and unknown emails.
- [ ] Keep session cookies signed, `httpOnly`, `secure`, and scoped correctly.
- [ ] Add auth checks on every dashboard, profile, and billing route.
- [ ] Confirm logout clears session cookies reliably.
- [ ] Keep anonymous and authenticated usage counters separate and auditable.
- [ ] Verify Stripe webhook signature handling before allowing tier changes.

### Deployment
- [ ] Configure outbound email delivery for magic links in each non-local environment.
- [ ] Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` where billing is enabled.
- [ ] Deploy account schema changes before exposing login and dashboard routes.
- [ ] Register the production Stripe webhook endpoint and test a real signed event.
- [ ] Smoke test signup, login, logout, billing checkout, billing portal, and webhook-driven tier changes.

## Release gates

Use these checkpoints instead of relying only on feature completeness.

### Before any public launch
- [ ] Phase 1 and 2 deployment flow works end to end in production.
- [ ] Phase 1 SSRF protection and public route rate limiting are live.
- [ ] Stripe and email webhooks verify signatures if those features are enabled.
- [ ] Security headers and same-origin API policy are live.
- [ ] Logs, alerts, and one rollback path are documented.

### Before enabling paid or high-cost features
- [ ] Deep research gating is enforced in production.
- [ ] Daily and monthly LLM spend alerts are configured.
- [ ] Provider ceilings are visible somewhere the team will actually check.

### Before broad traffic or launch marketing
- [ ] Load test completed.
- [ ] Abuse alerting tested manually.
- [ ] Worker restart and queue recovery tested.
- [ ] On-call owner for deploy-day incidents is clear.
