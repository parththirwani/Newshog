"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Copy, Loader2, RefreshCw, Share2 } from "lucide-react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { AppShell } from "@/components/app/AppShell";
import type { Analysis, Angle, AnalysisJournalistMatch } from "@newshog/shared";
import { relativeTime, nextAction } from "@/lib/result-utils";
import type { StoryVelocity, CoverageSignal } from "@newshog/shared";
import { ScoreRing } from "@/components/app/ScoreRing";
import { trackClient } from "@/lib/analytics-client";

const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm transition-colors hover:bg-secondary disabled:opacity-70";

type MatchResponse = AnalysisJournalistMatch[] | { count: number };

type InitialAnalysis = {
  id: string;
  status: string;
  articleTitle?: string | null;
  score?: number | null;
  velocity?: string | null;
  angles?: unknown;
  whyNow?: string | null;
  pitch?: string | null;
  error?: string | null;
  profileId?: string | null;
  researchRunId?: string | null;
  sourcePublishedAt?: string | Date | null;
  eventTiming?: string | null;
  coverageSignal?: CoverageSignal | null;
  noveltyScore?: number | null;
  updatedAt?: string | Date | null;
  userId?: string | null;
};

type InitialResearch = {
  status: string;
  lowConfidence: boolean;
  learnings: unknown;
  sources: unknown;
  answer: string | null;
  report: string | null;
};

