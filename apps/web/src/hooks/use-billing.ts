"use client";

import { useCallback, useState } from "react";

export type BillingErrorState =
  | null
  | { code: "billing_unconfigured" }
  | { code: "auth_required" }
  | { code: "no_subscription" }
  | { code: "unknown" };

// Shared Stripe checkout/portal trigger used by the landing pricing section,
// the dashboard, and the user menu. POSTs the billing route; on success the
// server returns a hosted Stripe URL we navigate to.
export function useBilling() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BillingErrorState>(null);

  const start = useCallback(async (kind: "checkout" | "portal") => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/${kind}`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      if (data.code === "billing_unconfigured") setError({ code: "billing_unconfigured" });
      else if (data.code === "auth_required") setError({ code: "auth_required" });
      else if (data.code === "no_subscription") setError({ code: "no_subscription" });
      else setError({ code: "unknown" });
    } catch {
      setError({ code: "unknown" });
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, start };
}