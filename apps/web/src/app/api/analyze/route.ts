import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getAnalyzeQueue, ANALYZE_QUEUE } from "@newshog/queue";

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

    const analysis = await prisma.analysis.create({
      data: { url, status: "queued" },
    });

    const queue = getAnalyzeQueue();
    await queue.add(ANALYZE_QUEUE, { analysisId: analysis.id }, { jobId: analysis.id });

    return NextResponse.json({ id: analysis.id }, { status: 201 });
  } catch (err) {
    console.error("[api/analyze] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
