import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({ email: null as string | null }));

vi.mock("@/lib/auth", () => ({
  getSessionEmail: () => Promise.resolve(session.email),
}));

const prismaMock = {
  analysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  profile: { findUnique: vi.fn() },
  analysisJournalistMatch: { findFirst: vi.fn() },
};

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/pitch", () => ({
  generatePitch: vi.fn(async () => "Subject: test pitch\n\nBody."),
}));

const { generatePitch } = await import("@/lib/pitch");
const { POST } = await import("./route");

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/analyze/abc/pitch", {
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
  error: null,
  profileId: null,
};

describe("POST /api/analyze/:id/pitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.email = null;
    prismaMock.analysis.findUnique.mockResolvedValue(baseAnalysis);
    prismaMock.analysis.update.mockResolvedValue({ pitch: "Subject: test pitch\n\nBody." });
    prismaMock.analysisJournalistMatch.findFirst.mockResolvedValue(null);
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

  it("generates a pitch and persists it", async () => {
    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pitch).toContain("Subject: test pitch");
    expect(generatePitch).toHaveBeenCalledWith(
      expect.objectContaining({ articleTitle: "Big story", angles: baseAnalysis.angles }),
    );
    expect(prismaMock.analysis.update).toHaveBeenCalledWith({
      where: { id: "abc" },
      data: { pitch: "Subject: test pitch\n\nBody." },
      select: { pitch: true },
    });
  });

  it("passes the selected angle through", async () => {
    await POST(makeRequest({ angle: "Angle one" }), { params: makeParams("abc") });
    expect(generatePitch).toHaveBeenCalledWith(
      expect.objectContaining({ selectedAngle: "Angle one" }),
    );
  });

  it("returns 500 when generation fails", async () => {
    vi.mocked(generatePitch).mockRejectedValueOnce(new Error("boom"));
    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(500);
  });

  it("rejects regeneration on a profile-linked analysis when not the owner", async () => {
    session.email = "someone-else@example.com";
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-2" });

    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(403);
    expect(generatePitch).not.toHaveBeenCalled();
  });

  it("allows regeneration on a profile-linked analysis by the owner", async () => {
    session.email = "owner@example.com";
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-1" });

    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    expect(generatePitch).toHaveBeenCalled();
  });

  it("allows regeneration on context-free analyses regardless of session", async () => {
    session.email = "someone@example.com";
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-2" });

    const response = await POST(makeRequest({}), { params: makeParams("abc") });
    expect(response.status).toBe(200);
  });
});