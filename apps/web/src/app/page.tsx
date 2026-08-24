"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { LiveExample } from "@/components/landing/LiveExample";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ProofStrip } from "@/components/landing/ProofStrip";
import { DeepResearchSection } from "@/components/landing/DeepResearchSection";
import { FinalCta } from "@/components/landing/FinalCta";
import { SiteFooter } from "@/components/landing/SiteFooter";
import type { Analysis } from "@newshog/shared";
import type { AnalyzeMode } from "@/components/landing/UrlInput";

interface Profile {
  id: string;
  type: string;
}

export default function Home() {
  const [result, setResult] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [pro, setPro] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<AnalyzeMode>("quick");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) setProfile(data);
      })
      .catch(() => {});
    // Pro entitlement drives the Deep Research gate + upgrade modal.
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setPro(Boolean(d.pro)))
      .catch(() => {});
    return () => stopPolling();
  }, [stopPolling]);

  const pollMatches = useCallback((id: string) => {
    // The match job runs after "analyzed" status and makes an LLM call, so
    // retry until it lands. Stop when matches are found or after a few tries
    // (no matches is a valid empty state, so we just bail silently). The
    // short retry window means a match ingested just after the poll loop ends
    // is missed until the next analyze; acceptable for now.
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/analyze/${id}/matches`);
        const matches = await res.json();
        if (Array.isArray(matches) && matches.length > 0) {
          setMatchCount(matches.length);
          stopPolling();
        } else if (attempts >= 4) {
          setMatchCount(0);
          stopPolling();
        }
        attempts++;
      } catch {
        setMatchCount(0);
        stopPolling();
      }
    }, 1500);
  }, [stopPolling]);

  const pollStatus = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/analyze/${id}/status`);
          const data = await res.json();
          setResult(data);
          if (data.status === "analyzed" || data.status === "failed") {
            stopPolling();
            setLoading(false);
            if (data.status === "analyzed") pollMatches(id);
          }
        } catch {
          stopPolling();
          setLoading(false);
          setError("Lost connection to server.");
        }
      }, 1500);
    },
    [stopPolling, pollMatches],
  );

  const handleAnalyze = useCallback(
    async (url: string, mode: AnalyzeMode = "quick") => {
      setError("");
      setResult(null);
      setLoading(true);
      setMatchCount(null);
      setActiveMode(mode);

      try {
        const res = await fetch(mode === "deep" ? "/api/analyze/deep" : "/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.code === "pro_required") setUpgradeOpen(true);
          else setError(data.error || "Something went wrong.");
          setLoading(false);
          return;
        }
        setResult(data);
        pollStatus(data.id);
      } catch {
        setError("Failed to reach server.");
        setLoading(false);
      }
    },
    [pollStatus],
  );

  const handleReanalyze = useCallback(async () => {
    if (!result?.url || !profile) return;
    setError("");
    setResult(null);
    setLoading(true);
    setMatchCount(null);

    try {
      await fetch(`/api/analyze/${result.id}`, { method: "DELETE" });

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.url, profileId: profile.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setLoading(false);
        return;
      }
      setResult(data);
      pollStatus(data.id);
    } catch {
      setError("Failed to reach server.");
      setLoading(false);
    }
  }, [result, profile, pollStatus]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero onAnalyze={handleAnalyze} pro={pro} onUpgrade={() => setUpgradeOpen(true)} />
        <LiveExample />
        <HowItWorks />
        <ProofStrip />
        <DeepResearchSection />
        <FinalCta onAnalyze={handleAnalyze} pro={pro} onUpgrade={() => setUpgradeOpen(true)} />
      </main>
      <SiteFooter />

      {loading && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full border border-border bg-card px-5 py-3 elevate">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-accent-strong animate-pulse" />
            {activeMode === "deep" && (
              <>
                {result?.status === "researching" && "Researching coverage and context — takes a bit longer..."}
                {result?.status === "analyzing" && "Analyzing the story with research context..."}
              </>
            )}
            {activeMode !== "deep" && result?.status === "scraping" && "Reading the article..."}
            {activeMode !== "deep" && result?.status === "scraped" && "Scraped. Starting analysis..."}
            {activeMode !== "deep" && result?.status === "analyzing" && "Analyzing the story..."}
            {(!result?.status || result.status === "queued") && "Queued..."}
          </div>
        </div>
      )}

      {upgradeOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/70 p-5 backdrop-blur-sm" onClick={() => setUpgradeOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 elevate" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold tracking-[-0.02em]">Deep Research is a Pro feature</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Quick score works for everyone. Deep research searches live coverage, surfaces competitive context,
              and grounds your score in cited sources.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a href="/profile" className="inline-flex items-center gap-1.5 rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-primary-foreground">
                Upgrade to Pro
              </a>
              <button onClick={() => setUpgradeOpen(false)} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full border border-destructive/50 bg-card px-5 py-3 elevate">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && result?.status === "analyzed" && result.score != null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-border bg-card px-6 py-4 elevate">
          <div className="flex items-center gap-4">
            <span className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">
              {result.score}
              <span className="ml-1 text-sm text-muted-foreground">/100</span>
            </span>
            <div>
              <p className="text-sm font-medium">{result.articleTitle}</p>
              <p className="text-xs text-muted-foreground">{result.whyNow}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/analyze/${result.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-strong px-4 py-1.5 text-xs font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px"
            >
              View full results
              <ArrowRight className="size-3" strokeWidth={2} />
            </Link>
            {matchCount != null && matchCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent-strong">
                {matchCount} open {matchCount === 1 ? "opportunity" : "opportunities"}
              </span>
            )}
            {profile && !result.profileId && (
              <button
                onClick={handleReanalyze}
                className="text-xs text-accent-strong hover:underline"
              >
                Re-analyze with my profile
              </button>
            )}
            {!profile && (
              <a
                href="/profile"
                className="text-xs text-accent-strong hover:underline"
              >
                Personalize this for me
              </a>
            )}
          </div>
        </div>
      )}

      {!loading && result?.status === "failed" && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-destructive/50 bg-card px-6 py-4 elevate">
          <p className="text-sm font-medium text-destructive">Analysis failed</p>
          <p className="text-xs text-muted-foreground">{result.error || "Something went wrong."}</p>
        </div>
      )}

      {!loading && result?.status === "analyzed" && result.score == null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-border bg-card px-6 py-4 elevate">
          <p className="text-sm font-medium">This run finished without a score</p>
          <p className="text-xs text-muted-foreground">Try analyzing it again to get a result.</p>
        </div>
      )}
    </div>
  );
}
