// SSRF-safe fetch + Readability (security.md A.2): private-IP rejection,
// per-hop redirect re-validation, IP pinning on Node, 10s timeout, 5MB cap.
// Upgrade: headless browser if landing pages return empty text.

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { safeFetchText } from "@newshog/shared/safe-fetch";

const MAX_CHARS = 10000;

export async function crawlCompanySite(urls: string[]): Promise<string> {
  const texts: string[] = [];

  for (const url of urls) {
    try {
      const fetched = await safeFetchText(url);
      if (!fetched.ok) continue;

      const dom = new JSDOM(fetched.body, { url: fetched.finalUrl });
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
