'use client';

import { useState } from 'react';
import {
  Calculator, EnvelopeOpen, HardHat, Phone, ChatCircleText, Handshake, GlobeSimple, Siren, EnvelopeSimple,
  ArrowBendUpRight, Archive, ArrowCounterClockwise, Briefcase, Plus
} from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { dealFromLead, isWebsite, leadView, type Lead } from '@/lib/leads';
import { Loading } from '@/components/ui';
import { useLogLead } from '@/components/LogLeadDialog';
import { useOpenJob } from '@/lib/useOpenJob';

const FILTERS = [['new', 'New'], ['converted', 'Converted'], ['archived', 'Archived'], ['all', 'All']] as const;
const ICON: Record<string, React.ElementType> = {
  'Quote request': Calculator, Contact: EnvelopeOpen, Careers: HardHat, 'Phone call': Phone, 'Text message': ChatCircleText,
  Email: EnvelopeSimple, Referral: Handshake
};
const when = (iso: string) => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

export default function Leads() {
  const { ready, leads } = useCrm();
  const logLead = useLogLead();
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('new');
  const list = leads.filter(l => f === 'all' || l.status === f);
  const fresh = leads.filter(l => l.status === 'new').length;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div><div className="meta">{fresh ? `${fresh} new to follow up` : 'Website forms and logged calls, in one place'}</div><h3>Leads</h3></div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="seg" role="radiogroup" aria-label="Filter leads">
            {FILTERS.map(([v, label]) => (
              <label key={v} className="seg-opt">
                <input type="radio" name="lfilter" checked={f === v} onChange={() => setF(v)} />{label}
                <span style={{ color: 'var(--color-neutral-500)' }}>{v === 'all' ? leads.length : leads.filter(l => l.status === v).length}</span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary" onClick={logLead}><Plus />Log a call</button>
        </div>
      </header>
      {!ready ? <Loading /> : list.length === 0 ? (
        <div className="empty">
          <GlobeSimple size={28} color="var(--color-accent)" />
          <div style={{ fontSize: 16, fontWeight: 500 }}>{f === 'new' ? 'No new leads' : 'Nothing here'}</div>
          <p className="meta" style={{ fontSize: 14, margin: 0, maxWidth: 440 }}>
            Quote and contact forms from wastely.ca land here on their own once the new CRM is live. For a phone call or text, click <strong style={{ color: 'var(--color-text)', fontWeight: 500 }}>Log a call</strong>.
          </p>
          <button className="btn btn-primary" onClick={logLead}><Plus />Log a call</button>
        </div>
      ) : list.map(l => <LeadCard key={l.id} l={l} />)}
    </div>
  );
}

function LeadCard({ l }: { l: Lead }) {
  const { services, jobs, settings, me, setNewDeal, setLeadStatus } = useCrm();
  const openJob = useOpenJob();
  const known = services.filter(s => !s.isCustom).map(s => s.name);
  const v = leadView(l, known);
  const Icon = ICON[l.form] || GlobeSimple;
  const careers = l.form === 'Careers';
  const job = l.jobId ? jobs.find(j => j.id === l.jobId) : null;
  const convert = () => setNewDeal({ ...dealFromLead(l, known, settings.minJob), ownerId: me.id, leadId: l.id });

  return (
    <article className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)', opacity: l.status === 'archived' ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="kicker" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon size={14} />{isWebsite(l) ? l.form : l.form + (v.loggedBy ? ' · logged by ' + v.loggedBy : '')}</span>
            {v.urgent && <span className="tag tag-outline tag-sm"><Siren />Urgent</span>}
            {l.status !== 'new' && <span className={'tag ' + (l.status === 'converted' ? 'tag-outline' : 'tag-neutral')} style={{ padding: '1px 8px' }}>{l.status === 'converted' ? 'Converted' : 'Archived'}</span>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 500 }}>{v.name}</div>
          {(v.company || v.location) && <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{[v.company, v.location].filter(Boolean).join(' · ')}</div>}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
            {v.phone && <a href={'tel:' + v.phone.replace(/[^\d+]/g, '')} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Phone />{v.phone}</a>}
            {v.email && <a href={'mailto:' + v.email} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><EnvelopeSimple />{v.email}</a>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, textAlign: 'right' }}>
          <span className="meta">{when(l.at)}</span>
          {l.page && <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{l.page.replace(/^https?:\/\//, '').slice(0, 50)}</span>}
          {v.range && <><span className="meta" style={{ marginTop: 6 }}>Indicative price</span><span className="num" style={{ fontSize: 18 }}>${v.range[0].toLocaleString('en-CA')} – ${v.range[1].toLocaleString('en-CA')}</span></>}
        </div>
      </div>
      {v.details && <p style={{ margin: 0, fontSize: 14, color: 'var(--color-neutral-200)', whiteSpace: 'pre-wrap' }}>{v.details}</p>}
      {v.services.length > 0 && <div className="chips">{v.services.map(s => <span key={s} className="tag tag-accent">{s}</span>)}</div>}
      {v.rows.filter(r => !/^(details|project details|message|location|site location|address)$/i.test(r.key)).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) minmax(0, 1fr)', gap: '6px 16px', fontSize: 13 }}>
          {v.rows.filter(r => !/^(details|project details|message|location|site location|address)$/i.test(r.key)).map(r => (
            <div key={r.key} style={{ display: 'contents' }}><span style={{ color: 'var(--color-neutral-500)' }}>{r.key}</span><span style={{ color: 'var(--color-neutral-200)' }}>{r.value}</span></div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {l.status === 'new' && !careers && <button className="btn btn-primary" onClick={convert}><ArrowBendUpRight />Create deal</button>}
        {l.status === 'new' && <button className="btn btn-secondary" onClick={() => setLeadStatus(l.id, 'archived')}><Archive />Archive</button>}
        {l.status === 'converted' && job && <button className="btn btn-secondary" onClick={() => openJob(job.id, '/pipeline')}><Briefcase />Deal: {job.client}</button>}
        {l.status === 'archived' && <button className="btn btn-ghost" onClick={() => setLeadStatus(l.id, 'new')}><ArrowCounterClockwise />Move back to New</button>}
        {careers && l.status === 'new' && <span className="meta" style={{ alignSelf: 'center' }}>Job application: archive it once it’s passed to hiring.</span>}
      </div>
    </article>
  );
}
