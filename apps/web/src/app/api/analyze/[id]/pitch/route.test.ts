import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(session.user),
}));

const prismaMock = {
  analysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  profile: { findUnique: vi.fn() },
  analysisJournalistMatch: { findFirst: vi.fn() },
  deepResearchRun: { findUnique: vi.fn() },
};

vi.mock("@newshog/db", () => ({
  prisma: prismaMock,
  logStage: vi.fn(),
}));
vi.mock("@/lib/content", () => ({
  generateContent: (...args: unknown[]) => mockGenerateContent(...args),
  parseContentResult: (kind: string, raw: string) =>
    kind === "pitch"
      ? { text: raw, meta: null }
      : {
          text: kind === "blog" ? "BLOG_BODY" : "POST_BODY",
          meta: { fitAssessment: "stretch", fitNote: "lane", timeFraming: "retrospective" },
        },
}));

const { POST } = await import("./route");

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/analyze/abc/content", {
    method: "POST",
    body: body === undefined ? "{}" : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeParams(id: string) {
  return Promise.resolve({ id });
}

const baseAnalysis = {
  id: "abc",
  url: "https://example.com/story",
  status: "analyzed",
  articleTitle: "Big story",
  rawArticleText: "Full article text here.",
  angles: [{ title: "Angle one", why_now: "now", why_journalists_care: "peers", headline: "Head" }],
  pitch: null,
  drafts: null,
  userId: null,
  error: null,
  profileId: null,
  score: 71,
  velocity: "breaking",
  eventTiming: "ongoing",
  whyNow: "it matters",
  sourcePublishedAt: null,
  researchRunId: null,
};

describe("POST /api/analyze/:id/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
    prismaMock.analysis.findUnique.mockResolvedValue(baseAnalysis);
    prismaMock.analysis.update.mockResolvedValue({});
    prismaMock.analysisJournalistMatch.findFirst.mockResolvedValue(null);
    prismaMock.deepResearchRun.findUnique.mockResolvedValue({ report: null, answer: null });
    mockGenerateContent.mockResolvedValue("Subject: test pitch\n\nBody.");
  });

  it("returns 404 when analysis is missing", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(null);
    const response = await POST(makeRequest({}), { params: makeParams("nope") });
    expect(response.status).toBe(404);
  });

  it("returns 409 when article text is not available yet", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, rawArticleText: null });
    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(409);
  });

  it("generates a pitch (default kind) and persists it", async () => {
    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.text).toContain("Subject:");
    expect(mockGenerateContent).toHaveBeenCalledWith(
      "pitch",
      expect.objectContaining({ articleTitle: "Big story", angles: baseAnalysis.angles }),
    );
    expect(prismaMock.analysis.update).toHaveBeenCalledWith({
      where: { id: "abc" },
      data: { pitch: "Subject: test pitch\n\nBody." },
    });
  });

  it("passes the selected angle through", async () => {
    await POST(makeRequest({ angle: "One" }), { params: makeParams("abc") });
    expect(mockGenerateContent).toHaveBeenCalledWith("pitch", expect.objectContaining({ selectedAngle: "One" }));
  });

  it("generates a blog post into drafts, preserving any existing draft", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({
      ...baseAnalysis,
      drafts: { post: "old post" },
    });
    const response = await POST(makeRequest({ kind: "blog" }), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledWith("blog", expect.any(Object));
    const updateCall = prismaMock.analysis.update.mock.calls[0][0];
    expect(updateCall.data.pitch).toBeUndefined();
    expect(updateCall.data.drafts).toEqual({ blog: "BLOG_BODY", post: "old post" });
  });

  it("generates a post with the single (linkedin) format", async () => {
    const response = await POST(makeRequest({ kind: "post" }), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledWith(
      "post",
      expect.objectContaining({ platform: "linkedin" }),
    );
    expect(mockGenerateContent).not.toHaveBeenCalledWith("post", expect.objectContaining({ platform: "twitter" }));
    const updateCall = prismaMock.analysis.update.mock.calls[0][0];
    expect(updateCall.data.drafts).toEqual({ post: "POST_BODY" });
  });

  it("passes deep-research context for blog/post runs", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, researchRunId: "run-1" });
    prismaMock.deepResearchRun.findUnique.mockResolvedValue({ report: "digest", answer: null });
    await POST(makeRequest({ kind: "blog" }), { params: makeParams("abc") });
    const call = mockGenerateContent.mock.calls[0][1] as { researchContext?: string };
    expect(call.researchContext).toBe("digest");
  });

  it("returns 500 when generation fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("boom"));
    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(500);
  });

  it("rejects regeneration on a profile-linked analysis when not the owner", async () => {
    session.user = { id: "someone-else", email: "someone-else@example.com" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-2" });

    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(403);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("allows regeneration on a profile-linked analysis by the owner", async () => {
    session.user = { id: "owner-user", email: "owner@example.com" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-1" });

    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it("allows regeneration on context-free analyses regardless of session", async () => {
    session.user = { id: "someone", email: "someone@example.com" };
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-2" });

    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(200);
  });
});