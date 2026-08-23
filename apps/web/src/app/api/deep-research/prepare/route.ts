import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { createEventEmitter, createOpenRouterHandler, generateClarificationQuestions } from "@newshog/deep-research";
import { requireProUser } from "@/lib/pro-gate";

export async function POST(request: Request) {
  // /prepare runs a live LLM call, so it's pro-gated like the other spend routes.
  const gate = await requireProUser();
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