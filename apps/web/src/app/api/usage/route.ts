import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getSessionUser, getAnonId } from "@/lib/auth";
import { anonQuota, ANON_FREE_LIMIT } from "@/lib/rate-limit";

export async function GET() {
  const user = await getSessionUser();
  if (user) {
    return NextResponse.json({ signedIn: true, email: user.email, used: null, remaining: null });
  }

  const { id, cookie } = await getAnonId();
  const used = await prisma.analysis.count({ where: { anonId: id } });
  const quota = anonQuota(used);
  const res = NextResponse.json({
    signedIn: false,
    used,
    remaining: quota.ok ? quota.remaining : 0,
    freeLimit: ANON_FREE_LIMIT,
  });
  if (cookie) res.cookies.set(cookie);
  return res;
}