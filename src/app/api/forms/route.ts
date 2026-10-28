import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase/admin';
import { allowedOrigin, parseSubmission } from '@/lib/leads';

export const runtime = 'nodejs';

// Website forms (wastely.ca) post here. The site sends
// Content-Type: text/plain with a JSON body { form, page, fields }, so browsers
// skip the CORS preflight. Public endpoint: origin check, honeypot, size cap and
// a per-IP rate limit. Rows are written with the service role; staff read them
// through row level security on the Leads screen.

const hits = new Map<string, number[]>();
const LIMIT = 10, WINDOW_MS = 60_000;

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return recent.length > LIMIT;
}

function cors(origin: string) {
  return allowedOrigin(origin, process.env.ALLOWED_ORIGINS)
    ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' }
    : {} as Record<string, string>;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get('origin') || '') });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || '';
  const headers = cors(origin);
  if (origin && !allowedOrigin(origin, process.env.ALLOWED_ORIGINS)) return NextResponse.json({ ok: false }, { status: 403 });
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return NextResponse.json({ ok: false, error: 'Too many submissions' }, { status: 429, headers });

  const parsed = parseSubmission(await request.text());
  if (parsed.ok === 'spam') return NextResponse.json({ ok: true }, { headers });
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status, headers });

  const { data, error } = await admin().from('web_submissions')
    .insert({ form: parsed.form, page: parsed.page, fields: parsed.fields, created_by: null })
    .select('id').single();
  if (error) {
    console.error('web form insert failed', error.message);
    return NextResponse.json({ ok: false }, { status: 500, headers });
  }
  return NextResponse.json({ ok: true, id: data.id }, { headers });
}
