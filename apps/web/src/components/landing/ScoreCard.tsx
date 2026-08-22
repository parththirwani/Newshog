"use client";

import { useInView, useCountUp } from "@/hooks/use-reveal";
import { cn } from "@/lib/utils";

const bars = [
  { label: "Velocity", value: 92 },
  { label: "Angle fit", value: 84 },
  { label: "Crowding", value: 61 },
  { label: "Shelf life", value: 73 },
];

export function ScoreCard({ className }: { className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const score = useCountUp(87, inView, 1200);

  return (
    <div
      ref={ref}
      className={cn(
        "live-border rounded-2xl border border-border bg-card p-6 elevate transition-[opacity,transform] duration-500 ease-out sm:p-7",
        inView ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="label-mono">Newsjack score</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-mono text-[11px] tracking-wider text-accent-foreground uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-accent-strong" />
          Live
        </span>
      </div>

      <div className="mt-5 flex items-end gap-4">
        <div className="flex items-baseline">
          <span className="text-[5.5rem] leading-[0.8] font-semibold tracking-[-0.05em] tabular-nums text-foreground">
            {score}
          </span>
          <span className="ml-1 font-mono text-sm text-muted-foreground">/100</span>
        </div>
        <span className="mb-2 rounded-md bg-accent-strong px-2.5 py-1 font-mono text-[11px] tracking-[0.12em] text-primary-foreground uppercase">
          High opportunity
        </span>
      </div>

      <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Story is 41 minutes old, three tier-1 outlets are chasing follow-ups, and nobody in your
        category has commented yet.
      </p>

      <dl className="mt-6 space-y-3">
        {bars.map((bar, i) => (
          <div key={bar.label} className="flex items-center gap-3">
            <dt className="w-24 shrink-0 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
              {bar.label}
            </dt>
            <dd className="flex-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-foreground transition-[width] duration-700 ease-out"
                  style={{
                    width: inView ? `${bar.value}%` : "0%",
                    transitionDelay: `${200 + i * 90}ms`,
                    background: bar.value >= 80 ? "var(--accent-strong)" : "var(--ink)",
                  }}
                />
              </div>
            </dd>
            <span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {bar.value}
            </span>
          </div>
        ))}
      </dl>
    </div>
  );
}
