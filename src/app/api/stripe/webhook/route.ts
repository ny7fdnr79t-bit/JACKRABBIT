import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { admin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// Stripe → Developers → Webhooks: point an endpoint at /api/stripe/webhook with
// checkout.session.completed, checkout.session.async_payment_succeeded and
// checkout.session.async_payment_failed. Its signing secret is STRIPE_WEBHOOK_SECRET.
export async function POST(request: Request) {
  const st = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!st || !secret) return NextResponse.json({ error: 'Stripe isn’t configured.' }, { status: 503 });

  let event: Stripe.Event;
  try {
    event = st.webhooks.constructEvent(await request.text(), request.headers.get('stripe-signature') || '', secret);
  } catch {
    return NextResponse.json({ error: 'Bad signature.' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoice_id;
    // Card payments are paid on completion; bank debits settle later (async_payment_succeeded).
    if (invoiceId && session.payment_status === 'paid') {
      const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      const { error } = await admin().from('invoices')
        .update({ status: 'Paid', paid_via: 'Stripe', stripe_payment_id: paymentId || null, stripe_session_id: session.id })
        .eq('id', invoiceId).eq('status', 'Sent');
      // A retry from Stripe is harmless: the status filter makes this a no-op once paid.
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ received: true });
}
