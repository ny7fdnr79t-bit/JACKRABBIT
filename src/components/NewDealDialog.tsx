'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Warning } from '@phosphor-icons/react';
import { useCrm, type DealDraft } from '@/lib/store';
import { CLIENT_TYPES, money } from '@/lib/crm';
import { EmergencySeg, pickerSummary, ServicePicker } from '@/components/ui';
import { useOpenJob } from '@/lib/useOpenJob';

export default function NewDealDialog() {
  const { newDeal, setNewDeal, me, profiles, settings, createDeal } = useCrm();
  const openJob = useOpenJob();
  const path = usePathname();
  const blank = (): DealDraft => ({ client: '', title: '', clientType: CLIENT_TYPES[2], value: '', ownerId: me.id, emergency: false, services: [] });
  const [d, setD] = useState<DealDraft>(blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Opened blank, or pre-filled from a lead.
  useEffect(() => { if (newDeal) { setD({ ...blank(), ...newDeal }); setErr(''); } }, [newDeal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!newDeal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNewDeal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newDeal, setNewDeal]);
  if (!newDeal) return null;

  const set = <K extends keyof DealDraft>(key: K) => (v: DealDraft[K]) => setD(x => ({ ...x, [key]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.services.length) return setErr('Pick at least one service.');
    if ((+d.value || 0) < settings.minJob) return setErr('Jobs start at ' + money(settings.minJob) + '.');
    setBusy(true);
    const id = await createDeal(d);
    setBusy(false);
    if (!id) return setErr('Couldn’t create the deal. Try again.');
    setNewDeal(false);
    openJob(id, path.startsWith('/pipeline') || path.startsWith('/overview') ? '/pipeline' : path);
  };

  return (
    <div className="dialog-backdrop dialog-layer" onClick={() => setNewDeal(false)}>
      <form className="dialog" role="dialog" aria-label="New deal" onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{ width: 'min(720px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="dialog-title">{d.leadId ? 'Create deal from lead' : 'New deal'}</div>
          <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>Jobs start at {money(settings.minJob)}. Combine any services into one job.</div>
        </div>
        <div className="grid-2">
          <div className="field span-2"><label htmlFor="nd-client">Client</label>
            <input id="nd-client" className="input" required autoFocus placeholder="Company name" value={d.client} onChange={e => set('client')(e.target.value)} /></div>
          <div className="field span-2"><label htmlFor="nd-title">Job</label>
            <input id="nd-title" className="input" required placeholder="e.g. 80k sq ft warehouse decommission" value={d.title} onChange={e => set('title')(e.target.value)} /></div>
          <div className="field"><label htmlFor="nd-type">Client type</label>
            <select id="nd-type" className="input" value={d.clientType} onChange={e => set('clientType')(e.target.value)}>
              {CLIENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select></div>
          <div className="field"><label htmlFor="nd-value">Estimated value ($)</label>
            <input id="nd-value" className="input" type="number" min={0} step={500} value={d.value} onChange={e => set('value')(e.target.value)} /></div>
          <div className="field"><label htmlFor="nd-owner">Account manager</label>
            <select id="nd-owner" className="input" value={d.ownerId} onChange={e => set('ownerId')(e.target.value)}>
              {profiles.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="field"><label>Response</label><EmergencySeg on={d.emergency} onChange={set('emergency')} name="em-new" /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="section-head"><h5 style={{ margin: 0 }}>Services</h5><span className="meta">{pickerSummary(d.services.length)}</span></div>
          <ServicePicker selected={d.services} onChange={set('services')} />
        </div>
        {err && <div className="warn" role="alert" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><Warning />{err}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={() => setNewDeal(false)}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create deal'}</button>
        </div>
      </form>
    </div>
  );
}
