import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { email, code } = (await request.json()) as { email?: string; code?: string };

    if (!email || !code || typeof email !== "string" || typeof code !== "string") {
      return NextResponse.json({ error: "Email and code required." }, { status: 400 });
    }

    const token = await prisma.token.findFirst({
      where: {
        email,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!token) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 401 });
    }

    await prisma.token.delete({ where: { id: token.id } });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(email));
    return res;
  } catch (err) {
    console.error("[api/auth/verify] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
