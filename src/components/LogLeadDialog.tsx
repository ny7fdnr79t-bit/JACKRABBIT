'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Phone } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { LOGGED_SOURCES } from '@/lib/leads';

// "Log a call": capture a phone/text/referral enquiry in a few seconds, from anywhere.
const Ctx = createContext<() => void>(() => {});
export const useLogLead = () => useContext(Ctx);

export function LogLeadProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return <Ctx.Provider value={show}>{children}{open && <LogLeadDialog onClose={() => setOpen(false)} />}</Ctx.Provider>;
}

function LogLeadDialog({ onClose }: { onClose: () => void }) {
  const { me, logLead } = useCrm();
  const [f, setF] = useState({ source: 'Phone call', name: '', phone: '', email: '', location: '', details: '', when: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() && !f.phone.trim()) return setErr('Add at least a name or a phone number.');
    if (!f.details.trim()) return setErr('Say what they need, even in a few words.');
    setBusy(true);
    const fields: Record<string, string> = {
      Name: f.name.trim(), Phone: f.phone.trim(), Email: f.email.trim(), Location: f.location.trim(),
      Details: f.details.trim(), When: f.when.trim(), 'Logged by': me.name
    };
    for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
    const ok = await logLead(f.source, fields);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="dialog-backdrop dialog-layer" onClick={onClose}>
      <form className="dialog" role="dialog" aria-label="Log a lead" onClick={e => e.stopPropagation()} onSubmit={save} style={{ width: 'min(560px, 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Phone size={20} color="var(--color-accent)" /><div className="dialog-title">Log a lead</div></div>
        <div className="grid-2">
          <div className="field"><label htmlFor="ll-src">How did they reach you?</label>
            <select id="ll-src" className="input" value={f.source} onChange={set('source')}>{LOGGED_SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div className="field"><label htmlFor="ll-name">Name</label><input id="ll-name" className="input" autoFocus value={f.name} onChange={set('name')} /></div>
          <div className="field"><label htmlFor="ll-phone">Phone</label><input id="ll-phone" className="input" type="tel" value={f.phone} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="ll-email">Email</label><input id="ll-email" className="input" type="email" value={f.email} onChange={set('email')} /></div>
          <div className="field span-2"><label htmlFor="ll-loc">Site address or area</label><input id="ll-loc" className="input" value={f.location} onChange={set('location')} /></div>
          <div className="field span-2"><label htmlFor="ll-det">What do they need?</label>
            <textarea id="ll-det" className="input" value={f.details} onChange={set('details')} placeholder="e.g. Estate cleanout, 3-bed house, some asbestos tile in basement" style={{ minHeight: 80 }} /></div>
          <div className="field span-2"><label htmlFor="ll-when">When?</label><input id="ll-when" className="input" value={f.when} onChange={set('when')} placeholder="e.g. Next week, or Urgent / emergency" /></div>
        </div>
        {err && <div className="warn" role="alert" style={{ fontSize: 13 }}>{err}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save lead'}</button>
        </div>
      </form>
    </div>
  );
}
