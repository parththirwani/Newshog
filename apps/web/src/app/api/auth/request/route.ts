import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import crypto from "crypto";
import { rateLimit, clientIp, AUTH_REQUEST_RATE_LIMIT, AUTH_REQUEST_WINDOW_MS } from "@/lib/rate-limit";
import { hashLoginCode } from "@/lib/auth";
import { sendLoginCode } from "@/lib/email";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { email?: string } | null;
    const email = body?.email?.trim().toLowerCase();

    if (!email || typeof email !== "string" || !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 });
    }

    const ipGate = rateLimit(`auth:request:ip:${clientIp(request)}`, AUTH_REQUEST_RATE_LIMIT, AUTH_REQUEST_WINDOW_MS);
    const emailGate = rateLimit(`auth:request:email:${email}`, AUTH_REQUEST_RATE_LIMIT, AUTH_REQUEST_WINDOW_MS);
    if (!ipGate.ok || !emailGate.ok) {
      const retryAfter = Math.max(ipGate.retryAfter, emailGate.retryAfter);
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const hashedCode = hashLoginCode(email, code);

    await prisma.token.deleteMany({ where: { email } });
    await prisma.token.create({ data: { email, code: hashedCode, expiresAt } });

    await sendLoginCode(email, code);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/request] POST error:", err);
    const status = err instanceof Error && err.message === "Auth email is not configured." ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? "Login email is not configured." : "Internal server error." }, { status });
  }
}
