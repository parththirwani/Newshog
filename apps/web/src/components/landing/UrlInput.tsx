"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function UrlInput({
  size = "lg",
  className,
  onAnalyze,
}: {
  size?: "lg" | "md";
  className?: string;
  onAnalyze?: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      for (const t of timeouts.current) clearTimeout(t);
    };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim() || state === "working") return;
    setState("working");
    onAnalyze?.(url.trim());
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

  return (
    <form onSubmit={submit} className={cn("w-full", className)}>
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
              Scoring
            </>
          ) : (
            <>
              Score it
              <ArrowRight className="size-4 transition-transform duration-200 group-focus-within:translate-x-0.5" strokeWidth={2} />
            </>
          )}
        </button>
      </div>
      <p className="mt-3 label-mono">First 3 stories free &middot; ~30s</p>
    </form>
  );
}
