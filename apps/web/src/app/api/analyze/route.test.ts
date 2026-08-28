import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; tier: string } | null,
}));
const anon = vi.hoisted(() => ({ id: "anon-1", cookie: null as Record<string, unknown> | null }));
const usageMock = vi.hoisted(() => ({
  checkAndConsumeQuota: vi.fn(),
  getQuotaStatus: vi.fn(),
}));

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

vi.mock("@/lib/usage", () => ({
  checkAndConsumeQuota: usageMock.checkAndConsumeQuota,
  getQuotaStatus: usageMock.getQuotaStatus,
  proGatingEnabled: () => true,
  LIMITS: { anonymous: { quick_search: 3, deep_research: 0 }, free: { quick_search: 10, deep_research: 1 }, pro: { quick_search: 250, deep_research: 50 } },
}));

vi.mock("@/lib/pro-gate", async () => {
  const { NextResponse } = await import("next/server");
  return {
    quotaDeniedResponse: (result: { tier: string; resetsAt: Date | null; remaining: number }, kind: string) =>
      NextResponse.json(
        {
          error: "quota_exceeded",
          code: "quota_exceeded",
          kind,
          tier: result.tier,
          resetsAt: result.resetsAt,
          remaining: 0,
        },
        { status: 429 },
      ),
  };
});

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
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
    prismaMock.profile.findUnique.mockResolvedValue(null);
    usageMock.getQuotaStatus.mockResolvedValue({ used: 0, limit: 3, resetsAt: null, tier: "anonymous" });
    usageMock.checkAndConsumeQuota.mockResolvedValue({
      allowed: true,
      remaining: 2,
      resetsAt: null,
      tier: "anonymous",
    });
  });

  it("rejects invalid URLs before touching quota", async () => {
    const res = await post({ url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(usageMock.checkAndConsumeQuota).not.toHaveBeenCalled();
  });

  it("consumes quota before enqueuing and returns the caller's remaining", async () => {
    usageMock.checkAndConsumeQuota.mockResolvedValue({
      allowed: true,
      remaining: 2,
      resetsAt: null,
      tier: "anonymous",
    });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    expect(usageMock.checkAndConsumeQuota).toHaveBeenCalledWith({ anonId: "anon-1" }, "quick_search");
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ anonId: "anon-1", userId: null }),
      }),
    );
    const body = await res.json();
    expect(body.remaining).toBe(2);
  });

  it("denies with 429 quota_exceeded when anonymous quota is exhausted and never enqueues", async () => {
    usageMock.checkAndConsumeQuota.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetsAt: null,
      tier: "anonymous",
    });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: "quota_exceeded", kind: "quick_search", tier: "anonymous" });
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("sets the anon cookie even on the exhausted response so the count sticks", async () => {
    anon.cookie = { name: "anon_id", value: "anon-1.sig" } as unknown as Record<string, unknown>;
    usageMock.checkAndConsumeQuota.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetsAt: null,
      tier: "anonymous",
    });
    const res = await post({ url: "https://example.com/story" });
    const cookies = res.headers.getSetCookie().join(";");
    expect(cookies).toContain("anon_id=");
  });

  it("enforces the logged-in free tier (10/day) instead of skipping quota", async () => {
    session.user = { id: "user-1", email: "owner@example.com", tier: "free" };
    usageMock.checkAndConsumeQuota.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetsAt: new Date("2099-01-01T00:00:00Z"),
      tier: "free",
    });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    expect(usageMock.checkAndConsumeQuota).toHaveBeenCalledWith({ userId: "user-1" }, "quick_search");
    expect(prismaMock.analysis.count).not.toHaveBeenCalled();
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", anonId: null }),
      }),
    );
    const body = await res.json();
    expect(body.remaining).toBe(9);
  });

  it("429s a logged-in free user at their daily limit", async () => {
    session.user = { id: "user-1", email: "owner@example.com", tier: "free" };
    usageMock.checkAndConsumeQuota.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetsAt: new Date("2099-01-01T00:00:00Z"),
      tier: "free",
    });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: "quota_exceeded", kind: "quick_search", tier: "free" });
    expect(body.resetsAt).toEqual("2099-01-01T00:00:00.000Z");
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("does not consume quota on a dedupe hit, but reports remaining from a status read", async () => {
    prismaMock.analysis.findFirst.mockResolvedValue({ id: "existing-1" });
    usageMock.getQuotaStatus.mockResolvedValue({ used: 1, limit: 3, resetsAt: null, tier: "anonymous" });
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: "existing-1", deduped: true, remaining: 2 });
    expect(usageMock.checkAndConsumeQuota).not.toHaveBeenCalled();
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("scopes the dedupe to the caller's own anonymous rows (never cross-account)", async () => {
    const res = await post({ url: "https://example.com/story" });
    expect(res.status).toBe(201);
    const calledWith = prismaMock.analysis.findFirst.mock.calls[0][0];
    expect(calledWith.where.OR).toContainEqual({ anonId: "anon-1" });
  });
});