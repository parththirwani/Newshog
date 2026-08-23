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

describe("analyzeArticle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("drops non-array garbage angles", async () => {
    mockCreate.mockResolvedValue(
      makeLlmResponse({ score: 60, why_now: "ok", angles: 42 }),
    );

    const result = await analyzeArticle("text", null);
    expect(result.angles).toEqual([]);
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

  it("throws when no tool call in response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { tool_calls: [] } }],
    });

    await expect(analyzeArticle("text", null)).rejects.toThrow(
      "No tool call in response",
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
