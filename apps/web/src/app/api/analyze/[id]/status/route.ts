import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        status: true,
        articleTitle: true,
        score: true,
        angles: true,
        whyNow: true,
        pitch: true,
        error: true,
        profileId: true,
        updatedAt: true,
      },
    });

    if (!analysis) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[api/analyze/:id/status] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
