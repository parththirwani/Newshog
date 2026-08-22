import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { generatePitch } from "@/lib/pitch";
import { isProfileOwner, resolveOwnerProfileId } from "@/lib/owner";
import type { Angle, ExpertiseSummary, CompanyContext } from "@newshog/shared";

function buildProfileContext(profile: {
  type: string;
  individual?: { expertiseSummary?: unknown } | null;
  enterprise?: { companyContext?: unknown; companyName?: string } | null;
}): string {
  if (profile.type === "individual" && profile.individual?.expertiseSummary) {
    const s = profile.individual.expertiseSummary as ExpertiseSummary;
    return [
      `Topics: ${s.topics.join(", ")}`,
      `Tone: ${s.tone}`,
      `Credentials: ${s.credentials.join(", ")}`,
      `Recurring themes: ${s.recurringThemes.join(", ")}`,
    ].join("\n");
  }
  if (profile.type === "enterprise" && profile.enterprise?.companyContext) {
    const c = profile.enterprise.companyContext as CompanyContext;
    return [
      `Company: ${profile.enterprise.companyName}`,
      `What they do: ${c.whatTheyDo}`,
      `Who they serve: ${c.whoTheyServe}`,
      `Product categories: ${c.productCategories.join(", ")}`,
      `Positioning/voice: ${c.positioningVoice}`,
      `Areas of authority: ${c.areasOfAuthority.join(", ")}`,
    ].join("\n");
  }
  return "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const selectedAngle = typeof body?.angle === "string" ? body.angle : undefined;

    const analysis = await prisma.analysis.findUnique({ where: { id } });
    if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!analysis.rawArticleText) {
      return NextResponse.json({ error: "Article not available yet." }, { status: 409 });
    }

    // Pitch regeneration costs an LLM call — only the owner may burn it on a
    // personalized analysis. Context-free analyses are publicly editable.
    const ownerProfileId = await resolveOwnerProfileId();
    if (!isProfileOwner(analysis.profileId, ownerProfileId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const angles = (analysis.angles ?? []) as unknown as Angle[];

    let profileContext: string | undefined;
    if (analysis.profileId) {
      const profile = await prisma.profile.findUnique({
        where: { id: analysis.profileId },
        include: { individual: true, enterprise: true },
      });
      if (profile) {
        const ctx = buildProfileContext(profile);
        if (ctx) profileContext = ctx;
      }
    }

    const latestMatch = await prisma.analysisJournalistMatch.findFirst({
      where: { analysisId: id },
      include: { journalistRequest: true },
      orderBy: { matchedAt: "desc" },
    });

    const opportunity = latestMatch
      ? {
          requesterName: latestMatch.journalistRequest.requesterName ?? undefined,
          outlet: latestMatch.journalistRequest.outlet ?? undefined,
          topicText: latestMatch.journalistRequest.topicText,
        }
      : undefined;

    const pitch = await generatePitch({
      articleTitle: analysis.articleTitle,
      articleText: analysis.rawArticleText,
      angles: angles as Angle[],
      selectedAngle,
      profileContext,
      opportunity,
    });

    const saved = await prisma.analysis.update({
      where: { id },
      data: { pitch },
      select: { pitch: true },
    });

    return NextResponse.json(saved);
  } catch (err) {
    console.error("[api/analyze/:id/pitch] POST error:", err);
    return NextResponse.json({ error: "Failed to generate pitch." }, { status: 500 });
  }
}