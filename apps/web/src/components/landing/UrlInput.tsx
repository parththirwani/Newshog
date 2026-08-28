"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UpsellKind, UpsellTier } from "@/components/app/UpsellModal";

export type AnalyzeMode = "quick" | "deep";
export type { UpsellKind, UpsellTier };

interface KindUsage {
  used: number;
  limit: number;
  resetsAt: string | null;
}

interface UsageState {
  signedIn: boolean;
  tier: UpsellTier;
  quickSearch: KindUsage;
  deepResearch: KindUsage;
}

export function UrlInput({
  size = "lg",
  className,
  onAnalyze,
  onUpgrade,
}: {
  size?: "lg" | "md";
  className?: string;
  onAnalyze?: (url: string, mode: AnalyzeMode) => void | Promise<void>;
  onUpgrade?: (kind: UpsellKind, tier: UpsellTier) => void;
}) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<AnalyzeMode>("quick");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [usage, setUsage] = useState<UsageState | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refreshUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.quickSearch) setUsage(d as UsageState);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    return () => {
      for (const t of timeouts.current) clearTimeout(t);
    };
  }, []);

  const quickRemaining = usage ? Math.max(0, usage.quickSearch.limit - usage.quickSearch.used) : null;
  const deepRemaining = usage ? Math.max(0, usage.deepResearch.limit - usage.deepResearch.used) : null;
  // While /api/usage hasn't resolved, do NOT block from the client — the
  // server-side check is authoritative and will 429 (or pass) correctly.
  // Blocking early here would show a false upsell to a pro/free user who
  // still has quota, just because the fetch hadn't landed yet.
  const usageLoaded = usage !== null;
  const canDeep = !usageLoaded || deepRemaining === null || deepRemaining > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || state === "working") return;
    // Gate deep research client-side by the caller's actual quota: anonymous
    // has zero, free has 1/day, pro has 50/cycle. Users with quota left go
    // straight through; users at/over the limit get the honest upsell.
    if (mode === "deep" && !canDeep) {
      onUpgrade?.("deep_research", usage?.tier ?? "anonymous");
      return;
    }
    setState("working");
    await onAnalyze?.(url.trim(), mode);
    refreshUsage();
    timeouts.current.push(
      setTimeout(() => {
        setState("done");
        document.getElementById("example")?.scrollIntoView({ behavior: "smooth", block: "start" });
        timeouts.current.push(
          setTimeout(() => setState("idle"), 1400),
        );
      }, 1200),
    );
  }

  const workingLabel = mode === "deep" ? "Researching" : "Scoring";
  const idleLabel = mode === "deep" ? "Deep research" : "Score it";

  let helper =
    "Paste a URL and get a newsworthiness score in seconds";
  if (mode === "deep") {
    if (usage && canDeep) {
      helper = `Grounded in live research across recent coverage — takes longer than a quick score (${deepRemaining} ${deepRemaining === 1 ? "run" : "runs"} left this ${
        usage.tier === "pro" ? "cycle" : "day"
      })`;
    } else if (usage?.signedIn) {
      helper =
        usage.deepResearch.limit > 0
          ? "Today's deep research used — it resets at UTC midnight · Pro gets 50/week-monthly"
          : "Deep research is a Pro feature — upgrade to run it";
    } else {
      helper = "Deep research needs a free account — log in for 1 run/day";
    }
  } else if (usage) {
    if (usage.tier === "anonymous") {
      const rem = quickRemaining ?? 0;
      helper =
        rem > 0
          ? `${rem} ${rem === 1 ? "story" : "stories"} left free · log in to keep going`
          : "All 3 free stories used · log in to keep analyzing";
    } else if (usage.tier === "free") {
      const rem = quickRemaining ?? 0;
      helper =
        rem > 0
          ? `${rem} ${rem === 1 ? "quick score" : "quick scores"} left today · Pro gives you 250/mo`
          : "Today's 10 quick scores used · Pro gives you 250/mo";
    } else {
      helper = `${quickRemaining ?? 0} of 250 quick scores left this cycle`;
    }
  }

  return (
    <form onSubmit={submit} className={cn("w-full", className)}>
      <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 mb-3" role="tablist">
        {(["quick", "deep"] as AnalyzeMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
              mode === m ? "bg-accent-strong/10 text-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {m === "quick" ? "Quick score" : (
              <>
                Deep Research
                <span className="label-mono text-[10px] text-accent-strong font-semibold">PRO</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-full border border-border bg-card pr-1.5 transition-colors focus-within:border-foreground/40",
          size === "lg" ? "pl-4 py-1.5" : "pl-3.5 py-1",
        )}
      >
        <Link2 className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          placeholder="https://reuters.com/breaking-story..."
          aria-label="News story URL"
          className={cn(
            "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70",
            size === "lg" ? "py-3 text-base" : "py-2 text-sm",
          )}
        />
        <button
          type="submit"
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-strong font-medium text-primary-foreground transition-[transform,opacity] duration-200 hover:-translate-y-px active:translate-y-0 disabled:opacity-70",
            size === "lg" ? "px-5 py-3 text-sm" : "px-4 py-2 text-sm",
          )}
          disabled={state === "working"}
        >
          {state === "working" ? (
            <>
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              {workingLabel}
            </>
          ) : (
            <>
              {idleLabel}
              <ArrowRight className="size-4 transition-transform duration-200 group-focus-within:translate-x-0.5" strokeWidth={2} />
            </>
          )}
        </button>
      </div>
      <p className="mt-3 label-mono">{helper}</p>
    </form>
  );
}