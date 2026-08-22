import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const matches = await prisma.analysisJournalistMatch.findMany({
      where: { analysisId: id },
      include: { journalistRequest: true },
      orderBy: { matchedAt: "desc" },
    });

    return NextResponse.json(matches);
  } catch (err) {
    console.error("[api/analyze/:id/matches] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
