import 'server-only';
import { admin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isToken, toAgreement, toCompany, toInvoice, type Agreement, type Company, type Invoice } from '@/lib/docs';

// A ref is either a document id (team members, checked by row level
// security) or a 64-character client token (anyone holding the link).
async function clientFor(ref: string) {
  if (isToken(ref)) return admin();
  return await createClient();
}

async function company(sb: Awaited<ReturnType<typeof clientFor>>): Promise<Company | null> {
  const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
  return data ? toCompany(data) : null;
}

export type JobInfo = { title: string; site: string; client: string };

async function jobInfo(sb: Awaited<ReturnType<typeof clientFor>>, id: string): Promise<JobInfo> {
  const { data } = await sb.from('jobs').select('title, site, client:clients(name)').eq('id', id).maybeSingle();
  const client = Array.isArray(data?.client) ? data?.client[0] : data?.client;
  return { title: data?.title || '', site: data?.site || '', client: (client as { name?: string } | null)?.name || '' };
}

export async function loadInvoice(ref: string): Promise<{ invoice: Invoice; company: Company; job: JobInfo } | null> {
  if (!isToken(ref) && !/^[0-9a-f-]{36}$/.test(ref)) return null;
  const sb = await clientFor(ref);
  const { data } = await sb.from('invoices').select('*').eq(isToken(ref) ? 'pay_token' : 'id', ref).maybeSingle();
  if (!data) return null;
  // Clients never see drafts.
  if (isToken(ref) && data.status === 'Draft') return null;
  const c = await company(sb);
  if (!c) return null;
  return { invoice: toInvoice(data), company: c, job: await jobInfo(sb, data.job_id) };
}

export type SignedInfo = { signature: string | null; signerEmail: string | null; signerIp: string | null; sha256: string | null };

export async function loadAgreement(ref: string): Promise<{ agreement: Agreement; company: Company; job: JobInfo; signed: SignedInfo } | null> {
  if (!isToken(ref) && !/^[0-9a-f-]{36}$/.test(ref)) return null;
  const sb = await clientFor(ref);
  const { data } = await sb.from('agreements').select('*').eq(isToken(ref) ? 'sign_token' : 'id', ref).maybeSingle();
  if (!data) return null;
  if (isToken(ref) && data.status === 'Draft') return null;
  const c = await company(sb);
  if (!c) return null;
  return {
    agreement: toAgreement(data), company: c, job: await jobInfo(sb, data.job_id),
    signed: { signature: data.signature, signerEmail: data.signer_email, signerIp: data.signer_ip, sha256: data.body_sha256 }
  };
}
