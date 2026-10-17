'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, X, PaperPlaneTilt, CheckCircle, Prohibit, Trash, FloppyDisk } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { cad, lineTotal, totals, type BillTo, type Invoice, type Line } from '@/lib/docs';
import { fmtD } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { CopyLinkButton, isOverdue, PdfLink, StatusTag } from '@/components/docs-ui';
import { useOpenJob } from '@/lib/useOpenJob';

type Draft = Pick<Invoice, 'issueDate' | 'dueDate' | 'lines' | 'taxRate' | 'notes' | 'billTo'>;
const draftOf = (x: Invoice): Draft => ({ issueDate: x.issueDate, dueDate: x.dueDate, lines: x.lines, taxRate: x.taxRate, notes: x.notes, billTo: x.billTo });

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { ready, invoices, jobs, updateInvoice, deleteInvoice } = useCrm();
  const router = useRouter();
  const openJob = useOpenJob();
  const inv = invoices.find(x => x.id === id);
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [paidVia, setPaidVia] = useState('E-transfer');

  useEffect(() => { if (inv && !d) setD(draftOf(inv)); }, [inv, d]);
  if (!ready) return <Loading />;
  if (!inv || !d) return <div className="page"><Link href="/invoices" className="btn btn-ghost"><ArrowLeft />Invoices</Link><div className="meta">Invoice not found.</div></div>;

  const job = jobs.find(j => j.id === inv.jobId);
  const editable = inv.status === 'Draft';
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(inv));
  const t = totals(d.lines, d.taxRate);
  const setLine = (i: number, patch: Partial<Line>) => setD({ ...d, lines: d.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const setBill = (patch: Partial<BillTo>) => setD({ ...d, billTo: { ...d.billTo, ...patch } });
  const act = async (f: () => Promise<boolean>) => { setBusy(true); const ok = await f(); setBusy(false); return ok; };
  const save = () => act(() => updateInvoice(inv.id, d));

  const send = async () => {
    if (!d.lines.length || t.total <= 0) return alert('Add at least one line with an amount before sending.');
    if (!d.billTo.email && !confirm('There’s no client email on this invoice. Send anyway?')) return;
    if (dirty && !(await save())) return;
    if (await act(() => updateInvoice(inv.id, { status: 'Sent' }))) {
      await navigator.clipboard.writeText(window.location.origin + '/pay/' + inv.payToken).catch(() => {});
      alert('Marked as sent. The client’s payment link is copied, so paste it into your email to ' + (d.billTo.email || 'the client') + '.');
    }
  };

  return (
    <div className="page page-narrow" style={{ maxWidth: 1040 }}>
      <Link href="/invoices" className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 13 }}><ArrowLeft />Invoices</Link>
      <header className="page-head">
        <div>
          <div className="meta">{inv.kind} invoice{job ? ' · ' : ''}{job && <button className="link-btn" onClick={() => openJob(job.id, '/pipeline')}>{job.client} — {job.title}</button>}</div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{inv.number}<StatusTag status={inv.status} overdue={isOverdue(inv.status, inv.dueDate)} /></h3>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <PdfLink href={'/api/pdf/invoice/' + inv.id} />
          {editable && <>
            <button className="btn btn-secondary" disabled={busy || !dirty} onClick={save}><FloppyDisk />{dirty ? 'Save' : 'Saved'}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={async () => { if (confirm('Delete draft ' + inv.number + '?') && await deleteInvoice(inv.id)) router.push('/invoices'); }}><Trash />Delete</button>
            <button className="btn btn-primary" disabled={busy} onClick={send}><PaperPlaneTilt />Mark sent and copy link</button>
          </>}
          {inv.status === 'Sent' && <CopyLinkButton path={'/pay/' + inv.payToken} label="Copy payment link" />}
        </div>
      </header>

      {inv.status === 'Sent' && (
        <div className="card elev-sm" style={{ padding: 'var(--space-4)', flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220, fontSize: 14 }}>Sent {inv.sentAt ? fmtD(inv.sentAt.slice(0, 10)) : ''}. Card payments through the link mark it paid automatically.</span>
          <select className="input" aria-label="Paid by" value={paidVia} onChange={e => setPaidVia(e.target.value)} style={{ width: 150 }}>
            {['E-transfer', 'Cheque', 'Other'].map(v => <option key={v}>{v}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy} onClick={() => confirm('Mark ' + inv.number + ' as paid by ' + paidVia.toLowerCase() + '?') && act(() => updateInvoice(inv.id, { status: 'Paid', paidVia }))}><CheckCircle />Mark paid</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => confirm('Void ' + inv.number + '? The client’s link will show it as void.') && act(() => updateInvoice(inv.id, { status: 'Void' }))}><Prohibit />Void</button>
        </div>
      )}
      {inv.status === 'Paid' && <div className="meta">Paid {inv.paidAt ? fmtD(inv.paidAt.slice(0, 10)) : ''}{inv.paidVia ? ' by ' + inv.paidVia.toLowerCase() : ''}.</div>}

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="field"><label htmlFor="i-client">Bill to</label><input id="i-client" className="input" disabled={!editable} value={d.billTo.client || ''} onChange={e => setBill({ client: e.target.value })} /></div>
        <div className="field"><label htmlFor="i-contact">Contact</label><input id="i-contact" className="input" disabled={!editable} value={d.billTo.contact || ''} onChange={e => setBill({ contact: e.target.value })} /></div>
        <div className="field"><label htmlFor="i-email">Client email</label><input id="i-email" type="email" className="input" disabled={!editable} value={d.billTo.email || ''} onChange={e => setBill({ email: e.target.value })} /></div>
        <div className="field"><label htmlFor="i-site">Site</label><input id="i-site" className="input" disabled={!editable} value={d.billTo.site || ''} onChange={e => setBill({ site: e.target.value })} /></div>
        <div className="field"><label htmlFor="i-issue">Issued</label><input id="i-issue" type="date" className="input" disabled={!editable} value={d.issueDate} onChange={e => setD({ ...d, issueDate: e.target.value })} /></div>
        <div className="field"><label htmlFor="i-due">Due</label>
          <input id="i-due" type="date" className="input" disabled={inv.status === 'Paid' || inv.status === 'Void'} value={d.dueDate}
            onChange={e => { setD({ ...d, dueDate: e.target.value }); if (!editable) updateInvoice(inv.id, { dueDate: e.target.value }); }} /></div>
      </div>

      <section className="section">
        <div style={{ overflowX: 'auto' }}>
          <table className="table lines" style={{ minWidth: 640 }}>
            <thead><tr><th>Description</th><th className="r" style={{ width: 90 }}>Qty</th><th className="r" style={{ width: 150 }}>Unit ($)</th><th className="r" style={{ width: 130 }}>Amount</th>{editable && <th style={{ width: 36 }} />}</tr></thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td>{editable ? <input className="input" aria-label="Description" value={l.description} onChange={e => setLine(i, { description: e.target.value })} /> : l.description}</td>
                  <td className="r">{editable ? <input className="input" type="number" step="any" aria-label="Quantity" value={l.qty} onChange={e => setLine(i, { qty: +e.target.value })} /> : l.qty}</td>
                  <td className="r">{editable ? <input className="input" type="number" step="0.01" aria-label="Unit price" value={l.unit_cents / 100} onChange={e => setLine(i, { unit_cents: Math.round(+e.target.value * 100) })} /> : cad(l.unit_cents)}</td>
                  <td className="r">{cad(lineTotal(l))}</td>
                  {editable && <td><button className="icon-btn del" aria-label="Remove line" onClick={() => setD({ ...d, lines: d.lines.filter((_, k) => k !== i) })}><X /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => setD({ ...d, lines: [...d.lines, { description: '', qty: 1, unit_cents: 0 }] })}><Plus />Add line</button>}
        <div className="money-sum rule-t" style={{ marginLeft: 'auto', width: 'min(100%, 420px)' }}>
          <Stat label="Subtotal" value={cad(t.sub)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{inv.taxLabel}{editable ? '' : ' ' + d.taxRate + '%'}</span>
            {editable
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input className="input" type="number" step="0.01" aria-label="Tax rate %" value={d.taxRate} onChange={e => setD({ ...d, taxRate: +e.target.value })} style={{ width: 72, minHeight: 30, fontSize: 13 }} />%</span>
              : <span className="num" style={{ fontSize: 18 }}>{cad(t.tax)}</span>}
          </div>
          <Stat label="Total (CAD)" value={cad(t.total)} />
        </div>
      </section>

      <div className="field"><label htmlFor="i-notes">Notes on the invoice</label>
        <textarea id="i-notes" className="input" disabled={!editable} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} placeholder="e.g. PO number, site contact, anything the client should see" /></div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{label}</span>
    <span className="num" style={{ fontSize: 18 }}>{value}</span>
  </div>
);
