"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type JobStatus = "queued" | "scraping" | "scraped" | "failed";

interface AnalysisResult {
  id: string;
  status: JobStatus;
  articleTitle?: string;
  error?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
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
          if (data.status === "scraped" || data.status === "failed") {
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
          Analyzing the story&hellip;
          {result && (
            <span className="text-xs text-gray-600 ml-2">{result.status}</span>
          )}
        </div>
      )}

      {!loading && result?.status === "scraped" && (
        <div className="mt-8 rounded-lg bg-gray-900 border border-gray-800 p-6">
          <h2 className="font-semibold text-lg mb-1">
            {result.articleTitle || "Article extracted"}
          </h2>
          <p className="text-sm text-green-400">
            Successfully scraped and stored. Ready for AI analysis (Phase 2).
          </p>
        </div>
      )}

      {!loading && result?.status === "failed" && (
        <div className="mt-8 rounded-lg bg-gray-900 border border-gray-800 p-6">
          <h2 className="font-semibold text-lg mb-1 text-red-400">Extraction failed</h2>
          <p className="text-sm text-gray-400">{result.error || "Could not extract article content."}</p>
        </div>
      )}
    </main>
  );
}
