import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { sessionCookie } from "@/lib/auth";
import { guard, hashScope } from "@/lib/rate-limit";
import { parseBody, AuthVerifyBodySchema } from "@/lib/schemas";

export async function POST(request: Request) {
  // A.1: total attempt cap per IP (shared-NAT collision is an accepted
  // tradeoff — the 6-digit code space itself is protected by the per-email
  // failed-attempt cap below).
  const limited = await guard(request, "auth-verify");
  if (!limited.allowed) return limited.response;

  try {
    // A.4: strict body — 6-digit code shape enforced before any DB lookup.
    const parsed = await parseBody(request, AuthVerifyBodySchema);
    if (!parsed.ok) return parsed.response;
    const { email, code } = parsed.data;

    const token = await prisma.token.findFirst({
      where: {
        email,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!token) {
      // Failed-attempt counter per email (5/hr, email-only key — successes
      // never consume it, and one typo doesn't tax the shared IP budget).
      const capped = await guard(request, "auth-verify-email", { ip: false, extraKeys: { email: hashScope(email) } });
      if (!capped.allowed) return capped.response;
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 401 });
    }

    await prisma.token.delete({ where: { id: token.id } });

    const user = await prisma.user.upsert({
      where: { email },
      create: { email },
      update: { lastLoginAt: new Date() },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(user.email));
    return res;
  } catch (err) {
    console.error("[api/auth/verify] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
