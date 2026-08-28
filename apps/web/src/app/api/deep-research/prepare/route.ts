import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { createEventEmitter, createOpenRouterHandler, generateClarificationQuestions } from "@newshog/deep-research";
import { requireQuotaUser } from "@/lib/pro-gate";

export async function POST(request: Request) {
  // /prepare spends a live LLM call, so it's quota-gated like the trigger
  // routes — but NON-CONSUMING. The user walks the multi-step clarification
  // flow here and only the trigger (/api/deep-research, /api/analyze/deep)
  // consumes a run. Gating up front means a user at their limit is told in
  // the first interaction, not denied after answering all the questions — and
  // no LLM budget is burned generating questions they can't act on.
  // (Accepted, conscious race: between this status read and the trigger's
  // consume, another tab can take the last run — the trigger's atomic upsert
  // keeps the ceiling airtight even then.)
  const gate = await requireQuotaUser("deep_research", { consume: false });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const { query } = body as { query?: string };
    const q = typeof query === "string" ? query.trim() : "";
    if (!q || q.length > 8000) {
      return NextResponse.json({ error: "query must be a string between 1 and 8000 characters." }, { status: 400 });
    }

    const controller = new AbortController();
    const runId = crypto.randomUUID();
    const questions = await generateClarificationQuestions(
      { query: q },
      {
        handler: createOpenRouterHandler(),
        emit: createEventEmitter({ runId }),
        signal: controller.signal,
      },
    );

    // Persist the prepare session so the kickoff can validate it hasn't been used.
    const session = await prisma.deepResearchSession.create({
      data: { query: q, questions: questions as object[] },
    });

    return NextResponse.json({ prepareSessionId: session.id, runId, questions }, { status: 201 });
  } catch (err) {
    console.error("[api/deep-research/prepare] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}