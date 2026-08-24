import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  analysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  profile: {
    findUnique: vi.fn(),
  },
  journalistRequest: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  },
  analysisJournalistMatch: {
    upsert: vi.fn(),
  },
};

vi.mock("@newshog/db", () => ({ prisma: prismaMock, logStage: vi.fn() }));

const scrapeMock = vi.fn();
vi.mock("../scrape", () => ({ scrapeArticle: scrapeMock }));

const analyzeMock = vi.fn();
vi.mock("../analyze", () => ({ analyzeArticle: analyzeMock }));

const fetchDigestEmailsMock = vi.fn().mockResolvedValue([]);
const extractJournalistRequestsMock = vi.fn().mockResolvedValue([]);
const matchRequestsToAnalysisMock = vi.fn().mockResolvedValue([]);
const markEmailsSeenMock = vi.fn().mockResolvedValue(undefined);
const matchQueueAddMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../email-fetch", () => ({
  fetchDigestEmails: fetchDigestEmailsMock,
  markEmailsSeen: markEmailsSeenMock,
}));
vi.mock("../extract-requests", () => ({ extractJournalistRequests: extractJournalistRequestsMock }));
vi.mock("../match-requests", () => ({ matchRequestsToAnalysis: matchRequestsToAnalysisMock }));

let capturedProcessors: Record<string, (job: { data: Record<string, unknown> }) => Promise<void>> = {};

vi.mock("bullmq", () => ({
  Worker: vi.fn(function WorkerMock(
    name: string,
    fn: (job: { data: Record<string, unknown> }) => Promise<void>,
  ) {
    capturedProcessors[name] = fn;
    return { on: vi.fn() };
  }),
  Queue: vi.fn(function QueueMock() {
    return {
      add: vi.fn(),
      getJobSchedulers: vi.fn().mockResolvedValue([]),
      upsertJobScheduler: vi.fn(),
      close: vi.fn(),
    };
  }),
}));

vi.mock("@newshog/queue", () => ({
  ANALYZE_QUEUE: "analyze-test",
  EMAIL_INGEST_QUEUE: "email-ingest-test",
  MATCH_QUEUE: "match-test",
  DEEP_RESEARCH_QUEUE: "deep-research-test",
  createConnection: vi.fn(),
  getMatchQueue: vi.fn(() => ({ add: matchQueueAddMock })),
  getDeepResearchQueue: vi.fn(() => ({ add: vi.fn() })),
}));

await import("../index");

const mockAnalysis = {
  id: "abc-123",
  url: "https://example.com/article",
  status: "queued",
};

function getAnalysisUpdates() {
  return prismaMock.analysis.update.mock.calls.map(
    (c: [{ data: Record<string, unknown> }]) => c[0].data,
  );
}

