'use client';

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sparkle, X, PaperPlaneTilt, ArrowCounterClockwise, CheckCircle, Warning } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';

const SUGGESTIONS = [
  'Which open deals are below the margin target?',
  'What’s due this week, and who owns it?',
  'Add a “Bin size” field to every job',
  'Draft a deposit invoice for my newest won job'
];

type Msg = { id: string; role: 'user' | 'assistant'; text: string; changes?: string[]; turnId?: string; undone?: boolean; error?: boolean };

const Ctx = createContext<{ open: boolean; toggle: () => void } | null>(null);
export const useAi = () => useContext(Ctx)!;

// Holds the assistant conversation for the whole signed-in session, so it
// survives moving between screens.
export function AiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(o => !o), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return <Ctx.Provider value={{ open, toggle }}>{children}{open && <Suspense><AiPanel onClose={() => setOpen(false)} /></Suspense>}</Ctx.Provider>;
}

// Conversation state lives outside the panel so closing it doesn't lose the chat.
let saved: { msgs: Msg[]; history: unknown[] } = { msgs: [], history: [] };

function AiPanel({ onClose }: { onClose: () => void }) {
  const { reload } = useCrm();
  const router = useRouter();
  const path = usePathname();
  const job = useSearchParams().get('job');
  const [msgs, setMsgs] = useState<Msg[]>(saved.msgs);
  const history = useRef<unknown[]>(saved.history);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { saved = { msgs, history: history.current }; }, [msgs]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => { box.current?.focus(); }, []);

  const push = (m: Omit<Msg, 'id'>) => setMsgs(ms => [...ms, { ...m, id: crypto.randomUUID() }]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    push({ role: 'user', text });
    setBusy(true);
    try {
      const r = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ history: history.current, message: text, context: { screen: path.replace(/^\//, '').split('/')[0] || 'overview', job } })
      });
      const data = await r.json().catch(() => ({}));
      if (data.reset) history.current = [];
      if (!r.ok) {
        push({ role: 'assistant', text: data.error || 'Something went wrong. Try again.', error: true, changes: data.changes?.length ? data.changes : undefined, turnId: data.turnId });
        if (data.changes?.length) reload();
        return;
      }
      history.current = data.history || [];
      push({ role: 'assistant', text: data.reply, changes: data.changes?.length ? data.changes : undefined, turnId: data.turnId });
      if (data.changes?.length) await reload();
      if (data.nav) {
        const screen = data.nav.screen ? '/' + data.nav.screen : data.nav.jobId && !/^\/(pipeline|contracts|overview|tasks)/.test(path) ? '/pipeline' : path;
        router.push(screen + (data.nav.jobId ? '?job=' + data.nav.jobId : ''), { scroll: false });
      }
    } catch {
      push({ role: 'assistant', text: 'Couldn’t reach the assistant. Check your connection and try again.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (m: Msg) => {
    if (!m.turnId) return;
    const r = await fetch('/api/ai/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: m.turnId }) });
    const data = await r.json().catch(() => ({}));
    if (r.ok || data.undone?.length) setMsgs(ms => ms.map(x => (x.id === m.id ? { ...x, undone: true } : x)));
    if (!r.ok) push({ role: 'assistant', text: data.error || 'Couldn’t undo that.', error: true });
    else history.current = [...history.current, { role: 'user', content: [{ type: 'text', text: '(I undid the changes from your last action.)' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Understood, those changes were undone.' }] }];
    reload();
  };

  const clear = () => { setMsgs([]); history.current = []; };

  return (
    <aside className="ai-panel" role="dialog" aria-label="Assistant">
      <header className="ai-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Sparkle size={18} color="var(--color-accent)" /><span style={{ fontSize: 15, fontWeight: 500 }}>Assistant</span></div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {msgs.length > 0 && <button className="btn btn-ghost" onClick={clear} style={{ fontSize: 12 }}>New chat</button>}
          <button className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Close assistant"><X size={16} /></button>
        </div>
      </header>
      <div ref={list} className="ai-list" aria-live="polite">
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', paddingTop: 'var(--space-4)' }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--color-neutral-300)' }}>
              Ask about deals, margins and tasks, or tell me what to change. I can update jobs, create deals, tasks and draft invoices, and change stages and fields. Every change can be undone. For changes to the app itself, I can file a request for Claude Code to build.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => <button key={s} className="ai-suggest" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map(m => m.role === 'user' ? (
          <div key={m.id} className="ai-user">{m.text}</div>
        ) : (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="ai-text" style={{ color: m.error ? 'var(--color-accent-300)' : undefined }}>{m.error && <Warning style={{ marginRight: 6, verticalAlign: '-2px' }} />}{m.text}</div>
            {m.changes && (
              <div className="ai-changes">
                {m.changes.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.4, color: m.undone ? 'var(--color-neutral-500)' : 'var(--color-neutral-200)', textDecoration: m.undone ? 'line-through' : 'none' }}>
                    <CheckCircle size={15} color="var(--color-accent)" style={{ marginTop: 2, flex: 'none' }} /><span>{c}</span>
                  </div>
                ))}
                {m.undone ? <span className="meta">Undone</span>
                  : m.turnId && <button className="btn btn-ghost" onClick={() => undo(m)} style={{ alignSelf: 'flex-start', fontSize: 12 }}><ArrowCounterClockwise />Undo</button>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="meta" style={{ fontSize: 13 }}>Thinking…</div>}
      </div>
      <form className="ai-form" onSubmit={e => { e.preventDefault(); send(); }}>
        <textarea ref={box} className="input" placeholder="Ask, or tell the CRM what to do…" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} style={{ minHeight: 72, resize: 'none' }} aria-label="Message the assistant" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>Enter to send · Shift+Enter for a new line</span>
          <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}><PaperPlaneTilt />Send</button>
        </div>
      </form>
    </aside>
  );
}

export function AskAiButton() {
  const { toggle } = useAi();
  return (
    <button className="btn btn-primary" onClick={toggle} style={{ justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sparkle />Ask AI</span>
      <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>⌘J</span>
    </button>
  );
}
