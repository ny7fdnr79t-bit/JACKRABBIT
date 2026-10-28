// Leads: website form submissions and logged calls/texts, before they become
// deals. Ported from the prototype's pick()/mapService()/parseRange().
// Shared by the Leads screen, the /api/forms endpoint and the assistant.

export type LeadStatus = 'new' | 'converted' | 'archived';
export type Lead = {
  id: string; form: string; page: string; at: string; fields: Record<string, string>;
  status: LeadStatus; jobId: string | null; createdBy: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toLead = (r: any): Lead => ({
  id: r.id, form: r.form, page: r.page || '', at: r.at, fields: r.fields || {}, status: r.status, jobId: r.job_id, createdBy: r.created_by ?? null
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// Where a lead came from. Website forms use their form name; logged ones use these.
export const LOGGED_SOURCES = ['Phone call', 'Text message', 'Email', 'Referral', 'Walk-in', 'Other'] as const;
export const isWebsite = (l: Lead) => !LOGGED_SOURCES.includes(l.form as (typeof LOGGED_SOURCES)[number]);

// Field names differ by form ("name" on Quote, "Name" on Contact): match case-insensitively.
export const pick = (f: Record<string, string>, ...keys: string[]) => {
  for (const key of keys) {
    const hit = Object.keys(f).find(x => x.toLowerCase() === key.toLowerCase());
    if (hit && f[hit]) return String(f[hit]);
  }
  return '';
};

const norm = (x: string) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');

// A website label like "Warehouse or facility clear-out" → the CRM's "Warehouse & Facility Clear-Outs".
export function mapService(label: string, known: string[]) {
  const n = norm(label);
  if (!n || n.startsWith('urgent') || n.startsWith('somethingelse')) return null;
  return known.find(s => norm(s) === n) || known.find(s => norm(s).slice(0, 8) === n.slice(0, 8)) || label.trim();
}

// "$8,000 – $12,000" → [8000, 12000]
export const parseRange = (txt: string) => {
  const m = String(txt || '').match(/\$([\d,]+)\s*[–-]\s*\$([\d,]+)/);
  return m ? [+m[1].replace(/,/g, ''), +m[2].replace(/,/g, '')] as const : null;
};

const HIDE = new Set(['confirmed', 'services', 'name', 'email', 'phone', 'company', 'page', 'logged by']);

export function leadView(l: Lead, knownServices: string[]) {
  const f = l.fields;
  let rest = String(pick(f, 'services'));
  const exact = knownServices.filter(sv => {
    const i = rest.toLowerCase().indexOf(sv.toLowerCase());
    if (i < 0) return false;
    rest = rest.slice(0, i) + rest.slice(i + sv.length);
    return true;
  });
  const raw = rest.split(',').map(x => x.trim()).filter(Boolean);
  const services = [...new Set([...exact, ...raw.map(x => mapService(x, knownServices)).filter((x): x is string => !!x)])];
  const urgent = raw.some(x => /^urgent/i.test(x)) || /emergency|urgent|asap/i.test(pick(f, 'when', 'timeline'));
  const range = parseRange(pick(f, 'confirmed'));
  const name = pick(f, 'name', 'full name') || [pick(f, 'first name', 'first_name'), pick(f, 'last name')].filter(Boolean).join(' ') || 'No name given';
  const company = pick(f, 'company');
  const location = pick(f, 'location', 'site location', 'address');
  const details = pick(f, 'details', 'project details', 'message', 'what they need');
  return {
    name, company, location, details,
    email: pick(f, 'email'), phone: pick(f, 'phone'),
    urgent, services, range,
    rows: Object.keys(f).filter(k => !HIDE.has(k.toLowerCase()) && f[k]).map(k => ({ key: k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '), value: String(f[k]) })),
    loggedBy: pick(f, 'logged by')
  };
}

// What the New deal dialog is pre-filled with when a lead becomes a deal.
export function dealFromLead(l: Lead, knownServices: string[], minJob: number) {
  const v = leadView(l, knownServices);
  const title = (v.details || v.services.join(', ') || 'New job').split(/[.!?\n]/)[0].slice(0, 70).trim();
  return {
    client: v.company || v.name,
    clientType: v.company ? 'Commercial' : 'Private owner',
    title,
    value: String(v.range ? Math.max(minJob, Math.round((v.range[0] + v.range[1]) / 2 / 100) * 100) : minJob),
    emergency: v.urgent,
    services: v.services,
    contact: { name: v.name === 'No name given' ? '' : v.name, email: v.email, phone: v.phone },
    site: v.location,
    source: isWebsite(l) ? 'Website · ' + l.form : l.form
  };
}

// ── The public endpoint's input checks (kept pure so they're testable) ──

export const MAX_BODY = 32_000;

export function parseSubmission(raw: string): { ok: true; form: string; page: string; fields: Record<string, string> } | { ok: false; status: number; error: string } | { ok: 'spam' } {
  if (raw.length > MAX_BODY) return { ok: false, status: 413, error: 'Too large' };
  let b: unknown;
  try { b = JSON.parse(raw); } catch { return { ok: false, status: 400, error: 'Not JSON' }; }
  if (!b || typeof b !== 'object') return { ok: false, status: 400, error: 'Missing body' };
  const body = b as { form?: unknown; page?: unknown; fields?: unknown };
  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) return { ok: false, status: 400, error: 'Missing fields' };
  const input = body.fields as Record<string, unknown>;
  if (input._gotcha) return { ok: 'spam' }; // honeypot: pretend success
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input).slice(0, 40)) {
    if (k.startsWith('_')) continue;
    fields[String(k).slice(0, 80)] = (Array.isArray(v) ? v.join(', ') : String(v ?? '')).slice(0, 4000);
  }
  if (!Object.values(fields).some(v => v.trim())) return { ok: false, status: 400, error: 'Empty form' };
  return { ok: true, form: String(body.form || 'Website form').slice(0, 60), page: String(body.page || '').slice(0, 300), fields };
}

export function allowedOrigin(origin: string, extra = '') {
  if (!origin) return false;
  const list = ['https://wastely.ca', 'https://www.wastely.ca', ...extra.split(',').map(s => s.trim()).filter(Boolean)];
  return list.includes(origin) || /^https:\/\/[a-z0-9-]+\.github\.io$/.test(origin);
}
