"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { LiveExample } from "@/components/landing/LiveExample";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ProofStrip } from "@/components/landing/ProofStrip";
import { DeepResearchSection } from "@/components/landing/DeepResearchSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FinalCta } from "@/components/landing/FinalCta";
import { useBilling } from "@/hooks/use-billing";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { UpsellModal, type UpsellKind, type UpsellTier } from "@/components/app/UpsellModal";
import type { Analysis } from "@newshog/shared";
import type { AnalyzeMode } from "@/components/landing/UrlInput";

interface Profile {
  id: string;
  type: string;
}

export default function Home() {
  const router = useRouter();
  const [result, setResult] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [quota, setQuota] = useState<{ kind: UpsellKind; tier: UpsellTier; resetsAt: string | null } | null>(null);
  const [activeMode, setActiveMode] = useState<AnalyzeMode>("quick");
  const { start: startBilling, error: billingError } = useBilling();
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
          if (data.code === "quota_exceeded") {
            setQuota({ kind: data.kind as UpsellKind, tier: data.tier as UpsellTier, resetsAt: data.resetsAt ?? null });
          } else if (data.code === "auth_required" || data.code === "pro_required") {
            setQuota({ kind: "deep_research", tier: "anonymous", resetsAt: null });
          } else {
            setError(data.error || "Something went wrong.");
          }
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

  // Mirror a failed checkout into the page's error banner so the hero upgrade
  // button is never silently dead (useBilling swallows errors into its own
  // state; the pricing section renders it inline, the hero doesn't).
  useEffect(() => {
    if (!billingError) return;
    if (billingError.code === "billing_unconfigured") {
      setError("Billing isn't wired up yet — reach out to get Pro access.");
    } else if (billingError.code === "auth_required") {
      setError("Sign in to continue.");
    } else {
      setError("Couldn't start checkout. Try again.");
    }
  }, [billingError]);

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
        if (data.code === "quota_exceeded") setQuota({ kind: data.kind as UpsellKind, tier: data.tier as UpsellTier, resetsAt: data.resetsAt ?? null });
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
  }, [result, profile, pollStatus]);

  // Upgrade CTA from the landing hero: signed-in users start Stripe checkout
  // directly; anonymous visitors go through login first (then back to billing).
  const handleLandingUpgrade = useCallback(() => {
    void (async () => {
      try {
        const me = await fetch("/api/me").then((r) => r.json());
        if (!me.signedIn) {
          router.push("/login?next=/pricing");
          return;
        }
        await startBilling("checkout");
      } catch {
        setError("Couldn't start checkout. Try again.");
      }
    })();
  }, [startBilling]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero
          onAnalyze={handleAnalyze}
          onUpgrade={(kind, tier) => setQuota({ kind, tier, resetsAt: null })}
          handleLandingUpgrade={handleLandingUpgrade}
        />
        <LiveExample />
        <HowItWorks />
        <ProofStrip />
        <DeepResearchSection />
        <PricingSection />
        <FinalCta onAnalyze={handleAnalyze} onUpgrade={(kind, tier) => setQuota({ kind, tier, resetsAt: null })} />
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

      {quota && (
        <UpsellModal
          open
          kind={quota.kind}
          tier={quota.tier}
          resetsAt={quota.resetsAt}
          onClose={() => setQuota(null)}
        />
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
              <Link
                href="/profile"
                className="text-xs text-accent-strong hover:underline"
              >
                Personalize this for me
              </Link>
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
