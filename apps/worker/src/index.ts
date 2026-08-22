import { Worker } from "bullmq";
import { prisma } from "@newshog/db";
import { ANALYZE_QUEUE, createConnection } from "@newshog/queue";
import { scrapeArticle } from "./scrape";
import { analyzeArticle } from "./analyze";

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

      const result = await analyzeArticle(scraped.text, scraped.title);

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
