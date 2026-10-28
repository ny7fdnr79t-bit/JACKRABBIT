import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// App changes built from inside the CRM.
//
//   request ──▶ GitHub issue (label "claude") ──▶ Claude Code GitHub Action
//     builds on branch claude/issue-<n>-… ──▶ pull request ──▶ Vercel preview
//     ──▶ Leadership clicks Publish ──▶ pull request merged ──▶ deploy
//
// GitHub is the source of truth for progress; the feature_requests table
// records who asked, who published, and when. Everything here runs on the
// server with GITHUB_TOKEN (fine-grained, this repo only).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export type BuildStatus = 'building' | 'ready' | 'published' | 'discarded' | 'failed';

export type Build = {
  id: string;
  number: number | null;          // issue number
  kind: 'feature' | 'rollback';
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  status: BuildStatus;
  detail: string;                 // one line for people: what's happening now
  issueUrl: string | null;
  prNumber: number | null;
  prUrl: string | null;
  previewUrl: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  events: { at: string; who: string; kind: string; note: string }[];
};

export class BuildError extends Error {}

const repo = () => process.env.GITHUB_REPO || 'ny7fdnr79t-bit/JACKRABBIT';
const base = () => process.env.GITHUB_BASE_BRANCH || 'crm-nextjs';
const label = () => process.env.GITHUB_REQUEST_LABEL || 'claude';
export const buildsConfigured = () => !!process.env.GITHUB_TOKEN;

async function gh(path: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new BuildError('App changes aren’t connected yet: GITHUB_TOKEN isn’t set on the server.');
  const r = await fetch('https://api.github.com/repos/' + repo() + path, {
    ...init,
    cache: 'no-store',
    headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', ...(init.headers || {}) }
  });
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new BuildError(`GitHub said: ${body.message || r.status}`);
  return body;
}

// ── Filing ──────────────────────────────────────────────────────────────

const instructions = () =>
  `\n\n---\nBuild this on a new branch from \`${base()}\` and open a pull request against \`${base()}\` that says "Closes #<this issue>". ` +
  `Follow README.md. Keep the Nocturne design and the existing patterns. Run \`npm run typecheck\` and \`npm run build\` before finishing. ` +
  `If the change needs a database change, add a new file under supabase/migrations/ (never edit an existing one) and say in the pull request that it must be run in Supabase before publishing. ` +
  `Don't touch secrets, auth, row level security or payment code unless the request is about them, and call out any such change in the pull request.`;

export async function fileRequest(sb: SupabaseClient, me: { id: string; name: string; role: string }, title: string, description: string, kind: 'feature' | 'rollback' = 'feature') {
  const issue = await gh('/issues', {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: `${description}\n\nRequested from the CRM by **${me.name}** (${me.role}) on ${new Date().toISOString().slice(0, 10)}.${instructions()}`,
      labels: [label()]
    })
  });
  const { data, error } = await sb.from('feature_requests')
    .insert({ user_id: me.id, title, description, kind, issue_url: issue.html_url, issue_number: issue.number })
    .select('id').single();
  if (error) throw new BuildError(error.message);
  await sb.from('build_events').insert({ request_id: data.id, user_id: me.id, kind: kind === 'rollback' ? 'rollback' : 'requested', note: title });
  return { id: data.id as string, number: issue.number as number, url: issue.html_url as string };
}

// ── Status ──────────────────────────────────────────────────────────────

// Shared per-request snapshot of the repo, so one refresh costs a handful of API calls.
async function snapshot() {
  const [pulls, runs] = await Promise.all([
    gh('/pulls?state=all&sort=created&direction=desc&per_page=50'),
    gh('/actions/workflows/claude.yml/runs?per_page=30').catch(() => ({ workflow_runs: [] }))
  ]);
  return { pulls: pulls as Row[], runs: (runs?.workflow_runs || []) as Row[] };
}

