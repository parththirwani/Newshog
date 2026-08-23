import { describe, it, expect, vi, afterEach } from "vitest";
import { scrapeArticle } from "../scrape";

function mockFetch(html: string, status = 200) {
  const implementation = (_input: string | URL | Request, _init?: RequestInit) => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      text: () => Promise.resolve(html),
    } as Response);
  };
  vi.stubGlobal("fetch", implementation);
}

function articleHtml(
  body: string,
  opts?: { title?: string; metaDesc?: string; ogDesc?: string },
) {
  const titleTag = opts?.title ? `<title>${opts.title}</title>` : "";
  const metaDesc = opts?.metaDesc
    ? `<meta name="description" content="${opts.metaDesc}">`
    : "";
  const ogDesc = opts?.ogDesc
    ? `<meta property="og:description" content="${opts.ogDesc}">`
    : "";
  return `<!DOCTYPE html><html><head>${titleTag}${metaDesc}${ogDesc}</head><body>${body}</body></html>`;
}

function longArticleText(minChars = 250) {
  const sentence = "The company announced a major product update today. ";
  const repeat = Math.ceil(minChars / sentence.length);
  return sentence.repeat(repeat);
}

describe("scrapeArticle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns full mode when Readability extracts >200 chars", async () => {
    mockFetch(
      articleHtml(`<article>${longArticleText(300)}</article>`, {
        title: "Test Article",
      }),
    );

    const result = await scrapeArticle("https://example.com/article");

    expect(result.mode).toBe("full");
    expect(result.text.length).toBeGreaterThan(200);
    expect(result.title).toBe("Test Article");
  });

  it("returns limited mode with meta description when Readability fails", async () => {
    mockFetch(
      articleHtml("<p>Short</p>", {
        title: "Short Post",
        metaDesc: "This is a meta description.",
      }),
    );

    const result = await scrapeArticle("https://example.com/short");

    expect(result.mode).toBe("limited");
    expect(result.text).toBe("This is a meta description.");
    expect(result.title).toBe("Short Post");
  });

  it("falls back to og:description when no meta description", async () => {
    mockFetch(
      articleHtml("<p>Minimal content</p>", {
        ogDesc: "OG description here.",
      }),
    );

    const result = await scrapeArticle("https://example.com/og");

    expect(result.mode).toBe("limited");
    expect(result.text).toBe("OG description here.");
  });

  it("falls back to body text preview when no meta tags", async () => {
    const bodyText = "Short body content that is under two hundred characters total.";
    mockFetch(`<html><head></head><body>${bodyText}</body></html>`);

    const result = await scrapeArticle("https://example.com/body");

    expect(result.mode).toBe("limited");
    expect(result.text).toContain("Short body content");
  });

  it("extracts title from article when available", async () => {
    mockFetch(
      articleHtml(`<article>${longArticleText(300)}</article>`, {
        title: "Fallback Title",
      }),
    );

    const result = await scrapeArticle("https://example.com");
    expect(result.title).toBe("Fallback Title");
  });

  it("returns null title when no title anywhere", async () => {
    mockFetch(`<html><head></head><body>${longArticleText(300)}</body></html>`);

    const result = await scrapeArticle("https://example.com");
    expect(result.title).toBeNull();
  });

  it("throws on non-OK HTTP response", async () => {
    mockFetch("<p>Not found</p>", 404);

    await expect(scrapeArticle("https://example.com/404")).rejects.toThrow(
      "Fetch failed: 404",
    );
  });

  it("sends correct user-agent header", async () => {
    mockFetch(articleHtml("<p>content</p>"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await scrapeArticle("https://example.com");

    // scrapeArticle now sends a browser-like UA (bot-challenge evasion), not
    // a self-identifying bot string — assert a real browser agent is sent.
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.stringMatching(/Mozilla\/5\.0/),
        }),
      }),
    );
  });

  it("trims whitespace from extracted text", async () => {
    mockFetch(
      articleHtml(`<article>  ${longArticleText(300)}  </article>`),
    );

    const result = await scrapeArticle("https://example.com");
    expect(result.text).not.toMatch(/^\s|\s$/);
  });
});
