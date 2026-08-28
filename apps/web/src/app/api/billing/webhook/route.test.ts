import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stripeMock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => stripeMock,
  getPriceId: () => "price_123",
  billingConfigured: () => true,
}));

vi.mock("@newshog/db", () => ({ prisma: prismaMock }));

const { POST } = await import("./route");

const KEY = "STRIPE_WEBHOOK_SECRET";

function post(payload: unknown, signature = "sig") {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return POST(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "Content-Type": "application/json" },
      body,
    }),
  );
}

function event(type: string, object: unknown) {
  return { id: "evt_1", type, data: { object } };
}

function subWithPeriod({
  id = "sub_1",
  status = "active",
  start = 1786000000,
  end = 1789000000,
  customer = "cus_1",
}: { id?: string; status?: string; start?: number; end?: number; customer?: string } = {}) {
  return {
    id,
    status,
    customer,
    items: { data: [{ current_period_start: start, current_period_end: end }] },
  };
}

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env[KEY] = "whsec_test";
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("not configured per-test");
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", email: "u@test.com", tier: "pro" });
    prismaMock.user.update.mockResolvedValue({ id: "u1" });
  });

  afterEach(() => {
    delete process.env[KEY];
  });

  it("503s when the webhook secret is not configured", async () => {
    delete process.env[KEY];
    const res = await post({});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "billing_unconfigured" });
  });

  it("400s when the Stripe signature is invalid", async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await post({});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  });

  it("checkout.session.completed promotes the user to pro and stores customer/subscription/period", async () => {
    const checkout = {
      metadata: { userId: "u1" },
      client_reference_id: "u1",
      customer: "cus_1",
      subscription: "sub_1",
    };
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" } as never);
    stripeMock.subscriptions.retrieve.mockResolvedValue(subWithPeriod({}) as never);
    stripeMock.webhooks.constructEvent.mockReturnValue(event("checkout.session.completed", checkout) as never);

    const res = await post({}, "sig");
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        tier: "pro",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripeCurrentPeriodStart: new Date(1786000000 * 1000),
        stripeCurrentPeriodEnd: new Date(1789000000 * 1000),
      },
    });
  });

  it("tolerates a checkout for a user that no longer exists (no 500, no retry-loop)", async () => {
    const checkout = {
      metadata: { userId: "ghost" },
      client_reference_id: "ghost",
      customer: "cus_1",
      subscription: "sub_1",
    };
    prismaMock.user.findUnique.mockResolvedValue(null);
    stripeMock.webhooks.constructEvent.mockReturnValue(event("checkout.session.completed", checkout) as never);

    const res = await post({}, "sig");
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("tolerates a checkout whose subscription cannot be retrieved", async () => {
    const checkout = {
      metadata: { userId: "u1" },
      client_reference_id: "u1",
      customer: "cus_1",
      subscription: "sub_deleted",
    };
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" } as never);
    stripeMock.subscriptions.retrieve.mockRejectedValue(new Error("no such subscription"));
    stripeMock.webhooks.constructEvent.mockReturnValue(event("checkout.session.completed", checkout) as never);

    const res = await post({}, "sig");
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({
        tier: "pro",
        stripeCurrentPeriodStart: null,
        stripeCurrentPeriodEnd: null,
      }),
    });
  });

  it("reverts to free on incomplete_expired via subscription.updated (initial payment never landed)", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(
      event("customer.subscription.updated", subWithPeriod({ status: "incomplete_expired" })) as never,
    );
    const res = await post({});
    expect(res.status).toBe(200);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { stripeSubscriptionId: "sub_1" } });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { tier: "free", stripeSubscriptionId: null },
    });
  });

  it("customer.subscription.updated refreshes the billing period without touching tier", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(
      event("customer.subscription.updated", subWithPeriod({ start: 1, end: 2 })) as never,
    );
    const res = await post({});
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        stripeCurrentPeriodStart: new Date(1000),
        stripeCurrentPeriodEnd: new Date(2000),
      },
    });
    // tier is NOT reset by a plain period refresh
    expect(prismaMock.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tier: "free" }) }),
    );
  });

  it("customer.subscription.deleted reverts the user to free and clears the subscription id", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(
      event("customer.subscription.deleted", subWithPeriod({ status: "canceled" })) as never,
    );
    const res = await post({});
    expect(res.status).toBe(200);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_1" },
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { tier: "free", stripeSubscriptionId: null },
    });
  });

  it("invoice.payment_failed does NOT revert the user (dunning retries first)", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(
      event("invoice.payment_failed", { subscription: "sub_1", customer: "cus_1" }) as never,
    );
    const res = await post({});
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("dunning exhaustion sequence: payment_failed then deletion only reverts on the delete event", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(
      event("invoice.payment_failed", { subscription: "sub_1", customer: "cus_1" }) as never,
    );
    await post({});
    expect(prismaMock.user.update).not.toHaveBeenCalled();

    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", email: "u@test.com", tier: "pro" });
    prismaMock.user.update.mockResolvedValue({ id: "u1" });
    stripeMock.webhooks.constructEvent.mockReturnValue(
      event("customer.subscription.deleted", subWithPeriod({ status: "canceled" })) as never,
    );
    const res = await post({});
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { tier: "free", stripeSubscriptionId: null },
    });
  });
});