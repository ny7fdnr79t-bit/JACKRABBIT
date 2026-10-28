// Invoices and agreements: types, template filling, and the small text
// format agreements are written in (# / ## headings, "- " bullets, **bold**).
// Shared by the CRM screens, the public pages and the PDF renderer.

export type InvoiceKind = 'Deposit' | 'Progress' | 'Final';
export type InvoiceStatus = 'Draft' | 'Sent' | 'Paid' | 'Void';
export type AgreementStatus = 'Draft' | 'Sent' | 'Signed' | 'Void';
export type Line = { description: string; qty: number; unit_cents: number };
export type BillTo = { client?: string; contact?: string; email?: string; phone?: string; site?: string };

export type Invoice = {
  id: string; number: string; jobId: string; kind: InvoiceKind; status: InvoiceStatus;
  issueDate: string; dueDate: string; lines: Line[]; taxRate: number; taxLabel: string;
  subtotalCents: number; taxCents: number; totalCents: number; notes: string; billTo: BillTo;
  payToken: string; sentAt: string | null; paidAt: string | null; paidVia: string | null;
};

export type Agreement = {
  id: string; number: string; jobId: string; status: AgreementStatus; title: string; body: string;
  priceCents: number; signToken: string; sentAt: string | null; viewedAt: string | null; signedAt: string | null;
  signerName: string | null; signerTitle: string | null;
};

export type Template = { id: string; name: string; body: string; isDefault: boolean };

export type Company = {
  name: string; address: string; email: string; phone: string; hstNumber: string;
  taxRate: number; taxLabel: string; paymentDays: number; depositPct: number; etransferEmail: string; footer: string;
};

