import { NextResponse } from 'next/server';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

// Reports whether each setting is present (true/false). Never the values.
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
] as const;

// Needed by later features; false here just means that feature isn't set up yet.
const INTEGRATIONS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'QUO_API_KEY',
  'QUO_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY'
] as const;

// process.env[name] reads the runtime value on the server. NEXT_PUBLIC_* may
// also have been copied into the build, so check both forms for those two.
function present(name: string): boolean {
  const built: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  };
  return Boolean((built[name] ?? process.env[name])?.trim());
}

async function reachable(url: string | undefined, key: string | undefined): Promise<boolean> {
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const env = Object.fromEntries(REQUIRED.map(n => [n, present(n)]));
  const integrations = Object.fromEntries(INTEGRATIONS.map(n => [n, present(n)]));
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  const supabase = {
    url: Boolean(url),
    anonKey: Boolean(key),
    serviceRoleKey: present('SUPABASE_SERVICE_ROLE_KEY'),
    reachable: await reachable(url, key)
  };
  const ok = supabase.url && supabase.anonKey && supabase.serviceRoleKey && supabase.reachable;
  return NextResponse.json(
    { ok, supabase, env, integrations },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
  );
}
