import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

// Pro-tier gating is enforced only when ENABLE_PRO_GATING is truthy. During
// development/tests the env var is unset, so every user passes and the feature
// can be exercised end-to-end without a pro account.
export function proGatingEnabled(): boolean {
  const raw = process.env.ENABLE_PRO_GATING;
  return raw === "true" || raw === "1";
}

export function isProUser(user: { tier?: string | null } | null): boolean {
  if (!proGatingEnabled()) return true;
  return user?.tier === "pro";
}

export function proDeniedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Deep Research is a Pro feature.",
      code: "pro_required",
      upgrade: true,
    },
    { status: 403 },
  );
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

/**
 * Resolve + gate the session for a Deep Research endpoint. Returns
 * { user, ok: true } or a NextResponse denial to short-circuit the handler.
 */
export async function requireProUser(): Promise<
  | { ok: true; user: { id: string; email: string; tier: string } }
  | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: authDeniedResponse() };
  if (!isProUser(user)) return { ok: false, response: proDeniedResponse() };
  return { ok: true, user };
}