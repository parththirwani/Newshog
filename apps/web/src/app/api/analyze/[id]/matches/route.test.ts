import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  analysisJournalistMatch: {
    findMany: vi.fn(),
  },
};

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

const { GET } = await import("./route");

function makeRequest(url: string) {
  return new Request(url);
}

function makeParams(id: string) {
  return Promise.resolve({ id });
}

describe("GET /api/analyze/:id/matches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns matches for a given analysis", async () => {
    const mockMatches = [
      {
        analysisId: "abc-123",
        journalistRequestId: "req-1",
        matchRationale: "Good fit for angle 1",
        matchedAt: "2026-08-20T12:00:00Z",
        journalistRequest: {
          id: "req-1",
          sourcePlatform: "source_of_sources",
          requesterName: "Jane Smith",
          outlet: "TechCrunch",
          topicText: "AI experts needed",
        },
      },
    ];
    prismaMock.analysisJournalistMatch.findMany.mockResolvedValue(mockMatches);

    const response = await GET(makeRequest("http://localhost/api/analyze/abc-123/matches"), {
      params: makeParams("abc-123"),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0].matchRationale).toBe("Good fit for angle 1");
    expect(body[0].journalistRequest.requesterName).toBe("Jane Smith");
  });

  it("returns empty array when no matches exist", async () => {
    prismaMock.analysisJournalistMatch.findMany.mockResolvedValue([]);

    const response = await GET(makeRequest("http://localhost/api/analyze/no-matches/matches"), {
      params: makeParams("no-matches"),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });

  it("queries with correct analysisId", async () => {
    prismaMock.analysisJournalistMatch.findMany.mockResolvedValue([]);

    await GET(makeRequest("http://localhost/api/analyze/test-id/matches"), {
      params: makeParams("test-id"),
    });

    expect(prismaMock.analysisJournalistMatch.findMany).toHaveBeenCalledWith({
      where: { analysisId: "test-id" },
      include: { journalistRequest: true },
      orderBy: { matchedAt: "desc" },
    });
  });

  it("returns 500 on prisma error", async () => {
    prismaMock.analysisJournalistMatch.findMany.mockRejectedValue(new Error("DB connection lost"));

    const response = await GET(makeRequest("http://localhost/api/analyze/err/matches"), {
      params: makeParams("err"),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error.");
  });

  it("includes journalistRequest data in response", async () => {
    prismaMock.analysisJournalistMatch.findMany.mockResolvedValue([
      {
        analysisId: "abc",
        journalistRequestId: "req-1",
        matchRationale: "Fit",
        matchedAt: new Date(),
        journalistRequest: {
          id: "req-1",
          sourcePlatform: "sourcebottle",
          requesterName: "Bob",
          outlet: "Forbes",
          topicText: "Cybersecurity",
          deadline: new Date(),
          replyContact: "bob@forbes.com",
          ingestedAt: new Date(),
          expiresAt: new Date(),
        },
      },
    ]);

    const response = await GET(makeRequest("http://localhost/api/analyze/abc/matches"), {
      params: makeParams("abc"),
    });

    const body = await response.json();
    expect(body[0].journalistRequest).toBeDefined();
    expect(body[0].journalistRequest.topicText).toBe("Cybersecurity");
  });
});
