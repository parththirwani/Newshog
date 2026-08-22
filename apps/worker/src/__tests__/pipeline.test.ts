import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  analysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

const scrapeMock = vi.fn();
vi.mock("../scrape", () => ({ scrapeArticle: scrapeMock }));

const analyzeMock = vi.fn();
vi.mock("../analyze", () => ({ analyzeArticle: analyzeMock }));

let capturedProcessor: (job: { data: { analysisId: string } }) => Promise<void>;

vi.mock("bullmq", () => ({
  Worker: vi.fn(function WorkerMock(
    _name: string,
    fn: (job: { data: { analysisId: string } }) => Promise<void>,
  ) {
    capturedProcessor = fn;
    return { on: vi.fn() };
  }),
}));

vi.mock("@newshog/queue", () => ({
  ANALYZE_QUEUE: "analyze-test",
  createConnection: vi.fn(),
}));

await import("../index");

const mockAnalysis = {
  id: "abc-123",
  url: "https://example.com/article",
  status: "queued",
};

function getUpdates() {
  return prismaMock.analysis.update.mock.calls.map(
    (c: [{ data: Record<string, unknown> }]) => c[0].data,
  );
}

describe("pipeline processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysis);
  });

  it("runs full pipeline through to analyzed status", async () => {
    scrapeMock.mockResolvedValue({
      title: "Article Title",
      text: "Scraped text content here.",
      mode: "full",
    });

    analyzeMock.mockResolvedValue({
      score: 80,
      why_now: "Timely event",
      angles: [
        {
          title: "Angle 1",
          why_now: "Now",
          why_journalists_care: "New info",
          headline: "Headline",
        },
      ],
    });

    await capturedProcessor({ data: { analysisId: "abc-123" } });

    const updates = getUpdates();
    expect(updates[0]).toEqual({ status: "scraping" });
    expect(updates[1]).toEqual({
      status: "scraped",
      articleTitle: "Article Title",
      rawArticleText: "Scraped text content here.",
      extractionMode: "full",
    });
    expect(updates[2]).toEqual({ status: "analyzing" });
    expect(updates[3]).toEqual({
      status: "analyzed",
      score: 80,
      whyNow: "Timely event",
      angles: [
        {
          title: "Angle 1",
          why_now: "Now",
          why_journalists_care: "New info",
          headline: "Headline",
        },
      ],
    });
  });

  it("throws when analysis record not found", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(null);

    await expect(
      capturedProcessor({ data: { analysisId: "missing" } }),
    ).rejects.toThrow("Analysis missing not found");
  });

  it("marks failed when scraping throws", async () => {
    scrapeMock.mockRejectedValue(new Error("Network timeout"));

    await capturedProcessor({ data: { analysisId: "abc-123" } });

    const updates = getUpdates();
    const failedUpdate = updates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.error).toBe("Network timeout");
  });

  it("marks failed when analysis throws", async () => {
    scrapeMock.mockResolvedValue({
      title: null,
      text: "Some text",
      mode: "limited",
    });
    analyzeMock.mockRejectedValue(new Error("LLM rate limit"));

    await capturedProcessor({ data: { analysisId: "abc-123" } });

    const updates = getUpdates();
    const failedUpdate = updates.find((u) => u.status === "failed");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.error).toBe("LLM rate limit");
  });

  it("passes scraped text and title to analyzeArticle", async () => {
    scrapeMock.mockResolvedValue({
      title: "Scraped Title",
      text: "Full article body",
      mode: "full",
    });
    analyzeMock.mockResolvedValue({ score: 50, why_now: "ok", angles: [] });

    await capturedProcessor({ data: { analysisId: "abc-123" } });

    expect(analyzeMock).toHaveBeenCalledWith(
      "Full article body",
      "Scraped Title",
    );
  });

  it("passes scraped url to scrapeArticle", async () => {
    scrapeMock.mockResolvedValue({ title: null, text: "t", mode: "limited" });
    analyzeMock.mockResolvedValue({ score: 10, why_now: "ok", angles: [] });

    await capturedProcessor({ data: { analysisId: "abc-123" } });

    expect(scrapeMock).toHaveBeenCalledWith(
      "https://example.com/article",
    );
  });
});
