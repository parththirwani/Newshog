import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { billingConfigured, getStripe } from "@/lib/stripe";
import { prisma } from "@newshog/db";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required", code: "auth_required" }, { status: 401 });
  }
  if (!billingConfigured()) {
    return NextResponse.json({ error: "billing_not_configured", code: "billing_unconfigured" }, { status: 503 });
  }

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { stripeCustomerId: true },
    });
    if (!row?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No active subscription for this account.", code: "no_subscription" },
        { status: 400 },
      );
    }

    const stripe = getStripe()!;
    const origin = new URL(request.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripeCustomerId,
      return_url: `${origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[api/billing/portal] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}