"use client";

import { useRouter } from "next/navigation";
import { UrlInput } from "@/components/landing/UrlInput";

export function DashboardAnalyze() {
  const router = useRouter();
  return (
    <UrlInput
      onAnalyze={async (url) => {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (res.ok) router.push(`/analyze/${data.id}`);
      }}
    />
  );
}