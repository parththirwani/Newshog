import { describe, it, expect, vi, beforeEach } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; tier: string } | null,
}));
const anon = vi.hoisted(() => ({ id: "anon-1", cookie: null as Record<string, unknown> | null }));
const usageMock = vi.hoisted(() => ({
  getQuotaStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(session.user),
  getAnonId: () => Promise.resolve({ id: anon.id, cookie: anon.cookie }),
}));

vi.mock("@/lib/usage", () => ({
  getQuotaStatus: usageMock.getQuotaStatus,
  proGatingEnabled: () => true,
}));

const { GET } = await import("./route");

function fmtQuota(used: number, limit: number, resetsAt: Date | null, tier: string) {
  return { used, limit, resetsAt, tier };
}

describe("GET /api/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
    anon.id = "anon-1";
    anon.cookie = null;
  });

  it("reports anonymous usage with lifetime limits and an anon id (cookie minted on first visit)", async () => {
    anon.cookie = { name: "anon_id", value: "anon-1.sig" } as unknown as Record<string, unknown>;
    usageMock.getQuotaStatus
      .mockResolvedValueOnce(fmtQuota(1, 3, null, "anonymous"))
      .mockResolvedValueOnce(fmtQuota(0, 0, null, "anonymous"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      signedIn: false,
      tier: "anonymous",
      pro: false,
      quickSearch: { used: 1, limit: 3, resetsAt: null },
      deepResearch: { used: 0, limit: 0, resetsAt: null },
    });
    expect(res.headers.getSetCookie().join(";")).toContain("anon_id=");
  });

  it("reports a logged-in free user's daily limits", async () => {
    session.user = { id: "u1", email: "u@test.com", tier: "free" };
    const tomorrow = new Date("2099-01-02T00:00:00Z");
    usageMock.getQuotaStatus
      .mockResolvedValueOnce(fmtQuota(3, 10, tomorrow, "free"))
      .mockResolvedValueOnce(fmtQuota(1, 1, tomorrow, "free"));
    const res = await GET();
    const body = await res.json();
    expect(body).toMatchObject({
      signedIn: true,
      email: "u@test.com",
      tier: "free",
      pro: false,
      quickSearch: { used: 3, limit: 10, resetsAt: "2099-01-02T00:00:00.000Z" },
      deepResearch: { used: 1, limit: 1, resetsAt: "2099-01-02T00:00:00.000Z" },
    });
    expect(usageMock.getQuotaStatus).toHaveBeenCalledTimes(2);
  });

  it("marks pro users and reports the billing-cycle ceiling", async () => {
    session.user = { id: "u2", email: "p@test.com", tier: "pro" };
    const periodEnd = new Date("2099-02-10T00:00:00Z");
    usageMock.getQuotaStatus
      .mockResolvedValueOnce(fmtQuota(5, 250, periodEnd, "pro"))
      .mockResolvedValueOnce(fmtQuota(2, 50, periodEnd, "pro"));
    const res = await GET();
    const body = await res.json();
    expect(body).toMatchObject({
      signedIn: true,
      tier: "pro",
      pro: true,
      quickSearch: { used: 5, limit: 250, resetsAt: "2099-02-10T00:00:00.000Z" },
      deepResearch: { used: 2, limit: 50, resetsAt: "2099-02-10T00:00:00.000Z" },
    });
  });
});