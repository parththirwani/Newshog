import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let sessionUser: { id: string; email: string; tier: string } | null = null;
let gatingEnabled = true;
let queueAdd: ReturnType<typeof vi.fn>;

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(sessionUser),
}));

vi.mock("@/lib/pro-gate", () => ({
  isProUser: (user: { tier?: string } | null) => (gatingEnabled ? user?.tier === "pro" : true),
  proDeniedResponse: () =>
    new Response(JSON.stringify({ error: "Deep Research is a Pro feature.", code: "pro_required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
}));

const prismaMock = {
  analysis: { create: vi.fn() },
};
vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

vi.mock("@newshog/queue", () => ({
  getAnalyzeQueue: () => ({ add: queueAdd }),
}));

const { POST } = await import("./route");

function post(url = "https://example.com/story") {
  return POST(
    new Request("http://localhost/api/analyze/deep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
}

describe("POST /api/analyze/deep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAdd = vi.fn();
  });
  afterEach(() => {
    sessionUser = null;
    gatingEnabled = true;
  });

  it("403s a non-pro user (with an upgrade signal) when gating is on", async () => {
    sessionUser = { id: "u1", email: "free@test.com", tier: "free" };
    gatingEnabled = true;
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "pro_required" });
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("allows a pro user and enqueues the analysis with a deep flag", async () => {
    sessionUser = { id: "u2", email: "pro@test.com", tier: "pro" };
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
    const res = await post();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "analysis-1", deep: true });
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u2", url: "https://example.com/story" }),
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "analyze",
      expect.objectContaining({ analysisId: "analysis-1", deepResearch: true }),
      expect.anything(),
    );
  });

  it("permits non-pro when gating is disabled (env off, dev/test mode)", async () => {
    sessionUser = { id: "u3", email: "dev@test.com", tier: "free" };
    gatingEnabled = false;
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-3" });
    const res = await post();
    expect(res.status).toBe(201);
  });

  it("rejects an invalid URL", async () => {
    sessionUser = { id: "u4", email: "x@test.com", tier: "pro" };
    const res = await post("not-a-url");
    expect(res.status).toBe(400);
  });
});