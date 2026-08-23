import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getAnalyzeQueue } from "@newshog/queue";
import { getSessionUser } from "@/lib/auth";
import { isProUser, proDeniedResponse } from "@/lib/pro-gate";

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
    // Deep Research is pro-gated at the API layer. When ENABLE_PRO_GATING is
    // unset (dev/test) everyone passes; otherwise only tier='pro' succeeds.
    const user = await getSessionUser();
    if (!isProUser(user)) return proDeniedResponse();

    const body = await request.json();
    const { url } = body as { url?: string };
    if (!url || typeof url !== "string" || !isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL. Provide a valid http(s) URL." }, { status: 400 });
    }

    if (!user) {
      // Practically unreachable (pro gate passes anonymous only when gating is
      // off) but keep the job owned consistently.
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

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