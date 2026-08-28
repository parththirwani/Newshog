import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; tier: string } | null,
}));
const stripeMock = vi.hoisted(() => ({
  configured: true,
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: () => Promise.resolve(session.user),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => (stripeMock.configured ? stripeMock : null),
  getPriceId: () => (stripeMock.configured ? "price_123" : null),
  billingConfigured: () => stripeMock.configured,
}));

function mockPost(route: () => Promise<Response>) {
  return route();
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = { id: "u1", email: "u@test.com", tier: "free" };
    stripeMock.configured = true;
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/sess" });
  });

  afterEach(() => {
    session.user = null;
  });

  it("401s an anonymous caller", async () => {
    session.user = null;
    const { POST } = await import("./route");
    const res = await mockPost(() => POST(new Request("http://localhost/api/billing/checkout", { method: "POST" })));
    expect(res.status).toBe(401);
  });

  it("503s with a clear code when billing is not configured", async () => {
    stripeMock.configured = false;
    const { POST } = await import("./route");
    const res = await mockPost(() => POST(new Request("http://localhost/api/billing/checkout", { method: "POST" })));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "billing_unconfigured" });
  });

  it("creates a $20/mo subscription checkout anchored to the user", async () => {
    const { POST } = await import("./route");
    const res = await mockPost(() => POST(new Request("http://localhost/api/billing/checkout?id=x", { method: "POST" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/sess" });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      line_items: [{ price: "price_123", quantity: 1 }],
      client_reference_id: "u1",
      metadata: { userId: "u1" },
      success_url: "http://localhost/dashboard?billing=success",
      cancel_url: "http://localhost/dashboard?billing=cancelled",
    });
  });
});