"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Copy, Loader2, RefreshCw } from "lucide-react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SCORE_THRESHOLD_LOW, SCORE_THRESHOLD_HIGH } from "@newshog/shared";
import type { Analysis, Angle, AnalysisJournalistMatch } from "@newshog/shared";
import { band, relativeTime } from "@/lib/result-utils";

const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm transition-colors hover:bg-secondary disabled:opacity-70";

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisErr, setAnalysisErr] = useState("");
  const [matches, setMatches] = useState<AnalysisJournalistMatch[] | null>(null);
  const [matchesErr, setMatchesErr] = useState(false);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedAngle, setSelectedAngle] = useState("");
  const [pitchErr, setPitchErr] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const generatedRef = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const poll = setInterval(async () => {
      const data = await fetchStatus();
      if (cancelled) return;
      attempts++;
      if (!data || data.status === "analyzed" || data.status === "failed" || attempts > 40) {
        clearInterval(poll);
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [fetchStatus]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/analyze/${id}/matches`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(data)) {
          setMatches(data);
          if (data.length > 0 || attempts >= 5) clearInterval(poll);
        } else {
          attempts++;
          if (attempts >= 5) {
            setMatchesErr(true);
            clearInterval(poll);
          }
        }
      } catch {
        attempts++;
        if (attempts >= 5) {
          setMatchesErr(true);
          clearInterval(poll);
        }
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [id]);

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
      analysis?.status === "analyzed" &&
      analysis.pitch == null &&
      !generatedRef.current &&
      !pitchLoading
    ) {
      generatedRef.current = true;
      regeneratePitch();
    }
  }, [analysis?.status, analysis?.pitch, pitchLoading, regeneratePitch]);

  const copyPitch = useCallback(async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [draft]);

  const angles = (analysis?.angles as Angle[] | undefined) ?? [];
  const score = analysis?.score;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          New analysis
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
          <div className="mt-8 rounded-2xl border border-destructive/50 bg-card p-6">
            <p className="text-sm font-medium text-destructive">Analysis failed</p>
            <p className="mt-1 text-sm text-muted-foreground">{analysis.error}</p>
          </div>
        )}

        {analysis?.status === "analyzed" && score != null && (
          <>
            <header className="mt-8 flex items-start justify-between gap-6">
              <div>
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[11px] tracking-[0.12em] uppercase",
                    score >= SCORE_THRESHOLD_HIGH
                      ? "bg-accent-strong/15 text-accent-strong"
                      : score >= SCORE_THRESHOLD_LOW
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {score} · {band(score)}
                </span>
                <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
                  {analysis.articleTitle}
                </h1>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  Analyzed {analysis.updatedAt ? relativeTime(analysis.updatedAt) : "just now"}
                </p>
              </div>
              <div className="shrink-0 text-right font-mono text-sm tabular-nums text-foreground">
                {score}
                <span className="text-muted-foreground">/100</span>
              </div>
            </header>

            <section className="mt-10">
              <h2 className="text-xs font-medium tracking-[0.1em] uppercase text-muted-foreground">
                Why this matters
              </h2>
              <p className="mt-3 text-base leading-relaxed text-foreground/85">{analysis.whyNow}</p>
            </section>

            <section className="mt-10">
              <h2 className="text-xs font-medium tracking-[0.1em] uppercase text-muted-foreground">
                Best angles
              </h2>
              <ul className="mt-3 space-y-2">
                {angles.map((a, i) => {
                  const open = expanded === i;
                  return (
                    <li
                      key={a.title}
                      className="rounded-xl border border-border bg-card"
                    >
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
                          <p className="rounded-lg bg-secondary/60 px-3 py-2 font-mono text-sm text-foreground/85">
                            <span className="text-muted-foreground">Headline: </span>
                            {a.headline}
                          </p>
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
              {matches !== null && matches.length === 0 && (
                <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  No open journalist requests match this story right now. Check back soon.
                </div>
              )}
              {matches !== null && matches.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {matches.map((m) => (
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
            </section>

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

            {!analysis.profileId && (
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
          </>
        )}

        {!analysis && !analysisErr && (
          <div className="mt-8 flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
            Loading analysis...
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}