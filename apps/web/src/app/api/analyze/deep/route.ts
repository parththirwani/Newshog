import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getAnalyzeQueue } from "@newshog/queue";
import { requireQuotaUser } from "@/lib/pro-gate";
import { rateLimit, clientIp, DEEP_ANALYZE_RATE_LIMIT, DEEP_ANALYZE_WINDOW_MS } from "@/lib/rate-limit";
import { normalizeUrl } from "@/lib/url";
import { assertSafePublicHttpUrl } from "@newshog/shared";

export async function POST(request: Request) {
  const gate = rateLimit(`analyze:deep:${clientIp(request)}`, DEEP_ANALYZE_RATE_LIMIT, DEEP_ANALYZE_WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many deep analyses. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  try {
    const body = await request.json();
    const { url } = body as { url?: string };
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Invalid URL. Provide a public http(s) URL." }, { status: 400 });
    }
    try {
      assertSafePublicHttpUrl(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL. Provide a public http(s) URL." }, { status: 400 });
    }
    const normalizedUrl = normalizeUrl(url);

    // Deep Research spends real LLM + network budget, so the deep_research
    // quota is enforced here before anything is enqueued. Anonymous callers
    // get a 401 (deep research requires an account); users past their
    // daily/monthly limit get a 429 with the reset time. When
    // ENABLE_PRO_GATING is off (dev/test), the check passes without consuming.
    const gate = await requireQuotaUser("deep_research");
    if (!gate.ok) return gate.response;
    const user = gate.user;

    const analysis = await prisma.analysis.create({
      data: {
        url: normalizedUrl,
        status: "queued",
        userId: user.id,
        profileId: null,
      },
    });

    await getAnalyzeQueue().add("analyze", { analysisId: analysis.id, deepResearch: true }, { jobId: analysis.id });

    return NextResponse.json({ id: analysis.id, deep: true }, { status: 201 });
  } catch (err) {
    console.error("[api/analyze/deep] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
