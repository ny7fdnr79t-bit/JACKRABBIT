'use client';

import { useEffect, useState } from 'react';
import { X, Siren, GlobeSimple, Warning, Trash, EnvelopeSimple, ChatCircleText, Phone, CheckCircle, Circle } from '@phosphor-icons/react';
import { useCrm, useLookups } from '@/lib/store';
import {
  addDays, BILLING, COSTS, costed, costOf, marginColor, marginOf, money, STATUS, today, type Job
} from '@/lib/crm';
import { CommitInput, EmergencySeg, pickerSummary, ServicePicker, TaskRow } from '@/components/ui';
import { JobDocuments } from '@/components/docs-ui';

export default function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { jobs, ready } = useCrm();
  const job = jobs.find(j => j.id === id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!job) {
    if (!ready) return null;
    return (
      <>
        <div className="backdrop" onClick={onClose} />
        <aside className="drawer" aria-label="Deal">
          <div className="section-head"><h4 style={{ margin: 0 }}>Deal not found</h4><CloseBtn onClose={onClose} /></div>
          <div className="meta">It may have been deleted.</div>
        </aside>
      </>
    );
  }
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={job.client + ' — ' + job.title}>
        <Body job={job} onClose={onClose} />
      </aside>
    </>
  );
}

const CloseBtn = ({ onClose }: { onClose: () => void }) => (
  <button className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
);

