// Upstash Redis-backed rate limiter (security.md Phase A.1), replacing the
// old single-node in-memory bucket. Evaluated BEFORE any DB write or quota
// check, and distinct from the Postgres quota layer:
//   - 429 shape here: { error: "rate_limited" } + Retry-After
//   - quota shape (pro-gate.ts): { error: "quota_exceeded" }
// The rate limiter stops pre-quota abuse (cookie cycling, brute force); the
// quota layer stays the backstop even on fail-closed routes — fail-closed
// here means "reject fast", not "no defense at all exists".
//
// Failure policy by route — split by cost exposure (security.md A.1):
//   fail-closed (503 on limiter error/missing-config): analyze, analyze/deep,
//   deep-research, deep-research/prepare, auth request+verify — LLM spend
//   and brute-forceable auth routes. 503 is the honest answer: "we can't
//   safely serve this right now".
//   fail-open: events (analytics only; worst case of a miss is log noise).
// Every Redis-error branch logs [security] ratelimit_redis_unreachable so
// Phase B.4 alerting has a hook from day one.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

export const ROUTE_LIMITS = {
  "analyze": { limit: 20, window: "1 m", failClosed: true },
  "analyze-deep": { limit: 5, window: "1 m", failClosed: true },
  "deep-research": { limit: 5, window: "1 m", failClosed: true },
  "deep-research-prepare": { limit: 5, window: "1 m", failClosed: true },
  "auth-request": { limit: 3, window: "1 h", failClosed: true },
  // Total verify attempts per IP. Shared-NAT (office/campus) collision is an
  // accepted tradeoff — revisit via support tickets, not preemptively.
  "auth-verify": { limit: 10, window: "1 h", failClosed: true },
  // Failed attempts only (consumed on the deny path), keyed per email hash.
  // Together with the 10/hr/IP total cap this kills 6-digit code brute force.
  "auth-verify-email": { limit: 5, window: "1 h", failClosed: true },
  "events": { limit: 60, window: "1 m", failClosed: false },
} as const;

export type RouteKey = keyof typeof ROUTE_LIMITS;

type LimiterResult = { success: boolean; reset: number; error?: string };
type LimiterLike = { limit: (key: string) => Promise<LimiterResult> };

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Keys must never contain raw emails/PII in Redis — hash before use.
export function hashScope(value: string): string {
  return crypto.createHash("sha256").update(value.toLowerCase().trim()).digest("hex").slice(0, 16);
}

// One Ratelimit instance per route policy, lazily constructed. Missing
// Upstash env (dev/test) returns null without importing anything network-y.
const instances = new Map<RouteKey, LimiterLike>();
function limiterFor(route: RouteKey): LimiterLike | null {
  const cached = instances.get(route);
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const policy = ROUTE_LIMITS[route];
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(policy.limit, policy.window as `${number} ${"s" | "m" | "h" | "d"}`),
    analytics: false,
  });
  instances.set(route, limiter);
  return limiter;
}

// Test seam: inject fake limiters (or null → "unconfigured") per route.
let testFactory: ((route: RouteKey) => LimiterLike | null) | null = null;
export function __setLimiterFactoryForTests(factory: (route: RouteKey) => LimiterLike | null): void {
  testFactory = factory;
}

export type GuardOutcome = { allowed: true } | { allowed: false; response: NextResponse };

function unavailable(route: RouteKey): NextResponse {
  return NextResponse.json({ error: "service_unavailable", code: "ratelimit_unavailable", route }, { status: 503 });
}

/**
 * Enforce `route`'s policy. Always keys on client IP; `extraKeys` adds
 * independently-limited dimensions (e.g. `email:<hash>` for auth routes —
 * a proxy rotation still hits the per-email window). ANY part over its
 * limit rejects; on multi-key routes each part gets its own window.
 */
export async function guard(
  request: Request,
  route: RouteKey,
  opts: { extraKeys?: Record<string, string>; ip?: boolean } = {},
): Promise<GuardOutcome> {
  const policy = ROUTE_LIMITS[route];
  const parts = [
    ...(opts.ip === false ? [] : [`ip:${clientIp(request)}`]),
    ...Object.entries(opts.extraKeys ?? {}).map(([name, v]) => `${name}:${v}`),
  ];
  const limiter = testFactory ? testFactory(route) : limiterFor(route);

  if (!limiter) {
    // Unconfigured. Dev/test tolerates; production must not silently lose
    // the primary defense on fail-closed routes.
    if (policy.failClosed && process.env.NODE_ENV === "production") {
      console.error(`[security] ratelimit_unconfigured route=${route}`);
      return { allowed: false, response: unavailable(route) };
    }
    return { allowed: true };
  }

  for (const part of parts) {
    let res: LimiterResult;
    try {
      res = await limiter.limit(`${route}:${part}`);
    } catch (err) {
      console.error(`[security] ratelimit_redis_unreachable route=${route} err=${(err as Error)?.message}`);
      return policy.failClosed ? { allowed: false, response: unavailable(route) } : { allowed: true };
    }
    if (res.error) {
      console.error(`[security] ratelimit_redis_unreachable route=${route} err=${res.error}`);
      return policy.failClosed ? { allowed: false, response: unavailable(route) } : { allowed: true };
    }
    if (!res.success) {
      const retryAfter = Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
      return {
        allowed: false,
        response: NextResponse.json(
          { error: "rate_limited", code: "rate_limited", retryAfter },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        ),
      };
    }
  }
  return { allowed: true };
}
