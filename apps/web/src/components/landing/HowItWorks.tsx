"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const steps = [
  {
    n: "01",
    title: "Paste the URL",
    body: "Any article, any outlet, any language. No account, no browser extension, no CSV upload.",
    aside: "Input",
  },
  {
    n: "02",
    title: "We read the room",
    body: "Coverage velocity, who already commented, how crowded the take is, and how long the story survives.",
    aside: "Signals",
  },
  {
    n: "03",
    title: "You get a verdict",
    body: "A 0–100 score with a plain-English go / wait / skip, so you stop debating it in Slack.",
    aside: "Score",
  },
  {
    n: "04",
    title: "Send the pitch",
    body: "Three angles ranked by strength, matched reporters on the beat, and a draft email you can send as-is.",
    aside: "Output",
  },
];

export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return;
      const p = Math.min(1, Math.max(0, -rect.top / total));
      setProgress(p);
      setActive(Math.min(steps.length - 1, Math.floor(p * steps.length * 0.999)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section id="how" className="border-b border-border">
      <div ref={sectionRef} className="relative h-[220vh]">
        <div className="sticky top-0 flex h-screen items-center">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
              <div>
                <span className="label-mono">How it works</span>
                <h2 className="mt-4 display-lg max-w-[12ch] text-balance">
                  Four steps. One coffee.
                </h2>
                <div className="mt-8 h-px w-full bg-border">
                  <div
                    className="h-px bg-accent-strong transition-[width] duration-150 ease-linear"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <div className="mt-4 flex gap-3">
                  {steps.map((s, i) => (
                    <span
                      key={s.n}
                      className={cn(
                        "font-mono text-[11px] tracking-wider transition-colors duration-200",
                        i === active ? "text-accent-strong" : "text-muted-foreground/50",
                      )}
                    >
                      {s.n}
                    </span>
                  ))}
                </div>
              </div>

              <div className="relative min-h-[16rem]">
                {steps.map((s, i) => (
                  <div
                    key={s.n}
                    aria-hidden={i !== active}
                    className={cn(
                      "transition-[opacity,transform] duration-300 ease-out",
                      i === active
                        ? "relative opacity-100 translate-y-0"
                        : "pointer-events-none absolute inset-0 translate-y-4 opacity-0",
                    )}
                  >
                    <span className="label-mono">{s.aside}</span>
                    <div className="mt-3 flex items-start gap-6">
                      <span className="text-[clamp(3.5rem,9vw,7rem)] leading-[0.8] font-semibold tracking-[-0.05em] text-accent-strong/15">
                        {s.n}
                      </span>
                      <div className="pt-2">
                        <h3 className="text-[clamp(1.5rem,2.6vw,2.25rem)] leading-tight font-semibold tracking-[-0.035em]">
                          {s.title}
                        </h3>
                        <p className="mt-3 max-w-md text-lg leading-relaxed font-light text-muted-foreground">
                          {s.body}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
