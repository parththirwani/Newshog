"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { SCORE_THRESHOLD_LOW, SCORE_THRESHOLD_HIGH } from "@newshog/shared";
import type { Angle, Analysis, AnalysisStatus } from "@newshog/shared";

function scoreColor(score: number): string {
  if (score >= SCORE_THRESHOLD_HIGH) return "text-green-400";
  if (score >= SCORE_THRESHOLD_LOW) return "text-yellow-400";
  return "text-red-400";
}

function scoreLabel(score: number): string {
  if (score >= SCORE_THRESHOLD_HIGH) return "Strong opportunity";
  if (score >= SCORE_THRESHOLD_LOW) return "Consider";
  return "Don't newsjack this";
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollStatus = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/analyze/${id}/status`);
          const data = await res.json();
          setResult(data);
          if (data.status === "analyzed" || data.status === "failed") {
            stopPolling();
            setLoading(false);
          }
        } catch {
          stopPolling();
          setLoading(false);
          setError("Lost connection to server.");
        }
      }, 1500);
    },
    [stopPolling],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setError("");
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setLoading(false);
        return;
      }
      setResult(data);
      pollStatus(data.id);
    } catch {
      setError("Failed to reach server.");
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-20">
      <h1 className="text-4xl font-bold tracking-tight mb-2">Newshog</h1>
      <p className="text-gray-400 mb-10">Paste a news URL to analyze the opportunity.</p>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="url"
          required
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg bg-gray-900 border border-gray-700 px-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Analyze
        </button>
      </form>

      {error && (
        <p className="mt-4 text-red-400 text-sm">{error}</p>
      )}

      {loading && (
        <div className="mt-8 flex items-center gap-3 text-gray-400">
          <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          {result?.status === "scraping" && "Scraping the article\u2026"}
          {result?.status === "scraped" && "Scraped. Starting analysis\u2026"}
          {result?.status === "analyzing" && "Analyzing the story\u2026"}
          {!result?.status || result.status === "queued" && "Queued\u2026"}
        </div>
      )}

      {!loading && result?.status === "analyzed" && result.score != null && (
        <div className="mt-8 space-y-6">
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-6">
            <div className="flex items-baseline gap-3 mb-2">
              <span className={`text-4xl font-bold ${scoreColor(result.score)}`}>
                {result.score}
              </span>
              <span className="text-sm text-gray-400">/ 100</span>
            </div>
            <p className={`text-sm font-medium ${scoreColor(result.score)}`}>
              {scoreLabel(result.score)}
            </p>
            <p className="text-sm text-gray-300 mt-2">{result.articleTitle}</p>
          </div>

          <div className="rounded-lg bg-gray-900 border border-gray-800 p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Why This Matters</h2>
            <p className="text-gray-200">{result.whyNow}</p>
          </div>

          {result.angles && result.angles.length > 0 && (
            <div className="rounded-lg bg-gray-900 border border-gray-800 p-6">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Best Angles</h2>
              <div className="space-y-4">
                {result.angles.map((angle, i) => (
                  <div key={i} className="border-l-2 border-blue-500 pl-4">
                    <h3 className="font-medium text-gray-100">{angle.title}</h3>
                    <p className="text-sm text-gray-300 mt-1">{angle.why_now}</p>
                    <p className="text-sm text-gray-400 mt-1">{angle.why_journalists_care}</p>
                    <p className="text-sm text-blue-400 mt-1 italic">&ldquo;{angle.headline}&rdquo;</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && result?.status === "failed" && (
        <div className="mt-8 rounded-lg bg-gray-900 border border-gray-800 p-6">
          <h2 className="font-semibold text-lg mb-1 text-red-400">Analysis failed</h2>
          <p className="text-sm text-gray-400">{result.error || "Something went wrong."}</p>
        </div>
      )}
    </main>
  );
}
