import { Worker } from "bullmq";
import { prisma } from "@newshog/db";
import { ANALYZE_QUEUE, createConnection } from "@newshog/queue";
import { scrapeArticle } from "./scrape";

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
      const result = await scrapeArticle(analysis.url);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "scraped",
          articleTitle: result.title,
          rawArticleText: result.text,
          extractionMode: result.mode,
        },
      });

      console.log(`[worker] done ${analysisId} (${result.mode}, ${result.text.length} chars)`);
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
