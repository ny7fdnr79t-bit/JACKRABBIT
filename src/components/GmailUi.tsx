'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  EnvelopeSimple, GoogleLogo, ArrowSquareOut, CaretDown, CaretRight, PaperPlaneTilt, Paperclip, ArrowClockwise, Warning, X
} from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';

type Thread = { id: string; subject: string; snippet: string; from: string; date: string; count: number; unread: boolean };
type Message = { id: string; from: string; to: string; cc: string; date: string; subject: string; text: string; quoted: string; attachments: string[]; outgoing: boolean };

const nameOf = (from: string) => (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || from.replace(/[<>]/g, '')).trim();
function when(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { code: j.error, status: r.status });
  return j as T;
}

// ── Team → Integrations: connect the Gmail mailbox ──────────────────────────

export function GmailConnectCard() {
  const { me, profiles, googleAccounts } = useCrm();
  const mine = googleAccounts.find(g => g.profileId === me.id);
  const shared = googleAccounts[0];
  const [url, setUrl] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'not_configured' | 'error'>('loading');
  const [msg, setMsg] = useState('');

  // The consent link is fetched ahead of time so the button is a real link:
  // it opens a new tab in a browser, or the default browser from the Mac app.
  const prepare = useCallback(async () => {
    try {
      const j = await api<{ url: string }>('/api/google/connect', { method: 'POST' });
      setUrl(j.url); setState('ready');
    } catch (e) {
      setState((e as { code?: string }).code === 'not_configured' ? 'not_configured' : 'error');
      setMsg((e as Error).message);
    }
  }, []);
  useEffect(() => {
    prepare();
    const t = setInterval(prepare, 20 * 60 * 1000);
    return () => clearInterval(t);
  }, [prepare]);

  const disconnect = async () => {
    if (!confirm('Disconnect ' + mine?.email + '? Email threads stop showing on deals until someone reconnects.')) return;
    try { await api('/api/google/disconnect', { method: 'POST' }); } catch (e) { setMsg((e as Error).message); }
  };

  const ownerName = (id: string) => profiles.find(p => p.id === id)?.name || 'a teammate';
  return (
    <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)', maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <EnvelopeSimple size={22} color="var(--color-accent)" />
          <div>
            <div style={{ fontSize: 17, fontWeight: 500 }}>Email · Gmail</div>
            <div className="meta">Email threads on each deal, and replies sent from the CRM</div>
          </div>
        </div>
        <span className={'tag ' + (shared ? 'tag-accent' : 'tag-neutral')} style={{ padding: '1px 8px' }}>{shared ? 'Connected' : 'Not connected'}</span>
      </div>

      {mine && <div style={{ fontSize: 14 }}>Your mailbox: <strong>{mine.email}</strong></div>}
      {!mine && shared && <div style={{ fontSize: 14 }}>Using <strong>{shared.email}</strong>, connected by {ownerName(shared.profileId)}. You can also connect your own.</div>}
      {!shared && <div style={{ fontSize: 14, color: 'var(--color-neutral-300)' }}>Connect the mailbox your clients email (for example go@wastely.ca). Google opens in a new window; approve it, then come back here.</div>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        {state === 'ready' && (
          <a className={'btn ' + (shared ? 'btn-secondary' : 'btn-primary')} href={url} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(prepare, 1000)}>
            <GoogleLogo />{mine ? 'Reconnect' : 'Connect Gmail'}<ArrowSquareOut size={13} />
          </a>
        )}
        {state === 'loading' && <span className="meta">Checking…</span>}
        {state === 'not_configured' && <span className="meta">Waiting for the Google keys in Vercel (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).</span>}
        {state === 'error' && <span className="warn" style={{ fontSize: 13 }}>{msg}</span>}
        {mine && <button className="btn btn-ghost" style={{ color: 'var(--color-neutral-400)' }} onClick={disconnect}>Disconnect</button>}
      </div>
      {state === 'ready' && msg && <div className="warn" style={{ fontSize: 13 }}>{msg}</div>}
    </div>
  );
}

// ── Deal panel: email with the contact ──────────────────────────────────────

