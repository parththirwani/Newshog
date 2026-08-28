"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UrlInput, type AnalyzeMode } from "@/components/landing/UrlInput";
import { UpsellModal, type UpsellKind, type UpsellTier } from "@/components/app/UpsellModal";

export function DashboardAnalyze() {
  const router = useRouter();
  const [quota, setQuota] = useState<{ kind: UpsellKind; tier: UpsellTier; resetsAt: string | null } | null>(null);

  return (
    <>
      <UrlInput
        onUpgrade={(kind, tier) => setQuota({ kind, tier, resetsAt: null })}
        onAnalyze={async (url, mode = "quick") => {
          const res = await fetch(mode === "deep" ? "/api/analyze/deep" : "/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (res.ok) {
            router.push(`/analyze/${data.id}`);
          } else if (data.code === "quota_exceeded") {
            setQuota({ kind: data.kind as UpsellKind, tier: data.tier as UpsellTier, resetsAt: data.resetsAt ?? null });
          } else if (data.code === "auth_required") {
            setQuota({ kind: "deep_research", tier: "anonymous", resetsAt: null });
          }
        }}
      />

      {quota && (
        <UpsellModal
          open
          kind={quota.kind}
          tier={quota.tier}
          resetsAt={quota.resetsAt}
          onClose={() => setQuota(null)}
        />
      )}
    </>
  );
}