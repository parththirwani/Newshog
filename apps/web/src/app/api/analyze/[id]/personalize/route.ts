import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { isOwner, resolveOwnerIds } from "@/lib/owner";

// Attach the current user's profile to an existing analysis so subsequent
// content generation (pitch/blog/post) is written in that profile's voice.
// The worker's analysis/angles stay as-is — only the output drafts are
// re-personalized. Ceiling: angles aren't retargeted to the profile (no
// is_stretch/fit_rationale); re-run the analysis (re-analyze) for that.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { userId, profileId } = await resolveOwnerIds();
  if (!userId) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!profileId) {
    return NextResponse.json({ error: "No profile yet. Create one on the profile page first." }, { status: 409 });
  }

  const analysis = await prisma.analysis.findUnique({ where: { id } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isOwner(analysis, userId, profileId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Context-free (public) analyses belong to whoever holds the link — attaching
  // a profile would quietly privatize a shared result for every other visitor.
  // Only user-owned analyses may be personalized in place; for a public one,
  // re-run it with the profile (the homepage "re-analyze with my profile" path).
  if (!analysis.userId) {
    return NextResponse.json(
      { error: "This analysis is public. Re-run it with your profile to personalize it." },
      { status: 409 },
    );
  }

  // Re-link to the profile and drop existing unpersonalized drafts so the UI
  // regenerates them in the profile's voice on next view.
  await prisma.analysis.update({
    where: { id },
    data: { profileId, pitch: null, drafts: {} },
  });

  return NextResponse.json({ ok: true, profileId });
}