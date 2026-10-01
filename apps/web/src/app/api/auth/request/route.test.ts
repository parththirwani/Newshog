import { describe, it, expect, vi, beforeEach } from "vitest";

const rateLimitMock = vi.fn();
const sendLoginCodeMock = vi.fn();
const prismaMock = {
  token: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  clientIp: () => "1.2.3.4",
  AUTH_REQUEST_RATE_LIMIT: 3,
  AUTH_REQUEST_WINDOW_MS: 60 * 60 * 1000,
}));

vi.mock("@/lib/email", () => ({
  sendLoginCode: sendLoginCodeMock,
}));

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

const { POST } = await import("./route");

function post(email: string) {
  return POST(
    new Request("http://localhost/api/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

describe("POST /api/auth/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue({ ok: true, remaining: 2, retryAfter: 0 });
    prismaMock.token.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.token.create.mockResolvedValue({ id: "tok-1" });
    sendLoginCodeMock.mockResolvedValue(undefined);
  });

  it("rate limits by ip or email", async () => {
    rateLimitMock
      .mockReturnValueOnce({ ok: false, remaining: 0, retryAfter: 60 })
      .mockReturnValueOnce({ ok: true, remaining: 2, retryAfter: 0 });

    const res = await post("owner@example.com");

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(prismaMock.token.create).not.toHaveBeenCalled();
    expect(sendLoginCodeMock).not.toHaveBeenCalled();
  });

  it("stores only the hashed code and sends the plain code out of band", async () => {
    const res = await post("owner@example.com");

    expect(res.status).toBe(200);
    expect(prismaMock.token.deleteMany).toHaveBeenCalledWith({ where: { email: "owner@example.com" } });
    const stored = prismaMock.token.create.mock.calls[0][0].data;
    expect(stored.email).toBe("owner@example.com");
    expect(stored.code).toMatch(/^[a-f0-9]{64}$/);
    expect(sendLoginCodeMock).toHaveBeenCalledWith("owner@example.com", expect.stringMatching(/^\d{6}$/));
  });

  it("returns 503 in production when email delivery is not configured", async () => {
    sendLoginCodeMock.mockRejectedValue(new Error("Auth email is not configured."));

    const res = await post("owner@example.com");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "Login email is not configured." });
  });
});
