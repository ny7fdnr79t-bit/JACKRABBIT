'use client';

import Link from 'next/link';
import { Plus, ArrowRight, HardHat } from '@phosphor-icons/react';
import { useCrm, useLookups } from '@/lib/store';
import { addDays, costOf, days, k, PROTECTED_STAGES, sum, today, todayLong } from '@/lib/crm';
import { Loading, TaskRow } from '@/components/ui';
import { useOpenJob } from '@/lib/useOpenJob';

export default function Overview() {
  const { ready, jobs, tasks, crew, settings, setNewDeal } = useCrm();
  const { crewOf } = useLookups();
  const openJob = useOpenJob();
  const T = today();
  const opens = settings.stages.filter(s => !PROTECTED_STAGES.includes(s));
  const open = jobs.filter(j => opens.includes(j.stage));
  const won = jobs.filter(j => j.stage === 'Won');
  const active = won.filter(j => j.status !== 'Completed');
  const onSite = won.filter(j => j.status === 'On site');
  const unpaid = won.filter(j => j.billing !== 'Paid');
  const wv = sum(active, j => j.value), wc = sum(active, costOf);
  const kpis = [
    { label: 'Open pipeline', value: k(sum(open, j => j.value)), sub: open.length + ' deals in play' },
    { label: 'Active contracts', value: k(wv), sub: active.length + ' scheduled or on site' },
    { label: 'Margin on active work', value: (wv ? Math.round(((wv - wc) / wv) * 100) : 0) + '%', sub: 'Target ' + settings.marginTarget + '%' },
    { label: 'Awaiting payment', value: k(sum(unpaid, j => j.value)), sub: unpaid.length + ' contracts not yet paid' }
  ];
  const deployed = new Set(onSite.flatMap(j => j.crewIds));
  const totals = opens.map(st => ({ st, total: sum(jobs.filter(j => j.stage === st), j => j.value) }));
  const maxT = Math.max(1, ...totals.map(x => x.total));
  const dueSoon = tasks.filter(t => !t.done && t.due <= addDays(T, 7)).sort((a, b) => a.due.localeCompare(b.due));

  return (
    <div className="page page-wide" style={{ gap: 'calc(var(--space-8) * 1.5)' }}>
      <header className="page-head">
        <div><div className="meta">{todayLong()}</div><h3>Overview</h3></div>
        <button className="btn btn-primary" onClick={() => setNewDeal(true)}><Plus />New deal</button>
      </header>
      {!ready ? <Loading /> : <>
        <div className="kpis">
          {kpis.map(x => (
            <div key={x.label} className="card elev-sm kpi">
              <div className="kpi-label">{x.label}</div>
              <div className="kpi-value num">{x.value}</div>
              <div className="meta">{x.sub}</div>
            </div>
          ))}
        </div>
        <div className="two-col">
          <section className="section">
            <div className="section-head"><h5>On site now</h5><span className="meta">{deployed.size} of {crew.length} crew deployed</span></div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {onSite.length === 0 && <div className="meta">No crews on site.</div>}
              {onSite.map(j => {
                const start = j.start || T;
                const total = Math.max(1, j.end ? days(start, j.end) : 1);
                const d = Math.min(total, Math.max(0, days(start, T)));
                const names = crewOf(j).map(c => c.name);
                return (
                  <button key={j.id} className="onsite-row rule-b" onClick={() => openJob(j.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{j.client}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{j.start && j.end ? 'Day ' + (d + 1) + ' of ' + (total + 1) : 'Dates not set'}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{j.title}{j.site ? ' · ' + j.site.split(',').pop()!.trim() : ''}</div>
                    <div className="progress"><div style={{ width: Math.round((d / total) * 100) + '%' }} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-neutral-300)' }}>
                      <HardHat size={14} color="var(--color-neutral-500)" />{names.length ? names.join(', ') : 'No crew assigned'}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="section">
            <div className="section-head"><h5>Pipeline by stage</h5><Link className="btn btn-ghost" href="/pipeline" style={{ fontSize: 13 }}>Open board<ArrowRight /></Link></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingTop: 'var(--space-2)' }}>
              {totals.map(x => (
                <div key={x.st} className="bar-row">
                  <span style={{ color: 'var(--color-neutral-300)' }}>{x.st}</span>
                  <div className="bar"><div style={{ width: Math.max(2, (x.total / maxT) * 100) + '%' }} /></div>
                  <span className="num" style={{ textAlign: 'right' }}>{k(x.total)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <section className="section">
          <div className="section-head"><h5>Due in the next 7 days</h5><Link className="btn btn-ghost" href="/tasks" style={{ fontSize: 13 }}>All tasks<ArrowRight /></Link></div>
          <div>
            {dueSoon.length === 0 && <div className="meta">Nothing due this week.</div>}
            {dueSoon.map(t => <TaskRow key={t.id} t={t} compact />)}
          </div>
        </section>
      </>}
    </div>
  );
}
