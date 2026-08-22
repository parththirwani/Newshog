import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(session.user),
}));

const prismaMock = {
  analysis: { findUnique: vi.fn() },
  profile: { findUnique: vi.fn() },
};

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

const { GET } = await import("./route");

function makeParams(id: string) {
  return Promise.resolve({ id });
}

const baseAnalysis = {
  id: "abc",
  url: "https://example.com/story",
  status: "analyzed",
  articleTitle: "Big story",
  score: 70,
  angles: [{ title: "Angle" }],
  whyNow: "why",
  pitch: "Subject: secret personalized pitch",
  error: null,
  profileId: null,
  userId: null,
  updatedAt: new Date().toISOString(),
};

describe("GET /api/analyze/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
    prismaMock.analysis.findUnique.mockResolvedValue(baseAnalysis);
    prismaMock.profile.findUnique.mockResolvedValue(null);
  });

  it("returns 404 for a missing analysis", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue(null);
    const response = await GET(new Request("http://x"), { params: makeParams("nope") });
    expect(response.status).toBe(404);
  });

  it("includes the pitch for a context-free (public) analysis", async () => {
    const response = await GET(new Request("http://x"), { params: makeParams("abc") });
    const body = await response.json();
    expect(body.pitch).toBe("Subject: secret personalized pitch");
  });

  it("strips the personalized pitch from a profile-linked analysis for logged-out visitors", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: "profile-1", userId: "user-1" });
    const response = await GET(new Request("http://x"), { params: makeParams("abc") });
    const body = await response.json();
    expect(body.pitch).toBeUndefined();
    expect(body.profileId).toBe("profile-1");
    expect(body.score).toBe(70);
  });

  it("never exposes the owner's userId to non-owners", async () => {
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, userId: "user-1" });
    const response = await GET(new Request("http://x"), { params: makeParams("abc") });
    const body = await response.json();
    expect(body.userId).toBeUndefined();
  });

  it("keeps the pitch for the profile owner", async () => {
    session.user = { id: "user-1", email: "owner@example.com" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: "profile-1" });
    prismaMock.profile.findUnique.mockResolvedValue({ id: "profile-1" });
    const response = await GET(new Request("http://x"), { params: makeParams("abc") });
    const body = await response.json();
    expect(body.pitch).toBe("Subject: secret personalized pitch");
  });

  it("strips the pitch from a user-linked analysis for another user", async () => {
    session.user = { id: "user-2", email: "other@example.com" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, userId: "user-1" });
    const response = await GET(new Request("http://x"), { params: makeParams("abc") });
    const body = await response.json();
    expect(body.pitch).toBeUndefined();
  });

  it("keeps the pitch for the owning user", async () => {
    session.user = { id: "user-1", email: "owner@example.com" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, userId: "user-1" });
    const response = await GET(new Request("http://x"), { params: makeParams("abc") });
    const body = await response.json();
    expect(body.pitch).toBe("Subject: secret personalized pitch");
  });
});