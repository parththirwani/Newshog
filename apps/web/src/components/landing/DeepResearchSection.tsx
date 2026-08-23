"use client";

import {
  Check,
  GitMerge,
  Radar,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Reveal } from "./Reveal";
import { ScoreRing } from "@/components/app/ScoreRing";

const findings = [
  {
    text: "This is the 4th similar launch this month novelty is low, score should reflect a crowded take.",
    badge: "Saturation check",
  },
  {
    text: "Axios Pro, The Information and two trade desks already filed on the space in the last 14 days.",
    badge: "Who's writing on it",
  },
  {
    text: "The angle \"compliance bill nobody costed\" isn't covered yet first-to-claim justifies a higher score.",
    badge: "Fresh ground",
  },
];

const cards = [
  {
    n: "01",
    icon: Search,
    title: "Searches live coverage",
    body: "Recent articles, comparable launches, and who already filed — not just your one URL.",
  },
  {
    n: "02",
    icon: GitMerge,
    title: "Fans out the research",
    body: "Independent threads run in parallel: what's new, who wrote it, and why now.",
  },
  {
    n: "03",
    icon: ShieldCheck,
    title: "Verify, then cite",
    body: "Every claim is grounded in a source excerpt; the top few surface in your verdict.",
  },
];

/**
 * Deep Research showcase — the Pro-tier context step sold on the landing page.
 * Aceternity-flavored bento (glow behind the headline, conic border on the
 * primary card) matched to this app's own design tokens.
 */
export function DeepResearchSection() {
  return (
    <section id="deep-research" className="relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-[520px] max-w-4xl rounded-full opacity-60 [mask-image:radial-gradient(60%_60%_at_50%_30%,#000,transparent)]"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--accent-strong) 22%, transparent), transparent)",
        }}
      />
      <div aria-hidden className="grid-paper pointer-events-none absolute inset-0 opacity-60 mask-[radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" />

      <div className="relative mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <Reveal className="text-center">
          <span className="label-mono">Deep Research · Pro</span>
          <h2 className="mx-auto mt-4 display-lg max-w-[20ch] text-balance">
            Score the story <span className="text-accent-strong">with the whole room</span> in context.
          </h2>
          <p className="mx-auto mt-5 max-w-xl leading-relaxed font-light text-muted-foreground">
            Quick score reads one article. Deep Research reads the room around it: recent coverage,
            who else is writing on the space, and whether the angle is crowded or first then feeds
            that into the same score, angles, and pitch.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {/* Primary card — findings digest with live border */}
          <Reveal delay={80} className="md:col-span-2">
            <div className="live-border elevate relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
              <span aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full blur-3xl"
                style={{ background: "color-mix(in oklab, var(--accent-strong) 16%, transparent)" }}
              />
              <div className="relative">
                <span className="label-mono">What the research surfaced</span>
                <ul className="mt-6 space-y-3">
                  {findings.map((f, i) => (
                    <li key={i} className="rounded-xl border border-border bg-background/60 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-accent-strong/10">
                          <Check className="size-3 text-accent-strong" strokeWidth={2.25} />
                        </span>
                        <div>
                          <p className="text-sm leading-relaxed text-foreground/85">{f.text}</p>
                          <p className="mt-1 label-mono !text-[10px]">{f.badge}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>

{/* Side card — the scoring lever */}
          <Reveal delay={160}>
            <div className="elevate flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-foreground">
                  <Radar className="size-5" strokeWidth={1.75} />
                </span>
                <ScoreRing score={80} size={64} />
              </div>
              <div className="mt-8">
                <p className="font-semibold tracking-[-0.01em]">The novelty lever</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  With five comparable launches this week, research drops that score below the pack.
                  First-to-cover? It pushes the other way.
                </p>
              </div>
            </div>
          </Reveal>

          {/* Four step cards */}
          {cards.map((card, i) => (
            <Reveal key={card.n} delay={80 + i * 60}>
              <div className="elevate group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-accent-strong/40">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-foreground">
                    <card.icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="font-mono text-sm text-muted-foreground/50">{card.n}</span>
                </div>
                <p className="mt-6 font-semibold tracking-[-0.01em]">{card.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}