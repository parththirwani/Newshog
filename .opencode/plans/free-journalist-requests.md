# Plan: Free journalist-request ingestion

## Goal
Let journalists show up in Newshog ("Open opportunities right now") using free
journalist-request sources instead of only paid digests. Verified end-to-end by
running ~10 test analyses and confirming matched requests render.

## Verified findings (done, read-only)
- IMAP creds in `.env` are valid: connect to Gmail IMAP succeeds, INBOX reads.
- **Ingestion is blocked by a bug**: `email-fetch.ts:68` uses
  `client.search(["UNSEEN"], { uid: true })` — imapflow returns `false` (not an
  array) for this array-form criteria, so `for (const uid of false)` throws
  `TypeError: false is not iterable`. Verified live: object form
  `{ seen: false }` returns the UID list `[1,2,3,4]`.
- Result: `journalist_requests` = 0, `analysis_journalist_matches` = 0 in DB.
- Worker is not currently running (queues idle since 08-24).
- Inbox currently holds only 4 Gmail security alerts, no digest emails yet.
- `SourcePlatform` enum + sender map are the only platform-coupling points.

## Changes

### 1. Fix search bug + extend sender map — `apps/worker/src/email-fetch.ts`
- Replace `client.search(["UNSEEN"], { uid: true })` with
  `client.search({ seen: false }, { uid: true })` and guard the falsy return so
  a server NO/BAD degrades to `[]` instead of crashing.
- Extend `SENDER_PLATFORM_MAP` (placeholders, to correct after first real mail):
  - `mentionmatch.com` → `mentionmatch`  (re-point from `help_a_b2b_writer`)
  - `qwoted.com` → `qwoted`
  - `haro.featured.com`, `featured.com` → `haro`
  - `pressplugs.com` → `pressplugs`
- `help_a_b2b_writer` stays in the enum (additive only).

### 2. Prisma enum — `packages/db/prisma/schema.prisma`
Add to `SourcePlatform`: `haro`, `qwoted`, `mentionmatch`, `pressplugs`.
Then run `prisma db push` (root script `db:push`).

### 3. TS type — `packages/shared/types/journalist-request.ts`
Extend `SourcePlatform` union to match the enum.

No changes to match/extract LLM logic.

### 4. New script — `scripts/add-request.ts`
Manual free-path CLI: insert a journalist request directly into
`journalist_requests` with the same schema shape `extractJournalistRequests()`
produces. No LLM call. Example:
`bun scripts/add-request.ts --platform qwoted --outlet TechCrunch --requester "Jane" --topic "..." [--deadline 2026-09-01] [--reply jane@tc.com]`
(reads a JSON object from stdin if `--json` given).

### 5. New script — `scripts/ingest-now.ts`
Dev trigger for the existing `fetchDigestEmails()` → `extractJournalistRequests()`
flow (same logic as the 4h BullMQ job, incl. 24h dedupe, 7-day expiry, and
`markEmailsSeen` after persistence) so ingestion is testable on demand.

## Verification sequence
1. `bun test` in `apps/worker` (email-fetch, pipeline, match suites) — add a case
   asserting search returns `[]` on falsy result.
2. `db:push`; then `tsc`/`next build` typecheck for the shared type change.
3. Start worker: `bun --env-file=.env run apps/worker/src/index.ts` (bg, nohup).
4. Seed a handful of requests via `add-request.ts` (from free sources) since the
   inbox has no digest emails yet; optionally trigger `ingest-now.ts`.
5. Run ~10 analyses (load-test-style POST loop to `/api/analyze`), let the match
   worker run, then confirm `analysis_journalist_matches` is populated and the
   owner's result page shows "Open opportunities right now" with the matched
   journalist requests.