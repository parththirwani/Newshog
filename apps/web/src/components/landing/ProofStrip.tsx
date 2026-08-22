"use client";

import { Reveal } from "./Reveal";
import { useInView, useCountUp } from "@/hooks/use-reveal";

const outlets = [
  "REUTERS",
  "BLOOMBERG",
  "TECHCRUNCH",
  "AXIOS",
  "THE VERGE",
  "FT",
  "WIRED",
  "POLITICO",
  "THE INFORMATION",
];

function Stat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.5);
  const n = useCountUp(value, inView, 1000);
  return (
    <div ref={ref} className="border-t border-border pt-5">
      <div className="text-[clamp(2.25rem,4vw,3.25rem)] leading-none font-semibold tracking-[-0.045em] tabular-nums">
        {n}
        {suffix}
      </div>
      <p className="label-mono mt-2">{label}</p>
    </div>
  );
}

export function ProofStrip() {
  return (
    <section className="border-b border-border">
      <div className="overflow-hidden border-b border-border py-5">
        <div className="ticker-track flex w-max gap-12 pr-12">
          {[...outlets, ...outlets].map((o, i) => (
            <span
              key={`${o}-${i}`}
              className="font-mono text-sm tracking-[0.18em] whitespace-nowrap text-muted-foreground/60"
            >
              {o}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <Reveal>
            <span className="label-mono">Coverage graph</span>
            <h2 className="mt-4 display-lg max-w-[13ch] text-balance">
              Trained on the desks you're pitching.
            </h2>
            <p className="mt-5 max-w-md leading-relaxed font-light text-muted-foreground">
              Newshog watches 1,900 outlets and every byline on them, so the score reflects what
              editors are actually chasing right now not what trended last quarter.
            </p>
          </Reveal>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-2">
            <Stat value={1900} suffix="" label="outlets monitored" />
            <Stat value={31} suffix="s" label="median time to verdict" />
            <Stat value={18} suffix="k" label="journalist beats mapped" />
            <Stat value={4} suffix="x" label="reply rate vs cold pitch" />
          </div>
        </div>
      </div>
    </section>
  );
}
