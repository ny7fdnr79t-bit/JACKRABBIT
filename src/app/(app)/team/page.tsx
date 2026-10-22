'use client';

import { useState } from 'react';
import { Plus, X, UserPlus } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { CREW_ROLES, initials, USER_ROLES } from '@/lib/crm';
import { CommitInput, Loading } from '@/components/ui';
import CompanySettings from '@/components/CompanySettings';
import { addMember } from './actions';
import { GmailConnectCard } from '@/components/GmailUi';

// Profiles and field crew. Sign-ups are closed: Leadership gives people access here.
export default function Team() {
  const { ready, me, profiles, crew, jobs, tasks, updateProfile, addCrew, removeCrew } = useCrm();
  const lead = me.role === 'Leadership';
  const [nc, setNc] = useState({ name: '', role: CREW_ROLES[0] as string });
  const [np, setNp] = useState({ email: '', name: '', role: 'Leadership' as string });
  const [npMsg, setNpMsg] = useState('');
  const [npBusy, setNpBusy] = useState(false);

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div><div className="meta">People, crews, and company details for documents</div><h3>Team</h3></div>
      </header>
      {!ready ? <Loading /> : <>
        <section className="section">
          <div className="section-head"><h5>Profiles</h5><span className="meta">{lead ? 'Only people added here can sign in.' : 'Leadership adds people here.'}</span></div>
          {lead && (
            <form style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.4fr) minmax(160px, 1fr) 170px auto', gap: 'var(--space-3)', maxWidth: 860 }} onSubmit={async e => {
              e.preventDefault();
              if (!np.email.trim()) return;
              setNpBusy(true);
              setNpMsg('');
              const r = await addMember(np);
              setNpBusy(false);
              if (r.error) { setNpMsg(r.error); return; }
              setNpMsg(np.email.trim() + ' can now sign in with an emailed code.');
              setNp({ email: '', name: '', role: 'Leadership' });
            }}>
              <input className="input" type="email" placeholder="Email" aria-label="New person's email" value={np.email} onChange={e => setNp({ ...np, email: e.target.value })} />
              <input className="input" placeholder="Name" aria-label="New person's name" value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} />
              <select className="input" aria-label="New person's role" value={np.role} onChange={e => setNp({ ...np, role: e.target.value })}>
                {USER_ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
              <button className="btn btn-primary" type="submit" disabled={npBusy}><UserPlus />{npBusy ? 'Adding…' : 'Give access'}</button>
            </form>
          )}
          {npMsg && <div className="meta" role="status">{npMsg}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
            {profiles.map(p => {
              const isMe = p.id === me.id;
              const canEdit = isMe || lead;
              return (
                <div key={p.id} className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-3)', opacity: p.active ? 1 : 0.7 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span className="me-avatar">{initials(p.name)}</span>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, fontWeight: 500 }}>
                        {p.name}{isMe && <span className="tag tag-outline" style={{ padding: '0 6px' }}>You</span>}{!p.active && <span className="tag tag-neutral" style={{ padding: '0 6px' }}>Pending</span>}
                      </span>
                      <span className="meta">{p.email}</span>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="grid-2" style={{ gap: 'var(--space-3)' }}>
                      <div className="field"><label htmlFor={'n-' + p.id}>Name</label><CommitInput id={'n-' + p.id} value={p.name} onCommit={v => v.trim() && updateProfile(p.id, { name: v.trim() })} /></div>
                      <div className="field"><label htmlFor={'q-' + p.id}>Quo number</label><CommitInput id={'q-' + p.id} type="tel" placeholder="+1…" value={p.quoPhone} onCommit={v => updateProfile(p.id, { quoPhone: v.trim() })} /></div>
                      <div className="field"><label htmlFor={'r-' + p.id}>Role</label>
                        <select id={'r-' + p.id} className="input" value={p.role} disabled={!lead} onChange={e => updateProfile(p.id, { role: e.target.value })}>
                          {USER_ROLES.map(r => <option key={r}>{r}</option>)}
                        </select></div>
                      {lead && !isMe && (
                        <div className="field"><label>Access</label>
                          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => updateProfile(p.id, { active: !p.active })}>{p.active ? 'Deactivate' : 'Activate'}</button>
                        </div>
                      )}
                    </div>
                  )}
                  {!canEdit && <span className="meta">{p.role}</span>}
                  <span className="meta">{jobs.filter(j => j.ownerId === p.id).length} jobs · {tasks.filter(t => t.assigneeId === p.id && !t.done).length} open tasks</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h5>Integrations</h5><span className="meta">Connected accounts the whole team uses</span></div>
          <GmailConnectCard />
        </section>

        <section className="section">
          <div className="section-head"><h5>Field crew</h5><span className="meta">{crew.length} people</span></div>
          <form style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 180px auto', gap: 'var(--space-3)', maxWidth: 640 }} onSubmit={e => {
            e.preventDefault();
            if (!nc.name.trim()) return;
            addCrew(nc.name, nc.role);
            setNc(x => ({ ...x, name: '' }));
          }}>
            <input className="input" placeholder="Name" aria-label="Crew name" value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} />
            <select className="input" aria-label="Crew role" value={nc.role} onChange={e => setNc({ ...nc, role: e.target.value })}>
              {CREW_ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
            <button className="btn btn-primary" type="submit"><Plus />Add</button>
          </form>
          <div style={{ maxWidth: 640 }}>
            {crew.map(c => (
              <div key={c.id} className="rule-b-soft" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 28px', gap: 10, alignItems: 'center', padding: '9px var(--space-2)' }}>
                <span style={{ fontSize: 14 }}>{c.name}</span>
                <span className="meta">{c.role}</span>
                <button className="icon-btn del" aria-label={'Remove ' + c.name} onClick={() => { if (confirm('Remove ' + c.name + ' from the crew list?')) removeCrew(c.id); }}><X /></button>
              </div>
            ))}
          </div>
        </section>

        <CompanySettings />
      </>}
    </div>
  );
}
