# Newshog — Security Hardening & DDoS Mitigation Plan
Phased rollout, pre-launch → post-launch

---

## 0. Scope & Principle

This plan sits **in front of and alongside** the existing usage-quota/Stripe billing system — it does not modify that logic. The quota system is a *business-logic* limit (cost control per user tier); this plan is *infrastructure/security* defense (stop abuse before it costs money or compromises the app, regardless of tier).

**Ordering principle:** cheapest, highest-leverage defenses first. Rate limiting and SSRF protection block the two attack vectors most likely to cost real money or leak data — they ship before launch. Monitoring and advanced hardening can follow shortly after, once real traffic patterns are visible.

---

## Phase A — Pre-Launch Blockers (must ship before going live)

**Goal:** Close the vectors that either cost direct money (LLM spend, Stripe abuse) or expose infrastructure (SSRF, webhook forgery).

### A.1 — IP-based rate limiting
- Add a Redis-backed (Upstash) token-bucket limiter in front of every public API route, evaluated **before** any DB write or quota check.
- `/api/analyze`: 20 req/min/IP
- `/api/analyze/deep`, `/api/deep-research/prepare`: 5 req/min/IP (stricter — LLM cost triggers even at prepare stage)
- Magic-link request endpoint: 3 req/hour/IP **and** 3 req/hour/email
- Rejected requests return `429` (rate-limit error, distinct from the `quota_exceeded` shape) before touching Postgres.

### A.2 — SSRF protection on article scraping
- Resolve DNS for any user-submitted URL and reject private/reserved IP ranges (RFC1918, loopback, link-local, cloud metadata `169.254.169.254`) before fetching.
- Re-validate the resolved IP at actual fetch time and pin the request to it (defends against DNS rebinding — hostname resolves public at check-time, private at fetch-time).
- Reject non-http(s) schemes.
- Fetch timeout: 10s. Max response size: 5MB.

### A.3 — Webhook signature verification
- Audit that the Stripe webhook route actually verifies `stripe-signature` and rejects on failure (confirm implemented, not just planned).
- Add equivalent signature verification to the inbound-email (Mailgun or chosen provider) webhook. Reject unsigned/invalid requests with `401` before any parsing.

### A.4 — Input validation
- Zod (or equivalent) schema on every API route's body/query params. Reject malformed, oversized, or unexpected-shape payloads before handler logic runs.

### A.5 — Security headers & CORS
- `next.config.js` headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), baseline `Content-Security-Policy` covering Stripe.js/analytics scripts.
- Lock CORS to same-origin by default on all API routes; open individual routes deliberately only if/when a public API surface ships.

### A.6 — Magic-link hardening
- Tokens: single-use, 15-minute expiry.
- "Request magic link" response is identical whether or not the email is a registered account (no user enumeration).

### A.7 — Secrets & dependency audit
- Confirm `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`, DB URLs, `STRIPE_WEBHOOK_SECRET` live only in host-encrypted env vars — never logged, never client-exposed, never committed.
- Run `npm audit` / Dependabot pass, with particular attention to `jsdom` and `@mozilla/readability` (DOM-parsing libraries with historical SSRF/XSS-adjacent CVEs).

### A.8 — Anthropic hard spend ceiling
- Set a daily/monthly hard spend alert (and cap, if the dashboard supports it) directly on the Anthropic API account — the last line of defense if every app-level control is somehow bypassed.

**Exit criteria:** all of the above implemented and tested (SSRF validator tests for private-IP rejection + DNS-rebinding case; rate-limiter tests for enforcement + reset). Cannot deploy publicly until this phase is done.

---

## Phase B — Launch-Week Hardening (ship within first few days of going live)

**Goal:** Close secondary vectors that matter once real (and possibly hostile) traffic starts arriving, but aren't launch-blocking.

### B.1 — Prompt injection defense-in-depth
- Extend the existing "staleness hardening" pattern (removal of the `## Inputs you will receive` stanza) into a general rule: all scraped article content is treated as untrusted input, never concatenated in a way that could be mistaken for system instructions.
- Add a lightweight check in the critique/review pass for output that looks like it's echoing injected instructions rather than analyzing the article (reuses the existing self-critique pass from Phase 2).

### B.2 — Distributed anon-cookie abuse mitigation
- Since anonymous quota is per-cookie (trivially bypassed by minting fresh cookies), confirm the Phase A.1 per-IP rate limit is the actual backstop here — anon quota alone is not a cost control.
- Add logging specifically flagging IPs generating unusually many distinct `anon_id` cookies in a short window (signal for scripted abuse even before it hits the rate limit).

### B.3 — Deep-research cost-bomb guard
- Confirm there's a hard cap on internal retry/regeneration loops in the angle self-critique and deep-research enrichment stages, so a single request can't recursively balloon LLM spend if a critique step keeps rejecting output.

### B.4 — Abuse logging & basic alerting
- Log every rate-limit rejection and quota denial (IP, route, timestamp) to a queryable store (existing logging infra, or a simple Postgres/Redis log table).
- Stand up a minimal alert (even a Slack/email webhook) for: spike in `/api/analyze` volume, spike in Stripe webhook failures, spike in `anonymous_usage` row-creation rate.

**Exit criteria:** logging is live and queryable; at least one manual test of each alert path (trigger a rate-limit burst, simulate a webhook failure) confirms signal actually fires.

---

## Phase C — Post-Launch, Traffic-Informed Hardening (weeks 2–4, based on real data)

**Goal:** Use real traffic patterns from Phase B's logging to decide what's actually worth adding — avoid over-building defenses against attacks that never materialize.

### C.1 — Evaluate edge-layer WAF (Cloudflare)
- If logs show bot/scraper traffic patterns Vercel's built-in DDoS mitigation doesn't catch, add Cloudflare in front for WAF rules, bot-fight mode, and geo/ASN blocking.
- Not needed if Phase A/B logs stay clean — don't add complexity preemptively.

### C.2 — Postgres contention review
- If `/api/analyze` p99 latency shows lock-contention symptoms under real load (hot `usage_counters`/`anonymous_usage` rows), revisit the earlier decision to skip Redis-fronted counters and add a fast-path cache layer.

### C.3 — IP-based anon backstop (if needed)
- If cookie-cycling abuse shows up meaningfully in Phase B.2's logs despite rate limiting, add a coarse secondary limit (e.g. 20 quick searches/day/IP) as a backstop — accept the fingerprinting trade-off only if the data justifies it.

### C.4 — Formal dependency/security review
- Run a broader review (e.g. `npm audit` in CI on every PR going forward, not just a one-time pre-launch pass) and consider a lightweight external review or automated SAST tool if budget allows.

**Exit criteria:** each item above is either implemented or explicitly deferred with a documented reason (traffic didn't justify it), based on Phase B log data.

---

## Summary Table

| Phase | Timing | Focus | Blocking? |
|---|---|---|---|
| A | Before launch | Rate limiting, SSRF, webhook auth, input validation, headers, secrets, spend ceiling | **Yes — cannot deploy without this** |
| B | First days live | Prompt injection defense, anon-abuse logging, cost-bomb guard, basic alerting | No, but ship fast |
| C | Weeks 2–4 | WAF, DB contention, IP backstop, ongoing dependency review | No — traffic-informed, may defer indefinitely |