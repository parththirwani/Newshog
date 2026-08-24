import { NextResponse } from "next/server";
import { prisma, logStage } from "@newshog/db";
import { generateContent, parseContentResult } from "@/lib/content";
import { isOwner, resolveOwnerIds } from "@/lib/owner";
import type { Angle, ContentKind, ContentDrafts, ExpertiseSummary, CompanyContext, PostPlatform } from "@newshog/shared";

function stringList(value: unknown): string {
  if (Array.isArray(value)) return (value as unknown[]).filter((v) => typeof v === "string").join(", ");
  if (typeof value === "string") return value;
  return "";
}

function buildProfileContext(profile: {
  type: string;
  individual?: { expertiseSummary?: unknown } | null;
  enterprise?: { companyContext?: unknown; companyName?: string } | null;
}): string {
  if (profile.type === "individual" && profile.individual?.expertiseSummary) {
    const s = profile.individual.expertiseSummary as ExpertiseSummary;
    return [
      `Topics: ${stringList(s.topics)}`,
      `Tone: ${s.tone}`,
      `Credentials: ${stringList(s.credentials)}`,
      `Recurring themes: ${stringList(s.recurringThemes)}`,
    ].join("\n");
  }
  if (profile.type === "enterprise" && profile.enterprise?.companyContext) {
    const c = profile.enterprise.companyContext as CompanyContext;
    return [
      `Company: ${profile.enterprise.companyName}`,
      `What they do: ${c.whatTheyDo}`,
      `Who they serve: ${c.whoTheyServe}`,
      `Product categories: ${stringList(c.productCategories)}`,
      `Positioning/voice: ${c.positioningVoice}`,
      `Areas of authority: ${stringList(c.areasOfAuthority)}`,
    ].join("\n");
  }
  return "";
}

// ponytail: fit_assessment/time_framing are returned to the client as a
// one-shot banner but not persisted (survives only until reload/regenerate).
// Ceiling: persist them in drafts when the UI needs the warning post-reload.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const kind = (["pitch", "blog", "post"].includes(body?.kind) ? body.kind : "pitch") as ContentKind;
    const selectedAngle = typeof body?.angle === "string" ? body.angle : undefined;
    // Single post format — posts.md's platform input defaults to linkedin.
    const platform: PostPlatform | undefined = kind === "post" ? "linkedin" : undefined;

    const analysis = await prisma.analysis.findUnique({ where: { id } });
    if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!analysis.rawArticleText) {
      return NextResponse.json({ error: "Article not available yet." }, { status: 409 });
    }

    // Regeneration costs an LLM call — only the owner may burn it on a
    // personalized analysis. Context-free analyses are publicly editable.
    const { userId, profileId: ownerProfileId } = await resolveOwnerIds();
    if (!isOwner(analysis, userId, ownerProfileId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawAngles = analysis.angles as unknown;
    const angles = (Array.isArray(rawAngles) ? rawAngles : []) as Angle[];

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

    let researchContext: string | undefined;
    if (kind !== "pitch" && analysis.researchRunId) {
      const run = await prisma.deepResearchRun.findUnique({ where: { runId: analysis.researchRunId } });
      researchContext = run?.report ?? run?.answer ?? undefined;
    }

    const raw = await generateContent(kind, {
      articleTitle: analysis.articleTitle,
      articleText: analysis.rawArticleText,
      angles,
      selectedAngle,
      profileContext,
      opportunity,
      analysisId: analysis.id,
      platform,
      researchContext,
      analysis: {
        score: analysis.score,
        velocity: analysis.velocity,
        eventTiming: analysis.eventTiming,
        whyNow: analysis.whyNow,
        sourcePublishedAt: analysis.sourcePublishedAt?.toISOString() ?? null,
      },
    });

    const { text, meta } = parseContentResult(kind, raw);

    if (kind === "pitch") {
      await prisma.analysis.update({
        where: { id },
        data: { pitch: text },
      });
      return NextResponse.json({ text, kind, meta });
    }

    const existing = (analysis.drafts as ContentDrafts | null) ?? {};
    const drafts = {
      ...existing,
      [kind]: text,
    };
    await prisma.analysis.update({
      where: { id },
      data: { drafts },
    });
    return NextResponse.json({ text, kind, meta });
  } catch (err) {
    logStage("pitch_failed", { analysisId: id });
    console.error("[api/analyze/:id/pitch] POST error:", err);
    return NextResponse.json({ error: "Failed to generate content." }, { status: 500 });
  }
}