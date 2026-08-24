import { describe, it, expect, vi } from "vitest";

// Compulsory schema-guard test. It drives `analyzeArticle` through 10 distinct
// realistic LLM first-pass responses and asserts that EVERY one produces a
// well-formed, persistable analysis (finite 0-100 score, non-empty why_now,
// angles array, valid velocity/event_timing). This is the regression net for
// the "analyses failing with malformed response" bug family — if a prompt or
// schema change lets any normal model output get rejected, this fails.
//
// 10 prompts/themes exercised:
//   1. strong breaking story       2. standard mid-score
//   3. stale story (low score)     4. legacy `why_this_matters` alias (the bug)
//   5. single angle as object      6. zero angles (valid: no viable pitches)
//   7. evergreen, one angle        8. upcoming event, high novelty
//   9. moderate, 2 angles         10. minimal/bare response, defaults apply

// Replace Bun.file BEFORE importing analyze (which calls it at module load).
// Run via `vitest` (the repo's test runner) where vi.stubGlobal works.
vi.stubGlobal("Bun", {
  file: () => ({ text: () => Promise.resolve("You are a PR analyst.") }),
});

vi.mock("openai", () => {
  const mockCreate = vi.fn();
  return {
    default: function MockOpenAI() {
      return { chat: { completions: { create: mockCreate } } };
    },
    __mockCreate: mockCreate,
  };
});

const { __mockCreate: mockCreate } = await import("openai");
const { analyzeArticle } = await import("../analyze");

function llm(args: object, fn = "submit_analysis") {
  return {
    choices: [
      { message: { tool_calls: [{ function: { name: fn, arguments: JSON.stringify(args) } }] } },
    ],
  };
}
const critiqueOk = { approved: true, corrected_fields: null, critique_notes: ["ok"] };