function Body({ job: j, onClose }: { job: Job; onClose: () => void }) {

  const { profiles, crew, jobs, tasks, settings, updateJob, setCost, setServices, toggleCrew, saveContact, deleteJob, addTask } = useCrm();
  const { serviceNames } = useLookups();
  const [taskDraft, setTaskDraft] = useState('');
  const isWon = j.stage === 'Won';
  const c = costOf(j);
  const contact = j.contact || { name: '', email: '', phone: '' };
  const saveC = (patch: Partial<typeof contact>) => saveContact(j.id, { name: contact.name, email: contact.email, phone: contact.phone, ...patch });

  // Crew conflicts: who is already on site somewhere else.
  const busy = new Map<string, string>();
  jobs.filter(x => x.id !== j.id && x.stage === 'Won' && x.status === 'On site').forEach(x => x.crewIds.forEach(cid => busy.set(cid, x.client)));
  const names = serviceNames(j);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="kicker">{j.clientType}</span>
            {j.source && <span className="tag tag-neutral tag-sm"><GlobeSimple />{j.source}</span>}
            {j.emergency && <span className="tag tag-outline tag-sm"><Siren />Emergency 24/7</span>}
          </div>
          <h4 style={{ margin: 0 }}>{j.client}</h4>
          <CommitInput value={j.title} onCommit={v => v.trim() && updateJob(j.id, { title: v.trim() })} aria-label="Job title"
            style={{ fontSize: 14, color: 'var(--color-neutral-300)', background: 'transparent', borderColor: 'transparent', padding: '2px 0', minHeight: 0 }} />
        </div>
        <CloseBtn onClose={onClose} />
      </div>

      <div className="grid-2">
        <div className="field"><label htmlFor="d-stage">Stage</label>
          <select id="d-stage" className="input" value={j.stage} onChange={e => updateJob(j.id, { stage: e.target.value })}>
            {settings.stages.map(s => <option key={s}>{s}</option>)}
          </select></div>
        <div className="field"><label htmlFor="d-owner">Account manager</label>
          <select id="d-owner" className="input" value={j.ownerId || ''} onChange={e => updateJob(j.id, { ownerId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {profiles.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        {isWon && <>
          <div className="field"><label htmlFor="d-status">Job status</label>
            <select id="d-status" className="input" value={j.status || 'Scheduled'} onChange={e => updateJob(j.id, { status: e.target.value as Job['status'] })}>
              {STATUS.map(s => <option key={s}>{s}</option>)}
            </select></div>
          <div className="field"><label htmlFor="d-billing">Billing</label>
            <select id="d-billing" className="input" value={j.billing} onChange={e => updateJob(j.id, { billing: e.target.value as Job['billing'] })}>
              {BILLING.map(s => <option key={s}>{s}</option>)}
            </select></div>
          <div className="field"><label htmlFor="d-start">Start</label><CommitInput id="d-start" type="date" value={j.start} onCommit={v => updateJob(j.id, { start: v })} /></div>
          <div className="field"><label htmlFor="d-end">End</label><CommitInput id="d-end" type="date" value={j.end} min={j.start || undefined} onCommit={v => updateJob(j.id, { end: v })} /></div>
        </>}
        <div className="field span-2"><label htmlFor="d-site">Site</label><CommitInput id="d-site" value={j.site} onCommit={v => updateJob(j.id, { site: v })} /></div>
        <div className="field span-2"><label htmlFor="d-contact">Client contact</label><CommitInput id="d-contact" value={contact.name} onCommit={v => saveC({ name: v })} /></div>
        <div className="field"><label htmlFor="d-email">Contact email</label><CommitInput id="d-email" type="email" value={contact.email} onCommit={v => saveC({ email: v })} /></div>
        <div className="field"><label htmlFor="d-phone">Contact phone</label><CommitInput id="d-phone" type="tel" value={contact.phone} onCommit={v => saveC({ phone: v })} /></div>
      </div>

      <section className="section">
        <div className="section-head"><h5>Conversation</h5><span className="meta">Email and Quo connect in a later phase</span></div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" disabled><EnvelopeSimple />Email</button>
          <button className="btn btn-secondary" disabled><ChatCircleText />Text</button>
          {contact.phone
            ? <a className="btn btn-primary" href={'tel:' + contact.phone.replace(/[^\d+]/g, '')}><Phone />Call {contact.name.split(',')[0] || j.client}</a>
            : <button className="btn btn-primary" disabled><Phone />Call</button>}
        </div>
      </section>

      <section className="section" style={{ gap: 'var(--space-4)' }}>
        <div className="section-head"><h5>Services</h5><span className="meta">{pickerSummary(names.length)}</span></div>
        <EmergencySeg on={j.emergency} onChange={v => updateJob(j.id, { emergency: v })} name={'em-' + j.id} />
        <ServicePicker selected={names} onChange={v => setServices(j.id, v)} />
      </section>

      <section className="section">
        <h5>{isWon ? 'Contract and operating costs' : 'Estimate'}</h5>
        <div className="money-grid">
          <label htmlFor="d-value" style={{ fontSize: 14 }}>Contract value</label>
          <CommitInput id="d-value" type="number" min={0} step={500} value={j.value} onCommit={v => updateJob(j.id, { value: Math.max(0, +v || 0) })} />
          {j.value < settings.minJob && (
            <span className="span-2 warn" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <Warning />Below the {money(settings.minJob)} job minimum
            </span>
          )}
          {COSTS.map(([key, label]) => (
            <CostLine key={key} label={label} value={j.costs[key]} onCommit={v => setCost(j.id, key, v)} />
          ))}
        </div>
        <div className="money-sum rule-t">
          <Stat label="Operating cost" value={money(c)} />
          <Stat label="Gross profit" value={money(j.value - c)} />
          <Stat label="Margin" value={costed(j) ? marginOf(j) + '%' : '—'} color={marginColor(j, settings.marginTarget)} />
        </div>
      </section>

      {isWon && (
        <section className="section">
          <div className="section-head"><h5>Crew on site</h5><span className="meta">{j.crewIds.length} assigned</span></div>
          {crew.length === 0 && <div className="meta">Add field crew under Team.</div>}
          <div className="crew-grid">
            {crew.map(m => {
              const on = j.crewIds.includes(m.id);
              return (
                <button key={m.id} className={'crew-opt' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleCrew(j.id, m.id)}>
                  {on ? <CheckCircle size={17} color="var(--color-accent)" /> : <Circle size={17} color="var(--color-neutral-600)" />}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{m.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{m.role}{busy.has(m.id) ? ' · on site at ' + busy.get(m.id) : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <JobDocuments jobId={j.id} />

      <section className="section">
        <h5>Tasks</h5>
        <form style={{ display: 'flex', gap: 'var(--space-2)' }} onSubmit={e => {
          e.preventDefault();
          if (!taskDraft.trim()) return;
          addTask({ title: taskDraft, jobId: j.id, assigneeId: j.ownerId, due: addDays(today(), 1) });
          setTaskDraft('');
        }}>
          <input className="input" placeholder="Add a task for this job…" value={taskDraft} onChange={e => setTaskDraft(e.target.value)} />
          <button className="btn btn-secondary" type="submit">Add</button>
        </form>
        <div>
          {tasks.filter(t => t.jobId === j.id).sort((a, b) => a.due.localeCompare(b.due)).map(t => <TaskRow key={t.id} t={t} compact />)}
        </div>
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginTop: 'auto', paddingTop: 'var(--space-4)' }}>
        <button className="btn btn-secondary" style={{ color: 'var(--color-neutral-300)' }}
          onClick={async () => { if (confirm('Delete ' + j.client + ' — ' + j.title + '? Its tasks are deleted too.')) { onClose(); await deleteJob(j.id); } }}>
          <Trash />Delete deal
        </button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </>
  );
}

function CostLine({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const id = 'cost-' + label.replace(/\W+/g, '-').toLowerCase();
  return (
    <>
      <label htmlFor={id} style={{ fontSize: 13, color: 'var(--color-neutral-300)', paddingLeft: 'var(--space-4)' }}>{label}</label>
      <CommitInput id={id} type="number" min={0} step={100} value={value} onCommit={v => onCommit(Math.max(0, +v || 0))} style={{ minHeight: 32, fontSize: 13 }} />
    </>
  );
}

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{label}</span>
    <span className="num" style={{ fontSize: 18, color }}>{value}</span>
  </div>
);
