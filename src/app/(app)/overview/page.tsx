'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ArrowRight, HardHat, Phone, CheckCircle, Circle, X, Tray } from '@phosphor-icons/react';
import { useCrm, useLookups } from '@/lib/store';
import { addDays, costOf, days, k, PROTECTED_STAGES, sum, today, todayLong } from '@/lib/crm';
import { Loading, TaskRow } from '@/components/ui';
import { useOpenJob } from '@/lib/useOpenJob';
import { useLogLead } from '@/components/LogLeadDialog';
import { leadView } from '@/lib/leads';

export default function Overview() {
  const { ready, jobs, tasks, crew, settings, setNewDeal, leads, company, services } = useCrm();
  const logLead = useLogLead();
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
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary" onClick={logLead}><Phone />Log a call</button>
          <button className="btn btn-primary" onClick={() => setNewDeal(true)}><Plus />New deal</button>
        </div>
      </header>
      {!ready ? <Loading /> : <>
        <GettingStarted steps={[
          { done: !!company.address, label: 'Add your company address and HST number', hint: 'Printed on invoices and agreements', href: '/team' },
          { done: crew.length > 0, label: 'Add your field crew', hint: 'So you can put people on jobs', href: '/team' },
          { done: leads.length > 0, label: 'Log your first lead', hint: 'A call or text that came in recently', onClick: logLead },
          { done: jobs.length > 0, label: 'Create your first deal', hint: 'Or turn a lead into one', onClick: () => setNewDeal(true) }
        ]} />
        {leads.some(l => l.status === 'new') && (
          <section className="section">
            <div className="section-head"><h5>New leads</h5><Link className="btn btn-ghost" href="/leads" style={{ fontSize: 13 }}>All leads<ArrowRight /></Link></div>
            <div>
              {leads.filter(l => l.status === 'new').slice(0, 5).map(l => {
                const v = leadView(l, services.filter(x => !x.isCustom).map(x => x.name));
                return (
                  <Link key={l.id} href="/leads" className="check-item rule-b-soft" style={{ textDecoration: 'none' }}>
                    <Tray size={16} color="var(--color-accent)" />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong style={{ fontWeight: 500 }}>{v.name}</strong><span className="meta" style={{ fontSize: 13 }}> · {v.details || v.services.join(', ') || l.form}</span></span>
                    <span className="meta">{l.form}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
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
              {onSite.length === 0 && <div className="meta">No crews on site. Won jobs show here once their status is On site.</div>}
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
            {dueSoon.length === 0 && <div className="meta">Nothing due this week. Tasks come from deals, leads you convert, and the assistant.</div>}
            {dueSoon.map(t => <TaskRow key={t.id} t={t} compact />)}
          </div>
        </section>
      </>}
    </div>
  );
}

// A short checklist for a fresh CRM. Hides itself when done, or when dismissed.
function GettingStarted({ steps }: { steps: { done: boolean; label: string; hint: string; href?: string; onClick?: () => void }[] }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem('wastely.gettingStarted') === 'hidden'); } catch { setHidden(false); } }, []);
  const left = steps.filter(s => !s.done).length;
  if (hidden || left === 0) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem('wastely.gettingStarted', 'hidden'); } catch {} };
  return (
    <section className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-3)' }}>
      <div className="section-head">
        <h5 style={{ margin: 0 }}>Getting started <span className="meta" style={{ fontSize: 13 }}>· {steps.length - left} of {steps.length} done</span></h5>
        <button className="icon-btn del" onClick={hide} aria-label="Hide getting started"><X /></button>
      </div>
      <div className="checklist">
        {steps.map(s => {
          const body = (<>{s.done ? <CheckCircle size={20} color="var(--color-accent)" /> : <Circle size={20} color="var(--color-neutral-600)" />}<span>{s.label}<span className="meta" style={{ fontSize: 12, display: 'block', textDecoration: 'none' }}>{s.hint}</span></span>{!s.done && <ArrowRight color="var(--color-neutral-500)" />}</>);
          return s.href
            ? <Link key={s.label} href={s.href} className={'check-item rule-b-soft' + (s.done ? ' done' : '')}>{body}</Link>
            : <button key={s.label} onClick={s.onClick} disabled={s.done} className={'check-item rule-b-soft' + (s.done ? ' done' : '')} style={{ border: 0, background: 'transparent', textAlign: 'left', cursor: s.done ? 'default' : 'pointer', width: '100%' }}>{body}</button>;
        })}
      </div>
    </section>
  );
}
