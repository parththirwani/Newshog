import { describe, it, expect, vi, beforeEach } from "vitest";

const owner = vi.hoisted(() => ({
  current: { userId: null as string | null, profileId: null as string | null },
}));

vi.mock("@/lib/owner", () => ({
  resolveOwnerIds: () => Promise.resolve(owner.current),
  isOwner: (a: { userId: string | null; profileId: string | null }, uid: string | null, pid: string | null) => {
    if (a.userId) return uid === a.userId;
    if (a.profileId) return pid === a.profileId;
    return true;
  },
}));

const prismaMock = {
  analysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@newshog/db", () => ({
  prisma: prismaMock,
}));

const { POST } = await import("./route");

function makeParams(id: string) {
  return Promise.resolve({ id });
}

const baseAnalysis = {
  id: "abc",
  url: "https://example.com/story",
  status: "analyzed",
  articleTitle: "Big story",
  rawArticleText: "Full article text here.",
  angles: [],
  pitch: "old unpersonalized pitch",
  drafts: { blog: "old draft" },
  error: null,
  profileId: null,
  userId: "user-1",
};

describe("POST /api/analyze/:id/personalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    owner.current = { userId: null, profileId: null };
    prismaMock.analysis.findUnique.mockResolvedValue(baseAnalysis);
    prismaMock.analysis.update.mockResolvedValue({});
  });

  it("returns 401 when not authenticated", async () => {
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(401);
    expect(prismaMock.analysis.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the user has no profile yet", async () => {
    owner.current = { userId: "user-1", profileId: null };
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(409);
    expect(prismaMock.analysis.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the analysis is missing", async () => {
    owner.current = { userId: "user-1", profileId: "profile-1" };
    prismaMock.analysis.findUnique.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(404);
  });

  it("returns 403 when the analysis belongs to another user", async () => {
    owner.current = { userId: "user-1", profileId: "profile-1" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, userId: "someone-else" });
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(403);
    expect(prismaMock.analysis.update).not.toHaveBeenCalled();
  });

  it("returns 403 when the analysis is profile-linked to another profile", async () => {
    owner.current = { userId: "user-1", profileId: "profile-1" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, userId: null, profileId: "profile-2" });
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(403);
  });

  it("attaches the profile and clears stale unpersonalized drafts", async () => {
    owner.current = { userId: "user-1", profileId: "profile-1" };
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, profileId: "profile-1" });
    expect(prismaMock.analysis.update).toHaveBeenCalledWith({
      where: { id: "abc" },
      data: { profileId: "profile-1", pitch: null, drafts: {} },
    });
  });

  it("rejects personalizing a context-free (public) analysis so it stays shared", async () => {
    owner.current = { userId: "user-1", profileId: "profile-1" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, userId: null, profileId: null });
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(409);
    expect(prismaMock.analysis.update).not.toHaveBeenCalled();
  });

  it("attaches the profile for a user-owned analysis even when profileId was null", async () => {
    owner.current = { userId: "user-1", profileId: "profile-1" };
    prismaMock.analysis.findUnique.mockResolvedValue({ ...baseAnalysis, profileId: null, userId: "user-1" });
    const response = await POST(new Request("http://localhost/api/analyze/abc/personalize", { method: "POST" }), { params: makeParams("abc") });
    expect(response.status).toBe(200);
    expect(prismaMock.analysis.update).toHaveBeenCalledWith({
      where: { id: "abc" },
      data: { profileId: "profile-1", pitch: null, drafts: {} },
    });
  });
});