import { createHmac } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { admin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// POST /api/forms — website form intake for wastely.ca.
// Public by design, so it only accepts browsers on the Wastely site (or this
// app), caps size, drops honeypot hits, and rate-limits each sender. Rows go
// into web_submissions with the service role; the CRM reads them under RLS.
//
// Body: { form, page, fields: { ... } } as JSON. It may be sent as
// text/plain (no CORS preflight) or as a normal form post.

const MAX_BYTES = 32 * 1024;
const PER_MINUTE = 10;
const PER_DAY = 60;
const DEFAULT_ORIGINS = ['https://wastely.ca', 'https://www.wastely.ca', 'https://ny7fdnr79t-bit.github.io'];

function allowedOrigins(self: string) {
  const extra = (process.env.FORMS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra, self]);
}

function cors(origin: string, ok: boolean): Record<string, string> {
  return ok && origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    : { Vary: 'Origin' };
}

const reply = (status: number, body: object, headers: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });

function clean(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 40)) {
    const key = String(k).trim().slice(0, 80);
    if (!key || key.startsWith('_')) continue;
    const val = Array.isArray(v) ? v.join(', ') : v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    if (val.trim()) out[key] = val.trim().slice(0, 4000);
  }
  return out;
}

// The form name, when the website didn't say: guessed from the page.
function formFrom(page: string) {
  const p = page.toLowerCase();
  if (p.includes('career')) return 'Careers';
  if (p.includes('contact')) return 'Contact';
  return 'Quote request';
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') || '';
  const ok = allowedOrigins(req.nextUrl.origin).has(origin);
  return new NextResponse(null, { status: ok ? 204 : 403, headers: cors(origin, ok) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') || '';
  const okOrigin = allowedOrigins(req.nextUrl.origin).has(origin);
  const h = cors(origin, okOrigin);
  if (!okOrigin) return reply(403, { ok: false, error: 'Origin not allowed' }, h);

  if (Number(req.headers.get('content-length') || 0) > MAX_BYTES) return reply(413, { ok: false, error: 'Too large' }, h);
  const type = req.headers.get('content-type') || '';
  let form = '', page = '', raw: Record<string, unknown> = {};
  try {
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) if (typeof v === 'string') raw[k] = v;
      form = String(raw._form || '');
      page = req.headers.get('referer') || '';
    } else {
      const text = await req.text();
      if (text.length > MAX_BYTES) return reply(413, { ok: false, error: 'Too large' }, h);
      const body = JSON.parse(text);
      raw = body?.fields && typeof body.fields === 'object' ? body.fields : {};
      form = String(body?.form || '');
      page = String(body?.page || raw.page || '');
    }
  } catch {
    return reply(400, { ok: false, error: 'Unreadable body' }, h);
  }

  // Honeypot: bots fill hidden fields. Pretend it worked.
  if (String(raw._gotcha || raw._honey || '').trim()) return reply(200, { ok: true }, h);

  const fields = clean(raw);
  if (!Object.keys(fields).length) return reply(400, { ok: false, error: 'Missing fields' }, h);

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const ipHash = createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || 'wastely').update(ip).digest('hex').slice(0, 32);

  try {
    const db = admin();
    const now = Date.now();
    const [minute, day] = await Promise.all([
      db.from('web_submissions').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('at', new Date(now - 60_000).toISOString()),
      db.from('web_submissions').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('at', new Date(now - 86_400_000).toISOString())
    ]);
    if ((minute.count ?? 0) >= PER_MINUTE || (day.count ?? 0) >= PER_DAY) {
      return reply(429, { ok: false, error: 'Too many submissions' }, { ...h, 'Retry-After': '60' });
    }
    const { data, error } = await db.from('web_submissions').insert({
      form: (form.trim() || formFrom(page)).slice(0, 60),
      page: page.slice(0, 300),
      fields,
      ip_hash: ipHash
    }).select('id').single();
    if (error) throw error;
    return reply(200, { ok: true, id: data.id }, h);
  } catch (e) {
    console.error('[api/forms]', e instanceof Error ? e.message : e);
    return reply(500, { ok: false, error: 'Couldn’t save the submission' }, h);
  }
}
