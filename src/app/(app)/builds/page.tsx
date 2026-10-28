'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut, Rocket, ChatCircleText, Trash, ArrowCounterClockwise, Plus, Sparkle, GithubLogo, CircleNotch, Lightbulb, Hammer, X, MagnifyingGlass } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { fmtD } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { useAi } from '@/components/AiPanel';

type Build = {
  id: string; number: number | null; kind: 'feature' | 'rollback' | 'suggestion'; reason: string; impact: string | null; effort: string | null; title: string; description: string; requestedBy: string; requestedAt: string;
  status: 'suggested' | 'dismissed' | 'building' | 'ready' | 'published' | 'discarded' | 'failed'; detail: string; issueUrl: string | null; prNumber: number | null;
  prUrl: string | null; previewUrl: string | null; publishedAt: string | null; publishedBy: string | null;
  events: { at: string; who: string; kind: string; note: string }[];
};

const TAG: Record<Build['status'], [string, string]> = {
  suggested: ['tag-accent', 'Suggested'], dismissed: ['tag-neutral', 'Dismissed'],
  building: ['tag-accent-2', 'Building'], ready: ['tag-accent', 'Ready to review'], published: ['tag-outline', 'Published'],
  discarded: ['tag-neutral', 'Discarded'], failed: ['tag-neutral', 'Needs attention']
};
const day = (iso: string | null) => (iso ? fmtD(iso.slice(0, 10)) : '');

