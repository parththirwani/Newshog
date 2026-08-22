import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { isProfileOwner, resolveOwnerProfileId } from "@/lib/owner";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      select: { profileId: true },
    });
    if (!analysis) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const matches = await prisma.analysisJournalistMatch.findMany({
      where: { analysisId: id },
      include: { journalistRequest: true },
      orderBy: { matchedAt: "desc" },
    });

    // ponytail: non-owners see only a count — match details can expose who
    // asked, which is private. Full list stays owner-only (or public when the
    // analysis is context-free).
    const ownerProfileId = await resolveOwnerProfileId();
    if (!isProfileOwner(analysis.profileId, ownerProfileId)) {
      return NextResponse.json({ count: matches.length });
    }

    return NextResponse.json(matches);
  } catch (err) {
    console.error("[api/analyze/:id/matches] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}