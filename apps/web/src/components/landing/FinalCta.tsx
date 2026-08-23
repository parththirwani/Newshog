"use client";

import { Reveal, WordReveal } from "./Reveal";
import { UrlInput, type AnalyzeMode } from "./UrlInput";

export function FinalCta({
  onAnalyze,
  pro = false,
  onUpgrade,
}: {
  onAnalyze?: (url: string, mode: AnalyzeMode) => void;
  pro?: boolean;
  onUpgrade?: () => void;
}) {
  return (
    <section id="cta" className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="grid-paper pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_70%_at_70%_100%,#000,transparent)]"
      />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-24 sm:px-8 lg:px-12 lg:py-32">
        <div className="max-w-3xl">
          <span className="label-mono">The window is open right now</span>
          <h2 className="mt-5 display-xl text-balance min-w-0">
            <WordReveal text="Somebody is pitching this story." />
            <span className="text-accent-strong">
              <WordReveal text="Might as well be you." />
            </span>
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed font-light text-muted-foreground">
            Paste a link. Get the verdict before the news cycle moves on.
          </p>
          <Reveal delay={80}>
            <UrlInput className="mt-9 max-w-xl" onAnalyze={onAnalyze} pro={pro} onUpgrade={onUpgrade} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
