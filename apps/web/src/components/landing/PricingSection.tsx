"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Reveal } from "./Reveal";
import { useBilling } from "@/hooks/use-billing";

const FREE_FEATURES = [
  "3 anonymous quick scores",
  "10 quick scores / day",
  "1 deep research run / day",
  "Angles, why-now & velocity",
];

const PRO_FEATURES = [
  "250 quick scores / month",
  "50 deep research runs / month",
  "Billing-cycle anchored resets",
  "Early access to new signals",
];

// Stripe-integrated pricing section for the landing page. Paying starts a real
// Stripe Checkout session ($20/mo); anonymously-landing non-sign in gets a
// login nudge + a Pro upsell. Mirrors the quota tiers in lib/usage.ts.
export function PricingSection() {
  const router = useRouter();
  const { loading, error, start } = useBilling();
  const [signedIn, setSignedIn] = useState(false);
  const [pro, setPro] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setSignedIn(Boolean(d.signedIn));
        setPro(Boolean(d.pro));
      })
      .catch(() => {});
  }, []);

  const upgrade = async () => {
    if (!signedIn) {
      router.push(`/login?next=/pricing`);
      return;
    }
    await start("checkout");
  };

  return (
    <section id="pricing" className="scroll-mt-20 relative overflow-hidden border-b border-border">
      <div
        aria-hidden
        className="grid-paper pointer-events-none absolute inset-0 opacity-50 mask-[radial-gradient(60%_50%_at_50%_0%,#000,transparent)]"
      />
      <div className="relative mx-auto max-w-6xl px-5 py-24 lg:py-32">
        <Reveal className="text-center">
          <span className="label-mono">Pricing</span>
          <h2 className="mx-auto mt-4 display-lg max-w-[18ch] text-balance">
            Start free. <span className="text-accent-strong">Go Pro when the volume hits.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl leading-relaxed font-light text-muted-foreground">
            Every tier gets quick scores, angles, and pitches. Pro adds deep research and a much
            higher monthly ceiling — billed monthly, cycle-anchored, cancel anytime.
          </p>
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-2">
          {/* Free */}
          <Reveal>
            <div className="elevate flex h-full flex-col rounded-2xl border border-border bg-card p-7">
              <p className="label-mono">Free</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-[-0.03em]">$0</span>
                <span className="label-mono text-muted-foreground">/month</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                For trying a story or two without an account.
              </p>
              <ul className="mt-6 space-y-2.5">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-strong" strokeWidth={2.25} />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push("/login")}
                className="mt-7 w-full rounded-full border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
              >
                {pro ? "You're on Pro, but Free is always available" : signedIn ? "You're on Free" : "Start free"}
              </button>
            </div>
          </Reveal>

          {/* Pro */}
          <Reveal delay={80}>
            <div className="live-border relative flex h-full flex-col rounded-2xl border border-border bg-card p-7">
              <span className="absolute -top-3 right-6 inline-flex items-center rounded-full bg-accent-strong px-3 py-1 text-[11px] font-semibold text-primary-foreground">
                Most popular
              </span>
              <p className="label-mono">Pro</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-[-0.03em]">$20</span>
                <span className="label-mono text-muted-foreground">/month</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                For founders and PR teams playing the news cycle daily.
              </p>
              <ul className="mt-6 space-y-2.5">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-strong" strokeWidth={2.25} />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => (pro ? start("portal") : upgrade())}
                disabled={loading}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-accent-strong px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px active:translate-y-0 disabled:opacity-70"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : pro ? "Manage plan" : "Upgrade to Pro"}
              </button>

              {error?.code === "auth_required" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Sign in to continue.
                </p>
              )}
              {error?.code === "billing_unconfigured" && (
                <p className="mt-3 text-xs text-destructive">
                  Billing isn't wired up yet — reach out to get Pro access.
                </p>
              )}
              {error?.code === "unknown" && (
                <p className="mt-3 text-xs text-destructive">
                  Couldn't start checkout. Try again.
                </p>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}