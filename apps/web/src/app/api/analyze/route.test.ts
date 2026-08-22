import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
const anon = vi.hoisted(() => ({ id: "anon-1", cookie: null as Record<string, unknown> | null }));

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(session.user),
  getAnonId: () => Promise.resolve({ id: anon.id, cookie: anon.cookie }),
  anonIdCookie: (id: string) => ({
    name: "anon_id",
    value: `${id}.sig`,
    httpOnly: true,
    path: "/",
    maxAge: 3600,
    sameSite: "lax",
  }),
}));

const prismaMock = {
  analysis: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
  profile: { findUnique: vi.fn() },
};
vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

vi.mock("@newshog/queue", () => ({
  getAnalyzeQueue: () => ({ add: vi.fn() }),
  ANALYZE_QUEUE: "analyze",
}));

vi.mock("@/lib/analytics", () => ({ trackServer: vi.fn() }));

// Real-rate-limit module keeps per-process bucket state that leaks across
// tests; stub it so every POST counts as allowed.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 9, retryAfter: 0 }),
  clientIp: () => "test",
  ANALYZE_RATE_LIMIT: 10,
  ANALYZE_WINDOW_MS: 60 * 60 * 1000,
  anonQuota: (used: number) => ({ ok: used < 3, remaining: Math.max(0, 3 - used) }),
}));

const { POST } = await import("./route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
    anon.id = "anon-1";
    anon.cookie = null;
    prismaMock.analysis.findFirst.mockResolvedValue(null);
    prismaMock.analysis.count.mockResolvedValue(0);
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
    prismaMock.profile.findUnique.mockResolvedValue(null);
  });

  it("rejects invalid URLs", async () => {
    const res = await post({ url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("blocks an anonymous visitor past the 3-story free tier", async () => {
    prismaMock.analysis.count.mockResolvedValue(3);
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.remaining).toBe(0);
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("sets the anon cookie even on the exhausted response so the count sticks", async () => {
    anon.cookie = { name: "anon_id", value: "anon-1.sig" } as unknown as Record<string, unknown>;
    prismaMock.analysis.count.mockResolvedValue(3);
    const res = await post({ url: "https://example.com/story" });
    const cookies = res.headers.getSetCookie().join(";");
    expect(cookies).toContain("anon_id=");
  });

  it("counts anonymous usage against the signed anon id, not IP", async () => {
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    expect(prismaMock.analysis.count).toHaveBeenCalledWith({ where: { anonId: "anon-1" } });
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ anonId: "anon-1", userId: null }),
      }),
    );
    const body = await res.json();
    expect(body.remaining).toBe(2);
  });

  it("attaches the userId for a logged-in user and skips the quota", async () => {
    session.user = { id: "user-1", email: "owner@example.com" };
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", anonId: null }),
      }),
    );
    expect(prismaMock.analysis.count).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.remaining).toBeUndefined();
  });

  it("scopes the dedupe to the caller's own anonymous rows (never cross-account)", async () => {
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    const calledWith = prismaMock.analysis.findFirst.mock.calls[0][0];
    expect(calledWith.where.OR).toEqual([{ anonId: "anon-1" }, { userId: null, anonId: null }]);
  });

  it("dedupes an anonymous caller onto their own prior analysis", async () => {
    prismaMock.analysis.findFirst.mockResolvedValue({ id: "my-analysis" });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.deduped).toBe(true);
    expect(body.id).toBe("my-analysis");
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("dedupes a logged-in user only onto their own (or context-free) analyses", async () => {
    session.user = { id: "user-1", email: "owner@example.com" };
    prismaMock.analysis.findFirst.mockResolvedValue({ id: "my-analysis" });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    const calledWith = prismaMock.analysis.findFirst.mock.calls[0][0];
    expect(calledWith.where.OR).toContainEqual({ userId: "user-1" });
    expect(calledWith.where.OR).toContainEqual({ userId: null, anonId: null });
  });

  it("rejects using another user's profile id", async () => {
    session.user = { id: "user-1", email: "owner@example.com" };
    prismaMock.profile.findUnique.mockResolvedValue({ userId: "user-2" });
    const res = await post({ url: "https://example.com/story", profileId: "profile-2" });
    expect(res.status).toBe(403);
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("allows a logged-in user to analyze against their own profile", async () => {
    session.user = { id: "user-1", email: "owner@example.com" };
    prismaMock.profile.findUnique.mockResolvedValue({ userId: "user-1" });
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
    const res = await post({ url: "https://example.com/story", profileId: "profile-1" });
    expect(res.status).toBe(201);
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ profileId: "profile-1" }),
      }),
    );
  });

  it("rejects an anonymous caller attaching a profile id", async () => {
    const res = await post({ url: "https://example.com/story", profileId: "profile-1" });
    expect(res.status).toBe(403);
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });
});