function findPr(pulls: Row[], n: number) {
  return pulls.find(p => String(p.head?.ref || '').startsWith(`claude/issue-${n}-`))
    || pulls.find(p => new RegExp(`(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, 'i').test(p.body || ''));
}

async function previewFor(sha: string): Promise<{ url: string | null; state: string }> {
  const deps = (await gh(`/deployments?sha=${sha}&per_page=5`).catch(() => [])) as Row[];
  for (const d of deps) {
    const st = ((await gh(`/deployments/${d.id}/statuses?per_page=1`).catch(() => [])) as Row[])[0];
    if (st) return { url: st.environment_url || st.target_url || null, state: st.state };
  }
  return { url: null, state: 'pending' };
}

async function statusOf(row: Row, snap: Awaited<ReturnType<typeof snapshot>>): Promise<Pick<Build, 'status' | 'detail' | 'prNumber' | 'prUrl' | 'previewUrl'>> {
  const n = row.issue_number as number;
  if (row.discarded_at) return { status: 'discarded', detail: 'Discarded.', prNumber: row.pr_number, prUrl: null, previewUrl: null };
  let pr = findPr(snap.pulls, n);
  const running = snap.runs.find(r => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(r.status)
    && (r.display_title === row.title || (pr && r.display_title === pr.title)));
  const lastRun = snap.runs.find(r => r.display_title === row.title || (pr && r.display_title === pr.title));

  // Claude sometimes pushes the branch without opening the pull request; open it for the reviewer.
  if (!pr && !running) {
    const refs = (await gh(`/git/matching-refs/heads/claude/issue-${n}-`).catch(() => [])) as Row[];
    const ref = refs[refs.length - 1];
    if (ref) {
      pr = await gh('/pulls', {
        method: 'POST',
        body: JSON.stringify({ title: row.title, head: ref.ref.replace('refs/heads/', ''), base: base(), body: `Closes #${n}\n\nOpened from the CRM for review.` })
      }).catch(() => null);
    }
  }

  if (!pr) {
    if (running) return { status: 'building', detail: 'Claude is building it…', prNumber: null, prUrl: null, previewUrl: null };
    if (lastRun?.conclusion === 'failure') return { status: 'failed', detail: 'The build stopped with an error. Ask for changes to try again, or discard it.', prNumber: null, prUrl: null, previewUrl: null };
    const stale = Date.now() - new Date(row.created_at).getTime() > 10 * 60_000;
    return {
      status: 'building', prNumber: null, prUrl: null, previewUrl: null,
      detail: stale && !lastRun ? 'Claude hasn’t picked this up. Check that the Claude GitHub app and workflow are set up (see README).' : 'Waiting for Claude to start…'
    };
  }

  const info = { prNumber: pr.number as number, prUrl: pr.html_url as string };
  if (pr.merged_at) return { ...info, status: 'published', detail: 'Published.', previewUrl: null };
  if (pr.state === 'closed') return { ...info, status: 'discarded', detail: 'The pull request was closed.', previewUrl: null };
  if (running) return { ...info, status: 'building', detail: 'Claude is working on your changes…', previewUrl: null };
  const preview = await previewFor(pr.head.sha);
  if (preview.state === 'success') return { ...info, status: 'ready', detail: 'Ready to try. Open the preview, then publish or ask for changes.', previewUrl: preview.url };
  if (preview.state === 'failure' || preview.state === 'error') return { ...info, status: 'failed', detail: 'The preview failed to build. Ask for changes to fix it.', previewUrl: preview.url };
  return { ...info, status: 'building', detail: 'Building the preview…', previewUrl: null };
}

export async function listBuilds(sb: SupabaseClient): Promise<Build[]> {
  const { data: rows, error } = await sb.from('feature_requests').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) throw new BuildError(error.message);
  if (!rows?.length) return [];
  const [{ data: people }, { data: events }, snap] = await Promise.all([
    sb.from('profiles').select('id,name'),
    sb.from('build_events').select('*').in('request_id', rows.map(r => r.id)).order('at'),
    snapshot()
  ]);
  const name = new Map((people || []).map(p => [p.id, p.name]));
  return Promise.all(rows.map(async r => {
    // Requests that are already settled don't need GitHub calls.
    const live = r.status === 'published' && r.published_at
      ? { status: 'published' as const, detail: 'Published.', prNumber: r.pr_number, prUrl: r.pr_number ? `https://github.com/${repo()}/pull/${r.pr_number}` : null, previewUrl: null }
      : await statusOf(r, snap).catch(e => ({ status: 'failed' as const, detail: e.message, prNumber: r.pr_number, prUrl: null, previewUrl: null }));
    if (live.status !== r.status || live.prNumber !== r.pr_number) {
      await sb.from('feature_requests').update({ status: live.status, pr_number: live.prNumber, updated_at: new Date().toISOString() }).eq('id', r.id);
    }
    return {
      id: r.id, number: r.issue_number, kind: r.kind, title: r.title, description: r.description,
      requestedBy: name.get(r.user_id) || 'Someone', requestedAt: r.created_at, issueUrl: r.issue_url,
      publishedAt: r.published_at, publishedBy: r.published_by ? name.get(r.published_by) || null : null,
      events: (events || []).filter(e => e.request_id === r.id).map(e => ({ at: e.at, who: name.get(e.user_id) || '', kind: e.kind, note: e.note })),
      ...live
    };
  }));
}

