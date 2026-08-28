import Stripe from "stripe";

// Stripe is env-driven: no secret key / price configured means the billing
// routes answer 503 billing_unconfigured instead of crashing. The $20/mo
// recurring price (STRIPE_PRICE_ID) is created once in the Stripe dashboard.

let stripe: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (stripe !== undefined) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  stripe = key ? new Stripe(key) : null;
  return stripe;
}

export function getPriceId(): string | null {
  return process.env.STRIPE_PRICE_ID || null;
}

export function billingConfigured(): boolean {
  return Boolean(getStripe() && getPriceId());
}