export default function Builds() {
  const { me } = useCrm();
  const { toggle } = useAi();
  const lead = me.role === 'Leadership';
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(null);
  const [review, setReview] = useState<{ at: string; suggestions: number; summary: string } | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/builds', { cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error || 'Couldn’t load builds.'); setBuilds(b => b || []); return; }
    setErr(''); setConfigured(d.configured !== false); setBuilds(d.builds || []); setReview(d.lastReview || null);
  }, []);

  // Refresh while anything is building; GitHub is the source of truth.
  useEffect(() => { load(); }, [load]);
  const active = builds?.some(b => b.status === 'building');
  useEffect(() => {
    const t = setInterval(load, active ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [load, active]);

  const act = async (b: Build, action: string, extra: Record<string, string> = {}) => {
    setBusy(b.id + action); setErr('');
    const r = await fetch('/api/builds/' + b.id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(d.error || 'That didn’t work.'); return false; }
    if (action === 'publish') alert(d.needsMigration
      ? 'Published. This change includes a database update: run the new file from supabase/migrations in the Supabase SQL Editor now, or the new feature may show errors.'
      : 'Published. It goes live as soon as the deploy finishes, usually within two minutes. Reload the CRM to see it.');
    await load();
    return true;
  };

  const runReview = async () => {
    setBusy('review'); setErr('');
    const r = await fetch('/api/builds/review', { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setErr(d.error || 'The review couldn’t run.');
    await load();
  };

  const file = async () => {
    if (!draft?.title.trim() || !draft.description.trim()) return setErr('Give it a title and describe what you want.');
    setBusy('new'); setErr('');
    const r = await fetch('/api/builds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setErr(d.error || 'Couldn’t send the request.');
    setDraft(null);
    load();
  };

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div><div className="meta">Changes to the CRM itself, built by Claude Code. You try each one before it goes live.</div><h3>Builds</h3></div>
        {lead && configured && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-secondary" disabled={busy === 'review'} onClick={runReview} title="Claude looks at the last 30 days of use and suggests up to three improvements (about $0.20)">
              {busy === 'review' ? <CircleNotch className="spin" /> : <MagnifyingGlass />}{busy === 'review' ? 'Reviewing…' : 'Review now'}
            </button>
            <button className="btn btn-secondary" onClick={toggle}><Sparkle />Describe it to the assistant</button>
            <button className="btn btn-primary" onClick={() => setDraft({ title: '', description: '' })}><Plus />Request a change</button>
          </div>
        )}
      </header>

      {!configured && (
        <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
          <h5 style={{ margin: 0 }}>Not connected yet</h5>
          <p className="meta" style={{ fontSize: 14, margin: 0 }}>
            Building app changes from the CRM needs a one-time GitHub setup: a GITHUB_TOKEN in Vercel, the ANTHROPIC_API_KEY secret and the Claude app in GitHub, and the workflow on main. The README’s “AI assistant” section has the steps.
          </p>
        </div>
      )}

      {draft && (
        <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
          <h5 style={{ margin: 0 }}>Request a change</h5>
          <div className="field"><label htmlFor="b-title">Title</label>
            <input id="b-title" className="input" autoFocus placeholder="e.g. Weekly crew schedule screen" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="b-desc">What should it do?</label>
            <textarea id="b-desc" className="input" style={{ minHeight: 140 }} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
              placeholder="Who uses it, where it appears, what it shows or does, and how you’ll know it’s right." /></div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy === 'new'} onClick={file}>{busy === 'new' ? 'Sending…' : 'Start building'}</button>
          </div>
        </div>
      )}

      {err && <div className="warn" role="alert" style={{ fontSize: 14 }}>{err}</div>}
      {builds === null ? <Loading /> : configured && builds.length === 0 && !draft ? (
        <div className="meta" style={{ fontSize: 14 }}>No builds yet. {lead ? 'Request a change, or ask the assistant (⌘J) for something the CRM can’t do yet.' : 'Leadership can request changes to the app here.'}</div>
      ) : (
        <>
          {review && (
            <div className="meta" style={{ fontSize: 13, display: 'flex', gap: 8 }}>
              <Lightbulb size={16} style={{ flex: 'none', marginTop: 2 }} />
              <span>Last review {day(review.at)}: {review.summary || (review.suggestions ? `${review.suggestions} suggestion(s).` : 'nothing to suggest.')} The CRM reviews itself every Monday.</span>
            </div>
          )}
          {builds.some(b => b.status === 'suggested') && (
            <section className="section">
              <div className="section-head"><h5>Suggested by the CRM</h5><span className="meta">Nothing is built until you choose Build it</span></div>
              {builds.filter(b => b.status === 'suggested').map(b => <SuggestionCard key={b.id} b={b} lead={lead} busy={busy} act={act} />)}
            </section>
          )}
          {builds.filter(b => b.status !== 'suggested' && b.status !== 'dismissed').map(b => <BuildCard key={b.id} b={b} lead={lead} busy={busy} act={act} />)}
          {builds.some(b => b.status === 'dismissed') && (
            <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowDismissed(!showDismissed)}>
              {showDismissed ? 'Hide' : 'Show'} {builds.filter(b => b.status === 'dismissed').length} dismissed suggestion(s)
            </button>
          )}
          {showDismissed && builds.filter(b => b.status === 'dismissed').map(b => <SuggestionCard key={b.id} b={b} lead={false} busy={busy} act={act} />)}
        </>
      )}
    </div>
  );
}

