import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { DEEP_RESEARCH_QUEUE, getDeepResearchQueue } from "@newshog/queue";
import { validateClarificationAnswers } from "@newshog/deep-research";
import { requireQuotaUser } from "@/lib/pro-gate";
import { guard } from "@/lib/rate-limit";
import { parseBody, DeepResearchBodySchema } from "@/lib/schemas";

export async function POST(request: Request) {
  // A.1: 5/min/IP before anything else — runs burn LLM + scrape budget.
  const limited = await guard(request, "deep-research");
  if (!limited.allowed) return limited.response;

  // Deep Research spends real LLM + network budget (search/scrape), so it's
  // quota-gated even on the standalone tool routes — not just /api/analyze/deep.
  // The consuming check runs after the cheap field validation (below) so a
  // malformed request doesn't burn a run from the user's ceiling, but before
  // any prepare-session write, run creation, or enqueue — a denied request
  // never consumes a clarification prepare_session or enqueues a job.
  try {
    // A.4: strict zod shape (query/depth/breadth/mode + prepare-session
    // fields) with a 64KB body cap, before any DB write or quota consume.
    const parsed = await parseBody(request, DeepResearchBodySchema);
    if (!parsed.ok) return parsed.response;
    const {
      query: q,
      depth,
      breadth,
      mode,
      prepareSessionId,
      skipClarification,
      clarificationAnswers,
    } = parsed.data;

    // Ownership anchor for DeepResearchRun: standalone runs belong to the
    // creating user, so the run-level endpoints ([runId] read/cancel, events)
    // can scope access to that user instead of any caller who knows the id.
    // NOT gated here — the consuming quota check sits AFTER the clarification
    // session is validated, so a 400 (missing/replayed prepare session, bad
    // answers) never burns a run from the caller's ceiling.

    // Mandatory clarification. Unless the caller explicitly opts out, the run
    // must reference a persisted prepare session that has not been replayed.
    let createdRunId: string;
    if (!skipClarification) {
      if (!prepareSessionId) {
        return NextResponse.json(
          { error: "clarification required: run /api/deep-research/prepare first and submit prepareSessionId + answers." },
          { status: 400 },
        );
      }
      let answers;
      try {
        answers = validateClarificationAnswers(clarificationAnswers);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
      if (answers.length === 0) {
        return NextResponse.json({ error: "clarification answers are required." }, { status: 400 });
      }

      const session = await prisma.deepResearchSession.findUnique({ where: { id: prepareSessionId } });
      if (!session || session.used || Array.isArray(session.answers)) {
        return NextResponse.json(
          { error: "Invalid or already-used prepare session. Call /api/deep-research/prepare again." },
          { status: 400 },
        );
      }

      // Consume quota now: every earlier 400 path has already returned, so a
      // denial here never burns a run and an allowance is never wasted on a
      // request that was going to be rejected.
      const gate = await requireQuotaUser("deep_research");
      if (!gate.ok) return gate.response;
      const userId = gate.user.id;

      // Persist the answers to the session so the worker folds them into the
      // research context.
      await prisma.deepResearchSession.update({
        where: { id: prepareSessionId },
        data: { answers: answers as object[] },
      });

      const run = await prisma.deepResearchRun.create({
        data: {
          runId: crypto.randomUUID(),
          status: "queued",
          userId,
          query: q,
          depth,
          breadth,
          mode,
          prepareSessionId,
          skipClarification: false,
          clarificationAnswers: answers as object[],
          coveredQueries: [],
          learnings: [],
          sources: [],
          visitedUrls: [],
        },
      });
      createdRunId = run.runId;

      try {
        await getDeepResearchQueue().add(DEEP_RESEARCH_QUEUE, buildJobPayload(run), { jobId: run.runId });
      } catch (err) {
        // An enqueue failure must not silently strand the run as "queued"
        // forever or burn the prepare session — clean up and rethrow.
        await prisma.deepResearchRun.delete({ where: { runId: run.runId } }).catch(() => {});
        await prisma.deepResearchSession.update({ where: { id: prepareSessionId }, data: { used: false } }).catch(() => {});
        throw err;
      }

      // Mark the session consumed so it cannot be replayed onto another run.
      await prisma.deepResearchSession.update({ where: { id: prepareSessionId }, data: { used: true } });
    } else {
      // Skip-clarification path still consumes quota — deny before creating
      // the run so a rejected request never leaves an orphaned queued run.
      const gate = await requireQuotaUser("deep_research");
      if (!gate.ok) return gate.response;
      const userId = gate.user.id;

      const run = await prisma.deepResearchRun.create({
        data: {
          runId: crypto.randomUUID(),
          status: "queued",
          userId,
          query: q,
          depth,
          breadth,
          mode,
          skipClarification: true,
          coveredQueries: [],
          learnings: [],
          sources: [],
          visitedUrls: [],
        },
      });
      createdRunId = run.runId;
      try {
        await getDeepResearchQueue().add(DEEP_RESEARCH_QUEUE, buildJobPayload(run), { jobId: run.runId });
      } catch (err) {
        await prisma.deepResearchRun.delete({ where: { runId: run.runId } }).catch(() => {});
        throw err;
      }
    }

    return NextResponse.json({ runId: createdRunId, status: "queued" }, { status: 202 });
  } catch (err) {
    console.error("[api/deep-research] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

interface RunRow {
  runId: string;
  query: string;
  depth: number;
  breadth: number;
  mode: string;
  clarificationAnswers?: unknown;
  skipClarification: boolean;
}

function buildJobPayload(run: RunRow) {
  return {
    runId: run.runId,
    query: run.query,
    depth: run.depth,
    breadth: run.breadth,
    mode: run.mode as "answer" | "report",
    clarificationAnswers: Array.isArray(run.clarificationAnswers) ? (run.clarificationAnswers as unknown[]) : [],
    skipClarification: run.skipClarification,
  };
}