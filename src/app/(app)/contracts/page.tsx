'use client';

import { useState } from 'react';
import { Siren, Warning, HardHat } from '@phosphor-icons/react';
import { useCrm, useLookups } from '@/lib/store';
import { BILLING_TAG, costed, costOf, fmtD, marginColor, marginOf, money, STATUS, STATUS_TAG, sum, svcLabel, type Status } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { useOpenJob } from '@/lib/useOpenJob';

const ORDER: Record<Status, number> = { 'On site': 0, Scheduled: 1, Completed: 2 };

export default function Contracts() {
  const { ready, jobs, settings } = useCrm();
  const { serviceNames, crewOf } = useLookups();
  const openJob = useOpenJob();
  const [filter, setFilter] = useState<'All' | Status>('All');
  const won = jobs.filter(j => j.stage === 'Won');
  const list = won
    .filter(j => filter === 'All' || j.status === filter)
    .sort((a, b) => ORDER[a.status || 'Scheduled'] - ORDER[b.status || 'Scheduled'] || (a.start || '').localeCompare(b.start || ''));
  const tv = sum(list, j => j.value), tc = sum(list, costOf);
  const totals = [
    { label: 'Contract value', value: money(tv) },
    { label: 'Operating cost', value: money(tc) },
    { label: 'Gross profit', value: money(tv - tc) },
    { label: 'Blended margin', value: (tv ? Math.round(((tv - tc) / tv) * 100) : 0) + '%' }
  ];

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div><div className="meta">Won work, costs and billing</div><h3>Contracts</h3></div>
        <div className="seg" role="radiogroup" aria-label="Filter by status">
          {(['All', ...STATUS] as const).map(v => (
            <label key={v} className="seg-opt">
              <input type="radio" name="cfilter" checked={filter === v} onChange={() => setFilter(v)} />
              {v}<span style={{ color: 'var(--color-neutral-500)' }}>{v === 'All' ? won.length : won.filter(j => j.status === v).length}</span>
            </label>
          ))}
        </div>
      </header>
      <div className="totals">
        {totals.map(t => <div key={t.label} className="total"><span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{t.label}</span><span className="v">{t.value}</span></div>)}
      </div>
      {!ready ? <Loading /> : list.length === 0 ? <div className="meta">No contracts here yet. Move a deal to Won to start one.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 880 }}>
            <thead>
              <tr><th>Contract</th><th>Status</th><th>Dates</th><th className="r">Value</th><th className="r">Op. cost</th><th className="r">Margin</th><th>Crew</th><th>Billing</th></tr>
            </thead>
            <tbody>
              {list.map(j => {
                const low = costed(j) && marginOf(j) < settings.marginTarget;
                const crew = crewOf(j);
                const lead = crew.find(c => c.role === 'Foreman') || crew[0];
                const status = j.status || 'Scheduled';
                return (
                  <tr key={j.id} tabIndex={0} onClick={() => openJob(j.id)} onKeyDown={e => { if (e.key === 'Enter') openJob(j.id); }}>
                    <td style={{ paddingTop: 10, paddingBottom: 10 }}>
                      <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>{j.client}{j.emergency && <Siren size={14} color="var(--color-accent)" aria-label="Emergency 24/7" />}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{j.title} · {svcLabel(serviceNames(j))}</div>
                    </td>
                    <td><span className={'tag ' + STATUS_TAG[status]}>{status}</span></td>
                    <td style={{ fontSize: 13, color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>{j.start ? fmtD(j.start) + ' – ' + fmtD(j.end) : 'Not scheduled'}</td>
                    <td className="r">{money(j.value)}</td>
                    <td className="r" style={{ color: 'var(--color-neutral-300)' }}>{money(costOf(j))}</td>
                    <td className="r" style={{ color: marginColor(j, settings.marginTarget), whiteSpace: 'nowrap' }}>
                      {low && <Warning size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} aria-label="Below margin target" />}{costed(j) ? marginOf(j) + '%' : '—'}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>
                      <HardHat style={{ marginRight: 6, color: 'var(--color-neutral-500)', verticalAlign: '-2px' }} />{crew.length ? crew.length + ' · ' + lead!.name.split(' ')[0] : 'None'}
                    </td>
                    <td><span className={'tag ' + BILLING_TAG[j.billing]}>{j.billing}</span></td>
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