describe("pipeline processor (analyze worker)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysis);
    prismaMock.journalistRequest.findMany.mockResolvedValue([]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);
    fetchDigestEmailsMock.mockResolvedValue([]);
    extractJournalistRequestsMock.mockResolvedValue([]);
    matchRequestsToAnalysisMock.mockResolvedValue([]);
  });

  it("runs full pipeline through to analyzed status", async () => {
    scrapeMock.mockResolvedValue({ title: "Article Title", text: "Scraped text content here.", mode: "full" });
    analyzeMock.mockResolvedValue({
      score: 80,
      why_now: "Timely event",
      velocity: "standard",
      velocity_reasoning: "Routine product announcement",
      angles: [{ title: "Angle 1", why_now: "Now", why_journalists_care: "New info", headline: "Headline" }],
    });

    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });

    const updates = getAnalysisUpdates();
    expect(updates[0]).toEqual({ status: "scraping" });
    expect(updates[1]).toEqual({ status: "scraped", articleTitle: "Article Title", rawArticleText: "Scraped text content here.", extractionMode: "full" });
    expect(updates[2]).toEqual({ status: "analyzing" });
    expect(updates[3]).toEqual({
      status: "analyzed",
      score: 80,
      velocity: "standard",
      velocityReasoning: "Routine product announcement",
      whyNow: "Timely event",
      angles: [{ title: "Angle 1", why_now: "Now", why_journalists_care: "New info", headline: "Headline" }],
    });
  });

  it("enqueues a match job after analysis completes", async () => {
    scrapeMock.mockResolvedValue({ title: "T", text: "body", mode: "full" });
    analyzeMock.mockResolvedValue({ score: 50, why_now: "ok", angles: [{ title: "A", why_now: "n", why_journalists_care: "c", headline: "h" }] });

    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });

    expect(matchQueueAddMock).toHaveBeenCalledWith(
      "match",
      { analysisId: "abc-123" },
      { jobId: "match-abc-123" },
    );
  });

  it("does not fail the analysis when the match enqueue throws", async () => {
    scrapeMock.mockResolvedValue({ title: "T", text: "body", mode: "full" });
    analyzeMock.mockResolvedValue({ score: 50, why_now: "ok", angles: [{ title: "A", why_now: "n", why_journalists_care: "c", headline: "h" }] });
    matchQueueAddMock.mockRejectedValueOnce(new Error("redis down"));

    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });

    const updates = getAnalysisUpdates();
    expect(updates.some((u) => u.status === "failed")).toBe(false);
    expect(updates[3].status).toBe("analyzed");
  });

  it("throws when analysis record not found", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(null);
    await expect(
      capturedProcessors["analyze-test"]({ data: { analysisId: "missing" } }),
    ).rejects.toThrow("Analysis missing not found");
  });

  it("marks failed when scraping throws", async () => {
    scrapeMock.mockRejectedValue(new Error("Network timeout"));
    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });
    const failedUpdate = getAnalysisUpdates().find((u) => u.status === "failed");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.error).toBe("Network timeout");
  });

  it("marks failed when analysis throws", async () => {
    scrapeMock.mockResolvedValue({ title: null, text: "Some text", mode: "limited" });
    analyzeMock.mockRejectedValue(new Error("LLM rate limit"));
    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });
    const failedUpdate = getAnalysisUpdates().find((u) => u.status === "failed");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.error).toBe("LLM rate limit");
  });

  it("passes scraped text and title to analyzeArticle", async () => {
    scrapeMock.mockResolvedValue({ title: "Scraped Title", text: "Full article body", mode: "full" });
    analyzeMock.mockResolvedValue({ score: 50, why_now: "ok", angles: [] });
    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });
    expect(analyzeMock).toHaveBeenCalledWith("Full article body", "Scraped Title", undefined, "abc-123", undefined);
  });

  it("fetches profile context when analysis has profileId", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...mockAnalysis, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({
      type: "individual",
      individual: { expertiseSummary: { topics: ["AI", "startups"], tone: "technical", credentials: ["CTO"], recurringThemes: ["innovation"] } },
    });
    scrapeMock.mockResolvedValue({ title: "T", text: "body", mode: "full" });
    analyzeMock.mockResolvedValue({ score: 50, why_now: "ok", angles: [] });

    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });

    expect(analyzeMock).toHaveBeenCalledWith("body", "T", expect.stringContaining("Topics: AI, startups"), "abc-123", undefined);
  });

  it("does not pass profile context when analysis has no profileId", async () => {
    scrapeMock.mockResolvedValue({ title: "T", text: "body", mode: "full" });
    analyzeMock.mockResolvedValue({ score: 50, why_now: "ok", angles: [] });

    await capturedProcessors["analyze-test"]({ data: { analysisId: "abc-123" } });

    expect(analyzeMock).toHaveBeenCalledWith("body", "T", undefined, "abc-123", undefined);
  });
});

