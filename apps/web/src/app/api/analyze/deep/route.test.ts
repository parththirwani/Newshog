import { describe, it, expect, vi, beforeEach } from "vitest";

// Controls the requireQuotaUser gate resolution. ok-based mock mirrors the
// real helper: ok:true returns a user, ok:false returns a denial Response.
vi.mock("@/lib/pro-gate", () => ({
  requireQuotaUser: () =>
    gate.ok
      ? Promise.resolve({ ok: true, user: gate.user })
      : Promise.resolve({ ok: false, response: gate.response }),
}));

const gate = vi.hoisted(() => ({
  ok: true,
  user: null as { id: string; email: string; tier: string } | null,
  response: null as Response | null,
}));

const prismaMock = {
  analysis: { create: vi.fn() },
};
vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

let queueAdd: ReturnType<typeof vi.fn>;
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

function quota429() {
  return new Response(
    JSON.stringify({ error: "quota_exceeded", code: "quota_exceeded", kind: "deep_research", tier: "free", resetsAt: null, remaining: 0 }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  );
}

function auth401() {
  return new Response(JSON.stringify({ error: "auth_required", code: "auth_required" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/analyze/deep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAdd = vi.fn();
    gate.ok = true;
    gate.user = { id: "u1", email: "free@test.com", tier: "free" };
    gate.response = null;
    prismaMock.analysis.create.mockResolvedValue({ id: "analysis-1" });
  });

  it("rejects an invalid URL before the quota gate", async () => {
    const res = await post("not-a-url");
    expect(res.status).toBe(400);
  });

  it("401s an anonymous caller (deep research requires an account)", async () => {
    gate.ok = false;
    gate.response = auth401();
    const res = await post();
    expect(res.status).toBe(401);
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
  });

  it("429s a user past their deep-research limit without enqueuing", async () => {
    gate.ok = false;
    gate.response = quota429();
    const res = await post();
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: "quota_exceeded", kind: "deep_research" });
    expect(prismaMock.analysis.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("allows a caller with remaining quota and enqueues the analysis with a deep flag", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "analysis-1", deep: true });
    expect(prismaMock.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", url: "https://example.com/story", profileId: null }),
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "analyze",
      expect.objectContaining({ analysisId: "analysis-1", deepResearch: true }),
      expect.anything(),
    );
  });
});