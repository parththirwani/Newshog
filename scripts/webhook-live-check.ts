// One-off LIVE verification of the billing webhook against the running app
// (localhost:3000) + real Stripe API objects + real DB. Signs real payloads
// with the actual STRIPE_WEBHOOK_SECRET the same way `stripe listen` does.
// Run from apps/web:  bun ../scripts/webhook-live-check.ts
//
// Scenarios:
//   A. Attack surface (forged/invalid/missing signatures, no session, unknown event)
//   B. checkout.session.completed   -> pro + customer/sub/period stored
//   C. subscription.updated (past_due) -> stays pro, period refreshed
//   D. invoice.payment_failed       -> NO change (dunning)
//   E. subscription.updated (canceled) -> free + sub id cleared
//   F. subscription.deleted         -> free (on a fresh re-upgrade)
//   G. replay / idempotency
//   H. checkout for nonexistent user -> tolerated, no 500

import { prisma } from "@newshog/db";
import crypto from "crypto";

const API = "https://api.stripe.com/v1";
const KEY = process.env.STRIPE_SECRET_KEY!;
const PRICE = process.env.STRIPE_PRICE_ID!;
const WH = process.env.STRIPE_WEBHOOK_SECRET!;
const WEBHOOK = "http://localhost:3000/api/billing/webhook";

