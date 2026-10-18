'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Phone, MapPin, Truck, Receipt, Calculator, CircleDashed, Square, CheckSquare, X, Check, Plus, CalendarBlank, Siren
} from '@phosphor-icons/react';
import { useCrm, useLookups } from '@/lib/store';
import { fmtD, SERVICE_GROUPS, today, type Task } from '@/lib/crm';
import { useOpenJob } from '@/lib/useOpenJob';

const TASK_ICONS = { Call: Phone, Visit: MapPin, Dispatch: Truck, Invoice: Receipt, Quote: Calculator, Task: CircleDashed };

// An input that edits locally and saves on blur or Enter, so typing doesn't
// write to the database on every keystroke.
export function CommitInput({ value, onCommit, ...rest }: { value: string | number; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(String(value ?? ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(String(value ?? '')); }, [value]);
  const commit = () => { if (v !== String(value ?? '')) onCommit(v); };
  return (
    <input
      className="input" {...rest} value={v}
      onChange={e => { setV(e.target.value); if (rest.type === 'date') onCommit(e.target.value); }}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; if (rest.type !== 'date') commit(); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function TaskRow({ t, compact, showDelete = true }: { t: Task; compact?: boolean; showDelete?: boolean }) {
  const { jobs, toggleTask, deleteTask } = useCrm();
  const { ownerName } = useLookups();
  const openJob = useOpenJob();
  const job = jobs.find(j => j.id === t.jobId);
  const overdue = !t.done && t.due < today();
  const Icon = TASK_ICONS[t.type] || CircleDashed;
  return (
    <div className={'task-row rule-b-soft' + (compact ? ' compact' : '')}>
      <button className={'icon-btn' + (t.done ? ' on' : '')} onClick={() => toggleTask(t.id)} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
        {t.done ? <CheckSquare /> : <Square />}
      </button>
      <Icon style={{ fontSize: 16, color: 'var(--color-neutral-500)' }} />
      <div style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, color: t.done ? 'var(--color-neutral-500)' : 'var(--color-text)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
        {job && <button className="link-btn" onClick={() => openJob(job.id)}>{job.client}</button>}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--color-neutral-400)' }}>{ownerName(t.assigneeId)}</span>
        <span style={{ color: overdue ? 'var(--color-accent-300)' : 'var(--color-neutral-400)', minWidth: 52, textAlign: 'right' }}>{t.due === today() ? 'Today' : fmtD(t.due)}</span>
      </div>
      {!compact && showDelete && <button className="icon-btn del" onClick={() => deleteTask(t.id)} aria-label="Delete task"><X /></button>}
    </div>
  );
}

export function ServicePicker({ selected, onChange }: { selected: string[]; onChange: (names: string[]) => void }) {
  const { services } = useCrm();
  const [draft, setDraft] = useState('');
  const groups = [...SERVICE_GROUPS, 'Custom'].map(g => ({
    name: g,
    items: services.filter(s => (g === 'Custom' ? !SERVICE_GROUPS.includes(s.grp) : s.grp === g)).map(s => s.name)
  }));
  // Selected names not yet saved as services still show under Custom.
  const known = new Set(services.map(s => s.name.toLowerCase()));
  groups[groups.length - 1].items.push(...selected.filter(n => !known.has(n.toLowerCase())));
  const has = (n: string) => selected.some(x => x.toLowerCase() === n.toLowerCase());
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!has(v)) onChange([...selected, v]);
    setDraft('');
  };
  return (
    <>
      {groups.filter(g => g.items.length).map(g => (
        <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h6 style={{ margin: 0, color: 'var(--color-neutral-400)' }}>{g.name}</h6>
          <div className="chips">
            {g.items.map(label => {
              const on = has(label);
              return (
                <button key={label} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on}
                  onClick={() => onChange(on ? selected.filter(x => x.toLowerCase() !== label.toLowerCase()) : [...selected, label])}>
                  {on ? <Check size={12} /> : <Plus size={12} />}{label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: -4 }}>
        <input className="input" placeholder="Add a custom service…" value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style={{ minHeight: 32, fontSize: 13 }} />
        <button className="btn btn-secondary" type="button" onClick={add} style={{ fontSize: 13 }}>Add</button>
      </div>
    </>
  );
}

export const pickerSummary = (n: number) => (n ? n + (n === 1 ? ' service' : ' services combined') : 'Pick one or more');

export function EmergencySeg({ on, onChange, name }: { on: boolean; onChange: (v: boolean) => void; name: string }) {
  return (
    <div className="seg" style={{ alignSelf: 'flex-start' }}>
      <label className="seg-opt"><input type="radio" name={name} checked={!on} onChange={() => onChange(false)} /><CalendarBlank />Standard</label>
      <label className="seg-opt"><input type="radio" name={name} checked={on} onChange={() => onChange(true)} /><Siren />Emergency 24/7</label>
    </div>
  );
}

export function Loading() {
  return <div className="meta">Loading…</div>;
}
