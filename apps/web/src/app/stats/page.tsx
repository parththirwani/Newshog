import { redirect } from "next/navigation";
import { prisma } from "@newshog/db";
import { LLM_PROMPT_PRICE_PER_M, LLM_COMPLETION_PRICE_PER_M, LLM_DAILY_ALERT_USD } from "@newshog/shared";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/app/AppShell";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const STAGE_LABEL: Record<string, string> = {
  analysis: "Analysis (understand+score+angles)",
  match: "Request matching",
  extract: "Email extraction",
  pitch: "Pitch generation",
  profile: "Profile summarization",
};

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const today = startOfToday();

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
    const usd =
      ((s._sum.promptTokens ?? 0) / 1e6) * LLM_PROMPT_PRICE_PER_M +
      ((s._sum.completionTokens ?? 0) / 1e6) * LLM_COMPLETION_PRICE_PER_M;
    return {
      stage: s.stage,
      label: STAGE_LABEL[s.stage] ?? s.stage,
      calls: s._count._all,
      promptTokens: Number(s._sum.promptTokens ?? 0),
      completionTokens: Number(s._sum.completionTokens ?? 0),
      usd,
    };
  });

  const totalUsd = stages.reduce((sum, s) => sum + s.usd, 0);
  const overBudget = totalUsd > LLM_DAILY_ALERT_USD;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold tracking-tight">Usage today</h1>
      <p className="mt-1 text-sm text-muted-foreground">{today.toISOString().slice(0, 10)}</p>

      {overBudget && (
        <div className="mt-6 rounded-xl border border-destructive/50 bg-card px-4 py-3 text-sm text-destructive">
          Over daily LLM budget (${LLM_DAILY_ALERT_USD}).
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
          LLM cost by stage
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Stage</th>
                <th className="px-4 py-2.5 text-right">Calls</th>
                <th className="px-4 py-2.5 text-right">In</th>
                <th className="px-4 py-2.5 text-right">Out</th>
                <th className="px-4 py-2.5 text-right">USD</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.stage} className="border-t border-border">
                  <td className="px-4 py-2.5">{s.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.calls}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.promptTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.completionTokens.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">${s.usd.toFixed(4)}</td>
                </tr>
              ))}
              {stages.length === 0 && (
                <tr className="border-t border-border">
                  <td className="px-4 py-2.5 text-muted-foreground" colSpan={5}>No LLM calls today.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td className="px-4 py-2.5 font-medium">Total</td>
                <td className="px-4 py-2.5" colSpan={3} />
                <td className="px-4 py-2.5 text-right font-medium tabular-nums">${totalUsd.toFixed(4)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Alert at ${LLM_DAILY_ALERT_USD}/day. Prices are the hardcoded model constants — not live.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">Free-tier load</h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-mono text-2xl tabular-nums">{analysesToday}</p>
            <p className="text-xs text-muted-foreground">analyses today</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-mono text-2xl tabular-nums">{openRequests}</p>
            <p className="text-xs text-muted-foreground">open requests</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-mono text-2xl tabular-nums">{eventsToday}</p>
            <p className="text-xs text-muted-foreground">events today</p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
