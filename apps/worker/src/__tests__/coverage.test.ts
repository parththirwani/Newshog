import { describe, it, expect } from "vitest";
import {
  buildCoverageSignal,
  buildResurfacingQuery,
  parseResurfacingConfirmation,
  shouldRunResurfacing,
} from "../deep-analyze";
import { applyGrounding } from "../postprocess";
import type { LlmAnalysis, RecentRelatedCoverage } from "@newshog/shared";

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
  novelty_score: 95,
  event_timing: "ongoing",
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

describe("applyGrounding — age decay (agePenalty)", () => {
  // Free tier included: the age penalty applies to every call regardless of
  // coverageSignal — deliberately changing the old "free tier unaffected" note.
  it("120-day-old article is penalized and can never be breaking", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date(Date.now() - 120 * 86_400_000).toISOString(),
    });
    expect(out.score).toBe(80 - 25); // 120d is in the 91–365 old bucket
    expect(out.velocity).toBe("evergreen");
  });

  // This bucket exists specifically to distinguish "old" from "ancient": a
  // 91-day-old story might have a legit resurfacing hook (modest penalty),
  // while a years-old one (the Whetlab reference case) needs a real floor.
  // If someone collapses the buckets in a refactor, that intent is the point.
  it("ancient article gets a steeper penalty than an old one", () => {
    const ancient = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date(Date.now() - 4000 * 86_400_000).toISOString(), // >365d → 40
    });
    const old = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(), // 91–365d → 25
    });
    expect(ancient.score).toBe(80 - 40);
    expect(ancient.score).toBeLessThan(old.score);
    expect(ancient.velocity).toBe("evergreen");
  });

  it("recent article is unchanged (age penalty is 0)", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    expect(out.score).toBe(80);
    expect(out.velocity).toBe("breaking");
  });

  // Guard against the MOCK_PUBLISH fallback: a missing date must NOT be treated
  // as ~235 days old and penalized. Missing = unknown, so unchanged.
  it("missing sourcePublishedAt is unchanged (no mock-fallback penalty)", () => {
    const out = applyGrounding(ARTICLE, { sourcePublishedAt: null });
    expect(out.score).toBe(80);
    expect(out.velocity).toBe("breaking");
  });

  it("stacks with the saturation penalty on deep-research calls", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: new Date(Date.now() - 120 * 86_400_000).toISOString(),
      coverageSignal: { externalSourceCount: 12, precedesSubmittedArticle: false },
    });
    expect(out.score).toBe(80 - 25 - 10); // age(120d=25) + saturation(12 sources=10)
    expect(out.velocity).toBe("evergreen");
  });
});

describe("applyGrounding — resurfacing override", () => {
  const recent = (daysAgo: number, url = "https://e.com/new"): RecentRelatedCoverage[] => [
    { url, date: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), snippet: "new development" },
  ];
  const ancient = new Date(Date.now() - 4000 * 86_400_000).toISOString();

  it("confirmed+evidenced resurfacing computes penalty from the evidence date, not original age, and caps velocity at standard", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: ancient, // 4000-day-old story
      coverageSignal: {
        externalSourceCount: 0,
        precedesSubmittedArticle: false,
        recentRelatedCoverage: recent(20),
        resurfacing: { confirmed: true, evidenceUrl: "https://e.com/new", evidenceDate: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      },
    });
    // effective age = 20d → agePenalty(20) = 5, NOT the full ancient 40.
    expect(out.score).toBe(80 - 5);
    expect(out.velocity).toBe("standard"); // capped, never "breaking" even though base was breaking
  });

  it("recent coverage present but LLM confirms false → full agePenalty and velocity clamp unchanged", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: ancient,
      coverageSignal: {
        externalSourceCount: 0,
        precedesSubmittedArticle: false,
        recentRelatedCoverage: recent(5, "https://e.com/listicle"),
        resurfacing: { confirmed: false, evidenceUrl: null },
      },
    });
    expect(out.score).toBe(80 - 40); // full ancient penalty
    expect(out.velocity).toBe("evergreen");
  });

  it("confirmed=true but fabricated evidence_url fails closed → full penalty (never trusts a URL outside recentRelatedCoverage)", () => {
    const out = applyGrounding(ARTICLE, {
      sourcePublishedAt: ancient,
      coverageSignal: {
        externalSourceCount: 0,
        precedesSubmittedArticle: false,
        recentRelatedCoverage: recent(5, "https://e.com/real"),
        resurfacing: { confirmed: true, evidenceUrl: "https://fabricated.com" }, // not in the list
      },
    });
    expect(out.score).toBe(80 - 40);
    expect(out.velocity).toBe("evergreen");
  });
});

describe("resurfacing gating & confirmation parsing", () => {
  const candidates: RecentRelatedCoverage[] = [
    { url: "https://e.com/new", date: "2026-08-01T00:00:00.000Z", snippet: "follow-up" },
  ];

  it("shouldRunResurfacing only fires for articles older than STALE_DAYS", () => {
    const now = new Date().toISOString();
    expect(shouldRunResurfacing(now)).toBe(false); // recent — no recency query
    expect(shouldRunResurfacing(null)).toBe(false);
    expect(shouldRunResurfacing(new Date(Date.now() - 4000 * 86_400_000).toISOString())).toBe(true);
  });

  it("buildResurfacingQuery biases toward new coverage with the current year", () => {
    const q = buildResurfacingQuery("Whetlab acquired by Twitter", "body");
    expect(q).toContain("latest update");
    expect(q).toContain(String(new Date().getFullYear()));
  });

  it("confirmed=true with a valid evidence_url is honored", () => {
    expect(parseResurfacingConfirmation(
      { resurfacing_confirmed: true, evidence_url: "https://e.com/new", resurfacing_reason: "a sequel" },
      candidates,
    )).toEqual({ confirmed: true, evidenceUrl: "https://e.com/new", evidenceDate: "2026-08-01T00:00:00.000Z" });
  });

  it("confirmed=true but fabricated/missing evidence_url fails closed to false", () => {
    expect(parseResurfacingConfirmation({ resurfacing_confirmed: true, evidence_url: "https://fake.com", resurfacing_reason: "x" }, candidates))
      .toEqual({ confirmed: false, evidenceUrl: null });
    expect(parseResurfacingConfirmation({ resurfacing_confirmed: true, evidence_url: null, resurfacing_reason: "x" }, candidates))
      .toEqual({ confirmed: false, evidenceUrl: null });
  });

  it("confirmed=false is passed through as false, and malformed/non-object raw responses fail closed", () => {
    expect(parseResurfacingConfirmation({ resurfacing_confirmed: false, evidence_url: null }, candidates))
      .toEqual({ confirmed: false, evidenceUrl: null });
    expect(parseResurfacingConfirmation(null, candidates)).toEqual({ confirmed: false, evidenceUrl: null });
    expect(parseResurfacingConfirmation("garbage", candidates)).toEqual({ confirmed: false, evidenceUrl: null });
  });
});
