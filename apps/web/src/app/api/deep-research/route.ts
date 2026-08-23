import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { DEEP_RESEARCH_QUEUE, getDeepResearchQueue } from "@newshog/queue";
import { validateClarificationAnswers } from "@newshog/deep-research";
import { requireProUser } from "@/lib/pro-gate";

export async function POST(request: Request) {
  // Deep Research spends real LLM + network budget (search/scrape), so it's
  // gated even on the standalone tool routes — not just /api/analyze/deep.
  const gate = await requireProUser();
  if (!gate.ok) return gate.response;

  // Ownership anchor for DeepResearchRun: standalone runs belong to the
  // creating user, so the run-level endpoints ([runId] read/cancel, events)
  // can scope access to that user instead of any caller who knows the id.
  const userId = gate.user.id;

  try {
    const body = await request.json();
    const {
      query,
      depth = 2,
      breadth = 3,
      mode = "answer",
      prepareSessionId,
      skipClarification = false,
    } = body as {
      query?: string;
      depth?: number;
      breadth?: number;
      mode?: string;
      prepareSessionId?: string;
      skipClarification?: boolean;
    };

    let clarificationAnswers: unknown[] = [];
    if (Array.isArray(body.clarificationAnswers)) clarificationAnswers = body.clarificationAnswers;

    const q = typeof query === "string" ? query.trim() : "";
    if (!q || q.length > 8000) {
      return NextResponse.json({ error: "query must be a string between 1 and 8000 characters." }, { status: 400 });
    }
    if (!Number.isInteger(depth) || depth < 1 || depth > 4) {
      return NextResponse.json({ error: "depth must be an integer between 1 and 4." }, { status: 400 });
    }
    if (!Number.isInteger(breadth) || breadth < 1 || breadth > 6) {
      return NextResponse.json({ error: "breadth must be an integer between 1 and 6." }, { status: 400 });
    }
    if (mode !== "answer" && mode !== "report") {
      return NextResponse.json({ error: "mode must be answer or report." }, { status: 400 });
    }

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