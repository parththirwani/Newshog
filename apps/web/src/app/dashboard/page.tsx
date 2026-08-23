import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@newshog/db";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/app/AppShell";
import { ScoreRing } from "@/components/app/ScoreRing";
import { DashboardAnalyze } from "./DashboardAnalyze";
import { SCORE_THRESHOLD_HIGH } from "@newshog/shared";

const PAGE_SIZE = 20;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { page: pageParam, type } = await searchParams;
  const typeFilter = type === "quick" || type === "deep" ? type : "all";
  const page = Math.max(1, Number(pageParam) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // quick = no research run; deep = research-backed; all (default) = everything.
  const typeWhere =
    typeFilter === "quick"
      ? { researchRunId: null }
      : typeFilter === "deep"
        ? { researchRunId: { not: null } }
        : {};
  const where = { userId: user.id, ...typeWhere };

  const [analyses, total, avgResult, strongCount, weekCount, profile] =
    await Promise.all([
      prisma.analysis.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          url: true,
          articleTitle: true,
          score: true,
          status: true,
          createdAt: true,
          researchRunId: true,
        },
      }),
      prisma.analysis.count({ where }),
      prisma.analysis.aggregate({
        where: { ...where, score: { not: null } },
        _avg: { score: true },
      }),
      prisma.analysis.count({
        where: { ...where, score: { gte: SCORE_THRESHOLD_HIGH } },
      }),
      prisma.analysis.count({
        where: { ...where, createdAt: { gte: weekAgo } },
      }),
      prisma.profile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      }),
    ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const avgScore = avgResult._avg.score
    ? Math.round(avgResult._avg.score)
    : null;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Dashboard</h1>

      <div className="mb-10">
        <p className="label-mono mb-2 text-xs text-muted-foreground">
          Score a new story
        </p>
        <DashboardAnalyze />
      </div>

      {total > 0 && (
        <div className="mb-8 grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <p className="label-mono mb-2 text-[11px] text-muted-foreground">
              Average score
            </p>
            <ScoreRing score={avgScore ?? 0} size={48} />
          </div>
          <StatCard label="Total analyzed" value={total} />
          <StatCard label="Strong matches" value={strongCount} />
          <StatCard label="This week" value={weekCount} />
        </div>
      )}

      {!profile && total > 0 && (
        <div className="mb-6 flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Personalize your results</p>
            <p className="text-xs text-muted-foreground">
              Add your background so angles are tailored to you.
            </p>
          </div>
          <Link
            href="/profile"
            className="shrink-0 rounded-full bg-accent-strong px-4 py-1.5 text-xs font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px active:translate-y-0"
          >
            Set up profile
          </Link>
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            {typeFilter === "all"
              ? "Paste a story URL above to get your first score."
              : typeFilter === "quick"
                ? "No quick score reports yet."
                : "No deep research reports yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <FilterTab href="/dashboard" active={typeFilter === "all"} label="All" />
            <FilterTab href="/dashboard?type=quick" active={typeFilter === "quick"} label="Quick score" />
            <FilterTab href="/dashboard?type=deep" active={typeFilter === "deep"} label="Deep research" />
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
            {analyses.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/analyze/${a.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-shadow hover:shadow-md"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {a.articleTitle || a.url}
                      </p>
                      {a.researchRunId && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-accent-strong uppercase">
                          Deep
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {a.score != null ? (
                    <ScoreRing score={a.score} size={40} />
                  ) : (
                    <span className="shrink-0 label-mono text-xs capitalize text-muted-foreground">
                      {a.status}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {pages > 1 && (
        <div className="mt-8 flex items-center justify-between">
          {page > 1 ? (
            <Link
              href={`/dashboard?page=${page - 1}${typeFilter !== "all" ? `&type=${typeFilter}` : ""}`}
              className="text-sm text-accent-strong hover:underline"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link
              href={`/dashboard?page=${page + 1}${typeFilter !== "all" ? `&type=${typeFilter}` : ""}`}
              className="text-sm text-accent-strong hover:underline"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </AppShell>
  );
}

function FilterTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-accent-strong text-primary-foreground"
          : "border border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {label}
    </Link>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5">
      <p className="label-mono mb-2 text-[11px] text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
