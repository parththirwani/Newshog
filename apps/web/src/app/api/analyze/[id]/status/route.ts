import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { isOwner, resolveOwnerIds } from "@/lib/owner";

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
        velocity: true,
        angles: true,
        whyNow: true,
        pitch: true,
        error: true,
        profileId: true,
        userId: true,
        researchRunId: true,
        updatedAt: true,
      },
    });

    if (!analysis) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { userId, profileId: ownerProfileId } = await resolveOwnerIds();
    const owner = isOwner(analysis, userId, ownerProfileId);

    // ponytail: owner gating is "context-free = public, else cookie(userId or
    // profileId) match". Context-free analyses hold no private data. The
    // owner's userId stays out of the public response — it's the account id.
    if (!owner) {
      const { pitch: _pitch, userId: _userId, ...pub } = analysis;
      return NextResponse.json(pub);
    }

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[api/analyze/:id/status] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
