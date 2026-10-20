import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseUrl, supabaseAnonKey, NOT_CONFIGURED } from '@/lib/supabase/env';

// Signed-out pages: sign-in, plus the client links for signing and paying.
const PUBLIC = ['/login', '/auth', '/sign/', '/pay/'];

// Refreshes the Supabase session cookie on every request and sends signed-out
// visitors to /login. Real authorization is row level security in Postgres.
export async function proxy(request: NextRequest) {
  const sbUrl = supabaseUrl();
  const sbKey = supabaseAnonKey();
  if (!sbUrl || !sbKey) {
    return new NextResponse(NOT_CONFIGURED + ' Check /api/health to see which ones are missing.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
  let response = NextResponse.next({ request });
  const sb = createServerClient(sbUrl, sbKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  const { data } = await sb.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!data.user && !PUBLIC.some(p => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|api/).*)']
};
