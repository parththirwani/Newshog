"use client";

import { useEffect, useState } from "react";
import { ScoreCard } from "./ScoreCard";
import { UrlInput } from "./UrlInput";

const rotating = ["worth a pitch", "already crowded", "dead by noon", "your whole week"];

export function Hero({ onAnalyze }: { onAnalyze?: (url: string) => void }) {
  const [i, setI] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setI((v) => (v + 1) % rotating.length), 2400);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onScroll = () => setOffset(window.scrollY * 0.12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section id="top" className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="grid-paper pointer-events-none absolute inset-x-0 -top-24 h-[560px] opacity-70 [mask-image:radial-gradient(70%_60%_at_30%_0%,#000,transparent)]"
        style={{ transform: `translateY(${offset}px)` }}
      />
      <div className="relative mx-auto grid max-w-6xl gap-14 px-5 pt-20 pb-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:pt-28 lg:pb-32">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1">
            <span className="size-1.5 rounded-full bg-accent-strong" />
            <span className="label-mono">Newsroom clock, founder speed</span>
          </div>

          <h1 className="mt-7 display-xl max-w-[16ch] text-balance">
            Know if a story is{" "}
            <span className="relative inline-grid">
              {rotating.map((word, idx) => (
                <span
                  key={word}
                  aria-hidden={idx !== i}
                  className="col-start-1 row-start-1 text-accent-strong transition-[opacity,transform] duration-300 ease-out"
                  style={{
                    opacity: idx === i ? 1 : 0,
                    transform: idx === i ? "translateY(0)" : "translateY(0.25em)",
                  }}
                >
                  {word}
                </span>
              ))}
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed font-light text-muted-foreground">
            Paste a breaking-news URL. Newshog scores the newsjack opportunity, hands you the sharpest
            angles, and drafts a pitch a journalist would actually open. About thirty seconds.
          </p>

          <UrlInput className="mt-8 max-w-xl" onAnalyze={onAnalyze} />

          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            {[
              ["31s", "median analysis"],
              ["1.2M", "stories indexed"],
              ["18k", "journalist beats"],
            ].map(([value, label]) => (
              <div key={label}>
                <div className="text-2xl font-semibold tracking-[-0.03em] tabular-nums">{value}</div>
                <div className="label-mono mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative lg:pl-6">
          <div
            aria-hidden
            className="absolute -top-8 -right-4 hidden h-40 w-40 rounded-full bg-accent blur-3xl lg:block"
            style={{ transform: `translateY(${-offset * 0.6}px)` }}
          />
          <ScoreCard className="relative" />
          <div className="relative mt-3 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex -space-x-2">
              {["AK", "MR", "JL", "TS"].map((initials) => (
                <span
                  key={initials}
                  className="grid size-7 place-items-center rounded-full border border-card bg-secondary font-mono text-[10px] text-muted-foreground"
                >
                  {initials}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">412 operators</span> scored a story in the
              last 24 hours
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
