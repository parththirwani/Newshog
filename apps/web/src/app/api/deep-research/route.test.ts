import { describe, it, expect, vi, beforeEach } from "vitest";

const gate = vi.hoisted(() => ({
  ok: true,
  calls: 0,
  user: null as { id: string; email: string; tier: string } | null,
  response: null as Response | null,
}));

vi.mock("@/lib/pro-gate", () => ({
  requireQuotaUser: () => {
    gate.calls++;
    return gate.ok
      ? Promise.resolve({ ok: true, user: gate.user })
      : Promise.resolve({ ok: false, response: gate.response });
  },
}));

const prismaMock = {
  deepResearchSession: { findUnique: vi.fn(), update: vi.fn() },
  deepResearchRun: { create: vi.fn(), delete: vi.fn() },
};
vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

let queueAdd: ReturnType<typeof vi.fn>;
vi.mock("@newshog/queue", () => ({
  getDeepResearchQueue: () => ({ add: queueAdd }),
  DEEP_RESEARCH_QUEUE: "deep-research",
}));

const { POST } = await import("./route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/deep-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function quota429() {
  return new Response(
    JSON.stringify({ error: "quota_exceeded", code: "quota_exceeded", kind: "deep_research", tier: "free", resetsAt: null, remaining: 0 }),
    { status: 429, headers: { "Content-Type": "application/json" } },
  );
}

describe("POST /api/deep-research — quota consume ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.ok = true;
    gate.calls = 0;
    gate.user = { id: "u1", email: "free@test.com", tier: "free" };
    gate.response = null;
    queueAdd = vi.fn().mockResolvedValue(undefined);
    prismaMock.deepResearchRun.create.mockResolvedValue({
      runId: "run-1",
      covers: {},
    });
    prismaMock.deepResearchSession.update.mockResolvedValue({});
  });

  it("does NOT consume quota when the prepare session is invalid (400 before the gate)", async () => {
    prismaMock.deepResearchSession.findUnique.mockResolvedValue(null);
    const res = await post({
      query: "is this story worth pitching?",
      prepareSessionId: "sess_ghost",
      clarificationAnswers: [{ id: "q1", answer: "yes" }],
    });
    expect(res.status).toBe(400);
    // The consuming gate must not run at all on a rejected session — a 400
    // must never burn a run from the caller's ceiling.
    expect(gate.calls).toBe(0);
    expect(prismaMock.deepResearchRun.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("does NOT consume quota for an already-used prepare session", async () => {
    prismaMock.deepResearchSession.findUnique.mockResolvedValue({
      id: "sess_used",
      used: true,
      answers: null,
    });
    const res = await post({
      query: "already used?",
      prepareSessionId: "sess_used",
      clarificationAnswers: [{ id: "q1", answer: "yes" }],
    });
    expect(res.status).toBe(400);
    expect(gate.calls).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("429s (consume denied) for a valid session when the user is at their deep limit", async () => {
    prismaMock.deepResearchSession.findUnique.mockResolvedValue({
      id: "sess_ok",
      used: false,
      answers: null,
    });
    gate.ok = false;
    gate.response = quota429();
    const res = await post({
      query: "capacity check",
      prepareSessionId: "sess_ok",
      clarificationAnswers: [{ id: "q1", answer: "yes" }],
    });
    expect(res.status).toBe(429);
    expect(prismaMock.deepResearchSession.update).not.toHaveBeenCalled();
    expect(prismaMock.deepResearchRun.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("consumes quota then enqueues for a valid session with allowance", async () => {
    prismaMock.deepResearchSession.findUnique.mockResolvedValue({
      id: "sess_ok",
      used: false,
      answers: null,
    });
    const res = await post({
      query: "valid run",
      prepareSessionId: "sess_ok",
      clarificationAnswers: [{ id: "q1", answer: "yes" }],
    });
    expect(res.status).toBe(202);
    expect(prismaMock.deepResearchSession.update).toHaveBeenCalledWith({
      where: { id: "sess_ok" },
      data: { answers: [{ id: "q1", question: "", answer: "yes" }] },
    });
    expect(queueAdd).toHaveBeenCalled();
  });
});