import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

interface ScrapeResult {
  title: string | null;
  text: string;
  mode: "full" | "limited";
}

export async function scrapeArticle(url: string): Promise<ScrapeResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; NewshogBot/1.0; +https://newshog.dev)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

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

  const metaDesc =
    doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const ogDesc =
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
  const preview = metaDesc || ogDesc || doc.body?.textContent?.slice(0, 1000) || "";

  return {
    title: doc.querySelector("title")?.textContent || null,
    text: preview.trim(),
    mode: "limited",
  };
}
