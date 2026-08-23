import { describe, it, expect } from "vitest";
import { extractPublishDate } from "../Dates";

describe("extractPublishDate", () => {
  it("parses ISO datetime and date-only", () => {
    expect(extractPublishDate("Updated 2026-08-20T14:30:00Z now")?.toISOString()).toBe("2026-08-20T14:30:00.000Z");
    expect(extractPublishDate("Day of 2026-08-20 publication")?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("prefers meta/JSON-LD datePublished", () => {
    const html = `<script type="application/ld+json">{"datePublished":"2025-03-12"}</script>`;
    expect(extractPublishDate(html)?.toISOString()).toBe("2025-03-12T00:00:00.000Z");
    const meta = '<meta property="article:published_time" content="2025-01-02T10:00:00Z">';
    expect(extractPublishDate(meta)?.toISOString()).toBe("2025-01-02T10:00:00.000Z");
  });

  it("parses month-name dates", () => {
    expect(extractPublishDate("Published May 12, 2026 by X")?.toISOString()).toBe("2026-05-12T00:00:00.000Z");
    expect(extractPublishDate("Updated 12 May 2026.")?.toISOString()).toBe("2026-05-12T00:00:00.000Z");
    expect(extractPublishDate("Sep 1 2026 announcement")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rejects nonsense or far-future years", () => {
    expect(extractPublishDate("no date here at all")).toBeNull();
    expect(extractPublishDate("year 1987")).toBeNull();
    expect(extractPublishDate("3012-01-01")).toBeNull();
  });
});