const FIXTURES: Array<{ name: string; first: object; assert: (r: Record<string, unknown>) => void }> = [
  {
    name: "strong breaking story",
    first: {
      score: 90, why_now: "Viral launch dominating the news cycle.",
      velocity: "breaking", velocity_reasoning: "Huge engagement in the last hour.",
      novelty_score: 95, event_timing: "ongoing",
      angles: [{ title: "A", why_now: "now", why_journalists_care: "big", headline: "H: A" }],
    },
    assert: (r) => {
      expect(r.score).toBe(90);
      expect(r.velocity).toBe("breaking");
    },
  },
  {
    name: "standard mid-score story",
    first: {
      score: 55, why_now: "Routine product announcement.",
      velocity: "standard", velocity_reasoning: "Standard news-cycle decay.",
      novelty_score: 40, event_timing: "past",
      angles: [
        { title: "A", why_now: "now", why_journalists_care: "x", headline: "H1" },
        { title: "B", why_now: "now", why_journalists_care: "y", headline: "H2" },
      ],
    },
    assert: (r) => {
      expect(r.score).toBe(55);
      expect((r.angles as unknown[]).length).toBe(2);
    },
  },
  {
    name: "stale story surfaced at low score (resurfacing framing)",
    first: {
      score: 12, why_now: "Old event with no fresh hook; resurfacing only if X happens.",
      velocity: "evergreen", velocity_reasoning: "Old; decays over weeks.",
      novelty_score: 10, event_timing: "past",
      angles: [],
    },
    assert: (r) => {
      expect(r.score).toBe(12); // genuine low score is preserved, not rejected
      expect(r.why_now).toContain("resurfacing");
      expect(r.angles).toEqual([]); // empty angle array is valid
    },
  },
  {
    name: "legacy why_this_matters alias (the bug that failed all analyses)",
    first: {
      score: 78, why_this_matters: "Model still used the legacy field name.",
      velocity: "standard", velocity_reasoning: "Normal cycle.",
      novelty_score: 60, event_timing: "ongoing",
      angles: [{ title: "A", why_now: "now", why_journalists_care: "x", headline: "H" }],
    },
    assert: (r) => {
      expect(r.score).toBe(78);
      expect(r.why_now).toBe("Model still used the legacy field name.");
      expect(mockCreate).toHaveBeenCalledTimes(2); // first pass + critique, NO retry
    },
  },
  {
    name: "single angle returned as an object (not array)",
    first: {
      score: 65, why_now: "Single strong angle makes sense here.",
      velocity: "standard", velocity_reasoning: "Normal cycle.",
      novelty_score: 50, event_timing: "past",
      angles: { title: "Only", why_now: "now", why_journalists_care: "x", headline: "H" },
    },
    assert: (r) => {
      expect(Array.isArray(r.angles)).toBe(true);
      expect((r.angles as unknown[]).length).toBe(1); // object coerced to array
    },
  },
  {
    name: "zero angles + no viable pitches (stale / not newsworthy)",
    first: {
      score: 18, why_now: "Not newsworthy for PR; no clear angle.",
      velocity: "evergreen", velocity_reasoning: "Decays slowly.",
      novelty_score: 20, event_timing: "past",
      angles: [],
    },
    assert: (r) => {
      expect(r.angles).toEqual([]);
      expect(r.score).toBe(18);
    },
  },
  {
    name: "evergreen policy story, one angle",
    first: {
      score: 82, why_now: "Structural policy shift with lasting relevance.",
      velocity: "evergreen", velocity_reasoning: "Slow decay, weeks or longer.",
      novelty_score: 70, event_timing: "upcoming",
      angles: [{ title: "Policy", why_now: "now", why_journalists_care: "x", headline: "H1" }],
    },
    assert: (r) => {
      expect(r.velocity).toBe("evergreen");
      expect(r.event_timing).toBe("upcoming");
    },
  },
  {
    name: "upcoming event, high novelty",
    first: {
      score: 70, why_now: "Unreleased product with high differentiation.",
      velocity: "standard", velocity_reasoning: "Until the launch, then breaking.",
      novelty_score: 88, event_timing: "upcoming",
      angles: [
        { title: "X", why_now: "now", why_journalists_care: "a", headline: "H1" },
        { title: "Y", why_now: "now", why_journalists_care: "b", headline: "H2" },
      ],
    },
    assert: (r) => {
      expect(r.novelty_score).toBe(88);
      expect(r.event_timing).toBe("upcoming");
    },
  },
  {
    name: "moderate story with exactly 2 angles",
    first: {
      score: 45, why_now: "Moderately interesting, some residual relevance.",
      velocity: "standard", velocity_reasoning: "A couple days.",
      novelty_score: 35, event_timing: "ongoing",
      angles: [
        { title: "A", why_now: "now", why_journalists_care: "x", headline: "H1" },
        { title: "B", why_now: "now", why_journalists_care: "y", headline: "H2" },
      ],
    },
    assert: (r) => {
      expect((r.angles as unknown[]).length).toBe(2);
    },
  },
  {
    name: "minimal bare response — defaults applied, still well-formed",
    first: {
      score: 30, why_now: "Bare but present.",
      angles: [],
    },
    assert: (r) => {
      expect(r.score).toBe(30);
      expect(Array.isArray(r.angles)).toBe(true);
      expect(["breaking", "standard", "evergreen"]).toContain(r.velocity); // default applied
      expect(r.event_timing).toBeUndefined(); // optional, omitted
    },
  },
];

describe("analyzeArticle — compulsory 10-prompt well-formedness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    "produces a well-formed result for: %s",
    async (_name, fixture) => {
      // First pass returns the fixture; critique approves unchanged.
      mockCreate
        .mockResolvedValueOnce(llm(fixture.first))
        .mockResolvedValueOnce(llm(critiqueOk, "submit_critique"));

      const result = await analyzeArticle("Article body text here.", "Sample title");
      const r = result as unknown as Record<string, unknown>;

      // Core invariants for EVERY fixture — this is the contract a persistable
      // analysis must satisfy (no scoreless/malformed rows ever).
      expect(typeof r.score).toBe("number");
      expect(r.score as number).toBeGreaterThanOrEqual(0);
      expect(r.score as number).toBeLessThanOrEqual(100);
      expect((r.why_now as string).length).toBeGreaterThan(0);
      expect(Array.isArray(r.angles)).toBe(true);
      expect(["breaking", "standard", "evergreen"]).toContain(r.velocity);

      fixture.assert(r);
    },
  );
});
