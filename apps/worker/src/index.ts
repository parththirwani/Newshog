import { Worker } from "bullmq";
import { prisma, recordLlmCall, logStage } from "@newshog/db";
import { ANALYZE_QUEUE, EMAIL_INGEST_QUEUE, MATCH_QUEUE, createConnection, getMatchQueue, DEEP_RESEARCH_QUEUE } from "@newshog/queue";
import { scrapeArticle } from "./scrape";
import { extractPublishDate } from "@newshog/deep-research";
import { analyzeArticle } from "./analyze";
import { fetchDigestEmails, markEmailsSeen } from "./email-fetch";
import { extractJournalistRequests } from "./extract-requests";
import { matchRequestsToAnalysis } from "./match-requests";
import { deepResearchWorker } from "./deep-research";
import { deepAnalyzeArticle } from "./deep-analyze";
import { applyGrounding } from "./postprocess";
import type { ExpertiseSummary, CompanyContext, JournalistRequest } from "@newshog/shared";

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

const connection = createConnection();

// Cap LLM-consuming worker concurrency per minute (analyze + match) so a
// viral-story spike degrades to queue wait rather than a runaway bill.
const LLM_CALLS_PER_MIN = 60;

// ── Analyze worker ──────────────────────────────────────────────

const analyzeWorker = new Worker(
  ANALYZE_QUEUE,
  async (job) => {
    const { analysisId, deepResearch } = job.data as { analysisId: string; deepResearch?: boolean };
    console.log(`[worker] processing analysis ${analysisId}${deepResearch ? " (deep research)" : ""}`);
    logStage("job_start", { analysisId, deepResearch: deepResearch ?? false });

    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) throw new Error(`Analysis ${analysisId} not found`);

    await prisma.analysis.update({
      where: { id: analysisId },
      data: { status: "scraping" },
    });

    try {
      const scraped = await scrapeArticle(analysis.url);
      const publishedAt = extractPublishDate(scraped.text);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "scraped",
          articleTitle: scraped.title,
          rawArticleText: scraped.text,
          extractionMode: scraped.mode,
          ...(publishedAt ? { sourcePublishedAt: publishedAt } : {}),
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

      // Deep Research is a pre-analysis context step: research the article's
      // topic, then feed the digest into the SAME analysis call. Result is the
      // same Analysis shape — just a researchRunId link + richer grounding.
      let researchContext: string | undefined;
      let researchRunId: string | null = null;
      let coverageSignal: import("@newshog/shared").CoverageSignal | null | undefined;
      if (deepResearch) {
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: "researching" },
        });

        const research = await deepAnalyzeArticle({
          title: scraped.title,
          articleText: scraped.text,
          analysisId,
          analysisUserId: analysis.userId ?? null,
          articleUrl: analysis.url,
          articlePublishedAt: publishedAt ? publishedAt.toISOString() : null,
        });
        researchContext = research.digest;
        researchRunId = research.runId;
        coverageSignal = research.coverageSignal;

        // Research set "researching" — reset to "analyzing" before the LLM.
        await prisma.analysis.update({
          where: { id: analysisId },
          data: { status: "analyzing" },
        });
      }

      // Free (non-deep) calls get no grounding arg — coverageSignal is null and
      // the model/the scorer run exactly as before.
      const analysisArgs: Parameters<typeof analyzeArticle> = [
        scraped.text,
        scraped.title,
        profileContext,
        analysisId,
        researchContext,
      ];
      if (coverageSignal) {
        analysisArgs.push({ sourcePublishedAt: publishedAt?.toISOString() ?? null, coverageSignal });
      }
      const result = await analyzeArticle(...analysisArgs);

      // Deterministic post-processing: saturation + precedes overrides. Free
      // (non-deep) scores have no coverageSignal so nothing is adjusted.
      const grounded = applyGrounding(result, {
        sourcePublishedAt: publishedAt?.toISOString() ?? null,
        coverageSignal,
      });

      // ponytail: pitch (and blog/post) generation is FE-driven on demand —
      // worker-side eager generation spent an LLM call on every analysis even
      // when the owner never opens the result. Analyses complete with no pitch;
      // the result view generates it on first load. Ceiling: revisit with a
      // batch gen job when per-analysis cost gets measured.
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: "analyzed",
          score: grounded.score,
          velocity: grounded.velocity,
          velocityReasoning: result.velocity_reasoning,
          whyNow: result.why_now,
          angles: result.angles,
          ...(grounded.noveltyScore != null ? { noveltyScore: grounded.noveltyScore } : {}),
          ...(grounded.eventTiming ? { eventTiming: grounded.eventTiming } : {}),
          ...(coverageSignal ? { coverageSignal } : {}),
          ...(researchRunId ? { researchRunId } : {}),
        },
      });

      console.log(`[worker] analyzed ${analysisId} (score: ${result.score})`);

      // Enqueue journalist request matching — a failure here must not mark the
      // already-completed analysis as failed.
      try {
        await getMatchQueue().add("match", { analysisId }, { jobId: `match-${analysisId}` });
      } catch (err) {
        console.error(`[worker] failed to enqueue match for ${analysisId}:`, err);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] failed ${analysisId}:`, message);

      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: "failed", error: message },
      });
    }
  },
  { connection: createConnection(), concurrency: 2, limiter: { max: LLM_CALLS_PER_MIN, duration: 60_000 } },
);

// ── Match worker ────────────────────────────────────────────────

const matchWorker = new Worker(
  MATCH_QUEUE,
  async (job) => {
    const { analysisId } = job.data as { analysisId: string };
    console.log(`[worker] matching requests for analysis ${analysisId}`);

    const analysis = await prisma.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis || !Array.isArray(analysis.angles)) return;

    // Fetch all non-expired journalist requests
    const now = new Date();
    const requests = await prisma.journalistRequest.findMany({
      where: {
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });

    if (requests.length === 0) {
      console.log(`[worker] no open requests for ${analysisId}, skipping match`);
      return;
    }

    // Build profile context if profile exists
    let profileContext: string | null = null;
    if (analysis.profileId) {
      const profile = await prisma.profile.findUnique({
        where: { id: analysis.profileId },
        include: { individual: true, enterprise: true },
      });
      if (profile) profileContext = buildProfileContext(profile) || null;
    }

    const angles = analysis.angles as unknown as import("@newshog/shared").Angle[];
    const typedRequests = requests.map((r) => ({
      id: r.id,
      sourcePlatform: r.sourcePlatform as import("@newshog/shared").SourcePlatform,
      requesterName: r.requesterName ?? undefined,
      outlet: r.outlet ?? undefined,
      topicText: r.topicText,
      deadline: r.deadline?.toISOString() ?? undefined,
      replyContact: r.replyContact ?? undefined,
      ingestedAt: r.ingestedAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? undefined,
    })) satisfies JournalistRequest[];

    const matches = await matchRequestsToAnalysis(angles, profileContext, typedRequests, analysisId);

    for (const m of matches) {
      await prisma.analysisJournalistMatch.upsert({
        where: {
          analysisId_journalistRequestId: {
            analysisId,
            journalistRequestId: m.journalist_request_id,
          },
        },
        create: {
          analysisId,
          journalistRequestId: m.journalist_request_id,
          matchRationale: m.match_rationale,
        },
        update: { matchRationale: m.match_rationale },
      });
    }

    console.log(`[worker] matched ${matches.length} requests for ${analysisId}`);
  },
  { connection: createConnection(), concurrency: 2, limiter: { max: LLM_CALLS_PER_MIN, duration: 60_000 } },
);

// ── Email ingest worker ─────────────────────────────────────────

const emailIngestWorker = new Worker(
  EMAIL_INGEST_QUEUE,
  async () => {
    console.log("[worker] starting email digest ingestion");

    const emails = await fetchDigestEmails();
    console.log(`[worker] fetched ${emails.length} digest emails`);

    const processedUids: number[] = [];

    for (const email of emails) {
      // One bad email (parse error, LLM hiccup, bad deadline) must not abort
      // the rest of the batch — it just retries next poll.
      try {
        const requests = await extractJournalistRequests(email.text || email.subject);
        console.log(`[worker] extracted ${requests.length} requests from: ${email.subject}`);

        for (const r of requests) {
          const recentDuplicate = await prisma.journalistRequest.findFirst({
            where: {
              sourcePlatform: email.platform,
              topicText: r.topic_text,
              ingestedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          });
          if (recentDuplicate) continue;

          // deadline also starts as "ISO 8601 or natural language" from the
          // LLM tool schema, so guard against unparseable values.
          const deadline = r.deadline && !Number.isNaN(Date.parse(r.deadline)) ? new Date(r.deadline) : null;

          await prisma.journalistRequest.create({
            data: {
              sourcePlatform: email.platform,
              requesterName: r.requester_name,
              outlet: r.outlet,
              topicText: r.topic_text,
              deadline,
              replyContact: r.reply_contact,
              rawEmailRef: email.subject,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 day expiry
            },
          });
        }

        processedUids.push(email.uid);
      } catch (err) {
        console.error(`[worker] failed to ingest email "${email.subject}":`, err);
      }
    }

    // Flag seen only after successful persistence so a failed email retries.
    if (processedUids.length > 0) {
      await markEmailsSeen(processedUids);
    }

    console.log("[worker] email digest ingestion complete");
  },
  { connection: createConnection(), concurrency: 1 },
);

// ── Schedule email ingest every 4 hours ────────────────────────

import { Queue } from "bullmq";

async function scheduleEmailIngest() {
  const queue = new Queue(EMAIL_INGEST_QUEUE, { connection });
  const existingJobs = await queue.getJobSchedulers();
  const hasScheduler = existingJobs.some((j) => j.name === "email-digest");
  if (!hasScheduler) {
    await queue.upsertJobScheduler("email-digest", { every: 4 * 60 * 60 * 1000 });
    console.log("[worker] scheduled email digest ingestion every 4h");
  }
  await queue.close();
}

scheduleEmailIngest().catch(console.error);

const deepResearchWorkerInstance = deepResearchWorker();

console.log("[worker] ready — listening on queues:", ANALYZE_QUEUE, EMAIL_INGEST_QUEUE, MATCH_QUEUE, DEEP_RESEARCH_QUEUE);
