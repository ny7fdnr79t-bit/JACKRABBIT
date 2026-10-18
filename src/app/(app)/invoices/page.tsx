'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCrm } from '@/lib/store';
import { cad, type InvoiceStatus } from '@/lib/docs';
import { fmtD } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { isOverdue, StatusTag } from '@/components/docs-ui';

const FILTERS = ['Open', 'Draft', 'Paid', 'Void', 'All'] as const;

export default function Invoices() {
  const { ready, invoices, jobs } = useCrm();
  const router = useRouter();
  const [f, setF] = useState<(typeof FILTERS)[number]>('Open');
  const match = (s: InvoiceStatus) => (f === 'All' ? true : f === 'Open' ? s === 'Sent' : s === f);
  const list = invoices.filter(x => match(x.status));
  const job = (id: string) => jobs.find(j => j.id === id);
  const sent = invoices.filter(x => x.status === 'Sent');
  const month = new Date().toISOString().slice(0, 7);
  const totals = [
    { label: 'Outstanding', value: cad(sent.reduce((a, x) => a + x.totalCents, 0)), sub: sent.length + ' sent, not yet paid' },
    { label: 'Overdue', value: cad(sent.filter(x => isOverdue(x.status, x.dueDate)).reduce((a, x) => a + x.totalCents, 0)), sub: sent.filter(x => isOverdue(x.status, x.dueDate)).length + ' past due date' },
    { label: 'Paid this month', value: cad(invoices.filter(x => x.status === 'Paid' && (x.paidAt || '').startsWith(month)).reduce((a, x) => a + x.totalCents, 0)), sub: 'incl. HST' }
  ];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div><div className="meta">Deposit, progress and final invoices</div><h3>Invoices</h3></div>
        <div className="seg" role="radiogroup" aria-label="Filter invoices">
          {FILTERS.map(v => (
            <label key={v} className="seg-opt">
              <input type="radio" name="ifilter" checked={f === v} onChange={() => setF(v)} />{v}
              <span style={{ color: 'var(--color-neutral-500)' }}>{invoices.filter(x => (v === 'All' ? true : v === 'Open' ? x.status === 'Sent' : x.status === v)).length}</span>
            </label>
          ))}
        </div>
      </header>
      <div className="totals">
        {totals.map(t => <div key={t.label} className="total"><span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{t.label}</span><span className="v">{t.value}</span><span className="meta">{t.sub}</span></div>)}
      </div>
      {!ready ? <Loading /> : list.length === 0 ? <div className="meta">No invoices here. Create one from a deal’s panel.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 760 }}>
            <thead><tr><th>Invoice</th><th>Client · job</th><th>Type</th><th>Issued</th><th>Due</th><th className="r">Total</th><th>Status</th></tr></thead>
            <tbody>
              {list.map(x => {
                const j = job(x.jobId);
                return (
                  <tr key={x.id} tabIndex={0} onClick={() => router.push('/invoices/' + x.id)} onKeyDown={e => { if (e.key === 'Enter') router.push('/invoices/' + x.id); }}>
                    <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{x.number}</td>
                    <td><div>{j?.client || x.billTo.client}</div><div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{j?.title}</div></td>
                    <td>{x.kind}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-300)' }}>{fmtD(x.issueDate)}</td>
                    <td style={{ whiteSpace: 'nowrap', color: isOverdue(x.status, x.dueDate) ? 'var(--color-accent-300)' : 'var(--color-neutral-300)' }}>{fmtD(x.dueDate)}</td>
                    <td className="r">{cad(x.totalCents)}</td>
                    <td><StatusTag status={x.status} overdue={isOverdue(x.status, x.dueDate)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
