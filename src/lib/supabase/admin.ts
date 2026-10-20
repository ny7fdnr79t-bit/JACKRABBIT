import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, NOT_CONFIGURED } from './env';

// Service-role client: bypasses row level security. Use it only on the
// server, only for the client-facing token pages (sign, pay) and webhooks,
// and always filter by the unguessable token.
export function admin() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error(NOT_CONFIGURED);
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY isn’t set.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
