import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type Member = { id: string; name: string; email: string; role: string; signature: string };

// The signed-in, active team member making this request, or null.
export async function currentMember(): Promise<Member | null> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data } = await sb.from('profiles').select('id,name,email,role,signature,active').eq('id', auth.user.id).maybeSingle();
  if (!data?.active) return null;
  return { id: data.id, name: data.name || data.email, email: data.email, role: data.role, signature: data.signature || '' };
}
