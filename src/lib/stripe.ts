import 'server-only';
import Stripe from 'stripe';

let client: Stripe | null = null;

// Null when STRIPE_SECRET_KEY isn't set: invoices then offer e-transfer and cheque only.
export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}
