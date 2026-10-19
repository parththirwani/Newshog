import { JSDOM } from "jsdom";
import type { SearchResult } from "./types";

export const DDG_HTML_URL = process.env.DDG_SEARCH_URL ?? "https://html.duckduckgo.com/html/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface SearchProvider {
  search(query: string, opts?: { signal?: AbortSignal }): Promise<SearchResult[]>;
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function canonicalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname.endsWith("bing.com") && url.pathname.startsWith("/ck/")) {
      const resolved = resolveBingUrl(value);
      if (resolved !== value) return canonicalizeUrl(resolved);
      return null;
    }
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function topicTokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !["the", "and", "for", "with", "from"].includes(t)))];
}

export function rankSearchResults(query: string, entries: SearchResult[]): SearchResult[] {
  const tokens = topicTokens(query);
  return entries
    .map((entry, index) => {
      const haystack = `${entry.title} ${entry.snippet} ${entry.url}`.toLowerCase();
      const reasons: string[] = [];
      let score = tokens.filter((token) => haystack.includes(token)).length * 10;
      if (/dictionary|glossary|definition|calendar|timeanddate/.test(haystack)) {
        score -= 100;
        reasons.push("topic collision");
      }
      if (/fund|raise|series|security|startup|report|coverage/.test(haystack)) score += 20;
      if (score <= 0 && reasons.length === 0) reasons.push("low topical relevance");
      const failureReason = reasons.includes("topic collision") ? reasons.join(", ") : undefined;
      return { entry: { ...entry, failureReason }, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry }) => entry);
}

const BING_URL = "https://www.bing.com/search";


export function normalizeSearchResults(
  entries: Array<{ title?: string; url?: string; description?: string; snippet?: string }>,
  maximum = 10,
): SearchResult[] {
  const seen = new Set<string>();
  return entries
    .map((entry) => {
      const url = canonicalizeUrl(String(entry?.url ?? ""));
      return {
        title: String(entry?.title ?? "").trim(),
        url: url ?? "",
        snippet: String(entry?.snippet ?? entry?.description ?? "").trim(),
      };
    })
    .filter((entry) => entry.url && !seen.has(entry.url) && seen.add(entry.url))
    .slice(0, maximum);
}

/** Parse DuckDuckGo HTML results into normalized SearchResult[]. */
export function parseDdgHtml(html: string): SearchResult[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();

  const anchors = Array.from(doc.querySelectorAll("a.result__a"));
  const pool = anchors.length ? anchors : Array.from(doc.querySelectorAll("a[href]"));

  for (const anchor of pool) {
    const urlValue = anchor.getAttribute("href") ?? "";
    if (!urlValue || seen.has(urlValue) || !validUrl(urlValue)) continue;
    seen.add(urlValue);

    let snippet = "";
    const parent = anchor.closest(".result");
    const snippetNode = parent?.querySelector(".result__snippet");
    if (snippetNode) snippet = snippetNode.textContent.trim();

    results.push({
      title: anchor.textContent.trim() || anchor.getAttribute("title") || urlValue,
      url: urlValue,
      snippet,
    });
  }

  return normalizeSearchResults(results, 10);
}

async function ddgHtml(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL(DDG_HTML_URL);
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}.`);
  return parseDdgHtml(await response.text());
}

/**
 * Resolve a search-engine redirect (Bing `ck/a`) to its real destination.
 * Bing hides the target in the base64 `u` query param prefixed with "a1".
 */
export function resolveBingUrl(href: string): string {
  if (!href.includes("bing.com/ck/")) return href;
  try {
    const parsed = new URL(href);
    const u = parsed.searchParams.get("u");
    if (u) {
      const b64 = u.startsWith("a1") ? u.slice(2) : u;
      const decoded = atob(b64);
      const real = new URL(decoded);
      if (real.protocol === "http:" || real.protocol === "https:") return decoded;
    }
  } catch {
    // fall through to the original href
  }
  return href;
}

export function parseBingRss(xml: string): SearchResult[] {
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  const entries = Array.from(dom.window.document.querySelectorAll("item")).map((item) => ({
    title: item.querySelector("title")?.textContent ?? "",
    url: item.querySelector("link")?.textContent ?? "",
    snippet: item.querySelector("description")?.textContent ?? "",
  }));
  return normalizeSearchResults(entries, 10);
}


export function parseBingHtml(html: string): SearchResult[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();

  for (const li of Array.from(doc.querySelectorAll("li.b_algo"))) {
    const anchor = li.querySelector("h2 a");
    if (!anchor) continue;
    const raw = anchor.getAttribute("href") ?? "";
    const url = resolveBingUrl(raw);
    if (!url || seen.has(url) || !validUrl(url)) continue;
    seen.add(url);

    let snippet = "";
    const lineClamp = li.querySelector("p.b_lineclamp");
    const caption = li.querySelector(".b_caption");
    const parsed = caption ?? lineClamp;
    if (parsed) snippet = parsed.textContent.trim();

    results.push({ title: anchor.textContent.trim(), url, snippet });
  }
  return normalizeSearchResults(results, 10);
}

async function bingHtml(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL(BING_URL);
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Bing returned HTTP ${response.status}.`);
  const body = await response.text();
  const htmlResults = parseBingHtml(body);
  if (htmlResults.length > 0) return htmlResults;
  const rssUrl = new URL("https://www.bing.com/search");
  rssUrl.searchParams.set("q", query);
  rssUrl.searchParams.set("format", "rss");
  const rssResponse = await fetch(rssUrl, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" }, redirect: "follow", signal: signal ?? AbortSignal.timeout(20_000) });
  if (!rssResponse.ok) throw new Error(`Bing RSS returned HTTP ${rssResponse.status}.`);
  const rssResults = parseBingRss(await rssResponse.text());
  if (rssResults.length === 0) throw new Error("Bing returned no organic results in HTML or RSS.");
  return rssResults;
}

export function createBingProvider(): SearchProvider {
  return { search: (query, opts) => bingHtml(query, opts?.signal) };
}

/**
 * Default native provider: DDG first, Bing on failure or empty results. Keeps
 * the plan's DDG-first default while staying resilient when DDG blocks us.
 */
export function createFailoverProvider(primary: SearchProvider = createDdgProvider(), fallback: SearchProvider = createBingProvider()): SearchProvider {
  return {
    async search(query, opts) {
      try {
        const results = await primary.search(query, opts);
        if (results.length > 0) return results;
      } catch {
        // fall through to fallback
      }
      return fallback.search(query, opts);
    },
  };
}

export function createDdgProvider(): SearchProvider {
  return { search: (query, opts) => ddgHtml(query, opts?.signal) };
}

let provider: SearchProvider | undefined;
/** Default native provider. Kept as an injectable seam so tests can stub search. */
export function getSearchProvider(): SearchProvider {
  if (!provider) provider = createFailoverProvider();
  return provider;
}

export function setSearchProvider(next: SearchProvider): void {
  provider = next;
}