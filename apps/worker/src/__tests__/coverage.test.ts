import { describe, it, expect } from "vitest";
import { buildCoverageSignal } from "../deep-analyze";
import { applyGrounding } from "../postprocess";
import type { LlmAnalysis } from "@newshog/shared";

describe("buildCoverageSignal", () => {
  const visited = [
    "https://article.com/story",   // submitted article — excluded
    "https://b.com/coverage",      // 2026-08-01 (predates article)
    "https://c.com/report",        // 2026-08-10
  ];
  const dates = {
    "https://article.com/story": "2026-08-20T00:00:00.000Z",
    "https://b.com/coverage": "2026-08-01T00:00:00.000Z",
    "https://c.com/report": "2026-08-10T00:00:00.000Z",
  };

  it("counts only other dated sources and excludes the article url", () => {
    const sig = buildCoverageSignal(visited, dates, "https://article.com/story", "2026-08-20T00:00:00.000Z");
    expect(sig?.externalSourceCount).toBe(2);
    expect(sig?.precedesSubmittedArticle).toBe(true);
    expect(sig?.earliestSourceDate).toBe("2026-08-01T00:00:00.000Z");
    expect(sig?.latestSourceDate).toBe("2026-08-10T00:00:00.000Z");
  });

  it("is false for precedes when no source predates the article", () => {
    const sig = buildCoverageSignal(visited, dates, "https://article.com/story", "2026-07-01T00:00:00.000Z");
    expect(sig?.precedesSubmittedArticle).toBe(false);
  });

  it("returns zero coverage when nothing external is dated", () => {
    const sig = buildCoverageSignal(["https://article.com/story"], {}, "https://article.com/story", "2026-08-20");
    expect(sig).toEqual({ externalSourceCount: 0, precedesSubmittedArticle: false });
  });
});

// The acceptance-criteria fixture pair: identical article, different mocked
// coverage signals.
const ARTICLE: LlmAnalysis = {
  score: 80,
  why_now: "Big launch",
  velocity: "breaking",
  velocity_reasoning: "Launch went viral today",
  angles: [],
  noveltyScore: 95,
  eventTiming: "ongoing",
};

describe("applyGrounding — saturation", () => {
  it("0 external sources + recent date keeps a breaking/strong score", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date().toISOString(),
      coverageSignal: { externalSourceCount: 0, precedesSubmittedArticle: false },
    });
    expect(out.velocity).toBe("breaking");
    expect(out.score).toBe(80);
  });

  it("10+ sources over a week forces the same story down to standard, never breaking", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date().toISOString(),
      coverageSignal: {
        externalSourceCount: 12,
        earliestSourceDate: "2026-08-17T00:00:00.000Z",
        latestSourceDate: "2026-08-23T00:00:00.000Z",
        precedesSubmittedArticle: false,
      },
    });
    expect(out.velocity).not.toBe("breaking");
    expect(out.score).toBeLessThan(80); // saturation deduction applied
  });

  it("heavily covered + old article downgrades to evergreen", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      coverageSignal: { externalSourceCount: 12, precedesSubmittedArticle: false },
    });
    expect(out.velocity).toBe("evergreen");
  });

  it("precedesSubmittedArticle downgrades perceived originality", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date().toISOString(),
      coverageSignal: {
        externalSourceCount: 0,
        precedesSubmittedArticle: true,
        earliestSourceDate: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      },
    });
    expect(out.score).toBeLessThan(ARTICLE.score);
    expect(out.velocity).toBe("evergreen");
  });

  it("quick-score: no coverageSignal means no adjustment (free tier unaffected)", () => {
    const out = applyGrounding(ARTICLE, { sourcePublishedAt: new Date().toISOString() });
    expect(out.score).toBe(80);
    expect(out.velocity).toBe("breaking");
  });
});