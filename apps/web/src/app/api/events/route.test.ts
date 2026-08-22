import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  event: { create: vi.fn() },
};

const rateGate = vi.hoisted(() => ({
  rateLimit: vi.fn(() => ({ ok: true, remaining: 10, retryAfter: 0 })),
}));

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimit: rateGate.rateLimit,
  };
});

const { POST } = await import("./route");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateGate.rateLimit.mockReturnValue({ ok: true, remaining: 10, retryAfter: 0 });
  });

  it("records a whitelisted event", async () => {
    prismaMock.event.create.mockResolvedValue({});
    const response = await POST(
      makeRequest({ name: "pitch_copied", props: { angle: "A" } }),
    );
    expect(response.status).toBe(201);
    expect(prismaMock.event.create).toHaveBeenCalledWith({
      data: { name: "pitch_copied", props: { angle: "A" } },
    });
  });

  it("rejects unknown event names", async () => {
    const response = await POST(makeRequest({ name: "hacker_event" }));
    expect(response.status).toBe(400);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("rejects missing request body", async () => {
    const response = await POST(new Request("http://localhost/api/events", { method: "POST" }));
    expect(response.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    rateGate.rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfter: 12 });
    const response = await POST(makeRequest({ name: "pitch_copied" }));
    expect(response.status).toBe(429);
    expect(prismaMock.event.create).not.toHaveBeenCalled();
  });

  it("records only pruned primitive props", async () => {
    prismaMock.event.create.mockResolvedValue({});
    await POST(
      makeRequest({ name: "result_shared", props: { ok: true, list: [1], nested: { a: 1 }, note: "hi" } }),
    );
    const call = prismaMock.event.create.mock.calls[0][0].data;
    expect(call.props).toEqual({ ok: true, note: "hi" });
  });
});