export const DEFAULT_COMPANY: Company = {
  name: 'Wastely', address: '', email: 'go@wastely.ca', phone: '', hstNumber: '', taxRate: 13, taxLabel: 'HST',
  paymentDays: 15, depositPct: 30, etransferEmail: '', footer: 'Thank you for choosing Wastely.'
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toInvoice = (r: any): Invoice => ({
  id: r.id, number: r.number, jobId: r.job_id, kind: r.kind, status: r.status, issueDate: r.issue_date, dueDate: r.due_date,
  lines: Array.isArray(r.lines) ? r.lines : [], taxRate: Number(r.tax_rate), taxLabel: r.tax_label,
  subtotalCents: Number(r.subtotal_cents), taxCents: Number(r.tax_cents), totalCents: Number(r.total_cents),
  notes: r.notes || '', billTo: r.bill_to || {}, payToken: r.pay_token, sentAt: r.sent_at, paidAt: r.paid_at, paidVia: r.paid_via
});

export const toAgreement = (r: any): Agreement => ({
  id: r.id, number: r.number, jobId: r.job_id, status: r.status, title: r.title, body: r.body, priceCents: Number(r.price_cents),
  signToken: r.sign_token, sentAt: r.sent_at, viewedAt: r.viewed_at, signedAt: r.signed_at, signerName: r.signer_name, signerTitle: r.signer_title
});

export const toCompany = (r: any): Company => ({
  name: r.company_name, address: r.company_address, email: r.company_email, phone: r.company_phone, hstNumber: r.hst_number,
  taxRate: Number(r.tax_rate), taxLabel: r.tax_label, paymentDays: r.payment_days, depositPct: r.deposit_pct,
  etransferEmail: r.etransfer_email, footer: r.invoice_footer
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export const cad = (cents: number) =>
  (cents < 0 ? '−$' : '$') + (Math.abs(cents) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const lineTotal = (l: Line) => Math.round((Number(l.qty) || 0) * (Number(l.unit_cents) || 0));

// Mirrors invoices_rules() in Postgres, for live totals while editing.
export const totals = (lines: Line[], taxRate: number) => {
  const sub = lines.reduce((a, l) => a + lineTotal(l), 0);
  const tax = Math.round((sub * taxRate) / 100);
  return { sub, tax, total: sub + tax };
};

export const longDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : 'to be confirmed';

// ── Templates ──────────────────────────────────────────────────────────

export type AgreementInput = {
  company: Company;
  client: string; contact: string; email: string; site: string; title: string;
  services: string[]; priceCents: number; start: string; end: string; emergency: boolean; date: string;
};

export function templateVars(i: AgreementInput): Record<string, string> {
  const tax = Math.round((i.priceCents * i.company.taxRate) / 100);
  const deposit = Math.round((i.priceCents * i.company.depositPct) / 100);
  return {
    agreement_date: longDate(i.date),
    company_name: i.company.name,
    company_address_line: i.company.address ? ', ' + i.company.address : '',
    client_name: i.client,
    client_contact_line: i.contact ? ', represented by ' + i.contact : '',
    site: i.site || 'the site to be confirmed',
    job_title: i.title,
    services_list: i.services.length ? i.services.map(s => '- ' + s).join('\n') : '- To be confirmed',
    price: cad(i.priceCents),
    tax_label: i.company.taxLabel,
    tax_rate: String(i.company.taxRate),
    total: cad(i.priceCents + tax),
    deposit_pct: String(i.company.depositPct),
    deposit: cad(deposit),
    payment_days: String(i.company.paymentDays),
    start_date: i.start ? longDate(i.start) : 'a date to be confirmed',
    end_date: i.end ? longDate(i.end) : 'a date to be confirmed',
    emergency_clause: i.emergency
      ? 'This is an emergency 24/7 response. Wastely will mobilise as soon as reasonably possible, including outside normal hours, and after-hours labour is included in the price above.'
      : ''
  };
}

export const fillTemplate = (body: string, vars: Record<string, string>) =>
  body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m)).replace(/\n{3,}/g, '\n\n').trim();

export const PLACEHOLDERS = [
  'agreement_date', 'company_name', 'company_address_line', 'client_name', 'client_contact_line', 'site', 'job_title',
  'services_list', 'price', 'tax_label', 'tax_rate', 'total', 'deposit_pct', 'deposit', 'payment_days', 'start_date', 'end_date', 'emergency_clause'
];

// ── Body format ────────────────────────────────────────────────────────

export type Span = { text: string; bold: boolean };
export type Block = { kind: 'h1' | 'h2' | 'p' | 'li'; spans: Span[] };

const spans = (text: string): Span[] =>
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(t => (t.startsWith('**') && t.endsWith('**') ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false }));

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) blocks.push({ kind: 'p', spans: spans(para.join(' ')) }); para = []; };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); blocks.push({ kind: 'h2', spans: spans(line.slice(3)) }); }
    else if (line.startsWith('# ')) { flush(); blocks.push({ kind: 'h1', spans: spans(line.slice(2)) }); }
    else if (/^[-*] /.test(line)) { flush(); blocks.push({ kind: 'li', spans: spans(line.slice(2)) }); }
    else para.push(line);
  }
  flush();
  return blocks;
}

export const isToken = (s: string) => /^[0-9a-f]{64}$/.test(s);

// Starting lines for a new invoice, shared by the CRM screens and the assistant.
export function draftInvoiceLines(kind: InvoiceKind, j: { title: string; services: string[]; valueCents: number }, depositPct: number,
  earlier: { kind: InvoiceKind; number: string; subtotalCents: number }[]): Line[] {
  if (kind === 'Deposit') return [{ description: `Deposit (${depositPct}%) — ${j.title}`, qty: 1, unit_cents: Math.round((j.valueCents * depositPct) / 100) }];
  if (kind === 'Progress') return [{ description: `Progress billing — ${j.title}`, qty: 1, unit_cents: 0 }];
  return [
    { description: j.title + (j.services.length ? ' — ' + j.services.join(', ') : ''), qty: 1, unit_cents: j.valueCents },
    ...earlier.filter(x => x.kind !== 'Final').map(x => ({ description: `Less: ${x.kind.toLowerCase()} invoice ${x.number}`, qty: 1, unit_cents: -x.subtotalCents }))
  ];
}
