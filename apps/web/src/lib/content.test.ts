import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => {
  return {
    default: function MockOpenAI() {
      return { chat: { completions: { create: mockCreate } } };
    },
  };
});

const { generatePitch, generateContent, parseContentResult, stripPreamble } = await import("./content");

const angles = [
  {
    title: "Angle one",
    why_now: "timely now",
    why_journalists_care: "peers care",
    headline: "Headline one",
  },
  {
    title: "Angle two",
    why_now: "also timely",
    why_journalists_care: "more peers care",
    headline: "Headline two",
  },
];

function makeResponse(content: string | null) {
  return { choices: [{ message: { content } }] };
}

describe("generatePitch (backward-compatible wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the trimmed LLM content", async () => {
    mockCreate.mockResolvedValue(makeResponse("  Subject: Hi\n\nBody.  "));
    const pitch = await generatePitch({ articleText: "text", angles, selectedAngle: "Angle one" });
    expect(pitch).toBe("Subject: Hi\n\nBody.");
  });

  it("selects the angle matching selectedAngle", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generatePitch({ articleText: "text", angles, selectedAngle: "Angle two" });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("Title: Angle two");
    expect(content).not.toContain("Title: Angle one");
  });

  it("falls back to the first angle when selection does not match", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generatePitch({ articleText: "text", angles, selectedAngle: "Nope" });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("Title: Angle one");
  });

  it("includes the article title when provided", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generatePitch({ articleText: "text", angles, selectedAngle: "Angle one", articleTitle: "Big story" });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("Article title: Big story");
  });

  it("does not include an article title line when title is absent", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generatePitch({ articleText: "text", angles, selectedAngle: "Angle one" });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).not.toContain("Article title:");
  });

  it("includes matched opportunity context when provided", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generatePitch({
      articleText: "text",
      angles,
      selectedAngle: "Angle one",
      opportunity: { requesterName: "Dana Whitfield", outlet: "Reuters", topicText: "Need SMB cost data" },
    });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("Dana Whitfield");
    expect(content).toContain("Reuters");
    expect(content).toContain("Need SMB cost data");
  });

  it("includes the profile context block when provided", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generatePitch({
      articleText: "text",
      angles,
      selectedAngle: "Angle one",
      profileContext: "Topics: payroll, compliance",
    });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("User profile context:");
    expect(content).toContain("Topics: payroll, compliance");
  });

  it("truncates the article text to the input cap", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    const longText = "x".repeat(10_000);
    await generatePitch({ articleText: longText, angles, selectedAngle: "Angle one" });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("x".repeat(8000));
    expect(content.length).toBeLessThan(10_000);
  });

  it("throws when the model returns no content", async () => {
    mockCreate.mockResolvedValue(makeResponse(null));
    await expect(
      generatePitch({ articleText: "text", angles, selectedAngle: "Angle one" }),
    ).rejects.toThrow("No pitch generated");
  });
});

describe("generateContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the kind's system prompt", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generateContent("blog", { articleText: "text", angles });
    const system = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("thought-leadership blog post");
    expect(system).not.toContain("PR pitching coach");
  });

  it("includes the analysis block only for blog/post", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generateContent("post", {
      articleText: "text",
      angles,
      platform: "linkedin",
      analysis: { score: 71, velocity: "breaking", sourcePublishedAt: "2026-08-20T00:00:00Z" },
    });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("score: 71/100");
    expect(content).toContain("velocity: breaking");
    expect(content).toContain("platform: linkedin");
  });

  it("never adds an analysis block for pitch", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generateContent("pitch", {
      articleText: "text",
      angles,
      analysis: { score: 50, velocity: "standard" },
    });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).not.toContain("Article analysis:");
    expect(content).not.toContain("current_date");
  });

it("includes research context when provided", async () => {
    mockCreate.mockResolvedValue(makeResponse("ok"));
    await generateContent("blog", { articleText: "text", angles, researchContext: "fresh development" });
    const content = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(content).toContain("Research context:");
    expect(content).toContain("fresh development");
  });

  it("throws when the model returns no content", async () => {
    mockCreate.mockResolvedValue(makeResponse(null));
    await expect(generateContent("post", { articleText: "text", angles, platform: "twitter" })).rejects.toThrow(
      "No post generated",
    );
  });
});

