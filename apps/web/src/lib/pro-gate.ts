import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { checkAndConsumeQuota, getQuotaStatus, proGatingEnabled, type QuotaResult, type UsageKind_t } from "./usage";

export { proGatingEnabled };

// The enforcement semantics for ENABLE_PRO_GATING live in ./usage.ts
// (proGatingEnabled). Unset means dev/test bypass (does not consume deep
// quota) in non-production, but ENFORCES in production — a missing flag can
// never silently unlock paid LLM spend.
export function isProUser(user: { tier?: string | null } | null): boolean {
  if (!proGatingEnabled()) return true;
  return user?.tier === "pro";
}

export function authDeniedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Sign in to use Deep Research.",
      code: "auth_required",
    },
    { status: 401 },
  );
}

export function quotaDeniedResponse(result: QuotaResult, kind: UsageKind_t): NextResponse {
  return NextResponse.json(
    {
      error: "quota_exceeded",
      code: "quota_exceeded",
      kind,
      tier: result.tier,
      resetsAt: result.resetsAt,
      remaining: 0,
    },
    { status: 429 },
  );
}

export interface QuotaUser {
  id: string;
  email: string;
  tier: string;
}

/**
 * Resolve + gate the session for a quota-restricted Deep Research endpoint.
 * Anonymous callers get a 401 (deep research requires an account, even
 * anonymously it is 0/day); logged-in callers past their limit get a 429 with
 * the reset time. When consume is false the gate only reads status — used to
 * short-circuit /prepare before it spends an LLM call, without consuming.
 * NOTE: the read-then-consume split between /prepare and the trigger is a
 * consciously accepted low-stakes race (two tabs can both pass a "1 left"
 * check; the consume is still atomic so the ceiling is never exceeded).
 */
export async function requireQuotaUser(
  kind: UsageKind_t,
  opts: { consume?: boolean } = {},
): Promise<{ ok: true; user: QuotaUser } | { ok: false; response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: authDeniedResponse() };

  if (opts.consume === false) {
    const status = await getQuotaStatus({ userId: user.id }, kind);
    if (status.limit - status.used <= 0) {
      return {
        ok: false,
        response: quotaDeniedResponse(
          { allowed: false, remaining: 0, resetsAt: status.resetsAt, tier: status.tier },
          kind,
        ),
      };
    }
    return { ok: true, user };
  }

  const result = await checkAndConsumeQuota({ userId: user.id }, kind);
  if (!result.allowed) return { ok: false, response: quotaDeniedResponse(result, kind) };
  return { ok: true, user };
}