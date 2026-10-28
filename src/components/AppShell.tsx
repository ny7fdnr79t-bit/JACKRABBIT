'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useOpenJob } from '@/lib/useOpenJob';
import {
  Recycle, SquaresFour, Kanban, FileText, CheckSquare, Tray, UsersThree, SignOut, Warning, X, Receipt, Signature, Hammer, Plus, Phone
} from '@phosphor-icons/react';
import { CrmProvider, useCrm } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';
import { initials, PROTECTED_STAGES, type Profile } from '@/lib/crm';
import JobDrawer from '@/components/JobDrawer';
import NewDealDialog from '@/components/NewDealDialog';
import { AiProvider, AskAiButton } from '@/components/AiPanel';
import { LogLeadProvider, useLogLead } from '@/components/LogLeadDialog';

export default function AppShell({ me, children }: { me: Profile; children: React.ReactNode }) {
  return (
    <CrmProvider me={me}>
      <AiProvider>
      <LogLeadProvider>
      <div className="shell">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      <Suspense>
        <JobDrawerRoute />
      </Suspense>
      <NewDealDialog />
      <ErrorToast />
      </LogLeadProvider>
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
  const { me, jobs, tasks, settings, invoices, agreements, leads, setNewDeal } = useCrm();
  const logLead = useLogLead();
  const path = usePathname();
  const openStages = settings.stages.filter(s => !PROTECTED_STAGES.includes(s));
  const n = (x: number) => (x ? String(x) : '');
  // Grouped by what people do: win work, run it, get paid, set up.
  const groups = [
    { label: '', items: [
      { href: '/overview', label: 'Overview', icon: SquaresFour, count: '' },
      { href: '/leads', label: 'Leads', icon: Tray, count: n(leads.filter(l => l.status === 'new').length), hot: true },
      { href: '/pipeline', label: 'Pipeline', icon: Kanban, count: n(jobs.filter(j => openStages.includes(j.stage)).length) }
    ] },
    { label: 'Work', items: [
      { href: '/contracts', label: 'Contracts', icon: FileText, count: n(jobs.filter(j => j.stage === 'Won' && j.status !== 'Completed').length) },
      { href: '/tasks', label: 'Tasks', icon: CheckSquare, count: n(tasks.filter(t => !t.done).length) }
    ] },
    { label: 'Money', items: [
      { href: '/agreements', label: 'Agreements', icon: Signature, count: n(agreements.filter(a => a.status === 'Sent').length) },
      { href: '/invoices', label: 'Invoices', icon: Receipt, count: n(invoices.filter(x => x.status === 'Sent').length) }
    ] },
    { label: 'Setup', items: [
      { href: '/team', label: 'Team', icon: UsersThree, count: '' },
      { href: '/builds', label: 'Builds', icon: Hammer, count: '' }
    ] }
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Recycle /></div>
        <span className="brand-name">Wastely</span>
      </div>
      <div className="quick">
        <button className="btn btn-primary" onClick={() => setNewDeal(true)}><Plus />New deal</button>
        <button className="btn btn-secondary" onClick={logLead} title="Log a phone call, text or referral"><Phone />Log call</button>
      </div>
      <nav className="nav-list" aria-label="Main">
        {groups.map(g => (
          <div key={g.label || 'main'} className="nav-group">
            {g.label && <div className="nav-heading">{g.label}</div>}
            {g.items.map(i => (
              <Link key={i.href} href={i.href} className="nav-item" aria-current={path.startsWith(i.href) ? 'page' : undefined}>
                <i.icon /><span className="label">{i.label}</span>
                <span className={'count' + ('hot' in i && i.hot && i.count ? ' count-hot' : '')}>{i.count}</span>
              </Link>
            ))}
          </div>
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