describe("parseContentResult", () => {
  it("passes pitch text through untouched", () => {
    const { text, meta } = parseContentResult("pitch", "Subject: Hi\n\nBody.");
    expect(text).toBe("Subject: Hi\n\nBody.");
    expect(meta).toBeNull();
  });

  it("extracts blog title, body and safety meta", () => {
    const raw = `{"title":"T","body":"hello","meta_description":"d","fit_assessment":"stretch","fit_note":"not your lane","time_framing":"retrospective"}`;
    const { text, meta } = parseContentResult("blog", raw);
    expect(text).toBe("T\n\nhello");
    expect(meta).toEqual({
      fitAssessment: "stretch",
      fitNote: "not your lane",
      timeFraming: "retrospective",
      title: "T",
    });
  });

  it("extracts post body and platform from a fenced JSON block", () => {
    const raw = 'prefix\n```json\n{"platform":"twitter","post":"tweet","is_thread":false,"fit_assessment":"natural","time_framing":"current"}\n```';
    const { text, meta } = parseContentResult("post", raw);
    expect(text).toBe("tweet");
    expect(meta).toEqual({
      fitAssessment: "natural",
      fitNote: null,
      timeFraming: "current",
      title: undefined,
    });
  });

  it("falls back to the raw string when the model skips the schema", () => {
    const { text, meta } = parseContentResult("post", "just a plain post");
    expect(text).toBe("just a plain post");
    expect(meta).toBeNull();
  });

  it("repairs real newlines inside JSON string values", () => {
    const raw = `{"platform":"linkedin","post":"Hook line.\n\nSecond paragraph with a real newline.","is_thread":false,"fit_assessment":"natural","time_framing":"current"}`;
    const { text, meta } = parseContentResult("post", raw);
    expect(text).toBe("Hook line.\n\nSecond paragraph with a real newline.");
    expect(meta?.timeFraming).toBe("current");
  });

  it("strips a framing preamble from the post body", () => {
    const post = 'Here is a 3-paragraph LinkedIn post reacting to the news:\\n\\nMicrosoft just bought Powerset.';
    const raw = `{"platform":"linkedin","post":"${post}","is_thread":false,"fit_assessment":"natural","time_framing":"current"}`;
    const { text } = parseContentResult("post", raw);
    expect(text).toBe("Microsoft just bought Powerset.");
    expect(text).not.toContain("Here is");
  });

  it("strips a preamble line from a raw (non-JSON) response", () => {
    const { text } = parseContentResult("post", "Sure, here's your post:\n\nJust my two cents on the acquisition.");
    expect(text).toBe("Just my two cents on the acquisition.");
  });

  it("strips a preamble from pitch text, keeping the Subject line", () => {
    const { text } = parseContentResult("pitch", "Here is a draft pitch:\n\nSubject: Hi Dana\n\nBody here.");
    expect(text).toBe("Subject: Hi Dana\n\nBody here.");
  });
});

describe("stripPreamble", () => {
  it("removes a colon-terminated framing line with a format word", () => {
    expect(stripPreamble("Here is a 3-paragraph LinkedIn post reacting to the news:\n\nFirst paragraph."))
      .toBe("First paragraph.");
  });

  it("leaves a legit hook that names no format and ends in a period", () => {
    expect(stripPreamble("This is a big quarter for us.\n\nRevenue doubled."))
      .toBe("This is a big quarter for us.\n\nRevenue doubled.");
  });

  it("leaves a real take even when it names a format without a trailing colon", () => {
    expect(stripPreamble("This is the pitch I used to land TechCrunch coverage and it worked."))
      .toBe("This is the pitch I used to land TechCrunch coverage and it worked.");
  });

  it("trims leading blank lines", () => {
    expect(stripPreamble("\n\n  \nFirst line.")).toBe("First line.");
  });
});