import { Worker } from "bullmq";
import { prisma } from "@newshog/db";
import { ANALYZE_QUEUE, createConnection } from "@newshog/queue";
import { scrapeArticle } from "./scrape";
import { analyzeArticle } from "./analyze";
import type { ExpertiseSummary, CompanyContext } from "@newshog/shared";

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

const worker = new Worker(
  ANALYZE_QUEUE,
  async (job) => {
    const { analysisId } = job.data as { analysisId: string };
    console.log(`[worker] processing analysis ${analysisId}`);

    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) throw new Error(`Analysis ${analysisId} not found`);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: "scraping" },
    });

    try {
      const scraped = await scrapeArticle(analysis.url);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "scraped",
          articleTitle: scraped.title,
          rawArticleText: scraped.text,
          extractionMode: scraped.mode,
        },
      });

      console.log(`[worker] scraped ${analysisId} (${scraped.mode}, ${scraped.text.length} chars)`);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: "analyzing" },
      });

      let profileContext: string | undefined;
      if (analysis.profileId) {
        const profile = await prisma.profile.findUnique({
          where: { id: analysis.profileId },
          include: { individual: true, enterprise: true },
        });
        if (profile) profileContext = buildProfileContext(profile) || undefined;
      }

      const result = await analyzeArticle(scraped.text, scraped.title, profileContext);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "analyzed",
          score: result.score,
          whyNow: result.why_now,
          angles: result.angles,
        },
      });

      console.log(`[worker] analyzed ${analysisId} (score: ${result.score})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] failed ${analysisId}:`, message);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: "failed", error: message },
      });
    }
  },
  {
    connection: createConnection(),
    concurrency: 2,
  },
);

console.log("[worker] ready — listening on queue:", ANALYZE_QUEUE);
