'use client';

import { useMemo, useState } from 'react';
import {
  Calculator, EnvelopeOpen, HardHat, Siren, EnvelopeSimple, Phone, ArrowBendUpRight, Archive, Briefcase, ArrowCounterClockwise, Trash, Warning
} from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { CLIENT_TYPES, money } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { useOpenJob } from '@/lib/useOpenJob';
import { parseLead, toE164, type LeadStatus, type WebLead } from '@/lib/webleads';

const FILTERS = ['New', 'Converted', 'Archived', 'All'] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_NAME: Record<LeadStatus, Exclude<Filter, 'All'>> = { new: 'New', converted: 'Converted', archived: 'Archived' };
const STATUS_TAG: Record<LeadStatus, string> = { new: 'tag-accent', converted: 'tag-outline', archived: 'tag-neutral' };

function fmtAt(at: string) {
  const d = new Date(at);
  const t = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? 'Today, ' + t : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ', ' + t;
}

export default function WebLeads() {
  const { ready, leads, services, jobs, settings, me, setLeadStatus, deleteLead, openDealFromLead } = useCrm();
  const openJob = useOpenJob();
  const [filter, setFilter] = useState<Filter>('New');
  const known = useMemo(() => services.map(s => s.name), [services]);
  const counts = (f: Filter) => (f === 'All' ? leads.length : leads.filter(l => STATUS_NAME[l.status] === f).length);
  const shown = leads.filter(l => filter === 'All' || STATUS_NAME[l.status] === filter);

  const startDeal = (l: WebLead) => {
    const p = parseLead(l, known);
    const mid = p.range ? Math.round((p.range[0] + p.range[1]) / 2 / 100) * 100 : 0;
    openDealFromLead({
      leadId: l.id,
      site: p.location,
      contact: { name: p.name, email: p.email, phone: toE164(p.phone) },
      note: 'From a website ' + l.form.toLowerCase() + (p.range ? ' · indicative price ' + money(p.range[0]) + ' – ' + money(p.range[1]) : '') +
        (p.services.length ? '' : ' · pick the services below'),
      draft: {
        client: p.company || p.name,
        title: p.title,
        clientType: p.company ? 'Commercial' : CLIENT_TYPES[5],
        value: String(Math.max(mid, settings.minJob)),
        ownerId: me.id,
        emergency: p.urgent,
        services: p.services
      }
    });
  };

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div><div className="meta">{counts('New')} new from wastely.ca</div><h3>Web leads</h3></div>
        <div className="seg" role="radiogroup" aria-label="Show">
          {FILTERS.map(f => (
            <label key={f} className="seg-opt">
              <input type="radio" name="wfilter" checked={filter === f} onChange={() => setFilter(f)} />
              {f}<span style={{ color: 'var(--color-neutral-500)' }}>{counts(f)}</span>
            </label>
          ))}
        </div>
      </header>

      {!ready ? <Loading /> : shown.length === 0 ? (
        <div className="meta" style={{ fontSize: 14 }}>
          {leads.length ? 'Nothing here.' : 'No website submissions yet. Quote, contact and careers forms on wastely.ca will appear here as they come in.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {shown.map(l => {
            const p = parseLead(l, known);
            const job = l.jobId ? jobs.find(j => j.id === l.jobId) : null;
            const Icon = p.isCareer ? HardHat : /contact/i.test(l.form) ? EnvelopeOpen : Calculator;
            const belowMin = p.range && p.range[1] < settings.minJob;
            return (
              <article key={l.id} className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-accent-300)' }}>
                        <Icon size={13} />{l.form}
                      </span>
                      {p.urgent && <span className="tag tag-outline" style={{ gap: 4, padding: '1px 6px' }}><Siren />Urgent</span>}
                      <span className={'tag ' + STATUS_TAG[l.status]} style={{ padding: '1px 8px' }}>{STATUS_NAME[l.status]}</span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 500 }}>{p.name}</div>
                    {(p.company || p.location) && <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{[p.company, p.location].filter(Boolean).join(' · ')}</div>}
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--color-neutral-300)' }}>
                      {p.email && <a href={'mailto:' + p.email} style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'inherit' }}><EnvelopeSimple style={{ color: 'var(--color-neutral-500)' }} />{p.email}</a>}
                      {p.phone && <a href={'tel:' + toE164(p.phone)} style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'inherit' }}><Phone style={{ color: 'var(--color-neutral-500)' }} />{p.phone}</a>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{fmtAt(l.at)}</span>
                    {l.page && <span style={{ fontSize: 11, color: 'var(--color-neutral-600)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.page.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}</span>}
                    {p.range && <>
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginTop: 6 }}>Indicative price</span>
                      <span style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(p.range[0])} – {money(p.range[1])}</span>
                      {belowMin && <span className="warn" style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}><Warning />Below the {money(settings.minJob)} minimum</span>}
                    </>}
                  </div>
                </div>

                {p.services.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {p.services.map(s => <span key={s} className="tag tag-accent">{s}</span>)}
                  </div>
                )}

                {p.rows.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) minmax(0, 1fr)', gap: '6px 16px', fontSize: 13 }}>
                    {p.rows.map(r => (
                      <div key={r.key} style={{ display: 'contents' }}>
                        <span style={{ color: 'var(--color-neutral-500)' }}>{r.key}</span>
                        <span style={{ color: 'var(--color-neutral-200)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  {l.status === 'new' && !p.isCareer && <button className="btn btn-primary" onClick={() => startDeal(l)}><ArrowBendUpRight />Create deal</button>}
                  {l.status === 'new' && <button className="btn btn-secondary" onClick={() => setLeadStatus(l.id, 'archived')}><Archive />Archive</button>}
                  {l.status === 'converted' && (job
                    ? <button className="btn btn-secondary" onClick={() => openJob(job.id)}><Briefcase />Deal: {job.client}</button>
                    : <span className="meta">Its deal was deleted.</span>)}
                  {l.status === 'archived' && <>
                    <button className="btn btn-ghost" onClick={() => setLeadStatus(l.id, 'new')}><ArrowCounterClockwise />Move back to New</button>
                    <button className="btn btn-ghost" style={{ color: 'var(--color-neutral-400)' }} onClick={() => { if (confirm('Delete this submission for good? Use this for spam.')) deleteLead(l.id); }}><Trash />Delete</button>
                  </>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