describe("match worker", () => {
  const mockAnalysisWithAngles = {
    id: "abc-123",
    url: "https://example.com/article",
    status: "analyzed",
    profileId: null,
    angles: [{ title: "AI funding", why_now: "Record quarter", why_journalists_care: "Trend story", headline: "AI Boom" }],
  };

  const mockRequests = [
    {
      id: "req-1",
      sourcePlatform: "source_of_sources",
      requesterName: "Jane",
      outlet: "TechCrunch",
      topicText: "AI funding experts",
      deadline: null,
      replyContact: "jane@tc.com",
      ingestedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.journalistRequest.findMany.mockResolvedValue(mockRequests);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);
    matchRequestsToAnalysisMock.mockResolvedValue([]);
    fetchDigestEmailsMock.mockResolvedValue([]);
    extractJournalistRequestsMock.mockResolvedValue([]);
  });

  it("queries non-expired journalist requests", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(prismaMock.journalistRequest.findMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
    });
  });

  it("skips matching when no open requests exist", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);
    prismaMock.journalistRequest.findMany.mockResolvedValue([]);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(matchRequestsToAnalysisMock).not.toHaveBeenCalled();
  });

  it("skips matching when analysis has no angles", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...mockAnalysisWithAngles, angles: null });

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(prismaMock.journalistRequest.findMany).not.toHaveBeenCalled();
  });

  it("skips matching when analysis not found", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(null);

    await capturedProcessors["match-test"]({ data: { analysisId: "missing" } });

    expect(prismaMock.journalistRequest.findMany).not.toHaveBeenCalled();
  });

  it("calls matchRequestsToAnalysis with angles and requests", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(matchRequestsToAnalysisMock).toHaveBeenCalledWith(
      mockAnalysisWithAngles.angles,
      null,
      expect.arrayContaining([expect.objectContaining({ id: "req-1", topicText: "AI funding experts" })]),
      "abc-123",
    );
  });

  it("passes profile context when analysis has profileId", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...mockAnalysisWithAngles, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({
      type: "enterprise",
      enterprise: {
        companyName: "Acme Corp",
        companyContext: { whatTheyDo: "Cloud", whoTheyServe: "Enterprises", productCategories: ["cloud"], positioningVoice: "technical", areasOfAuthority: ["infra"] },
      },
    });

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(matchRequestsToAnalysisMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining("Company: Acme Corp"),
      expect.any(Array),
      "abc-123",
    );
  });

  it("upserts matched requests", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);
    matchRequestsToAnalysisMock.mockResolvedValue([{ journalist_request_id: "req-1", match_rationale: "Direct fit for AI angle." }]);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(prismaMock.analysisJournalistMatch.upsert).toHaveBeenCalledWith({
      where: { analysisId_journalistRequestId: { analysisId: "abc-123", journalistRequestId: "req-1" } },
      create: { analysisId: "abc-123", journalistRequestId: "req-1", matchRationale: "Direct fit for AI angle." },
      update: { matchRationale: "Direct fit for AI angle." },
    });
  });

  it("does not upsert when no matches found", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);
    matchRequestsToAnalysisMock.mockResolvedValue([]);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(prismaMock.analysisJournalistMatch.upsert).not.toHaveBeenCalled();
  });

  it("upserts multiple matches", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);
    matchRequestsToAnalysisMock.mockResolvedValue([
      { journalist_request_id: "req-1", match_rationale: "Fit 1" },
      { journalist_request_id: "req-2", match_rationale: "Fit 2" },
    ]);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    expect(prismaMock.analysisJournalistMatch.upsert).toHaveBeenCalledTimes(2);
  });

  it("converts request dates to ISO strings for LLM", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysisWithAngles);
    prismaMock.journalistRequest.findMany.mockResolvedValue([{ ...mockRequests[0], deadline: new Date("2026-08-25") }]);

    await capturedProcessors["match-test"]({ data: { analysisId: "abc-123" } });

    const typedRequests = matchRequestsToAnalysisMock.mock.calls[0][2];
    expect(typedRequests[0].deadline).toBe("2026-08-25T00:00:00.000Z");
  });
});

