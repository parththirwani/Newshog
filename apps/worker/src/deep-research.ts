import { Worker } from "bullmq";
import { prisma } from "@newshog/db";
import { DEEP_RESEARCH_QUEUE, createConnection } from "@newshog/queue";
import { runResearch, createEventEmitter, createOpenRouterHandler, createTokenBudget } from "@newshog/deep-research";
import type { ClarificationAnswer, Emitter } from "@newshog/deep-research";

interface DeepResearchJobData {
  runId: string;
  query: string;
  depth: number;
  breadth: number;
  mode: "answer" | "report";
  clarificationAnswers: ClarificationAnswer[];
  skipClarification: boolean;
}

const eventChannel = (runId: string) => `deep-research:${runId}`;
const cancelChannel = (runId: string) => `deep-research-cancel:${runId}`;

export function deepResearchWorker(): Worker {
  const conn = createConnection();
  const pub = createConnection();

  return new Worker<DeepResearchJobData>(
    DEEP_RESEARCH_QUEUE,
    async (job) => {
      const { runId } = job.data;
      const controller = new AbortController();

      const cancelSub = conn.duplicate();
      await cancelSub.subscribe(cancelChannel(runId), (message) => {
        if (message === "cancel") controller.abort();
      });

      const budget = createTokenBudget();
      // Persist cost totals as the run spends — surfaced live via the snapshot.
      const emit: Emitter = createEventEmitter({
        runId,
        onEvent(event) {
          if (event.type === "cost.updated") {
            prisma.deepResearchRun.update({
              where: { runId },
              data: { promptTokens: budget.promptTokens, completionTokens: budget.completionTokens },
            }).catch(() => {});
          }
          pub.publish(eventChannel(runId), JSON.stringify(event)).catch(() => {});
        },
      });

      try {
        const run = await prisma.deepResearchRun.findUnique({ where: { runId } });
        if (!run || run.cancelled) return;

        await prisma.deepResearchRun.update({ where: { runId }, data: { status: "running" } });

        const outcome = await runResearch(
          {
            query: job.data.query,
            depth: job.data.depth,
            breadth: job.data.breadth,
            mode: job.data.mode,
            clarificationAnswers: job.data.clarificationAnswers,
            skipClarification: job.data.skipClarification,
          },
          { handler: createOpenRouterHandler(), budget, emit, signal: controller.signal },
        );

        // A cancel may have arrived before this run's subscription existed; honor
        // the DB flag rather than persisting a completed result for a cancelled run.
        const laterRun = await prisma.deepResearchRun.findUnique({ where: { runId } });
        if (laterRun?.cancelled) {
          await prisma.deepResearchRun.update({ where: { runId }, data: { status: "cancelled", error: "Cancel received after finish marker." } }).catch(() => {});
          return;
        }

        const status = outcome.truncated
          ? ("truncated" as const)
          : (outcome.lowConfidence ? ("low_confidence" as const) : ("completed" as const));
        await prisma.deepResearchRun.update({
          where: { runId },
          data: {
            status,
            learnings: outcome.learnings as unknown as object[],
            sources: outcome.sources as unknown as object[],
            visitedUrls: outcome.visitedUrls as unknown as object[],
            coveredQueries: outcome.coveredQueries as unknown as object[],
            answer: outcome.answer ?? null,
            report: outcome.report ?? null,
            promptTokens: outcome.promptTokens,
            completionTokens: outcome.completionTokens,
            ...(outcome.truncationReason ? { error: outcome.truncationReason } : {}),
          },
        }).catch((err) => console.error("[deep-research] final persist failed:", err));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = error instanceof Error && error.message === "Research cancelled";
        await prisma.deepResearchRun.update({
          where: { runId },
          data: { status: cancelled ? "cancelled" : "failed", error: message },
        }).catch(() => {});
        if (!cancelled) throw error;
      } finally {
        await cancelSub.unsubscribe(cancelChannel(runId)).catch(() => {});
        cancelSub.disconnect();
      }
    },
    { connection: conn, concurrency: 1 },
  );
}