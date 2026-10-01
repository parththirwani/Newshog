# Deploying Newshog

This repo deploys as two services:

- `apps/web` on Vercel
- `apps/worker` on Render

## Vercel web app

### Project settings
- Framework preset: Next.js
- Root directory: repo root
- Install command: `bun install --frozen-lockfile`
- Build command: `bun run build`

`vercel.json` is already set for this shape.

### Vercel env vars

Set these in Vercel for Preview and Production as needed.

Required:
- `DATABASE_URL` = Supabase pooler URL
- `DIRECT_URL` = Supabase direct URL
- `REDIS_URL` = Upstash TCP URL (`rediss://...`)
- `OPENROUTER_API_KEY`
- `SESSION_SECRET`
- `NEXT_PUBLIC_SITE_URL` = deployed app URL, e.g. `https://newshog.xyz`

Email:
- `RESEND_API_KEY`
- `AUTH_EMAIL_FROM` = later use `login@newshog.xyz` after domain verification
- `BILLING_EMAIL_FROM` = later use `billing@newshog.xyz` after domain verification

Billing:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

Profile/context:
- `APIFY_TOKEN`
- `X_API_KEY`

Journalist ingestion:
- `IMAP_HOST`
- `IMAP_PORT`
- `IMAP_USER`
- `IMAP_PASS`

Optional:
- `NEXT_PUBLIC_MEDIALYST_URL`
- `JINA_API_KEY`
- `ENABLE_PRO_GATING=true`

### Vercel CLI

Run from repo root:

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
vercel env add REDIS_URL production
vercel env add OPENROUTER_API_KEY production
vercel env add SESSION_SECRET production
vercel env add NEXT_PUBLIC_SITE_URL production
vercel env add RESEND_API_KEY production
vercel env add AUTH_EMAIL_FROM production
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
vercel env add STRIPE_PRICE_ID production
vercel env add APIFY_TOKEN production
vercel env add X_API_KEY production
vercel env add IMAP_HOST production
vercel env add IMAP_PORT production
vercel env add IMAP_USER production
vercel env add IMAP_PASS production
vercel --prod
```

## Render worker

### Service settings
- Service type: Worker
- Runtime: Docker
- Dockerfile: `apps/worker/Dockerfile`
- Root directory: repo root

`render.yaml` is already added so Render can import the service definition.

### Render env vars

Set the same server-side env vars used by the web app:

- `DATABASE_URL` = Supabase pooler URL
- `DIRECT_URL` = Supabase direct URL
- `REDIS_URL` = Upstash TCP URL (`rediss://...`)
- `OPENROUTER_API_KEY`
- `SESSION_SECRET`
- `RESEND_API_KEY`
- `AUTH_EMAIL_FROM`
- `BILLING_EMAIL_FROM`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`
- `APIFY_TOKEN`
- `X_API_KEY`
- `IMAP_HOST`
- `IMAP_PORT`
- `IMAP_USER`
- `IMAP_PASS`
- `NEXT_PUBLIC_MEDIALYST_URL` if used
- `JINA_API_KEY` if used
- `ENABLE_PRO_GATING=true`

### Render deploy steps

1. Create a new Render Blueprint or Worker service from this repo.
2. Confirm it uses `apps/worker/Dockerfile`.
3. Add env vars.
4. Deploy.
5. Check worker logs for successful Redis and Postgres connectivity.

## Migrations

Run migrations from `packages/db` against the direct DB URL before or during deploy:

```bash
cd packages/db
bun x prisma migrate deploy
```

## Stripe webhook

After Vercel deploy, register the production webhook URL in Stripe:

```text
https://your-domain/api/billing/webhook
```

Listen for:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

## Smoke checks

After deploy:

```bash
curl -X POST https://your-domain/api/auth/request -H "content-type: application/json" -d '{"email":"you@example.com"}'
curl -X POST https://your-domain/api/analyze -H "content-type: application/json" -d '{"url":"https://example.com"}'
curl https://your-domain/api/me
```
