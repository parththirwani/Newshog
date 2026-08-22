// ponytail: simple fetch + Readability, no retry, no JS rendering.
// Upgrade: headless browser if landing pages return empty text.

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const MAX_CHARS = 10000;

export async function crawlCompanySite(urls: string[]): Promise<string> {
  const texts: string[] = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "NewshogBot/1.0 (company profile crawl)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      const dom = new JSDOM(html, { url });
      const doc = new dom.window.HTMLDocument();
      const article = new Readability(doc).parse();
      if (article?.textContent) {
        texts.push(article.textContent.slice(0, MAX_CHARS));
      }
    } catch {
      // skip failed URLs silently
    }
  }

  return texts.join("\n\n").slice(0, MAX_CHARS);
}
