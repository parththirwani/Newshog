"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { LiveExample } from "@/components/landing/LiveExample";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ProofStrip } from "@/components/landing/ProofStrip";
import { FinalCta } from "@/components/landing/FinalCta";
import { SiteFooter } from "@/components/landing/SiteFooter";
import type { Analysis } from "@newshog/shared";

interface Profile {
  id: string;
  type: string;
}

export default function Home() {
  const [result, setResult] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
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
    return () => stopPolling();
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
          }
        } catch {
          stopPolling();
          setLoading(false);
          setError("Lost connection to server.");
        }
      }, 1500);
    },
    [stopPolling],
  );

  const handleAnalyze = useCallback(
    async (url: string) => {
      setError("");
      setResult(null);
      setLoading(true);

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
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
    },
    [pollStatus],
  );

  const handleReanalyze = useCallback(async () => {
    if (!result?.url || !profile) return;
    setError("");
    setResult(null);
    setLoading(true);

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
        <Hero onAnalyze={handleAnalyze} />
        <LiveExample />
        <HowItWorks />
        <ProofStrip />
        <FinalCta onAnalyze={handleAnalyze} />
      </main>
      <SiteFooter />

      {loading && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full border border-border bg-card px-5 py-3 elevate">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-accent-strong animate-pulse" />
            {result?.status === "scraping" && "Scraping the article..."}
            {result?.status === "scraped" && "Scraped. Starting analysis..."}
            {result?.status === "analyzing" && "Analyzing the story..."}
            {(!result?.status || result.status === "queued") && "Queued..."}
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
          <div className="mt-3 flex gap-2">
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
    </div>
  );
}
