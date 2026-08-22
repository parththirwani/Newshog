import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getAnalyzeQueue, ANALYZE_QUEUE } from "@newshog/queue";
import { rateLimit, clientIp, ANALYZE_RATE_LIMIT, ANALYZE_WINDOW_MS } from "@/lib/rate-limit";
import { trackServer } from "@/lib/analytics";
import { normalizeUrl } from "@/lib/url";
import { ANALYSIS_DEDUPE_HOURS } from "@newshog/shared";

function isValidUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // ponytail: in-memory per-process token bucket (10/hr/key). Single-node
  // ceiling; swap to the redis in packages/queue (createConnection) in
  // Phase 8 when the web app runs more than one instance.
  const gate = rateLimit(`analyze:${clientIp(request)}`, ANALYZE_RATE_LIMIT, ANALYZE_WINDOW_MS);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many analyses. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  try {
    const body = await request.json();
    const { url, profileId } = body as { url?: string; profileId?: string };

    if (!url || typeof url !== "string" || !isValidUrl(url)) {
      return NextResponse.json({ error: "Invalid URL. Provide a valid http(s) URL." }, { status: 400 });
    }

    const normalizedUrl = normalizeUrl(url);

    // Dedupe: don't re-run the expensive pipeline for a URL already analyzed
    // in the window. Escapes via DELETE then POST again if it goes stale.
    const recent = await prisma.analysis.findFirst({
      where: {
        url: normalizedUrl,
        profileId: profileId || null,
        status: "analyzed",
        createdAt: { gt: new Date(Date.now() - ANALYSIS_DEDUPE_HOURS * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) {
      trackServer("url_deduped", { profileId: profileId ?? null });
      return NextResponse.json({ id: recent.id, deduped: true }, { status: 201 });
    }

    const analysis = await prisma.analysis.create({
      data: { url: normalizedUrl, status: "queued", profileId: profileId || null },
    });

    const queue = getAnalyzeQueue();
    await queue.add(ANALYZE_QUEUE, { analysisId: analysis.id }, { jobId: analysis.id });

    trackServer("url_pasted", { profileId: profileId ?? null });

    return NextResponse.json({ id: analysis.id }, { status: 201 });
  } catch (err) {
    console.error("[api/analyze] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
