import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => {
  return {
    default: function MockOpenAI() {
      return { chat: { completions: { create: mockCreate } } };
    },
  };
});

const { generatePitch } = await import("./pitch");

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

describe("generatePitch", () => {
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