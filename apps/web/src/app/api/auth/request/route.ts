import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import crypto from "crypto";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string };

    if (!email || typeof email !== "string" || !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 });
    }

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
