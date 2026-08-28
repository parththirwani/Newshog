"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { AuthButton } from "@/components/landing/AuthButton";

// Only allow a same-origin path like "/pricing" or "/dashboard". Rejects
// absolute URLs, protocol-relative "//host", and anything not starting with
// exactly one "/".
function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

const inputClass =
  "w-full rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40";
const btnPrimary =
  "inline-flex items-center gap-2 rounded-full bg-accent-strong px-5 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:-translate-y-px active:translate-y-0 disabled:opacity-70";

export default function LoginPage() {
  const router = useRouter();
  // Client-side read of ?next= so post-login we can return the user to where
  // they were headed (e.g. the pricing section to start checkout), instead of
  // hard-casting every login to /dashboard. Only same-origin relative paths
  // are honored — `https://evil.example` and protocol-relative `//evil` are
  // rejected, otherwise an attacker-controlled ?next= would redirect a freshly
  // authenticated user off-site (open-redirect phishing vector).
  const nextPath =
    typeof window !== "undefined"
      ? safeNext(new URLSearchParams(window.location.search).get("next"))
      : "/dashboard";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to send code.");
      } else {
        setCodeSent(true);
      }
    } catch {
      setError("Failed to reach server.");
    }
    setLoading(false);
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Invalid code.");
      } else {
        router.push(nextPath);
      }
    } catch {
      setError("Failed to reach server.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <AuthButton />
      </div>

      <div className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Log in</h1>
        <p className="text-sm text-muted-foreground mb-8">
          No password needed — we email you a one-time code.
        </p>

        {error && (
          <div className="mb-6 rounded-2xl border border-destructive/50 bg-card px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!codeSent ? (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Code sent to <span className="text-foreground">{email}</span>. Check your server console.
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              maxLength={6}
              required
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Verify & continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}