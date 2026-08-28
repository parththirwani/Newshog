import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => {
  return {
    default: function MockOpenAI() {
      return { chat: { completions: { create: mockCreate } } };
    },
  };
});

vi.mock("@newshog/db", () => ({ recordLlmCall: vi.fn() }));

const { summarizeIndividualProfile } = await import("./summarize");
const { buildProfileContext } = await import("@newshog/shared");

function toolResponse(overrides: Record<string, unknown>) {
  return {
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(overrides) } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 10 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("summarizeIndividualProfile — sparse input", () => {
  it("short-circuits a URL-only bio (no LLM call, insufficientData true)", async () => {
    const summary = await summarizeIndividualProfile(
      "LinkedIn: https://linkedin.com/in/parth-thirwani-887b26217",
    );

    expect(mockCreate).not.toHaveBeenCalled();
    expect(summary.insufficientData).toBe(true);
    expect(summary.topics).toEqual([]);
    expect(summary.tone).toBeNull();
    expect(summary.credentials).toEqual([]);
    expect(summary.recurringThemes).toEqual([]);
    expect(summary.sourceQuality).toBe("verified");
    // Downstream must not render the empty summary as real expertise.
    expect(buildProfileContext({ type: "individual", individual: { expertiseSummary: summary } }))
      .toBe("No verified expertise data available.");
  });

  it("short-circuits the 'No bio provided.' fallback", async () => {
    const summary = await summarizeIndividualProfile("No bio provided.");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(summary.insufficientData).toBe(true);
  });

  it("short-circuits when X posts are the only input but empty", async () => {
    const summary = await summarizeIndividualProfile("LinkedIn: https://linkedin.com/in/abc", []);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(summary.insufficientData).toBe(true);
  });

  it("does NOT short-circuit a real written bio even with no external sources", async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        topics: ["AI coding assistants"],
        tone: "technical",
        credentials: ["Software developer"],
        recurring_themes: ["B2B tooling"],
        recurring_themes_confidence: "single_source",
        insufficient_data: false,
      }),
    );

    const summary = await summarizeIndividualProfile(
      "I build Codemate, an AI coding assistant for teams.",
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(summary.insufficientData).toBe(false);
    expect(summary.topics).toEqual(["AI coding assistants"]);
  });
});

describe("summarizeIndividualProfile — LLM output mapping", () => {
  it("keeps insufficient_data true when the model reports it despite populated fields", async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        topics: ["Data analysis"],
        tone: "Data Analyst",
        credentials: ["Tableau Certified"],
        recurring_themes: ["dashboards"],
        recurring_themes_confidence: "single_source",
        insufficient_data: true,
      }),
    );

    const summary = await summarizeIndividualProfile(
      "LinkedIn: https://linkedin.com/in/abc\n\nI analyze data sometimes.",
    );

    expect(summary.insufficientData).toBe(true);
    // Blocked downstream in favor of the honest signal.
    expect(buildProfileContext({ type: "individual", individual: { expertiseSummary: summary } }))
      .toBe("No verified expertise data available.");
  });

  it("coerces missing insufficient_data with all-empty fields to insufficientData true", async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        topics: [],
        tone: null,
        credentials: [],
        recurring_themes: [],
        recurring_themes_confidence: "null",
      }),
    );

    const summary = await summarizeIndividualProfile("LinkedIn: https://linkedin.com/in/abc");
    expect(summary.insufficientData).toBe(true);
  });

  it("maps a real result with nullable tone and confidence", async () => {
    mockCreate.mockResolvedValue(
      toolResponse({
        topics: ["LLM agents", "AI coding assistants"],
        tone: "practitioner, skeptical of hype",
        credentials: ["Founded Codemate", "Ex-Postman engineer"],
        recurring_themes: ["developer productivity"],
        recurring_themes_confidence: "multi_source",
        insufficient_data: false,
      }),
    );

    const summary = await summarizeIndividualProfile(
      "LinkedIn: https://linkedin.com/in/abc\n\nRecent X/Twitter posts:\ntweet 1\ntweet 2",
    );

    expect(summary.insufficientData).toBe(false);
    expect(summary.tone).toBe("practitioner, skeptical of hype");
    expect(summary.recurringThemesConfidence).toBe("multi_source");
  });
});

describe("buildProfileContext", () => {
  it("refuses legacy unverified summaries until regenerated", () => {
    const s = {
      topics: ["Data analysis"],
      tone: "Data Analyst",
      credentials: ["Tableau Certified"],
      recurringThemes: ["dashboards"],
      sourceQuality: "unverified_legacy" as const,
    };
    expect(buildProfileContext({ type: "individual", individual: { expertiseSummary: s } }))
      .toContain("unverified");
  });

  it("renders real verified data as before", () => {
    const s = {
      topics: ["LLM agents"],
      tone: "technical",
      credentials: ["CTO"],
      recurringThemes: ["productivity"],
    };
    expect(buildProfileContext({ type: "individual", individual: { expertiseSummary: s } }))
      .toBe("Topics: LLM agents\nTone: technical\nCredentials: CTO\nRecurring themes: productivity");
  });

  it("returns empty string when no context exists", () => {
    expect(buildProfileContext({ type: "individual" })).toBe("");
  });
});