import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import crypto from "crypto";
import { guard, hashScope } from "@/lib/rate-limit";
import { parseBody, AuthRequestBodySchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    // A.4: strict body parse first so the email-scoped limit can key on it.
    // Garbage bodies still burn the IP window but never reach the DB.
    const parsed = await parseBody(request, AuthRequestBodySchema);
    if (!parsed.ok) {
      const ipOnly = await guard(request, "auth-request");
      return ipOnly.allowed ? parsed.response : ipOnly.response;
    }
    const { email } = parsed.data;

    // A.1: 3/hour/IP AND 3/hour/email (email hashed — no PII in limiter keys).
    // The response stays identical whether or not the account exists (A.6).
    const limited = await guard(request, "auth-request", { extraKeys: { email: hashScope(email) } });
    if (!limited.allowed) return limited.response;

    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.token.create({
      data: { email, code, expiresAt },
    });

    console.log(`\n[auth] Verification code for ${email}: ${code}\n`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/request] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
