import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; tier: string } | null,
}));
const stripeMock = vi.hoisted(() => ({
  configured: true,
  billingPortal: { sessions: { create: vi.fn() } },
}));
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(session.user),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => (stripeMock.configured ? stripeMock : null),
  getPriceId: () => (stripeMock.configured ? "price_123" : null),
  billingConfigured: () => stripeMock.configured,
}));

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = { id: "u1", email: "u@test.com", tier: "free" };
    stripeMock.configured = true;
    prismaMock.user.findUnique.mockResolvedValue({ stripeCustomerId: "cus_123" });
    stripeMock.billingPortal.sessions.create.mockResolvedValue({ url: "https://billing.stripe.com/p/sess" });
  });

  afterEach(() => {
    session.user = null;
  });

  it("401s an anonymous caller", async () => {
    session.user = null;
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/billing/portal", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("400s when the account has no Stripe customer yet", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ stripeCustomerId: null });
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/billing/portal", { method: "POST" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "no_subscription" });
  });

  it("creates a billing portal session for the user's customer and returns the url", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/billing/portal?x=1", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe.com/p/sess" });
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "http://localhost/dashboard",
    });
  });
});