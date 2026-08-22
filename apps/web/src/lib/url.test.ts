import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("lowercases the hostname", () => {
    expect(normalizeUrl("https://Example.COM/Path")).toBe("https://example.com/Path");
  });

  it("strips a trailing slash", () => {
    expect(normalizeUrl("https://example.com/story/")).toBe("https://example.com/story");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("drops tracking params but keeps real ones", () => {
    expect(normalizeUrl("https://example.com/story?utm_source=twit&ref=share&page=2&fbclid=x")).toBe(
      "https://example.com/story?page=2",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/story#comments")).toBe("https://example.com/story");
  });

  it("collapses default ports", () => {
    expect(normalizeUrl("https://example.com:443/story")).toBe("https://example.com/story");
  });

  it("turns a tracking-param link into the canonical story link", () => {
    expect(normalizeUrl("https://example.com/Cool-Story/?utm_campaign=launch#top")).toBe(
      "https://example.com/Cool-Story",
    );
  });
});