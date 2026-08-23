import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export const MAX_MARKDOWN_LENGTH = 25_000;

export interface ScrapeResult {
  title: string | null;
  text: string;
  mode: "full" | "limited";
}

/** Extract `document.markdown` from a Scrybe-style payload, hard-truncated. */
export function extractMarkdown(payload: { document?: { markdown?: string } }): string {
  const markdown = payload?.document?.markdown;
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("Scrybe returned no readable markdown.");
  }
  return markdown.slice(0, MAX_MARKDOWN_LENGTH);
}

async function fetchMirror(url: string): Promise<{ text: string; title: string } | null> {
  const apiKey = process.env.JINA_API_KEY;
  const headers: Record<string, string> = apiKey
    ? { Accept: "text/plain", Authorization: `Bearer ${apiKey}`, "User-Agent": "Mozilla/5.0" }
    : { Accept: "text/plain", "User-Agent": "Mozilla/5.0" };
  const candidates = [
    `https://r.jina.ai/${url}`,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
  ];
  for (const mirror of candidates) {
    try {
      const m = await fetch(mirror, {
        headers,
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      if (!m.ok) continue;
      const text = (await m.text()).trim();
      if (text.length > 200) {
        const title = text.split("\n").find((line) => /^Title: /.test(line))?.replace(/^Title: /, "") ?? "";
        return { text, title };
      }
    } catch {
      // try next mirror
    }
  }
  return null;
}

function scrapeHtml(html: string, url: string): ScrapeResult {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const reader = new Readability(doc);
  const article = reader.parse();

  if (article?.textContent && article.textContent.trim().length > 200) {
    return {
      title: article.title || doc.querySelector("title")?.textContent || null,
      text: article.textContent.trim(),
      mode: "full",
    };
  }

  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
  const preview = metaDesc || ogDesc || doc.body?.textContent?.slice(0, 1000) || "";

  return {
    title: doc.querySelector("title")?.textContent || null,
    text: preview.trim(),
    mode: "limited",
  };
}

async function scrapeViaMirror(url: string, fallback: { status: number; statusText: string }): Promise<ScrapeResult> {
  const mirrored = await fetchMirror(url);
  if (mirrored) {
    return { title: mirrored.title, text: mirrored.text, mode: "full" };
  }
  throw new Error(`Fetch failed: ${fallback.status} ${fallback.statusText}`);
}

export async function scrapeArticle(url: string): Promise<ScrapeResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!res.ok) {
    // Publisher gate (bot challenge / paywall) — try a rendered mirror before
    // giving up. The mirror returns plain text, so we can't use Readability.
    try {
      return await scrapeViaMirror(url, res);
    } catch {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
  }

  return scrapeHtml(await res.text(), url);
}

/**
 * A scrape that yields 25000-char markdown for the LLM. Falls back to the search
 * snippet on any failure (caller decides).
 */
export async function scrapeMarkdown(url: string): Promise<string> {
  const scraped = await scrapeArticle(url);
  if (!scraped.text) throw new Error("No content extracted.");
  return scraped.text.slice(0, MAX_MARKDOWN_LENGTH);
}