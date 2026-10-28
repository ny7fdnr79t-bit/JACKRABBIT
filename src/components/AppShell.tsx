'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useOpenJob } from '@/lib/useOpenJob';
import {
  Recycle, SquaresFour, Kanban, FileText, CheckSquare, GlobeSimple, Tray, UsersThree, SignOut, Warning, X, Receipt, Signature, Hammer
} from '@phosphor-icons/react';
import { CrmProvider, useCrm } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';
import { initials, PROTECTED_STAGES, type Profile } from '@/lib/crm';
import JobDrawer from '@/components/JobDrawer';
import NewDealDialog from '@/components/NewDealDialog';
import { AiProvider, AskAiButton } from '@/components/AiPanel';

export default function AppShell({ me, children }: { me: Profile; children: React.ReactNode }) {
  return (
    <CrmProvider me={me}>
      <AiProvider>
      <div className="shell">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      <Suspense>
        <JobDrawerRoute />
      </Suspense>
      <NewDealDialog />
      <ErrorToast />
      </AiProvider>
    </CrmProvider>
  );
}

function JobDrawerRoute() {
  const id = useSearchParams().get('job');
  const open = useOpenJob();
  return id ? <JobDrawer id={id} onClose={() => open(null)} /> : null;
}

// Which screens get used feeds the weekly self-review.
function useScreenViews() {
  const path = usePathname();
  const screen = path.split('/')[1] || 'overview';
  useEffect(() => {
    supabase().from('app_events').insert({ kind: 'view', screen }).then(() => {});
  }, [screen]);
}

function Sidebar() {
  useScreenViews();
  const { me, jobs, tasks, settings, invoices, agreements } = useCrm();
  const path = usePathname();
  const openStages = settings.stages.filter(s => !PROTECTED_STAGES.includes(s));
  const nav = [
    { href: '/overview', label: 'Overview', icon: SquaresFour, count: '' },
    { href: '/pipeline', label: 'Pipeline', icon: Kanban, count: String(jobs.filter(j => openStages.includes(j.stage)).length) },
    { href: '/contracts', label: 'Contracts', icon: FileText, count: String(jobs.filter(j => j.stage === 'Won' && j.status !== 'Completed').length) },
    { href: '/tasks', label: 'Tasks', icon: CheckSquare, count: String(tasks.filter(t => !t.done).length) },
    { href: '/agreements', label: 'Agreements', icon: Signature, count: String(agreements.filter(a => a.status === 'Sent').length || '') },
    { href: '/invoices', label: 'Invoices', icon: Receipt, count: String(invoices.filter(x => x.status === 'Sent').length || '') },
    { href: '', label: 'Web leads', icon: GlobeSimple, count: '' },
    { href: '', label: 'Inbox', icon: Tray, count: '' },
    { href: '/team', label: 'Team', icon: UsersThree, count: '' },
    { href: '/builds', label: 'Builds', icon: Hammer, count: '' }
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Recycle /></div>
        <span className="brand-name">Wastely</span>
      </div>
      <nav className="nav-list">
        {nav.map(n => n.href ? (
          <Link key={n.label} href={n.href} className="nav-item" aria-current={path.startsWith(n.href) ? 'page' : undefined}>
            <n.icon /><span className="label">{n.label}</span><span className="count">{n.count}</span>
          </Link>
        ) : (
          <span key={n.label} className="nav-item" aria-disabled="true" title="Coming in a later phase">
            <n.icon /><span className="label">{n.label}</span><span className="count">Soon</span>
          </span>
        ))}
      </nav>
      <div className="sidebar-foot">
        <AskAiButton />
        <div className="me">
          <span className="me-avatar">{initials(me.name)}</span>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span className="me-name">{me.name}</span>
            <span className="me-role">{me.role}</span>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost" type="submit" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}><SignOut />Sign out</button>
        </form>
      </div>
    </aside>
  );
}

function ErrorToast() {
  const { error, clearError } = useCrm();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);
  if (!error) return null;
  return (
    <div className="toast" role="alert">
      <Warning className="warn" />{error}
      <button className="icon-btn del" onClick={clearError} aria-label="Dismiss"><X /></button>
    </div>
  );
}
