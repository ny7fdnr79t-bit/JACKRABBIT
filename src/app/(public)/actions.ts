'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { admin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { isToken } from '@/lib/docs';

async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  return proto + '://' + host;
}

export type SignResult = { error?: string };

// Records the client's signature. Only an agreement in "Sent" can be signed,
// and the update is conditional on that, so a link can't be signed twice.
export async function signAgreement(token: string, form: { name: string; title: string; email: string; signature: string; agree: boolean }): Promise<SignResult> {
  if (!isToken(token)) return { error: 'This link isn’t valid.' };
  const name = form.name.trim().slice(0, 120);
  const email = form.email.trim().slice(0, 200);
  if (!name) return { error: 'Type your full name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (!form.agree) return { error: 'Tick the box to confirm you agree.' };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(form.signature) || form.signature.length > 300_000) return { error: 'Draw your signature in the box.' };

  const sb = admin();
  const { data: ag } = await sb.from('agreements').select('id, body, status').eq('sign_token', token).maybeSingle();
  if (!ag) return { error: 'This link isn’t valid.' };
  if (ag.status !== 'Sent') return { error: ag.status === 'Signed' ? 'This agreement is already signed.' : 'This agreement can no longer be signed.' };

  const h = await headers();
  const { data, error } = await sb.from('agreements').update({
    status: 'Signed',
    signed_at: new Date().toISOString(),
    signer_name: name,
    signer_title: form.title.trim().slice(0, 120) || null,
    signer_email: email,
    signer_ip: (h.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    signer_agent: (h.get('user-agent') || '').slice(0, 400) || null,
    signature: form.signature,
    body_sha256: createHash('sha256').update(ag.body, 'utf8').digest('hex')
  }).eq('id', ag.id).eq('status', 'Sent').select('id');
  if (error || !data?.length) return { error: 'We couldn’t record your signature. Please try again.' };
  redirect('/sign/' + token + '?signed=1');
}

// Sends the client to Stripe Checkout for the invoice's full amount.
export async function payInvoice(token: string) {
  const st = stripe();
  if (!st || !isToken(token)) redirect('/pay/' + token);
  const sb = admin();
  const { data: inv } = await sb.from('invoices').select('id, number, status, total_cents, bill_to, job_id').eq('pay_token', token).maybeSingle();
  if (!inv || inv.status !== 'Sent' || inv.total_cents <= 0) redirect('/pay/' + token);
  const [{ data: co }, { data: job }] = await Promise.all([
    sb.from('app_settings').select('company_name').eq('id', 1).maybeSingle(),
    sb.from('jobs').select('title').eq('id', inv.job_id).maybeSingle()
  ]);
  const base = await origin();
  const email = (inv.bill_to as { email?: string })?.email;
  const session = await st!.checkout.sessions.create({
    mode: 'payment',
    currency: 'cad',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'cad',
        unit_amount: Number(inv.total_cents),
        product_data: { name: `${co?.company_name || 'Wastely'} invoice ${inv.number}`, description: job?.title || undefined }
      }
    }],
    customer_email: email || undefined,
    client_reference_id: inv.id,
    metadata: { invoice_id: inv.id, invoice_number: inv.number },
    payment_intent_data: { description: `Invoice ${inv.number}`, metadata: { invoice_id: inv.id, invoice_number: inv.number } },
    success_url: `${base}/pay/${token}?paid=1`,
    cancel_url: `${base}/pay/${token}`
  });
  await sb.from('invoices').update({ stripe_session_id: session.id }).eq('id', inv.id);
  redirect(session.url!);
}
