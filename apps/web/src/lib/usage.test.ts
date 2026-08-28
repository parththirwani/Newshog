import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn() },
  usageCounter: { findUnique: vi.fn() },
  anonymousUsage: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock("@newshog/db", () => ({
  prisma: prismaMock,
  UsageKind: { quick_search: "quick_search", deep_research: "deep_research" },
}));

const { checkAndConsumeQuota, getQuotaStatus } = await import("./usage");

const GATING = "ENABLE_PRO_GATING";

function before() {
  vi.clearAllMocks();
  // Default to gating ON so deep-research tests exercise the consume path;
  // the dedicated dev-bypass describe turns it off explicitly.
  process.env[GATING] = "true";
}

// Captures the interpolated values of the atomic upsert tagged-template.
// For usage_counters: [id, userId, kind, periodStart, periodEnd, limit]
// For anonymous_usage: [id, anonId, kind, limit]
function upsertValues() {
  return prismaMock.$queryRaw.mock.calls[0].slice(1);
}

function freeUser() {
  return { id: "u1", tier: "free", stripeCurrentPeriodStart: null, stripeCurrentPeriodEnd: null };
}

describe("anonymous", () => {
  beforeEach(before);

  it("consumes anonymous quick search against the lifetime limit of 3", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const res = await checkAndConsumeQuota({ anonId: "anon-1" }, "quick_search");
    expect(res).toMatchObject({ allowed: true, remaining: 2, resetsAt: null, tier: "anonymous" });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    // [id, anonId, kind, limit]
    const v = upsertValues();
    expect(v[1]).toBe("anon-1");
    expect(v[2]).toBe("quick_search");
    expect(v[3]).toBe(3);
  });

  it("denies anonymous once the atomic upsert is filtered by the limit", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const res = await checkAndConsumeQuota({ anonId: "anon-1" }, "quick_search");
    expect(res).toMatchObject({ allowed: false, remaining: 0, tier: "anonymous" });
  });

  it("never allows anonymous deep research and does not touch the DB", async () => {
    const res = await checkAndConsumeQuota({ anonId: "anon-1" }, "deep_research");
    expect(res).toMatchObject({ allowed: false, remaining: 0, tier: "anonymous" });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("reports anonymous status without consuming", async () => {
    prismaMock.anonymousUsage.findUnique.mockResolvedValue({ count: 1 });
    const status = await getQuotaStatus({ anonId: "anon-1" }, "quick_search");
    expect(status).toMatchObject({ used: 1, limit: 3, resetsAt: null, tier: "anonymous" });
  });
});

describe("checkAndConsumeQuota — free (daily UTC boundary)", () => {
  beforeEach(before);

  it("consumes quick search against 10/day with a UTC-midnight period", async () => {
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1 }]);

    const res = await checkAndConsumeQuota({ userId: "u1" }, "quick_search");
    expect(res).toMatchObject({ allowed: true, remaining: 9, tier: "free" });

    const v = upsertValues();
    const start = v[3] as Date;
    const end = v[4] as Date;
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(v[5]).toBe(10);
    expect(res.resetsAt).toEqual(end);
  });

  it("denies at 10/day", async () => {
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.$queryRaw.mockResolvedValue([]);
    const res = await checkAndConsumeQuota({ userId: "u1" }, "quick_search");
    expect(res).toMatchObject({ allowed: false, remaining: 0, tier: "free" });
    expect(res.resetsAt).not.toBeNull();
  });

  it("allows exactly 1 deep research per day", async () => {
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const res = await checkAndConsumeQuota({ userId: "u1" }, "deep_research");
    expect(res).toMatchObject({ allowed: true, remaining: 0, tier: "free" });
    // the tuple limit for deep is 1 — after one consume, remaining is 0
    const v = upsertValues();
    expect(v[5]).toBe(1);
  });

  it("reads status without making contact with the atomic upsert", async () => {
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.usageCounter.findUnique.mockResolvedValue({ count: 3 });
    const status = await getQuotaStatus({ userId: "u1" }, "quick_search");
    expect(status).toMatchObject({ used: 3, limit: 10, tier: "free" });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("checkAndConsumeQuota — pro (billing cycle)", () => {
  beforeEach(before);

  it("anchors the period to the Stripe subscription cycle, limit 250", async () => {
    const start = new Date("2026-08-10T00:00:00Z");
    const end = new Date("2026-09-10T00:00:00Z");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      tier: "pro",
      stripeCurrentPeriodStart: start,
      stripeCurrentPeriodEnd: end,
    });
    prismaMock.$queryRaw.mockResolvedValue([{ count: 5 }]);
    const res = await checkAndConsumeQuota({ userId: "u1" }, "quick_search");
    expect(res).toMatchObject({ allowed: true, remaining: 245, tier: "pro" });
    const v = upsertValues();
    expect(v[3]).toEqual(start);
    expect(v[4]).toEqual(end);
    expect(v[5]).toBe(250);
  });

  it("falls back to the calendar month when the Stripe anchor is missing (never silently unlocks)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      tier: "pro",
      stripeCurrentPeriodStart: null,
      stripeCurrentPeriodEnd: null,
    });
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const res = await checkAndConsumeQuota({ userId: "u1" }, "deep_research");
    expect(res).toMatchObject({ allowed: true, tier: "pro" });
    const v = upsertValues();
    const start = v[3] as Date;
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(v[5]).toBe(50);
  });
});

describe("ENABLE_PRO_GATING dev bypass", () => {
  const setNodeEnv = (v: string | undefined) => {
    Object.defineProperty(process.env, "NODE_ENV", { value: v, configurable: true, writable: true, enumerable: true });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env[GATING];
    setNodeEnv(undefined);
  });

  it("allows deep research WITHOUT consuming when the env switch is off", async () => {
    setNodeEnv("test");
    delete process.env[GATING];
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.usageCounter.findUnique.mockResolvedValue({ count: 0 });
    const res = await checkAndConsumeQuota({ userId: "u1" }, "deep_research");
    expect(res.allowed).toBe(true);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("consumes deep research when gating is on (export mode)", async () => {
    process.env[GATING] = "true";
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const res = await checkAndConsumeQuota({ userId: "u1" }, "deep_research");
    expect(res.allowed).toBe(true);
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
  });

  it("prod-safe default: unset flag ENFORCES in production (no silent unlimited spend)", async () => {
    setNodeEnv("production");
    delete process.env[GATING];
    prismaMock.user.findUnique.mockResolvedValue(freeUser());
    prismaMock.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const res = await checkAndConsumeQuota({ userId: "u1" }, "deep_research");
    expect(res.allowed).toBe(true);
    expect(prismaMock.$queryRaw).toHaveBeenCalled();

    // At the ceiling it denies instead of silently bypassing.
    prismaMock.$queryRaw.mockResolvedValue([]);
    const denied = await checkAndConsumeQuota({ userId: "u1" }, "deep_research");
    expect(denied.allowed).toBe(false);
  });
});