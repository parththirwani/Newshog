import { NextResponse } from "next/server";
import { getSessionUser, getAnonId } from "@/lib/auth";
import { getQuotaStatus } from "@/lib/usage";

export async function GET() {
  const user = await getSessionUser();

  if (user) {
    const [quickSearch, deepResearch] = await Promise.all([
      getQuotaStatus({ userId: user.id }, "quick_search"),
      getQuotaStatus({ userId: user.id }, "deep_research"),
    ]);
    return NextResponse.json({
      signedIn: true,
      email: user.email,
      tier: quickSearch.tier,
      pro: quickSearch.tier === "pro",
      quickSearch: {
        used: quickSearch.used,
        limit: quickSearch.limit,
        resetsAt: quickSearch.resetsAt,
      },
      deepResearch: {
        used: deepResearch.used,
        limit: deepResearch.limit,
        resetsAt: deepResearch.resetsAt,
      },
    });
  }

  const anon = await getAnonId();
  const [quickSearch, deepResearch] = await Promise.all([
    getQuotaStatus({ anonId: anon.id }, "quick_search"),
    getQuotaStatus({ anonId: anon.id }, "deep_research"),
  ]);
  const res = NextResponse.json({
    signedIn: false,
    tier: "anonymous",
    pro: false,
    quickSearch: {
      used: quickSearch.used,
      limit: quickSearch.limit,
      resetsAt: null,
    },
    deepResearch: {
      used: deepResearch.used,
      limit: deepResearch.limit,
      resetsAt: null,
    },
  });
  if (anon.cookie) res.cookies.set(anon.cookie);
  return res;
}