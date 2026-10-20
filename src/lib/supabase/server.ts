import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseUrl, supabaseAnonKey, NOT_CONFIGURED } from './env';

export async function createClient() {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) throw new Error(NOT_CONFIGURED);
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => {
        // Server components can't set cookies; the proxy refreshes the session instead.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      }
    }
  });
}
