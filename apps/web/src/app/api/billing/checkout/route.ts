import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { billingConfigured, getPriceId, getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required", code: "auth_required" }, { status: 401 });
  }
  if (!billingConfigured()) {
    return NextResponse.json({ error: "billing_not_configured", code: "billing_unconfigured" }, { status: 503 });
  }

  try {
    const stripe = getStripe()!;
    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: getPriceId()!, quantity: 1 }],
      // client_reference_id + metadata both anchor the checkout to the user,
      // so the webhook can promote the right account regardless of event shape.
      client_reference_id: user.id,
      metadata: { userId: user.id },
      success_url: `${origin}/dashboard?billing=success`,
      cancel_url: `${origin}/dashboard?billing=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[api/billing/checkout] POST error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}