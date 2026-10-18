'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCrm } from '@/lib/store';
import { cad, type AgreementStatus } from '@/lib/docs';
import { fmtD } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { StatusTag } from '@/components/docs-ui';

const FILTERS = ['Awaiting signature', 'Draft', 'Signed', 'Void', 'All'] as const;
const matches = (f: (typeof FILTERS)[number], s: AgreementStatus) => (f === 'All' ? true : f === 'Awaiting signature' ? s === 'Sent' : s === f);

export default function Agreements() {
  const { ready, agreements, jobs } = useCrm();
  const router = useRouter();
  const [f, setF] = useState<(typeof FILTERS)[number]>('Awaiting signature');
  const list = agreements.filter(a => matches(f, a.status));
  const job = (id: string) => jobs.find(j => j.id === id);
  const day = (iso: string | null) => (iso ? fmtD(iso.slice(0, 10)) : '—');

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div><div className="meta">Service agreements clients sign online</div><h3>Agreements</h3></div>
        <div className="seg" role="radiogroup" aria-label="Filter agreements">
          {FILTERS.map(v => (
            <label key={v} className="seg-opt">
              <input type="radio" name="afilter" checked={f === v} onChange={() => setF(v)} />{v}
              <span style={{ color: 'var(--color-neutral-500)' }}>{agreements.filter(a => matches(v, a.status)).length}</span>
            </label>
          ))}
        </div>
      </header>
      {!ready ? <Loading /> : list.length === 0 ? <div className="meta">No agreements here. Create one from a deal’s panel.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 720 }}>
            <thead><tr><th>Agreement</th><th>Client · job</th><th className="r">Price</th><th>Sent</th><th>Opened</th><th>Signed</th><th>Status</th></tr></thead>
            <tbody>
              {list.map(a => {
                const j = job(a.jobId);
                return (
                  <tr key={a.id} tabIndex={0} onClick={() => router.push('/agreements/' + a.id)} onKeyDown={e => { if (e.key === 'Enter') router.push('/agreements/' + a.id); }}>
                    <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{a.number}</td>
                    <td><div>{j?.client}</div><div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{j?.title}</div></td>
                    <td className="r">{cad(a.priceCents)}</td>
                    <td style={{ color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{day(a.sentAt)}</td>
                    <td style={{ color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{day(a.viewedAt)}</td>
                    <td style={{ color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{a.signedAt ? day(a.signedAt) + ' · ' + a.signerName : '—'}</td>
                    <td><StatusTag status={a.status} /></td>
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
