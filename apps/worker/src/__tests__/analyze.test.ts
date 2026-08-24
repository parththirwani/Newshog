import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal(
  "Bun",
  {
    file: (_path: string | URL) => ({
      text: () => Promise.resolve("You are a PR analyst."),
    }),
  },
);

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

function makeLlmResponse(args: object) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "submit_analysis", arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

function makeCritiqueResponse(args: object) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "submit_critique", arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

function makeContentResponse(content: string) {
  // model answered in plain content instead of a tool call — the fallback path
  return { choices: [{ message: { content } }] };
}

const FIRST_PASS = {
  score: 75,
  why_now: "Relevant because of X",
  velocity: "breaking",
  velocity_reasoning: "Launch went viral in hours",
  novelty_score: 90,
  event_timing: "ongoing",
  angles: [
    {
      title: "Angle 1",
      why_now: "Timely",
      why_journalists_care: "New info",
      headline: "Breaking: thing",
    },
  ],
};

describe("analyzeArticle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries once, then throws a user-facing error when the first pass is malformed (never persists a scoreless row)", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse({ ...FIRST_PASS, score: undefined, why_now: "", angles: [] }))
      .mockResolvedValueOnce(makeLlmResponse({ ...FIRST_PASS, score: undefined, why_now: "", angles: [] }));

    await expect(analyzeArticle("text", null)).rejects.toThrow(/couldn't analyze/i);
    expect(mockCreate).toHaveBeenCalledTimes(2); // first + one retry
  });

  it("accepts the legacy why_this_matters alias as why_now instead of rejecting the response", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse({ ...FIRST_PASS, why_now: undefined, why_this_matters: "Legacy rationale" }))
      .mockResolvedValueOnce(makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: ["ok"] }));

    const result = await analyzeArticle("text", null);
    expect(result.why_now).toBe("Legacy rationale");
    expect(mockCreate).toHaveBeenCalledTimes(2); // no retry needed
  });

  it("succeeds on the retry when the first pass is malformed but the retry is well-formed", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse({ ...FIRST_PASS, score: undefined, why_now: "", angles: [] }))
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: ["ok"] }));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
    expect(mockCreate).toHaveBeenCalledTimes(3); // malformed + retry + critique
  });

  it("throws when the first pass has no angles array (retry also malformed)", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse({ ...FIRST_PASS, angles: null }))
      .mockResolvedValueOnce(makeLlmResponse({ ...FIRST_PASS, angles: null }));

    await expect(analyzeArticle("text", null)).rejects.toThrow(/couldn't analyze/i);
  });

  it("succeeds on retry when an angle is missing its headline", async () => {
    const noHeadline = {
      ...FIRST_PASS,
      angles: [{ title: "Angle 1", why_now: "Timely", why_journalists_care: "New info" }],
    };
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(noHeadline))
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: ["ok"] }));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
    expect(result.angles[0].headline).toBe("Breaking: thing");
    expect(mockCreate).toHaveBeenCalledTimes(3); // malformed + retry + critique
  });

  it("throws when every pass delivers an angle with a missing headline", async () => {
    const noHeadline = {
      ...FIRST_PASS,
      angles: [{ title: "H", why: "Timely", why_journalists_care: "New info" }],
    };
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(noHeadline))
      .mockResolvedValueOnce(makeLlmResponse(noHeadline));

    await expect(analyzeArticle("text", null)).rejects.toThrow(/couldn't analyze/i);
  });

  it("recovers when the model answers in plain content instead of a tool call", async () => {
    mockCreate
      .mockResolvedValueOnce(makeContentResponse(JSON.stringify(FIRST_PASS)))
      .mockResolvedValueOnce(makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: ["ok"] }));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
    expect(result.angles[0].headline).toBe("Breaking: thing");
    expect(mockCreate).toHaveBeenCalledTimes(2); // first pass in content + critique
  });

  it("recovers from fenced JSON in the content answer", async () => {
    mockCreate
      .mockResolvedValueOnce(makeContentResponse("```json\n" + JSON.stringify(FIRST_PASS) + "\n```"))
      .mockResolvedValueOnce(
        makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: ["ok"] }),
      );

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("returns parsed analysis from LLM", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({
        score: 75,
        why_now: "Relevant because of X",
        velocity: "breaking",
        velocity_reasoning: "Launch went viral in hours",
        angles: [
          {
            title: "Angle 1",
            why_now: "Timely",
            why_journalists_care: "New info",
            headline: "Breaking: thing",
          },
        ],
      }),
    );

    const result = await analyzeArticle("Some article text", "Test Title");

    expect(result.score).toBe(75);
    expect(result.why_now).toBe("Relevant because of X");
    expect(result.velocity).toBe("breaking");
    expect(result.velocity_reasoning).toBe("Launch went viral in hours");
    expect(result.angles).toHaveLength(1);
    expect(result.angles[0].title).toBe("Angle 1");
  });

  it("sends title when provided", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 50, why_now: "ok", angles: [] }),
    );

    await analyzeArticle("body", "My Title");

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[1].content).toContain("Article title: My Title");
  });

  it("omits title line when title is null", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 50, why_now: "ok", angles: [] }),
    );

    await analyzeArticle("body", null);

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[1].content).not.toContain("Article title:");
  });

  it("clamps score below 0", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: -10, why_now: "neg", angles: [] }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(0);
  });

  it("clamps score above 100", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 150, why_now: "high", angles: [] }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(100);
  });

  it("truncates angles to MAX_ANGLES (3)", async () => {
    const angles = Array.from({ length: 5 }, (_, i) => ({
      title: `Angle ${i}`,
      why_now: "t",
      why_journalists_care: "c",
      headline: "h",
    }));

    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 60, why_now: "ok", angles }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.angles).toHaveLength(3);
  });

  it("wraps a single angle object into an array", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({
        score: 60,
        why_now: "ok",
        angles: { title: "Only angle", why_now: "t", why_journalists_care: "c", headline: "h" },
      }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.angles).toHaveLength(1);
    expect(result.angles[0].title).toBe("Only angle");
  });

  it("rejects garbage (non-object, non-array) angles as malformed", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 60, why_now: "ok", angles: 42 }),
    );

    await expect(analyzeArticle("text", null)).rejects.toThrow(/couldn't analyze/i);
  });

  it("keeps the first-pass angles when a critique returns headline-less angles", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(
        makeCritiqueResponse({
          approved: false,
          corrected_fields: {
            angles: [{ title: "Changed angle", why_now: "x", why_journalists_care: "y" }],
          },
          critique_notes: ["tighten angle"],
        }),
      );

    const result = await analyzeArticle("text", null);
    // the headline-less corrected angle must not wipe the valid first-pass list
    expect(result.angles).toHaveLength(1);
    expect(result.angles[0].title).toBe("Angle 1");
    expect(result.angles[0].headline).toBe("Breaking: thing");
  });

  it("applies critique angles when every corrected angle has a headline", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(
        makeCritiqueResponse({
          approved: false,
          corrected_fields: {
            angles: [
              { title: "Refined angle", why_now: "x", why_journalists_care: "y", headline: "Refined headline" },
            ],
          },
          critique_notes: ["tighten angle"],
        }),
      );

    const result = await analyzeArticle("text", null);
    expect(result.angles).toHaveLength(1);
    expect(result.angles[0].title).toBe("Refined angle");
    expect(result.angles[0].headline).toBe("Refined headline");
  });

  it("truncates input text to LLM_MAX_INPUT_CHARS", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 40, why_now: "ok", angles: [] }),
    );

    const longText = "a".repeat(10_000);
    await analyzeArticle(longText, null);

    const messages = mockCreate.mock.calls[0][0].messages;
    const sentText = messages[1].content as string;
    expect(sentText.length).toBeLessThan(10_000);
    expect(sentText).toContain("a".repeat(8000));
  });

  it("retries then throws a user-facing error when no tool call is returned", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { tool_calls: [] } }],
    });

    await expect(analyzeArticle("text", null)).rejects.toThrow(
      "We couldn't analyze this story after retrying",
    );
  });

  it("rounds score to nearest integer", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 72.6, why_now: "ok", angles: [] }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(73);
  });

  it("passes through a valid velocity", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({
        score: 65,
        why_now: "ok",
        velocity: "evergreen",
        velocity_reasoning: "Policy takes effect next year",
        angles: [],
      }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.velocity).toBe("evergreen");
  });

  it("defaults missing velocity to standard", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 65, why_now: "ok", angles: [] }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.velocity).toBe("standard");
  });

  it("defaults unknown velocity to standard", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({
        score: 65,
        why_now: "ok",
        velocity: "unstoppable",
        angles: [],
      }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.velocity).toBe("standard");
  });
});

