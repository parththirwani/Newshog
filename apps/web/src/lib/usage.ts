import { prisma, UsageKind } from "@newshog/db";
import crypto from "crypto";

// Deep-research gating is enforced only when ENABLE_PRO_GATING is truthy.
// During development/tests the env var is unset, so the deep quota passes
// without consuming and the pipeline can be exercised end-to-end without a
// pro account. Quick search is always enforced regardless of this flag.
// Safety default: an UNSET flag never disables enforcement in production —
// silently unlimited deep research would burn LLM spend with no ceiling.
export function proGatingEnabled(): boolean {
  const raw = process.env.ENABLE_PRO_GATING;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0" || raw === "") return false;
  return process.env.NODE_ENV === "production";
}

// Three-tier usage quotas, enforced server-side before any job is enqueued or
// LLM cost is spent. Two independent counters per identity — quick search and
// deep research never share a bucket.
//
//   anonymous: 3 quick searches lifetime (tracked by signed anon_id cookie),
//              0 deep research.
//   free:      10 quick/day + 1 deep/day, reset on UTC midnight boundary.
//   pro:       250 quick/mo + 50 deep/mo, reset on the Stripe billing cycle
//              (current_period_start/end), else the calendar-month fallback.
//
// Consumption is a single atomic upsert guarded by `count < limit` — no
// transaction, no SELECT ... FOR UPDATE, no race window between check and
// increment. If the guard filters the upsert, no row comes back and the
// request is denied.

export type UsageKind_t = "quick_search" | "deep_research";
export type Tier = "anonymous" | "free" | "pro";

export interface QuotaIdentity {
  userId?: string;
  anonId?: string;
}

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
  resetsAt: Date | null;
  tier: Tier;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  resetsAt: Date | null;
  tier: Tier;
}

export const LIMITS = {
  anonymous: { quick_search: 3, deep_research: 0 },
  free: { quick_search: 10, deep_research: 1 },
  pro: { quick_search: 250, deep_research: 50 },
} as const;

interface UserRef {
  id: string;
  tier: string;
  stripeCurrentPeriodStart: Date | null;
  stripeCurrentPeriodEnd: Date | null;
}

function tierFor(user: UserRef): Tier {
  return user.tier === "pro" ? "pro" : "free";
}

// Free resets on a fixed UTC-midnight boundary, not a rolling 24h window, so
// "10/day" maps to a calendar day. Pro resets on the Stripe billing cycle; if
// the anchor is missing (webhook not yet landed, manually promoted in dev)
// fall back to the current calendar month — never silently unlock forever.
function periodFor(user: UserRef | null, now = new Date()): { start: Date; end: Date } {
  const tier = user ? tierFor(user) : "anonymous";
  if (tier === "pro" && user?.stripeCurrentPeriodStart && user?.stripeCurrentPeriodEnd) {
    return { start: user.stripeCurrentPeriodStart, end: user.stripeCurrentPeriodEnd };
  }
  if (tier === "pro") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { start, end };
}

function newCounterId(): string {
  return crypto.randomUUID();
}

async function fetchUser(userId: string): Promise<UserRef | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tier: true,
      stripeCurrentPeriodStart: true,
      stripeCurrentPeriodEnd: true,
    },
  });
}

/**
 * Atomically check-and-increment quota for one identity + kind. Never throws on
 * quota denial — returns { allowed: false } and does NOT increment when the
 * limit is already reached.
 */
export async function checkAndConsumeQuota(
  identity: QuotaIdentity,
  kind: UsageKind_t,
): Promise<QuotaResult> {
  const now = new Date();

  if (identity.userId) {
    const user = await fetchUser(identity.userId);
    if (!user) return deniedResult(kind, "anonymous");
    const tier = tierFor(user);
    const limit = LIMITS[tier][kind];

    // Dev/test bypass for deep research only (mirrors the ENABLE_PRO_GATING
    // convention in pro-gate.ts). Quick search is always enforced. Reports the
    // current count without consuming so the response stays truthful.
    if (kind === "deep_research" && !proGatingEnabled()) {
      const status = await quotaStatusFor(user, tier, kind, now);
      return { allowed: true, remaining: Math.max(0, limit - status.used), resetsAt: status.resetsAt, tier };
    }

    const period = periodFor(user, now);
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO usage_counters (id, user_id, kind, period_start, period_end, count, created_at, updated_at)
      VALUES (${newCounterId()}, ${user.id}, ${kind}::"UsageKind", ${period.start}, ${period.end}, 1, NOW(), NOW())
      ON CONFLICT (user_id, kind, period_start)
      DO UPDATE SET count = usage_counters.count + 1, updated_at = NOW()
      WHERE usage_counters.count < ${limit}
      RETURNING count
    `;
    const allowed = rows.length === 1;
    const used = allowed ? rows[0].count : limit;
    return { allowed, remaining: Math.max(0, limit - used), resetsAt: period.end, tier };
  }

  // Anonymous. Tracks in anonymous_usage; deep research is hard-capped at 0.
  if (kind === "deep_research") return deniedResult(kind, "anonymous");
  const limit = LIMITS.anonymous[kind];
  const anonId = identity.anonId;
  if (!anonId) return deniedResult(kind, "anonymous");

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO anonymous_usage (id, anon_id, kind, count, first_seen, last_seen)
    VALUES (${newCounterId()}, ${anonId}, ${kind}::"UsageKind", 1, NOW(), NOW())
    ON CONFLICT (anon_id, kind)
    DO UPDATE SET count = anonymous_usage.count + 1, last_seen = NOW()
    WHERE anonymous_usage.count < ${limit}
    RETURNING count
  `;
  const allowed = rows.length === 1;
  const used = allowed ? rows[0].count : limit;
  return { allowed, remaining: Math.max(0, limit - used), resetsAt: null, tier: "anonymous" };
}

async function quotaStatusFor(user: UserRef, tier: Tier, kind: UsageKind_t, now = new Date()): Promise<QuotaStatus> {
  const limit = LIMITS[tier][kind];
  const p = periodFor(user, now);
  if (limit === 0) return { used: 0, limit, resetsAt: p.end, tier };
  const row = await prisma.usageCounter.findUnique({
    where: {
      userId_kind_periodStart: { userId: user.id, kind: kind as UsageKind, periodStart: p.start },
    },
    select: { count: true },
  });
  return { used: row?.count ?? 0, limit, resetsAt: p.end, tier };
}

/**
 * Non-consuming read for the current period — lets the frontend render
 * "X left" and lets /prepare short-circuit before walking the clarification
 * flow. Never increments.
 */
export async function getQuotaStatus(identity: QuotaIdentity, kind: UsageKind_t): Promise<QuotaStatus> {
  if (identity.userId) {
    const user = await fetchUser(identity.userId);
    if (!user) return { used: 0, limit: 0, resetsAt: null, tier: "anonymous" };
    return quotaStatusFor(user, tierFor(user), kind);
  }
  const anonId = identity.anonId;
  const limit = LIMITS.anonymous[kind];
  if (!anonId || limit === 0) return { used: 0, limit, resetsAt: null, tier: "anonymous" };
  const row = await prisma.anonymousUsage.findUnique({
    where: { anonId_kind: { anonId, kind: kind as UsageKind } },
    select: { count: true },
  });
  return { used: row?.count ?? 0, limit, resetsAt: null, tier: "anonymous" };
}

function deniedResult(kind: UsageKind_t, tier: Tier): QuotaResult {
  return { allowed: false, remaining: 0, resetsAt: null, tier };
}