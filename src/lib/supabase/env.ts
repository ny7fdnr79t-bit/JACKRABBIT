// Where the Supabase URL and anon key come from.
//
// Next.js copies NEXT_PUBLIC_* values into the build when it runs, so a deploy
// built before those variables were saved (or while one was still blank) keeps
// shipping without them, however many times the page reloads. To survive that:
//   - on the server, fall back to SUPABASE_URL / SUPABASE_ANON_KEY, read at runtime;
//   - in the browser, fall back to the values the root layout writes into the
//     page at request time (window.__SUPABASE_ENV__).
// The anon key is public by design (row level security protects the data).
// The service-role key never goes through here.

declare global {
  interface Window {
    __SUPABASE_ENV__?: { url?: string; anonKey?: string };
  }
}

const fromWindow = () => (typeof window === 'undefined' ? undefined : window.__SUPABASE_ENV__);

export function supabaseUrl(): string | undefined {
  // Literal process.env.NEXT_PUBLIC_… access so Next.js can inline it.
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || fromWindow()?.url || undefined;
}

export function supabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || fromWindow()?.anonKey || undefined;
}

export function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export const NOT_CONFIGURED =
  'Wastely CRM can’t find its Supabase settings. In Vercel → Settings → Environment Variables, set SUPABASE_URL and SUPABASE_ANON_KEY (or the NEXT_PUBLIC_ versions) for Production, then redeploy.';
