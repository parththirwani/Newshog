"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnalyzeMode = "quick" | "deep";

export function UrlInput({
  size = "lg",
  className,
  onAnalyze,
  pro = false,
  onUpgrade,
}: {
  size?: "lg" | "md";
  className?: string;
  onAnalyze?: (url: string, mode: AnalyzeMode) => void | Promise<void>;
  pro?: boolean;
  onUpgrade?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<AnalyzeMode>("quick");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refreshUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.signedIn && typeof d.remaining === "number") setRemaining(d.remaining);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || state === "working") return;
    // Deep Research is pro-gated: non-pro users get the upgrade prompt, never
    // an unscoped backend call.
    if (mode === "deep" && !pro) {
      onUpgrade?.();
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
              mode === m ? "bg-accent/10 text-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {m === "quick" ? "Quick score" : (
              <>
                Deep Research
                {!pro && <span className="label-mono text-[10px] text-accent-strong font-semibold">PRO</span>}
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
          ) : mode === "deep" ? (
            <>
              {idleLabel}
              <ArrowRight className="size-4 transition-transform duration-200 group-focus-within:translate-x-0.5" strokeWidth={2} />
            </>
          ) : (
            <>
              {idleLabel}
              <ArrowRight className="size-4 transition-transform duration-200 group-focus-within:translate-x-0.5" strokeWidth={2} />
            </>
          )}
        </button>
      </div>
      <p className="mt-3 label-mono">
        {mode === "deep"
          ? pro
            ? "Grounded in live research across recent coverage — takes longer than a quick score"
            : "Deep research is a Pro feature — upgrade to run it"
: remaining !== null
              ? remaining > 0
                ? `${remaining} ${remaining === 1 ? "story" : "stories"} left free · log in to keep going`
                : "All 3 free stories used · log in to keep analyzing"
              : "Paste a URL and get a newsworthiness score in seconds"}
      </p>
    </form>
  );
}