export function ResultView({
  id,
  owner,
  user,
  initial,
  initialResearch,
}: {
  id: string;
  owner: boolean;
  user: { email: string } | null;
  initial?: InitialAnalysis;
  initialResearch?: InitialResearch | null;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(
    initial
      ? {
          id: initial.id,
          status: initial.status as Analysis["status"],
          articleTitle: initial.articleTitle ?? undefined,
          score: initial.score ?? undefined,
          velocity: (initial.velocity ?? undefined) as StoryVelocity | undefined,
          angles: (Array.isArray(initial.angles) ? initial.angles : undefined) as Angle[] | undefined,
          whyNow: initial.whyNow ?? undefined,
          pitch: initial.pitch ?? undefined,
          error: initial.error ?? undefined,
          profileId: initial.profileId ?? undefined,
          researchRunId: initial.researchRunId ?? undefined,
          updatedAt: initial.updatedAt instanceof Date ? initial.updatedAt.toISOString() : initial.updatedAt ?? undefined,
        }
      : null,
  );
  const [analysisErr, setAnalysisErr] = useState("");
  const [matches, setMatches] = useState<MatchResponse | null>(null);
  const [matchesErr, setMatchesErr] = useState(false);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [draft, setDraft] = useState(initial?.pitch ?? "");
  const [selectedAngle, setSelectedAngle] = useState(
    initial?.angles && Array.isArray(initial.angles) && initial.angles.length > 0
      ? (initial.angles as Angle[])[0].title
      : "",
  );
  const [pitchErr, setPitchErr] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [profileType, setProfileType] = useState<string | null>(null);
  const generatedRef = useRef(false);
  const trackedCompleteRef = useRef(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => setProfileType(data?.type ?? null))
      .catch(() => {});
  }, []);

  const medialystUrl = process.env.NEXT_PUBLIC_MEDIALYST_URL;
  const medialystHref = medialystUrl
    ? profileType
      ? `${medialystUrl}?type=${profileType}`
      : medialystUrl
    : null;

  const openMedialyst = useCallback(() => {
    trackClient("medialyst_clicked", { type: profileType ?? "none" });
    // ponytail: Medialyst signup-attribution hook — wire when their side
    // delivers a callback; the medialyst_clicked event feed is the paper trail.
  }, [profileType]);

  const fetchStatus = useCallback(async (silent = false) => {
    try {
      const res = await fetch(`/api/analyze/${id}/status`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setAnalysis(data);
      if (!silent && data.pitch) {
        setDraft(data.pitch);
        setSelectedAngle(data.angles?.[0]?.title ?? "");
      }
      return data;
    } catch {
      setAnalysisErr("Could not load this analysis.");
      return null;
    }
  }, [id]);

  const isTerminal = initial?.status === "analyzed" || initial?.status === "failed";

  // Personalized analyses (owned or profile-scoped) are private — their deep
  // research renders to the owner only. Context-free analyses are public.
  const contextFree = !initial?.userId && !initial?.profileId;

  // For in-flight analyses, fetch immediately on mount (don't wait the first
  // 1500ms tick) so the score/data appears as soon as it's ready.
  useEffect(() => {
    if (isTerminal) return;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      cancelled = true;
      if (poll) clearInterval(poll);
    };
    // ponytail: deep research runs for minutes (not the ~60s quick-score does).
    // The old attempts>40 tick cap froze the loader mid-run; poll on a wall-clock
    // deadline instead. Worker always reaches analyzed/failed, so this is just a
    // runaway-job safety net.
    const deadline = Date.now() + 30 * 60 * 1000;
    const done = (s: string | undefined) => s === "analyzed" || s === "failed" || Date.now() > deadline;

    void (async () => {
      const data = await fetchStatus();
      if (cancelled) return;
      // Completed already at load — stop. Otherwise begin polling.
      if (!data || done(data.status)) return stop();
      poll = setInterval(async () => {
        if (cancelled) return;
        const next = await fetchStatus();
        if (cancelled) return;
        if (!next || done(next.status)) stop();
      }, 1500);
    })();

    return stop;
  }, [fetchStatus, isTerminal]);

  useEffect(() => {
    if (analysis?.status === "analyzed" && !trackedCompleteRef.current) {
      trackedCompleteRef.current = true;
      trackClient("analysis_completed");
    }
  }, [analysis?.status]);

  useEffect(() => {
    if (analysis?.status !== "analyzed") return;
    let cancelled = false;
    fetch(`/api/analyze/${id}/matches`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data) setMatches(data);
      })
      .catch(() => {
        if (!cancelled) setMatchesErr(true);
      });
    return () => { cancelled = true; };
  }, [id, analysis?.status]);

  const regeneratePitch = useCallback(
    async (angleTitle?: string) => {
      setPitchLoading(true);
      setPitchErr("");
      try {
        const res = await fetch(`/api/analyze/${id}/pitch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ angle: angleTitle }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to generate pitch.");
        setDraft(data.pitch);
        setSelectedAngle(angleTitle ?? analysis?.angles?.[0]?.title ?? "");
        await fetchStatus(true);
      } catch (err) {
        setPitchErr(err instanceof Error ? err.message : "Failed to generate pitch.");
      } finally {
        setPitchLoading(false);
      }
    },
    [id, fetchStatus],
  );

  useEffect(() => {
    if (
      owner &&
      analysis?.status === "analyzed" &&
      analysis.pitch == null &&
      !generatedRef.current &&
      !pitchLoading
    ) {
      generatedRef.current = true;
      regeneratePitch();
    }
  }, [owner, analysis?.status, analysis?.pitch, pitchLoading, regeneratePitch]);

  const copyPitch = useCallback(async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    trackClient("pitch_copied");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [draft]);

  const copyAngle = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    trackClient("angle_copied");
  }, []);

  const share = useCallback(async () => {
    const url = window.location.href;
    const title = analysis?.articleTitle ?? "Newshog analysis";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      trackClient("result_shared");
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // user cancelled the share sheet
    }
  }, [analysis?.articleTitle]);

  const angles = Array.isArray(analysis?.angles) ? (analysis?.angles as Angle[]) : [];
  const score = analysis?.score;
  const velocity = analysis?.velocity as StoryVelocity | undefined;
  const matchList = matches && Array.isArray(matches) ? matches : null;
  const matchCount = matches ? (Array.isArray(matches) ? matches.length : matches.count) : null;

  const content = (
    <>
        <Link
          href={owner ? "/dashboard" : "/"}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          {owner ? "Dashboard" : "New analysis"}
        </Link>

        {analysisErr && (
          <div className="mt-8 rounded-2xl border border-destructive/50 bg-card p-6">
            <p className="text-sm font-medium text-destructive">{analysisErr}</p>
            <Link href="/" className="mt-2 inline-block text-sm text-accent-strong hover:underline">
              Start a new analysis
            </Link>
          </div>
        )}

        {analysis?.status === "failed" && (
          <AnalysisError error={analysis.error} />
        )}

        {analysis?.status === "analyzed" && score != null && (
          <>
            <header className="mt-8 flex items-start justify-between gap-6">
              <div>
                <ScoreRing score={score} size={80} />
                <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
                  {analysis.articleTitle}
                </h1>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  Analyzed {analysis.updatedAt ? relativeTime(analysis.updatedAt) : "just now"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                <span className="font-mono text-sm tabular-nums text-foreground">
                  {score}
                  <span className="text-muted-foreground">/100</span>
                </span>
                <button onClick={share} className={btnSecondary}>
                  {shared ? (
                    <>
                      <Check className="size-4" strokeWidth={1.75} /> Copied
                    </>
                  ) : (
                    <>
                      <Share2 className="size-4" strokeWidth={1.75} /> Share
                    </>
                  )}
                </button>
              </div>
            </header>

            <section className="mt-10">
              <h2 className="text-xs font-medium tracking-[0.1em] uppercase text-muted-foreground">
                Why this matters
              </h2>
              <p className="mt-3 text-base leading-relaxed text-foreground/85">{analysis.whyNow}</p>
</section>

            {analysis.researchRunId && (owner || contextFree) && (
              <ResearchBacked runId={analysis.researchRunId} initial={initialResearch} coverage={initial?.coverageSignal ?? null} />
            )}

            <section className="mt-10">
              <h2 className="text-xs font-medium tracking-[0.1em] uppercase text-muted-foreground">
                Best angles
              </h2>
              <ul className="mt-3 space-y-2">
                {angles.map((a, i) => {
                  const open = expanded === i;
                  return (
                    <li key={a.title} className="rounded-xl border border-border bg-card">
                      <button
                        onClick={() => setExpanded(open ? null : i)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                      >
                        <span className="font-medium tracking-[-0.01em]">{a.title}</span>
                        <ChevronDown
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                        />
                      </button>
                      {open && (
                        <div className="space-y-3 border-t border-border px-4 py-3">
                          <p className="text-sm leading-relaxed text-foreground/85">
                            <span className="text-muted-foreground">Why now: </span>
                            {a.why_now}
                          </p>
                          <p className="text-sm leading-relaxed text-foreground/85">
                            <span className="text-muted-foreground">Why journalists care: </span>
                            {a.why_journalists_care}
                          </p>
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2">
                            <p className="font-mono text-sm text-foreground/85">
                              <span className="text-muted-foreground">Headline: </span>
                              {a.headline}
                            </p>
                            <button
                              onClick={() => copyAngle(a.headline)}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                              aria-label="Copy headline"
                            >
                              <Copy className="size-4" strokeWidth={1.75} />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="mt-10">
              <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                Open opportunities right now
              </h2>
              {matchesErr && (
                <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  Couldn't load requests right now.
                </div>
              )}
              {matches === null && !matchesErr && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                  Checking open requests...
                </div>
              )}
              {matches !== null && (!matchList || matchList.length === 0) && matchCount === 0 && (
                <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No open journalist requests match this story right now. Check back soon.
                </div>
              )}
              {matchList !== null && matchList.length > 0 && owner && (
                <ul className="mt-3 space-y-2">
                  {matchList.map((m) => (
                    <li key={m.journalistRequestId} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-medium tracking-[-0.01em]">
                          {m.journalistRequest.requesterName || "Anonymous"} · {m.journalistRequest.outlet ?? "any outlet"}
                        </p>
                        {m.journalistRequest.deadline && (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            Due {new Date(m.journalistRequest.deadline).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {m.journalistRequest.topicText}
                      </p>
                      <p className="mt-2 text-xs text-foreground/70">{m.matchRationale}</p>
                    </li>
                  ))}
                </ul>
              )}
              {matchList !== null && matchList.length > 0 && !owner && (
                <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  {matchList.length} open {matchList.length === 1 ? "opportunity" : "opportunities"} on this story.
                </div>
              )}
            </section>

            <section className="mt-10">
              <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                Next action
              </h2>
              <div className="mt-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium tracking-[-0.01em]">{nextAction(score, matchCount ?? 0, velocity).timing}</p>
                  <span className="font-mono text-xs text-muted-foreground">Suggested window</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground/85">{nextAction(score, matchCount ?? 0, velocity).action}</p>
              </div>
            </section>

            {owner ? (
              <section className="mt-10">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                    Suggested pitch
                  </h2>
                  {angles.length > 1 && (
                    <select
                      value={selectedAngle}
                      onChange={(e) => {
                        setSelectedAngle(e.target.value);
                        regeneratePitch(e.target.value);
                      }}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
                    >
                      {angles.map((a) => (
                        <option key={a.title} value={a.title}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="mt-3">
                  {pitchLoading && analysis?.pitch == null && (
                    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                      Writing your pitch...
                    </div>
                  )}
                  {!pitchLoading && analysis?.pitch == null && (
                    <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                      {pitchErr}
                      <button
                        onClick={() => regeneratePitch(selectedAngle)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-secondary"
                      >
                        <RefreshCw className="size-3.5" strokeWidth={1.75} />
                        Generate pitch
                      </button>
                    </div>
                  )}
                  {analysis?.pitch != null && (
                    <div>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={9}
                        className="w-full resize-y rounded-xl border border-border bg-card px-4 py-3 font-mono text-[13px] leading-relaxed outline-none focus:border-foreground/40"
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button onClick={copyPitch} disabled={!draft} className={btnSecondary}>
                          {copied ? (
                            <>
                              <Check className="size-4" strokeWidth={1.75} /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="size-4" strokeWidth={1.75} /> Copy pitch
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => regeneratePitch(selectedAngle)}
                          disabled={pitchLoading}
                          className={btnSecondary}
                        >
                          <RefreshCw className={`size-4 ${pitchLoading ? "animate-spin" : ""}`} strokeWidth={1.75} />
                          Regenerate
                        </button>
                        {pitchErr && <span className="text-sm text-destructive">{pitchErr}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="mt-10 rounded-xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">
                  This analysis was personalized for its owner. Public view shows the story verdict and angles only.
                </p>
                <p className="label-mono mt-2">Generated by Newshog</p>
              </section>
            )}

            {owner && !analysis.profileId && (
              <section className="mt-10 rounded-xl border border-border bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">
                  Want pitches written in your (or your company's) voice?
                </p>
                <Link
                  href="/profile"
                  className="mt-2 inline-block text-sm font-medium text-accent-strong hover:underline"
                >
                  Personalize this for me →
                </Link>
              </section>
            )}

            {medialystHref && (
              <section className="mt-10 rounded-xl border border-accent-strong/40 bg-card p-5 text-center">
                <p className="text-sm text-muted-foreground">
                  Want this automatically for every story, using your profile?
                </p>
                <a
                  href={medialystHref}
                  onClick={openMedialyst}
                  className="mt-2 inline-block text-sm font-medium text-accent-strong hover:underline"
                >
                  Medialyst →
                </a>
              </section>
            )}
          </>
        )}

        {(!analysis || (analysis.status !== "analyzed" && analysis.status !== "failed")) && !analysisErr && (
          <AnalysisLoader status={analysis?.status} />
        )}

        {/* Terminal state with no score — reached only by legacy/partial rows
            (score is always written alongside status on a fresh run). Guard
            against the silent blank dead-end and offer a clear re-run path. */}
        {analysisErr ? null : (
          analysis?.status === "analyzed" && score == null && (
            <div className="mt-12 rounded-2xl border border-border bg-card p-8 text-center">
              <p className="font-semibold tracking-[-0.01em]">{analysis.articleTitle || "This analysis"}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                This run completed without a score, so there's nothing to show yet.
                Re-run it to get the full result.
              </p>
              <Link href="/" className="mt-4 inline-block rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-primary-foreground">
                Analyze a story
              </Link>
            </div>
          )
        )}
    </>
  );

  if (owner && user) {
    return <AppShell user={user}>{content}</AppShell>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-12">
        {content}
      </main>
      <SiteFooter />
    </div>
  );
}

// ── Markdown renderer ────────────────────────────────────────────────────
// ponytail: the smallest markdown renderer that turns a research report into
// clickable links. Deliberately not pulling react-markdown: the report the
// model emits is a narrow subset (headings, bold, bullets, blockquotes,
// [text](url)). If reports start carrying tables or code fences, swap this for
// react-markdown — the consumer signature stays the same.

const INLINE_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*/g;

function renderInline(text: string, prefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <a key={`${prefix}-${k++}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-accent-strong underline decoration-accent-strong/50 underline-offset-2 hover:opacity-80">
          {match[1]}
        </a>,
      );
    } else {
      parts.push(<strong key={`${prefix}-${k++}`} className="font-semibold text-foreground/90">{match[3]}</strong>);
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(markdown: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  let list: ReactNode[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(<ul key={`k${key++}`} className="mt-2 space-y-2 pl-5 list-disc">{list}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) {
      out.push(
        <p key={`k${key++}`} className="text-sm leading-relaxed text-foreground/85">
          {para.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {renderInline(line, `${key}-${i}`)}
            </span>
          ))}
        </p>,
      );
      para = [];
    }
  };

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s(.+)$/);
    if (heading) {
      flushList();
      flushPara();
      const content = renderInline(heading[2], `h${key}`);
      const cls = "font-medium tracking-[-0.01em] text-foreground";
      if (heading[1].length === 1) out.push(<h1 key={`k${key++}`} className={`text-lg ${cls}`}>{content}</h1>);
      else if (heading[1].length === 2) out.push(<h2 key={`k${key++}`} className={`text-base ${cls}`}>{content}</h2>);
      else out.push(<h3 key={`k${key++}`} className={`text-sm font-semibold text-foreground`}>{content}</h3>);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      flushPara();
      list.push(<li key={list.length}>{renderInline(line.replace(/^[-*]\s/, ""), `li-${key}`)}</li>);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushList();
  flushPara();
  return out;
}

function ResearchBacked({ runId, initial, coverage }: { runId: string; initial?: InitialResearch | null; coverage?: CoverageSignal | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ status?: string; answer?: string | null; report?: string | null; learnings: unknown; sources: unknown } | null>(initial ?? null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (initial) return; // server already rendered the research — no fetch needed
    fetch(`/api/deep-research/${runId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setErr(true));
  }, [runId, initial]);

  const learnings = Array.isArray(data?.learnings)
    ? (data.learnings as Array<{ text: string; excerpt?: string; sourceUrls?: string[] }>)
    : [];
  const sources = Array.isArray(data?.sources) ? (data.sources as Array<{ id: number; url: string }>) : [];
  const report = data?.report ?? data?.answer ?? "";
  const lowConfidence = data?.status === "low_confidence" || data?.status === "truncated";

  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  return (
    <section className="mt-10 rounded-2xl border border-accent-strong/30 bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <span className="inline-flex items-center gap-1.5 font-medium text-accent-strong">
          Backed by deep research
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {data ? `${sources.length} ${sources.length === 1 ? "source" : "sources"}` : ""}
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          {coverage && coverage.externalSourceCount > 0 && (
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-foreground/85">
              {coverage.externalSourceCount} other {coverage.externalSourceCount === 1 ? "source" : "sources"} found covering this story
              {coverage.earliestSourceDate && coverage.latestSourceDate
                ? ` · ${coverage.earliestSourceDate.slice(0, 10)} to ${coverage.latestSourceDate.slice(0, 10)}`
                : ""}
            </p>
          )}
          {!data && !err && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
              Loading research...
            </div>
          )}
          {err && <p className="text-sm text-muted-foreground">Couldn't load the research behind this score.</p>}

          {lowConfidence && (
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
              Research for this topic was limited — treat this analysis with extra scrutiny.
            </p>
          )}

          {data && (
            <>
              {report && (
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground mb-2">Research notes</p>
                  <div className="space-y-1 text-sm">{renderMarkdown(report)}</div>
                </div>
              )}

              {learnings.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground mb-2">Why this score</p>
                  <ul className="space-y-2">
                    {learnings.map((l, i) => (
                      <li key={i} className="rounded-lg bg-secondary/60 px-3 py-2 text-sm leading-relaxed text-foreground/85">
                        {l.text}
                        {l.excerpt && <p className="mt-1 font-mono text-xs text-muted-foreground">“{l.excerpt}”</p>}
                        {Array.isArray(l.sourceUrls) && l.sourceUrls.length > 0 && (
                          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                            {l.sourceUrls.map((url, j) => (
                              <a
                                key={j}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-accent-strong underline decoration-accent-strong/50 underline-offset-2 hover:opacity-80"
                              >
                                {hostOf(url)}
                              </a>
                            ))}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sources.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground mb-2">Sources</p>
                  <ul className="space-y-2">
                    {sources.map((s) => (
                      <li key={s.id} className="rounded-lg bg-card px-3 py-2">
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-sm break-all text-accent-strong underline decoration-accent-strong/50 underline-offset-2 hover:opacity-80">
                          {s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const STAGES: Record<string, string> = {
  queued: "Queued in line...",
  scraping: "Reading the article...",
  scraped: "Assessing the story...",
  researching: "Researching coverage and context this takes a bit longer than a quick score",
  analyzing: "Scoring what makes it newsworthy...",
};

export function AnalysisLoader({ status }: { status?: string }) {
  const [pct, setPct] = useState(20);
  useEffect(() => {
    const t = setInterval(() => setPct((p) => Math.min(95, p + 2)), 220);
    return () => clearInterval(t);
  }, []);
  const label = (status && STAGES[status]) ?? "Working on your analysis...";
  return (
<div className="mt-8 flex flex-col items-center py-24">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-accent-strong/70"
            style={{ animation: `newshog-bar 0.9s ${i * 0.18}s ease-in-out infinite` }}
          />
        ))}
      </div>
      <p className="mt-6 text-sm font-medium text-foreground/90">{label}</p>
      <p className="mt-1.5 font-mono text-xs text-muted-foreground">{pct}%</p>
      <div className="mt-4 h-1 w-44 overflow-hidden rounded-full bg-border/70">
        <div className="h-full rounded-full bg-accent-strong" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function AnalysisError({ error }: { error?: string | null }) {
  return (
    <div className="mt-8 flex flex-col items-center py-24">
      <div className="relative" aria-hidden>
        <div className="absolute inset-0 rounded-full border border-destructive/40" style={{ animation: "newshog-pulse 1.8s ease-in-out infinite" }} />
        <div className="relative flex size-12 items-center justify-center rounded-full border border-destructive/60 bg-card">
          <svg viewBox="0 0 24 24" className="size-5 text-destructive" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="3" y1="3" x2="21" y2="3" stroke="currentColor" strokeWidth="2" />
            <line x1="10" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" />
            <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="2" />
            <line x1="6" y1="19" x2="18" y2="19" stroke="currentColor" strokeWidth="2" />
            <line x1="6" y1="7" x2="6" y2="21" stroke="currentColor" strokeWidth="2" />
            <line x1="18" y1="7" x2="18" y2="21" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
      </div>
      <p className="mt-6 text-lg font-semibold tracking-[-0.01em] text-destructive">Couldn't analyze this story</p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground/70">
        The site may be blocking access, or the article isn't reachable right now.
      </p>
      {error && (
        <code className="mt-4 rounded-lg border border-border/60 bg-secondary/60 px-3 py-1.5 font-mono text-xs text-foreground/70 break-all">
          {error}
        </code>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Try another story
        </Link>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-secondary disabled:opacity-70"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          Retry
        </button>
      </div>
    </div>
  );
}