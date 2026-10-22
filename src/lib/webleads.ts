// Reading website form submissions (wastely.ca) into something the CRM can
// show and turn into a deal. Ported from the prototype's subView()/pick()/
// mapService(). Field keys differ by form, so lookups ignore case.

export type LeadStatus = 'new' | 'converted' | 'archived';
export type WebLead = {
  id: string;
  form: string;
  page: string;
  at: string;
  fields: Record<string, string>;
  status: LeadStatus;
  jobId: string | null;
};

export type ParsedLead = {
  name: string;
  company: string;
  location: string;
  email: string;
  phone: string;
  urgent: boolean;
  services: string[];
  range: [number, number] | null;
  rows: { key: string; value: string }[];
  isCareer: boolean;
  title: string;
};

// Shown elsewhere on the card, or internal to the website.
const HIDDEN = new Set(['confirmed', 'services', 'page', 'name', 'email', 'phone', 'company']);

export const pick = (f: Record<string, string>, ...keys: string[]) => {
  for (const key of keys) {
    const hit = Object.keys(f).find(x => x.toLowerCase() === key.toLowerCase());
    if (hit && f[hit]) return String(f[hit]).trim();
  }
  return '';
};

export const parseRange = (txt: string): [number, number] | null => {
  const m = String(txt || '').match(/\$([\d,]+)\s*[–—-]\s*\$([\d,]+)/);
  return m ? [+m[1].replace(/,/g, ''), +m[2].replace(/,/g, '')] : null;
};

const norm = (x: string) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');

// A website label → a CRM service name. Labels like "Warehouse or facility
// clear-out" match on their first 8 letters; anything else becomes custom.
const mapService = (label: string, known: string[]) => {
  const n = norm(label);
  if (!n || n.startsWith('urgent') || n.startsWith('somethingelse')) return null;
  return known.find(s => norm(s).slice(0, 8) === n.slice(0, 8)) || label.trim();
};

export function parseLead(lead: WebLead, known: string[]): ParsedLead {
  const f = lead.fields || {};
  let rest = pick(f, 'services');
  const exact = known.filter(s => {
    const i = rest.toLowerCase().indexOf(s.toLowerCase());
    if (i < 0) return false;
    rest = rest.slice(0, i) + rest.slice(i + s.length);
    return true;
  });
  const raw = rest.split(',').map(x => x.trim()).filter(Boolean);
  const urgent = raw.some(x => /^urgent/i.test(x)) || /emergency|urgent|asap/i.test(pick(f, 'when', 'timeline'));
  const services = [...new Set([...exact, ...raw.map(x => mapService(x, known)).filter((x): x is string => !!x)])];
  const name = pick(f, 'name', 'full name', 'your name');
  const company = pick(f, 'company', 'company name');
  const details = pick(f, 'details', 'project details', 'message');
  const firstSentence = details.split(/[.!?\n]/)[0].trim().slice(0, 70);
  return {
    name: name || pick(f, 'email') || 'Website visitor',
    company,
    location: pick(f, 'location', 'site location', 'address', 'property address'),
    email: pick(f, 'email', 'email address'),
    phone: pick(f, 'phone', 'phone number'),
    urgent,
    services,
    range: parseRange(pick(f, 'confirmed') || pick(f, 'estimate', 'price')),
    rows: Object.keys(f)
      .filter(key => !HIDDEN.has(key.toLowerCase()) && !key.startsWith('_') && String(f[key]).trim())
      .map(key => ({ key: key.charAt(0).toUpperCase() + key.slice(1), value: String(f[key]) })),
    isCareer: /career/i.test(lead.form),
    title: firstSentence || (services.length ? services[0] + (services.length > 1 ? ' +' + (services.length - 1) : '') : 'Website ' + lead.form.toLowerCase())
  };
}

// Phone numbers as E.164 (+16135551234) so calls and texts from Quo can be
// matched to the contact later. North American numbers get +1.
export function toE164(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 8) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return s;
}