describe("email ingest worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.analysis.findUnique.mockResolvedValue(mockAnalysis);
    prismaMock.journalistRequest.findMany.mockResolvedValue([]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);
    matchRequestsToAnalysisMock.mockResolvedValue([]);
    fetchDigestEmailsMock.mockResolvedValue([]);
    extractJournalistRequestsMock.mockResolvedValue([]);
  });

  it("fetches emails and extracts requests", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 1, subject: "SOS digest", text: "AI experts needed", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: "Jane", outlet: "TechCrunch", topic_text: "AI experts", deadline: null, reply_contact: "jane@tc.com" },
    ]);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(fetchDigestEmailsMock).toHaveBeenCalled();
    expect(extractJournalistRequestsMock).toHaveBeenCalledWith("AI experts needed");
  });

  it("creates journalist request records from extracted data", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 1, subject: "Digest", text: "query text", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: "Bob", outlet: "Forbes", topic_text: "Cybersecurity", deadline: "2026-08-25", reply_contact: "bob@forbes.com" },
    ]);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(prismaMock.journalistRequest.create).toHaveBeenCalledWith({
      data: {
        sourcePlatform: "source_of_sources",
        requesterName: "Bob",
        outlet: "Forbes",
        topicText: "Cybersecurity",
        deadline: expect.any(Date),
        replyContact: "bob@forbes.com",
        rawEmailRef: "Digest",
        expiresAt: expect.any(Date),
      },
    });
  });

  it("deduplicates requests within 24h", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 1, subject: "Digest", text: "query", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: null, outlet: null, topic_text: "Same topic", deadline: null, reply_contact: null },
    ]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue({ id: "existing-req" });

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(prismaMock.journalistRequest.create).not.toHaveBeenCalled();
  });

  it("creates request when no duplicate found", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 1, subject: "Digest", text: "query", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: null, outlet: null, topic_text: "New topic", deadline: null, reply_contact: null },
    ]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(prismaMock.journalistRequest.create).toHaveBeenCalled();
  });

  it("marks emails as seen only after persistence", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 5, subject: "Digest", text: "query", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: null, outlet: null, topic_text: "New topic", deadline: null, reply_contact: null },
    ]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(markEmailsSeenMock).toHaveBeenCalledWith([5]);
  });

  it("does not mark email seen when extraction fails", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 2, subject: "Bad Digest", text: "query", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockRejectedValueOnce(new Error("LLM failure"));

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(markEmailsSeenMock).not.toHaveBeenCalledWith([2]);
  });

  it("stores null deadline for unparseable LLM dates", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 3, subject: "Digest", text: "query", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: null, outlet: null, topic_text: "Natural language deadline", deadline: "end of the month", reply_contact: null },
    ]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(prismaMock.journalistRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deadline: null }),
    });
  });

  it("queries dedupe by platform and topic within 24h", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 1, subject: "Digest", text: "query", html: "", from: "digest@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: null, outlet: null, topic_text: "Dup topic", deadline: null, reply_contact: null },
    ]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(prismaMock.journalistRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourcePlatform: "source_of_sources", topicText: "Dup topic" }),
      }),
    );
  });

  it("handles multiple emails and multiple requests per email", async () => {
    fetchDigestEmailsMock.mockResolvedValue([
      { uid: 1, subject: "E1", text: "body1", html: "", from: "a@sourceofsources.com", date: new Date(), platform: "source_of_sources" },
      { uid: 1, subject: "E2", text: "body2", html: "", from: "b@sourcebottle.com", date: new Date(), platform: "sourcebottle" },
    ]);
    extractJournalistRequestsMock.mockResolvedValue([
      { requester_name: "X", outlet: null, topic_text: "Req 1", deadline: null, reply_contact: null },
      { requester_name: "Y", outlet: null, topic_text: "Req 2", deadline: null, reply_contact: null },
    ]);
    prismaMock.journalistRequest.findFirst.mockResolvedValue(null);

    await capturedProcessors["email-ingest-test"]({ data: {} });

    expect(extractJournalistRequestsMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.journalistRequest.create).toHaveBeenCalledTimes(4);
  });
});