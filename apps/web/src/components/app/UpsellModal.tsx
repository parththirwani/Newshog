"use client";

import { useState } from "react";
import Link from "next/link";

export type UpsellKind = "quick_search" | "deep_research";
export type UpsellTier = "anonymous" | "free" | "pro";

// Tier-aware 429 gate modal. Anonymous → log in; free at limit → upgrade to
// Pro via Stripe checkout; pro at limit → manage plan via the billing portal.
// Replaces the old anonymous "Deep Research is a Pro feature" modals so every
// quota rejection renders a specific, honest path forward.
export function UpsellModal({
  open,
  kind,
  tier,
  resetsAt,
  onClose,
}: {
  open: boolean;
  kind: UpsellKind;
  tier: UpsellTier;
  resetsAt: string | null;
  onClose: () => void;
}) {
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  if (!open) return null;

  async function upgrade() {
    setCheckoutError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.assign(data.url);
      } else if (data.code === "billing_unconfigured") {
        setCheckoutError("Billing isn't wired up yet — reach out to get Pro access.");
      } else {
        setCheckoutError("Something went wrong starting checkout. Try again.");
      }
    } catch {
      setCheckoutError("Could not reach the billing server.");
    }
  }

  const resetLine = resetsAt ? ` · resets ${formatRelative(resetsAt)}` : "";

  function copy(): { title: string; body: string } {
    if (tier === "pro") {
      return {
        title: kind === "quick_search" ? "Quick-score limit hit this cycle" : "Deep-research limit hit this cycle",
        body: `You're on Pro and used this billing cycle's ${kind === "quick_search" ? "250 quick scores" : "50 deep research runs"}${resetLine}.`,
      };
    }
    if (tier === "anonymous") {
      return kind === "quick_search"
        ? {
            title: "All 3 free stories used",
            body: "Log in to keep analyzing with 10 quick scores/day + 1 deep research run/day.",
          }
        : {
            title: "Deep research needs an account",
            body: "Sign in to your free account for 1 deep research run per day — or go Pro for 50/month, billed-cycle anchored.",
          };
    }
    return kind === "quick_search"
      ? {
          title: "You've used today's quick scores",
          body: `Free tier gets 10 quick scores/day${resetLine}. Go Pro for 250 quick scores and 50 deep research runs per month.`,
        }
      : {
          title: "You've used today's deep research",
          body: `Free tier gets 1 deep research run/day${resetLine}. Go Pro for 50 deep research runs per month.`,
        };
  }

  const { title, body } = copy();

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-background/70 p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 elevate"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-semibold tracking-[-0.02em]">{title}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>

        <div className="mt-5 flex items-center gap-2">
          {tier === "anonymous" ? (
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Log in / Sign up
            </Link>
          ) : tier === "free" ? (
            <button
              onClick={upgrade}
              className="rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px active:translate-y-0"
            >
              Upgrade to Pro · $20/mo
            </button>
          ) : (
            <button
              onClick={async () => {
                try {
                  const res = await fetch("/api/billing/portal", { method: "POST" });
                  const data = await res.json();
                  if (res.ok && data.url) window.location.assign(data.url);
                } catch {
                  /* leave the modal open with the generic message below */
                }
              }}
              className="rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px active:translate-y-0"
            >
              Manage plan
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary"
          >
            Not now
          </button>
        </div>

        {checkoutError && <p className="mt-3 text-xs text-destructive">{checkoutError}</p>}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = then - Date.now();
  if (Number.isNaN(diff) || diff <= 0) return "soon";
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 24) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (hours >= 1) {
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    return `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
  }
  return `${Math.max(1, Math.floor(diff / 60_000))}m`;
}