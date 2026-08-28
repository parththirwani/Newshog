import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getAnalyzeQueue } from "@newshog/queue";
import { requireQuotaUser } from "@/lib/pro-gate";

function isValidUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };
    if (!url || typeof url !== "string" || !isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL. Provide a valid http(s) URL." }, { status: 400 });
    }

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
        url,
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