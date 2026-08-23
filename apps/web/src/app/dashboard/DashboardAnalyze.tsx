"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UrlInput, type AnalyzeMode } from "@/components/landing/UrlInput";

export function DashboardAnalyze() {
  const router = useRouter();
  const [pro, setPro] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setPro(Boolean(d.pro)))
      .catch(() => {});
  }, []);

  return (
    <>
      <UrlInput
        pro={pro}
        onUpgrade={() => setUpgradeOpen(true)}
        onAnalyze={async (url, mode = "quick") => {
          const res = await fetch(mode === "deep" ? "/api/analyze/deep" : "/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (res.ok) {
            router.push(`/analyze/${data.id}`);
          } else if (data.code === "pro_required") {
            setUpgradeOpen(true);
          }
        }}
      />

      {upgradeOpen && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-background/70 p-5 backdrop-blur-sm"
          onClick={() => setUpgradeOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 elevate"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold tracking-[-0.02em]">Deep Research is a Pro feature</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Quick score works for everyone. Deep research searches live coverage, surfaces competitive
              context, and grounds your score in cited sources.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href="/profile"
                className="inline-flex items-center gap-1.5 rounded-full bg-accent-strong px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Upgrade to Pro
              </a>
              <button
                onClick={() => setUpgradeOpen(false)}
                className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}