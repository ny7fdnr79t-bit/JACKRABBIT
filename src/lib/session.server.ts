import 'server-only';
import { createClient } from '@/lib/supabase/server';

// The signed-in, active member making this request, with their RLS-bound client.
export async function currentMember() {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data: me } = await sb.from('profiles').select('id,name,role,active').eq('id', auth.user.id).maybeSingle();
  if (!me?.active) return null;
  return { sb, me: { id: me.id as string, name: me.name as string, role: me.role as string } };
}
