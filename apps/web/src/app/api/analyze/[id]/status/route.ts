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

    const ownerProfileId = await resolveOwnerProfileId();
    const owner = isProfileOwner(analysis.profileId, ownerProfileId);

    // ponytail: owner gating is "no profile = public, else cookie(profile.ownerEmail)
    // match". Real per-user accounts/ACL = Phase 7+. Context-free analyses stay
    // public since they hold no private profile data.
    if (!owner) {
      const { pitch: _pitch, ...pub } = analysis;
      return NextResponse.json(pub);
    }

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[api/analyze/:id/status] GET error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
