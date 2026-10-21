'use server';

import { createClient } from '@/lib/supabase/server';
import { admin } from '@/lib/supabase/admin';
import { USER_ROLES } from '@/lib/crm';

// Public sign-ups are off, so this is the only way an account gets created.
// Leadership adds someone by email; they then sign in with an emailed code.
export async function addMember(input: { email: string; name: string; role: string }): Promise<{ error?: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const role = (USER_ROLES as readonly string[]).includes(input.role) ? input.role : 'Account manager';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: 'Sign in again.' };
  const { data: lead } = await sb.rpc('is_leadership');
  if (!lead) return { error: 'Only Leadership can add people.' };

  const db = admin();
  const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } });
    if (error || !data.user) return { error: error?.message || 'Couldn’t create the account.' };
    id = data.user.id;
  }
  const { error } = await db.from('profiles').update({ active: true, role, ...(name ? { name } : {}) }).eq('id', id);
  return error ? { error: error.message } : {};
}
