"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function AuthButton({ className }: { className?: string }) {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => setEmail(d?.signedIn ? (d.email as string) : null))
      .catch(() => {});
  }, []);

  return (
    <Link
      href={email ? "/dashboard" : "/login"}
      className={cn(
        "inline-flex items-center rounded-full border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary",
        className,
      )}
    >
      {email === null ? "Log in" : "Dashboard"}
    </Link>
  );
}