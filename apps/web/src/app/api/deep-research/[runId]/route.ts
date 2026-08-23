import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getSessionUser } from "@/lib/auth";
import { createConnection } from "@newshog/queue";

// A run is owned by its creating user. Runs without a userId are public
// context (e.g. anonymous deep-analyze paths). 404 (not 403) on mismatched
// ownership so unguessable runIds don't leak existence.
async function isRunUser(runId: string) {
  const run = await prisma.deepResearchRun.findUnique({ where: { runId } });
  if (!run) return null;
  if (!run.userId) return run;
  const user = await getSessionUser();
  return user?.id === run.userId ? run : null;
}

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await isRunUser(runId);
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Sources carry grounding status/audit fields server-side only — never to the
  // client. The UI renders plain functional hyperlinks, not a trust badge.
  const sources = Array.isArray(run.sources)
    ? (run.sources as Array<Record<string, unknown>>).map(({ status: _, claimText: __, reason: ___, ...rest }) => rest)
    : [];

  return NextResponse.json({
    runId: run.runId,
    status: run.status,
    query: run.query,
    mode: run.mode,
    depth: run.depth,
    breadth: run.breadth,
    learnings: run.learnings,
    sources,
    visitedUrls: run.visitedUrls,
    coveredQueries: run.coveredQueries,
    answer: run.answer,
    report: run.report,
    promptTokens: run.promptTokens,
    completionTokens: run.completionTokens,
    truncated: run.status === "truncated",
    lowConfidence: run.status === "low_confidence",
    error: run.error,
  });
}

export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await isRunUser(runId);
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (run.status === "completed" || run.status === "truncated") {
    return NextResponse.json({ error: "Run already finished." }, { status: 409 });
  }

  await prisma.deepResearchRun.update({ where: { runId }, data: { cancelled: true } });
  // Tell the worker (via Redis) to abort at the next LLM boundary.
  const redis = createConnection();
  try {
    await redis.publish(`deep-research-cancel:${runId}`, "cancel");
  } finally {
    redis.disconnect();
  }
  return NextResponse.json({ ok: true });
}