// ── Decisions (Leadership only; the caller checks the role) ─────────────

async function requestRow(sb: SupabaseClient, idOrNumber: string | number) {
  const q = sb.from('feature_requests').select('*');
  const { data } = typeof idOrNumber === 'number' || /^\d+$/.test(String(idOrNumber))
    ? await q.eq('issue_number', Number(idOrNumber)).maybeSingle()
    : await q.eq('id', idOrNumber).maybeSingle();
  if (!data) throw new BuildError('No build with that number.');
  return data as Row;
}

export async function requestChanges(sb: SupabaseClient, me: { id: string; name: string }, ref: string | number, feedback: string) {
  const r = await requestRow(sb, ref);
  if (r.status === 'published' || r.discarded_at) throw new BuildError('That build is finished. Ask for a new change instead.');
  const snap = await snapshot();
  const pr = findPr(snap.pulls, r.issue_number);
  // On the pull request Claude revises its branch; before one exists it restarts on the issue.
  await gh(`/issues/${pr ? pr.number : r.issue_number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `@claude ${feedback}\n\n— ${me.name}, from the CRM` })
  });
  await sb.from('feature_requests').update({ status: 'building', updated_at: new Date().toISOString() }).eq('id', r.id);
  await sb.from('build_events').insert({ request_id: r.id, user_id: me.id, kind: 'feedback', note: feedback });
}

export async function publish(sb: SupabaseClient, me: { id: string; name: string }, ref: string | number) {
  const r = await requestRow(sb, ref);
  const snap = await snapshot();
  const found = findPr(snap.pulls, r.issue_number);
  if (!found) throw new BuildError('There’s nothing to publish yet. Wait until it’s ready to review.');
  const pr = await gh(`/pulls/${found.number}`);
  if (pr.merged) throw new BuildError('That build is already published.');
  if (pr.state !== 'open') throw new BuildError('That build was closed.');
  const preview = await previewFor(pr.head.sha);
  if (preview.state !== 'success') throw new BuildError('The preview isn’t ready, so it can’t be published yet.');
  if (pr.mergeable === false) throw new BuildError('This build conflicts with newer changes. Ask for changes with “update this to the latest version” and try again.');
  await gh(`/pulls/${pr.number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: 'squash', sha: pr.head.sha, commit_title: `${pr.title} (#${pr.number})`, commit_message: `Published from the CRM by ${me.name}.` })
  });
  await sb.from('feature_requests').update({ status: 'published', pr_number: pr.number, published_at: new Date().toISOString(), published_by: me.id, updated_at: new Date().toISOString() }).eq('id', r.id);
  await sb.from('build_events').insert({ request_id: r.id, user_id: me.id, kind: 'published', note: `Merged #${pr.number}` });
  const needsMigration = /supabase\/migrations\//.test(JSON.stringify(await gh(`/pulls/${pr.number}/files?per_page=100`).catch(() => [])));
  return { prNumber: pr.number as number, needsMigration };
}

export async function discard(sb: SupabaseClient, me: { id: string; name: string }, ref: string | number) {
  const r = await requestRow(sb, ref);
  if (r.status === 'published') throw new BuildError('That build is published. Use Roll back instead.');
  const snap = await snapshot();
  const pr = findPr(snap.pulls, r.issue_number);
  if (pr && pr.state === 'open') await gh(`/pulls/${pr.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
  await gh(`/issues/${r.issue_number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) }).catch(() => {});
  await sb.from('feature_requests').update({ status: 'discarded', discarded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', r.id);
  await sb.from('build_events').insert({ request_id: r.id, user_id: me.id, kind: 'discarded', note: '' });
}

// Rolling back is itself a build: Claude prepares a revert, you try it and publish it.
export async function rollback(sb: SupabaseClient, me: { id: string; name: string; role: string }, ref: string | number) {
  const r = await requestRow(sb, ref);
  if (r.status !== 'published' || !r.pr_number) throw new BuildError('Only published builds can be rolled back.');
  return fileRequest(sb, me, `Roll back: ${r.title}`,
    `Undo the change published in pull request #${r.pr_number} ("${r.title}"). Revert exactly what that pull request changed and nothing else. ` +
    `If later changes depend on it, keep them working and explain what you did. If it added a database migration, add a new migration that reverses it only if that is safe for existing data; otherwise explain in the pull request.`, 'rollback');
}
