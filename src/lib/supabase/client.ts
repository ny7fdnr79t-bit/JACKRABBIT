import { createBrowserClient } from '@supabase/ssr';
import { supabaseUrl, supabaseAnonKey, NOT_CONFIGURED } from './env';

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabase() {
  if (!client) {
    const url = supabaseUrl();
    const key = supabaseAnonKey();
    if (!url || !key) throw new Error(NOT_CONFIGURED);
    client = createBrowserClient(url, key);
  }
  return client;
}
