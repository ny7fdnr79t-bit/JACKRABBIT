import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/AppShell';
import type { Profile } from '@/lib/crm';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/login');

  const { data: p } = await sb.from('profiles').select('id,name,role,email,quo_phone,active').eq('id', auth.user.id).maybeSingle();
  if (!p?.active) {
    return (
      <main className="login">
        <div className="dialog login-card">
          <div className="dialog-title">Access pending</div>
          <div className="dialog-body">
            {auth.user.email} is signed in, but isn’t an active Wastely CRM member yet. Ask someone in Leadership to activate you under Team.
          </div>
          <form action="/auth/signout" method="post" className="dialog-actions">
            <button className="btn btn-secondary" type="submit">Sign out</button>
          </form>
        </div>
      </main>
    );
  }

  const me: Profile = { id: p.id, name: p.name || p.email, role: p.role, email: p.email, quoPhone: p.quo_phone || '', active: p.active };
  return <AppShell me={me}>{children}</AppShell>;
}
