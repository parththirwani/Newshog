"use client";

import { useState } from "react";
import { ArrowUpRight, Copy, TrendingUp } from "lucide-react";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

const tabs = ["Why now", "Top angles", "Draft pitch", "Journalists"] as const;
type Tab = (typeof tabs)[number];

const angles = [
  {
    title: "The compliance bill nobody costed",
    strength: 94,
    note: "You have first-party data on the actual cost per SMB. Reporters have none.",
  },
  {
    title: "Founders vs. the 30-day deadline",
    strength: 81,
    note: "Human angle, easy quote, works for trade and national desks.",
  },
  {
    title: "Why the incumbents lobbied for it",
    strength: 67,
    note: "Spicy. Needs a source you can name on record.",
  },
];

const journalists = [
  { name: "Dana Whitfield", outlet: "Reuters", beat: "SMB policy", fit: 96 },
  { name: "Marcus Ono", outlet: "The Information", beat: "Fintech regulation", fit: 91 },
  { name: "Priya Raman", outlet: "Axios Pro", beat: "Compliance", fit: 88 },
];

export function LiveExample() {
  const [tab, setTab] = useState<Tab>("Why now");

  return (
    <section id="example" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal className="lg:sticky lg:top-24 lg:self-start">
            <span className="label-mono">Real output</span>
            <h2 className="mt-4 display-lg max-w-[14ch] text-balance">
              This is the whole product.
            </h2>
            <p className="mt-5 max-w-sm leading-relaxed font-light text-muted-foreground">
              No dashboard tour, no onboarding call. One URL in, one verdict out — with the angles and
              the pitch already written.
            </p>
            <div className="mt-7 flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 font-mono text-xs text-muted-foreground">
              <TrendingUp className="size-3.5 text-accent-strong" strokeWidth={2} />
              reuters.com/markets/smb-compliance-bill
            </div>
          </Reveal>

          <Reveal delay={90}>
            <div className="overflow-hidden rounded-2xl border border-border bg-card elevate">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <p className="text-sm font-medium">SMB compliance bill clears committee</p>
                  <p className="label-mono mt-1">Reuters · 41 min ago · Analyzed in 28s</p>
                </div>
                <span className="rounded-md bg-accent-strong px-2.5 py-1 font-mono text-[11px] tracking-[0.12em] text-primary-foreground uppercase">
                  87 · Go
                </span>
              </div>

              <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
                {tabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200",
                      tab === t
                        ? "bg-foreground text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="p-5 sm:p-7">
                {tab === "Why now" && (
                  <div className="space-y-4">
                    {[
                      "Three tier-1 outlets filed within 40 minutes — the follow-up window opens tonight.",
                      "Zero vendor commentary in coverage so far. The expert slot is empty.",
                      "Search interest for “compliance deadline” up 340% since 9:04 ET.",
                      "Expected shelf life: 3 days. Pitch before Monday and you're late.",
                    ].map((line, i) => (
                      <div key={line} className="flex gap-3">
                        <span className="mt-0.5 font-mono text-[11px] text-accent-strong">
                          0{i + 1}
                        </span>
                        <p className="text-[15px] leading-relaxed text-foreground/85">{line}</p>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "Top angles" && (
                  <ul className="space-y-3">
                    {angles.map((a, i) => (
                      <li
                        key={a.title}
                        className="group rounded-xl border border-border p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-foreground/25"
                        style={{ transitionDelay: `${i * 20}ms` }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <p className="font-medium tracking-[-0.01em]">{a.title}</p>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {a.strength}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                          {a.note}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {tab === "Draft pitch" && (
                  <div>
                    <div className="rounded-xl border border-border bg-secondary/50 p-5 font-mono text-[13px] leading-relaxed whitespace-pre-line text-foreground/85">
                      {`Subject: cost data on the SMB compliance bill (we have numbers)

Dana saw your committee piece. We process payroll for 4,100 small
businesses, so we can tell you what the 30-day window actually costs:
$1,840 median per business, and 61% won't make the deadline.

Happy to share the dataset or put our CFO on a call today.`}
                    </div>
                    <button className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-sm transition-colors hover:bg-secondary">
                      <Copy className="size-3.5" strokeWidth={1.75} />
                      Copy pitch
                    </button>
                  </div>
                )}

                {tab === "Journalists" && (
                  <ul className="divide-y divide-border">
                    {journalists.map((j) => (
                      <li key={j.name} className="flex items-center justify-between gap-4 py-3.5">
                        <div>
                          <p className="font-medium tracking-[-0.01em]">{j.name}</p>
                          <p className="label-mono mt-0.5">
                            {j.outlet} · {j.beat}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {j.fit}% fit
                          </span>
                          <ArrowUpRight className="size-4 text-muted-foreground" strokeWidth={1.75} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
