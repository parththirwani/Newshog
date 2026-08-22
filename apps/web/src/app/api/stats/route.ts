import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { LLM_PROMPT_PRICE_PER_M, LLM_COMPLETION_PRICE_PER_M, LLM_DAILY_ALERT_USD } from "@newshog/shared";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET() {
  const today = startOfToday();

  // Aggregate is read-only usage across the whole app — no per-user rows leave.
  const [byStage, analysesToday, openRequests, eventsToday] = await Promise.all([
    prisma.lLMCall.groupBy({
      by: ["stage"],
      where: { createdAt: { gte: today } },
      _sum: { promptTokens: true, completionTokens: true },
      _count: { _all: true },
    }),
    prisma.analysis.count({ where: { createdAt: { gte: today } } }),
    prisma.journalistRequest.count({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }),
    prisma.event.count({ where: { createdAt: { gte: today } } }),
  ]);

  const stages = byStage.map((s) => {
    const promptUsd = ((s._sum.promptTokens ?? 0) / 1e6) * LLM_PROMPT_PRICE_PER_M;
    const completionUsd = ((s._sum.completionTokens ?? 0) / 1e6) * LLM_COMPLETION_PRICE_PER_M;
    return {
      stage: s.stage,
      calls: s._count._all,
      promptTokens: s._sum.promptTokens ?? 0,
      completionTokens: s._sum.completionTokens ?? 0,
      usd: Number((promptUsd + completionUsd).toFixed(4)),
    };
  });

  const totalUsd = stages.reduce((sum, s) => sum + s.usd, 0);

  return NextResponse.json({
    date: today.toISOString().slice(0, 10),
    stages,
    totalUsd: Number(totalUsd.toFixed(4)),
    overDailyBudget: totalUsd > LLM_DAILY_ALERT_USD,
    dailyAlertUsd: LLM_DAILY_ALERT_USD,
    freeTier: {
      analysesToday,
      openRequests,
      eventsToday,
    },
  });
}