function BuildCard({ b, lead, busy, act }: { b: Build; lead: boolean; busy: string | null; act: (b: Build, action: string, extra?: Record<string, string>) => Promise<boolean> }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const open = b.status !== 'published' && b.status !== 'discarded';
  const [tag, label] = TAG[b.status];
  const working = (a: string) => busy === b.id + a;

  return (
    <article className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={'tag ' + tag}>{b.status === 'building' && <CircleNotch className="spin" style={{ marginRight: 4 }} />}{label}</span>
            {b.kind === 'rollback' && <span className="tag tag-outline">Rollback</span>}
            <span className="meta">#{b.number} · {b.requestedBy} · {day(b.requestedAt)}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 500 }}>{b.title}</div>
          <div style={{ fontSize: 13, color: 'var(--color-neutral-300)' }}>{b.status === 'published' ? `Published${b.publishedBy ? ' by ' + b.publishedBy : ''} ${day(b.publishedAt)}.` : b.detail}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {b.previewUrl && <a className="btn btn-primary" href={b.previewUrl} target="_blank" rel="noopener"><ArrowSquareOut />Open preview</a>}
          {(b.prUrl || b.issueUrl) && <a className="btn btn-ghost" href={b.prUrl || b.issueUrl!} target="_blank" rel="noopener" aria-label="View on GitHub"><GithubLogo />GitHub</a>}
        </div>
      </div>

      <div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-neutral-200)', whiteSpace: 'pre-wrap', ...(more ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>{b.description}</p>
        {b.description.length > 200 && <button className="link-btn" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more'}</button>}
      </div>

      {b.events.filter(e => e.kind === 'feedback').length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {b.events.filter(e => e.kind === 'feedback').map((e, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--color-neutral-300)', display: 'flex', gap: 8 }}>
              <ChatCircleText size={15} style={{ flex: 'none', marginTop: 2, color: 'var(--color-neutral-500)' }} /><span><strong style={{ fontWeight: 500 }}>{e.who}</strong> · {day(e.at)}: {e.note}</span>
            </div>
          ))}
        </div>
      )}

      {lead && feedback !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea className="input" autoFocus value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="What should change? Be specific: what you saw in the preview and what you want instead." aria-label="Changes to make" />
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setFeedback(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!feedback.trim() || working('changes')} onClick={async () => { if (await act(b, 'changes', { feedback })) setFeedback(null); }}>{working('changes') ? 'Sending…' : 'Send to Claude'}</button>
          </div>
        </div>
      )}

      {lead && (open || b.status === 'published') && feedback === null && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {b.status === 'ready' && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => confirm(`Publish “${b.title}”? Everyone using the CRM gets this change within a couple of minutes. Make sure you’ve tried the preview.`) && act(b, 'publish')}>
              <Rocket />{working('publish') ? 'Publishing…' : 'Publish'}
            </button>
          )}
          {open && <button className="btn btn-secondary" disabled={!!busy} onClick={() => setFeedback('')}><ChatCircleText />Ask for changes</button>}
          {open && <button className="btn btn-secondary" disabled={!!busy} onClick={() => confirm(`Discard “${b.title}”? The work is thrown away; nothing goes live.`) && act(b, 'discard')}><Trash />Discard</button>}
          {b.status === 'published' && b.kind === 'feature' && (
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => confirm(`Roll back “${b.title}”? Claude prepares a new build that undoes it, which you preview and publish like any other.`) && act(b, 'rollback')}>
              <ArrowCounterClockwise />Roll back
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function SuggestionCard({ b, lead, busy, act }: { b: Build; lead: boolean; busy: string | null; act: (b: Build, action: string, extra?: Record<string, string>) => Promise<boolean> }) {
  const [more, setMore] = useState(false);
  const working = (a: string) => busy === b.id + a;
  return (
    <article className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-3)', opacity: b.status === 'dismissed' ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={'tag ' + TAG[b.status][0]}><Lightbulb style={{ marginRight: 4 }} />{TAG[b.status][1]}</span>
        {b.impact && <span className="meta">{b.impact} impact</span>}
        {b.effort && <span className="meta">· {b.effort} change</span>}
        <span className="meta">· {day(b.requestedAt)}</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 500 }}>{b.title}</div>
      {b.reason && <div style={{ fontSize: 13, color: 'var(--color-accent-300)' }}>Why: {b.reason}</div>}
      <p style={{ margin: 0, fontSize: 14, color: 'var(--color-neutral-200)', whiteSpace: 'pre-wrap', ...(more ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>{b.description}</p>
      {b.description.length > 200 && <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more'}</button>}
      {lead && b.status === 'suggested' && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => confirm(`Build “${b.title}”? Claude Code starts building it; you’ll still preview it before anything goes live.`) && act(b, 'approve')}>
            <Hammer />{working('approve') ? 'Starting…' : 'Build it'}
          </button>
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => act(b, 'dismiss')}><X />{working('dismiss') ? 'Dismissing…' : 'Dismiss'}</button>
        </div>
      )}
    </article>
  );
}