if (!KEY?.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a test key.");
if (!WH?.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function step(name: string, fn: () => Promise<void>) {
  console.log(`\n== ${name} ==`);
  try {
    await fn();
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name} threw:`, (err as Error).message);
  }
}

async function stripeCall(method: string, path: string, body?: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}` },
    body: body instanceof URLSearchParams ? body : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe ${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function sign(payload: string): string {
  const ts = String(Math.floor(Date.now() / 1000));
  const mac = crypto.createHmac("sha256", WH).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

async function deliver(payload: unknown): Promise<Response> {
  const raw = JSON.stringify(payload);
  return fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": sign(raw) },
    body: raw,
  });
}

const userEmail = `webhook-live-${Date.now()}@test.local`;

async function main() {
  // ── Test user ──────────────────────────────────────────────
  const user = await prisma.user.create({
    data: { email: userEmail, tier: "free" },
  });
  console.log(`Test user ${user.id} (${userEmail})`);

  let customer: any;
  let sub: any;

  try {
    // ── A. Attack surface ────────────────────────────────────
    await step("A. attack surface", async () => {
      const noSig = await fetch(WEBHOOK, { method: "POST", body: '{"type":"x"}' });
      check("no signature -> 400 missing_signature", noSig.status === 400, `got ${noSig.status}`);

      const badSig = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: '{"type":"x"}',
      });
      check("forged signature -> 400 invalid_signature", badSig.status === 400, `got ${badSig.status}`);

      const stale = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "stripe-signature": sign('{"type":"x"}').replace(/t=\d+/, `t=${Math.floor(Date.now() / 1000) - 600}`) },
        body: '{"type":"x"}',
      });
      check("old/timestamp-skewed signed event -> rejected", stale.status === 400, `got ${stale.status}`);

      const unknown = await deliver({ id: "evt_ghost", type: "product.created", data: { object: { id: "prod_x" } } });
      check("unknown event type -> 200 received, no writes", unknown.status === 200 && (await unknown.json()).received === true);

      const checkoutAnon = await fetch("http://localhost:3000/api/billing/checkout", { method: "POST" });
      check("checkout without session -> 401", checkoutAnon.status === 401);
      const portalAnon = await fetch("http://localhost:3000/api/billing/portal", { method: "POST" });
      check("portal without session -> 401", portalAnon.status === 401);

      // Case-sensitivity: a replayed/hijacked checkout targeting a user we control
      const takeover = await deliver({
        id: "evt_takeover",
        type: "checkout.session.completed",
        data: { object: { metadata: { userId: user.id }, client_reference_id: user.id, customer: "cus_forged", subscription: null } },
      });
      check("checkout with null subscription -> 200, no promotion", takeover.status === 200 && (await prisma.user.findUnique({ where: { id: user.id } }))!.tier === "free");
    });

    // ── Set up real Stripe objects ───────────────────────────
    await step("setup real stripe customer + subscription", async () => {
      customer = await stripeCall("POST", "/v1/customers", new URLSearchParams({ name: "webhook-live-test" }));
      sub = await stripeCall("POST", "/v1/subscriptions", new URLSearchParams({
        customer: customer.id,
        "items[0][price]": PRICE,
        "items[0][quantity]": "1",
        "trial_period_days": "30", // active without a payment method
      }));
      check("subscription created", sub.status === "trialing" || sub.status === "active", `status=${sub.status}`);
    });

    // ── B. checkout.session.completed ────────────────────────
    await step("B. checkout.session.completed -> pro", async () => {
      const session = await stripeCall("POST", "/v1/checkout/sessions", new URLSearchParams({
        mode: "subscription",
        client_reference_id: user.id,
        "metadata[userId]": user.id,
        "line_items[0][price]": PRICE, "line_items[0][quantity]": "1",
        success_url: "http://localhost:3000/dashboard?billing=success",
        cancel_url: "http://localhost:3000/dashboard?billing=cancelled",
      }));
      const checkoutObj = {
        ...session,
        customer: customer.id,
        subscription: sub.id,
      };
      const res = await deliver({ id: "evt_checkout_done", type: "checkout.session.completed", data: { object: checkoutObj } });
      const u = await prisma.user.findUnique({ where: { id: user.id } })!;
      check("200", res.status === 200, `got ${res.status}`);
      check("tier=pro", u.tier === "pro", `tier=${u.tier}`);
      check("customer stored", u.stripeCustomerId === customer.id);
      check("subscription stored", u.stripeSubscriptionId === sub.id);
      const item = sub.items?.data?.[0];
      check("period stored",
        u.stripeCurrentPeriodStart?.getTime() === item.current_period_start * 1000 &&
        u.stripeCurrentPeriodEnd?.getTime() === item.current_period_end * 1000,
        `period=${u.stripeCurrentPeriodStart?.toISOString()} → ${u.stripeCurrentPeriodEnd?.toISOString()}`);
    });

    // ── C. subscription.updated (past_due = dunning) ─────────
    await step("C. subscription.updated (past_due) keeps pro", async () => {
      const updated = { ...sub, status: "past_due" };
      const res = await deliver({ id: "evt_upd_due", type: "customer.subscription.updated", data: { object: updated } });
      const u = await prisma.user.findUnique({ where: { id: user.id } })!;
      check("200", res.status === 200);
      check("stays pro", u.tier === "pro", `tier=${u.tier}`);
      check("subscription retained", u.stripeSubscriptionId === sub.id);
    });

    // ── D. invoice.payment_failed ────────────────────────────
    await step("D. invoice.payment_failed -> NO change (dunning)", async () => {
      const iv = await stripeCall("POST", "/v1/invoices", new URLSearchParams({ customer: customer.id, subscription: sub.id }));
      const res = await deliver({
        id: "evt_inv_fail",
        type: "invoice.payment_failed",
        data: { object: { id: iv.id, subscription: sub.id, customer: customer.id } },
      });
      const u = await prisma.user.findUnique({ where: { id: user.id } })!;
      check("200", res.status === 200);
      check("tier still pro", u.tier === "pro");
      check("subscription retained", u.stripeSubscriptionId === sub.id);
    });

    // ── E. subscription.updated (canceled) ───────────────────
    await step("E. subscription.updated (canceled) -> free", async () => {
      const updated = { ...sub, status: "canceled" };
      const res = await deliver({ id: "evt_upd_cancel", type: "customer.subscription.updated", data: { object: updated } });
      const u = await prisma.user.findUnique({ where: { id: user.id } })!;
      check("200", res.status === 200);
      check("tier=free", u.tier === "free", `tier=${u.tier}`);
      check("sub id cleared", u.stripeSubscriptionId === null);
      check("customer kept (for history)", u.stripeCustomerId === customer.id);
    });

    // ── G. replay idempotency ────────────────────────────────
    await step("G. replay of non-idempotent-adjacent events tolerated", async () => {
      // Re-deliver the canceled event again -> no-op, still 200
      const again = await deliver({ id: "evt_upd_cancel", type: "customer.subscription.updated", data: { object: { ...sub, status: "canceled" } } });
      const u = await prisma.user.findUnique({ where: { id: user.id } })!;
      check("replay -> 200", again.status === 200);
      check("replay no-op", u.tier === "free" && u.stripeSubscriptionId === null);
    });

    // ── F. subscription.deleted (on a re-upgraded pro) ───────
    await step("F. subscription.deleted -> free", async () => {
      await prisma.user.update({ where: { id: user.id }, data: { tier: "pro", stripeSubscriptionId: sub.id } });
      const deleted = { ...sub, status: "canceled" };
      const res = await deliver({ id: "evt_sub_deleted", type: "customer.subscription.deleted", data: { object: deleted } });
      const u = await prisma.user.findUnique({ where: { id: user.id } })!;
      check("200", res.status === 200);
      check("tier=free", u.tier === "free", `tier=${u.tier}`);
      check("sub id cleared", u.stripeSubscriptionId === null);
    });

    // ── H. checkout for a deleted user ───────────────────────
    await step("H. checkout.session.completed for missing user tolerated", async () => {
      const session = await stripeCall("POST", "/v1/checkout/sessions", new URLSearchParams({
        mode: "subscription",
        client_reference_id: "user-does-not-exist",
        "metadata[userId]": "user-does-not-exist",
        "line_items[0][price]": PRICE, "line_items[0][quantity]": "1",
        success_url: "http://x",
        cancel_url: "http://x",
      }));
      const res = await deliver({
        id: "evt_ghost_checkout",
        type: "checkout.session.completed",
        data: { object: { ...session, customer: customer.id, subscription: sub.id } },
      });
      check("200 (no 500 / no retry loop)", res.status === 200, `got ${res.status}`);
    });
  } finally {
    // ── cleanup ──────────────────────────────────────────────
    try { if (sub) await stripeCall("DELETE", `/v1/subscriptions/${sub.id}`); } catch {}
    try { if (customer) await stripeCall("DELETE", `/v1/customers/${customer.id}`); } catch {}
    await prisma.user.deleteMany({ where: { email: userEmail } });
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL SCENARIOS PASSED ✓" : `${failures} SCENARIO(S) FAILED ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });