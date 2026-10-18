'use client';

import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { today } from '@/lib/crm';
import { Loading, TaskRow } from '@/components/ui';

export default function Tasks() {
  const { ready, me, profiles, jobs, tasks, addTask } = useCrm();
  const T = today();
  const [who, setWho] = useState('everyone');
  const [nt, setNt] = useState({ title: '', jobId: '', assigneeId: me.id, due: T });
  const people = profiles.filter(p => p.active);
  const mine = tasks.filter(t => who === 'everyone' || t.assigneeId === who);
  const byDue = (a: { due: string }, b: { due: string }) => a.due.localeCompare(b.due);
  const groups = [
    { label: 'Overdue', color: 'var(--color-accent-300)', items: mine.filter(t => !t.done && t.due < T).sort(byDue) },
    { label: 'Today', color: 'var(--color-neutral-200)', items: mine.filter(t => !t.done && t.due === T) },
    { label: 'Upcoming', color: 'var(--color-neutral-200)', items: mine.filter(t => !t.done && t.due > T).sort(byDue) },
    { label: 'Done', color: 'var(--color-neutral-500)', items: mine.filter(t => t.done).sort(byDue).reverse() }
  ].filter(g => g.items.length);
  const openCount = tasks.filter(t => !t.done).length;
  const overdue = tasks.filter(t => !t.done && t.due < T).length;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div><div className="meta">{openCount} open{overdue ? ' · ' + overdue + ' overdue' : ''}</div><h3>Tasks</h3></div>
        <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor="t-who" style={{ margin: 0 }}>Assigned to</label>
          <select id="t-who" className="input" value={who} onChange={e => setWho(e.target.value)} style={{ width: 180 }}>
            <option value="everyone">Everyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </header>
      <form className="task-add" onSubmit={e => {
        e.preventDefault();
        if (!nt.title.trim()) return;
        addTask({ title: nt.title, jobId: nt.jobId || null, assigneeId: nt.assigneeId || null, due: nt.due || T });
        setNt(x => ({ ...x, title: '' }));
      }}>
        <input className="input" placeholder="Add a task…" aria-label="Task" value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} />
        <select className="input" aria-label="Job" value={nt.jobId} onChange={e => setNt({ ...nt, jobId: e.target.value })}>
          <option value="">No job</option>
          {jobs.filter(j => j.stage !== 'Lost').map(j => <option key={j.id} value={j.id}>{j.client} — {j.title}</option>)}
        </select>
        <select className="input" aria-label="Assignee" value={nt.assigneeId} onChange={e => setNt({ ...nt, assigneeId: e.target.value })}>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="input" type="date" aria-label="Due" value={nt.due} onChange={e => setNt({ ...nt, due: e.target.value })} />
        <button className="btn btn-primary" type="submit"><Plus />Add</button>
      </form>
      {!ready ? <Loading /> : groups.length === 0 ? <div className="meta">No tasks.</div> : groups.map(g => (
        <section key={g.label} className="section" style={{ gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><h6 style={{ margin: 0, color: g.color }}>{g.label}</h6><span className="meta">{g.items.length}</span></div>
          <div>{g.items.map(t => <TaskRow key={t.id} t={t} />)}</div>
        </section>
      ))}
    </div>
  );
}
