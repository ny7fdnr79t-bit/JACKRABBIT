import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses row level security. Use it only on the
// server, only for the client-facing token pages (sign, pay) and webhooks,
// and always filter by the unguessable token.
export function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY isn’t set.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