export function DealEmail({ jobId, contactId, email, name }: { jobId: string; contactId: string | null; email: string; name: string }) {
  const { googleAccounts } = useCrm();
  const connected = googleAccounts.length > 0;
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [mailbox, setMailbox] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!email || !connected) return;
    setErr('');
    try {
      const j = await api<{ mailbox: string; threads: Thread[] }>('/api/gmail/threads?email=' + encodeURIComponent(email));
      setThreads(j.threads); setMailbox(j.mailbox);
    } catch (e) {
      setThreads([]); setErr((e as Error).message === 'not_connected' ? '' : (e as Error).message);
    }
  }, [email, connected]);

  useEffect(() => { setThreads(null); setOpen(null); setComposing(false); load(); }, [load]);

  if (!email) return <div className="meta">Add the contact’s email above to see email threads here.</div>;
  if (!connected) return <div className="meta">Connect Gmail under Team to see and send email here.</div>;

  const list = threads || [];
  const shown = showAll ? list : list.slice(0, 5);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => { setComposing(c => !c); setOpen(null); }}><EnvelopeSimple />Email {name || email}</button>
        <button className="btn btn-ghost btn-icon" onClick={load} aria-label="Refresh email"><ArrowClockwise size={15} /></button>
        {mailbox && <span className="meta">from {mailbox}</span>}
      </div>
      {composing && (
        <Composer
          to={email} jobId={jobId} contactId={contactId} withSubject
          onCancel={() => setComposing(false)}
          onSent={() => { setComposing(false); load(); }}
        />
      )}
      {err && <div className="warn" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><Warning />{err}</div>}
      {threads === null && !err && <div className="meta">Loading email…</div>}
      {threads !== null && !list.length && !err && <div className="meta">No email with {email} yet.</div>}
      <div>
        {shown.map(t => (
          <div key={t.id} className="rule-b-soft">
            <button className="email-row" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
              {open === t.id ? <CaretDown size={13} /> : <CaretRight size={13} />}
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: t.unread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                  {t.count > 1 && <span className="meta" style={{ flex: 'none' }}>{t.count}</span>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(t.from)} — {t.snippet}</span>
              </span>
              <span className="meta" style={{ flex: 'none' }}>{when(t.date)}</span>
            </button>
            {open === t.id && <ThreadView threadId={t.id} jobId={jobId} contactId={contactId} to={email} onSent={load} />}
          </div>
        ))}
      </div>
      {list.length > 5 && <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(s => !s)}>{showAll ? 'Show fewer' : 'Show all ' + list.length}</button>}
    </div>
  );
}

function ThreadView({ threadId, jobId, contactId, to, onSent }: { threadId: string; jobId: string; contactId: string | null; to: string; onSent: () => void }) {
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [err, setErr] = useState('');
  const [quoted, setQuoted] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    try { setMsgs((await api<{ messages: Message[] }>('/api/gmail/threads/' + threadId)).messages); }
    catch (e) { setErr((e as Error).message); }
  }, [threadId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="warn" style={{ fontSize: 13, padding: '0 0 12px 22px' }}>{err}</div>;
  if (!msgs) return <div className="meta" style={{ padding: '0 0 12px 22px' }}>Loading…</div>;
  // Reply to whoever wrote last that isn't us; fall back to the deal's contact.
  const lastIn = [...msgs].reverse().find(m => !m.outgoing);
  const replyTo = lastIn ? (lastIn.from.match(/<([^>]+)>/)?.[1] || lastIn.from).trim() : to;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: '0 0 var(--space-4) 22px' }}>
      {msgs.map(m => (
        <div key={m.id} className="email-msg" data-out={m.outgoing ? '1' : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
            <span style={{ color: m.outgoing ? 'var(--color-accent-200)' : 'var(--color-neutral-200)', fontWeight: 500 }}>{nameOf(m.from)}</span>
            <span className="meta">{new Date(m.date).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--color-neutral-200)' }}>{m.text || '(no text)'}</div>
          {m.attachments.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {m.attachments.map((a, i) => <span key={i} className="tag tag-neutral tag-sm"><Paperclip />{a}</span>)}
            </div>
          )}
          {m.quoted && (
            <>
              <button className="link-btn" style={{ alignSelf: 'flex-start', fontSize: 12 }} onClick={() => setQuoted(q => ({ ...q, [m.id]: !q[m.id] }))}>{quoted[m.id] ? 'Hide quoted text' : 'Show quoted text'}</button>
              {quoted[m.id] && <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--color-neutral-500)', borderLeft: '2px solid var(--color-divider)', paddingLeft: 10 }}>{m.quoted}</div>}
            </>
          )}
        </div>
      ))}
      <Composer to={replyTo} threadId={threadId} jobId={jobId} contactId={contactId} onSent={() => { load(); onSent(); }} />
    </div>
  );
}

function Composer({ to, threadId, jobId, contactId, withSubject, onSent, onCancel }: {
  to: string; threadId?: string; jobId: string; contactId: string | null; withSubject?: boolean; onSent: () => void; onCancel?: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || (withSubject && !subject.trim())) return;
    setBusy(true); setErr('');
    try {
      await api('/api/gmail/send', { method: 'POST', body: JSON.stringify({ to: [to], subject, body, threadId, jobId, contactId }) });
      setBody(''); setSubject(''); onSent();
    } catch (e2) { setErr((e2 as Error).message); }
    setBusy(false);
  };
  return (
    <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div className="meta">{threadId ? 'Reply to ' : 'To '}{to}</div>
      {withSubject && <input className="input" placeholder="Subject" aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} autoFocus />}
      <textarea className="input" placeholder={threadId ? 'Write a reply…' : 'Write your email…'} aria-label="Message" value={body} onChange={e => setBody(e.target.value)} rows={4} autoFocus={!withSubject && !threadId} />
      {err && <div className="warn" style={{ fontSize: 13 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}><X />Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy || !body.trim() || (withSubject && !subject.trim())}><PaperPlaneTilt />{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}