describe("analyzeArticle — critique pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls a second, separate LLM and logs stage analysis_critique", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: ["ok"] }));

    await analyzeArticle("body", "My Title", undefined, "abc-123");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const critiqueCall = mockCreate.mock.calls[1][0];
    expect(critiqueCall.tool_choice).toEqual({ type: "function", function: { name: "submit_critique" } });
    const critiqueContent = critiqueCall.messages[1].content as string;
    expect(critiqueContent).toContain("First-pass analysis:");
  });

  it("returns first pass unchanged when approved", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({ approved: true, corrected_fields: null, critique_notes: [] }));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
    expect(result.angles).toHaveLength(1);
  });

  it("shallow-merges only corrected fields into the first pass", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({
        approved: false,
        corrected_fields: { why_now: "Now corrected language", event_timing: "past" },
        critique_notes: ["stale phrasing fixed"],
      }));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75); // untouched
    expect(result.why_now).toBe("Now corrected language");
    expect(result.event_timing).toBe("past");
    expect(result.angles).toHaveLength(1); // untouched
  });

  it("does not override approved fields left out of corrected_fields", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({
        approved: false,
        corrected_fields: { velocity: "evergreen" },
        critique_notes: ["velocity contradicted staleness"],
      }));

    const result = await analyzeArticle("text", null);
    expect(result.velocity).toBe("evergreen");
    expect(result.score).toBe(75);
  });

  it("falls back to first pass and does not throw when critique has no tool call", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce({ choices: [{ message: { tool_calls: [] } }] });

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
  });

  it("falls back to first pass when critique throws", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockRejectedValueOnce(new Error("timeout"));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75);
  });

  it("keeps the first-pass score when the critique corrects it to a malformed value", async () => {
    mockCreate
      .mockResolvedValueOnce(makeLlmResponse(FIRST_PASS))
      .mockResolvedValueOnce(makeCritiqueResponse({
        approved: false,
        corrected_fields: { score: "high", why_now: "Fixed language" },
        critique_notes: ["malformed score should not zero a valid first pass"],
      }));

    const result = await analyzeArticle("text", null);
    expect(result.score).toBe(75); // never zeroed to 0 by normalize
    expect(result.why_now).toBe("Fixed language"); // valid corrections still apply
  });
});
