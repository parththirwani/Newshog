import { NextResponse } from "next/server";
import { prisma } from "@newshog/db";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

// Tier changes happen ONLY here, driven by Stripe webhook events — there is
// no client-settable tier field anywhere. Handled:
//   checkout.session.completed        → tier=pro, store customer/subscription/period
//   customer.subscription.updated     → refresh billing period (plan changes land here)
//   customer.subscription.deleted     → tier=free (fires at the actual cancellation
//                                        moment, honoring cancel-at-period-end from
//                                        the portal) — clears the subscription id
//   invoice.payment_failed            → NO tier change. Stripe dunning retries for
//                                        a grace period; only a real cancel reverts
//                                        the user to free.
// Stripe's current API exposes the billing cycle's current_period_start/end on
// the subscription's FIRST subscription item, not the subscription itself (the
// SDK v22 type matches the API docs on this). Read the period with a runtime
// fallback so a subscription-level shape on an older account still works.
function periodDates(sub: unknown): { start: Date; end: Date } | null {
  if (!sub || typeof sub !== "object") return null;
  const o = sub as {
    items?: { data?: unknown[] };
    current_period_start?: unknown;
    current_period_end?: unknown;
  };
  const item = (Array.isArray(o.items?.data) ? (o.items.data[0] as { current_period_start?: unknown; current_period_end?: unknown }) : null) ?? null;
  const start = o.current_period_start ?? item?.current_period_start;
  const end = o.current_period_end ?? item?.current_period_end;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "billing_not_configured", code: "billing_unconfigured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.error("[api/billing/webhook] signature verification failed:", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    // ponytail: no event-id dedup table. Stripe retries are exact duplicates
    // (same event id) and every handler below is idempotent, so a replay lands
    // on the same final state instead of double-billing or flipping tier twice.
    // Ceiling: add an events ledger if a non-idempotent event ever appears.
    switch (event.type) {
      case "checkout.session.completed": {
        const checkout = event.data.object as Stripe.Checkout.Session;
        const userId =
          (checkout.metadata?.userId as string | undefined) ||
          (checkout.client_reference_id as string | undefined);
        if (!userId) return NextResponse.json({ received: true });

        const subscriptionId = typeof checkout.subscription === "string" ? checkout.subscription : null;
        if (subscriptionId) {
          // The user may have been deleted between checkout and this event —
          // a missing row must not 500 (which would make Stripe retry forever).
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
          if (user) {
            let period: { start: Date; end: Date } | null = null;
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId);
              period = periodDates(sub);
            } catch (err) {
              console.warn("[api/billing/webhook] subscription retrieve failed", { subscriptionId, err });
            }
            await prisma.user.update({
              where: { id: userId },
              data: {
                tier: "pro",
                stripeCustomerId: typeof checkout.customer === "string" ? checkout.customer : null,
                stripeSubscriptionId: subscriptionId,
                stripeCurrentPeriodStart: period?.start ?? null,
                stripeCurrentPeriodEnd: period?.end ?? null,
              },
            });
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        // Terminal states revert to free: canceled/unpaid cover dunning
        // exhaustion; incomplete_expired means the first invoice was never
        // paid. past_due is intentionally NOT a revert — dunning is still
        // retrying, so the user keeps Pro access in the grace period.
        if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired") {
          await revertUser(sub.id);
        } else {
          const user = await userBySubscription(sub.id);
          const period = periodDates(sub);
          if (user && period) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                stripeCurrentPeriodStart: period.start,
                stripeCurrentPeriodEnd: period.end,
              },
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await revertUser(sub.id);
        break;
      }

      case "invoice.payment_failed": {
        // Intentionally no tier change — Stripe dunning retries. Log only.
        const invoice = event.data.object as { subscription?: string | null; customer?: string | null };
        console.warn("[api/billing/webhook] invoice.payment_failed", {
          subscription: invoice.subscription,
          customer: invoice.customer,
        });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[api/billing/webhook] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

async function userBySubscription(subscriptionId: string) {
  if (!subscriptionId) return null;
  return prisma.user.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
}

// Cancel/expiry → back to free. Keeps the customer + period fields for
// history/portal, clears the subscription id so it can be reused.
async function revertUser(subscriptionId: string) {
  const user = await userBySubscription(subscriptionId);
  if (!user) return;
  await prisma.user.update({
    where: { id: user.id },
    data: { tier: "free", stripeSubscriptionId: null },
  });
}