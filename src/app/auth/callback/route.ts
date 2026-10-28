import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// Sign-ins land here.
// - ?token_hash=…&type=email  from the email templates: works on any device or browser.
// - ?code=…                   from Google / Microsoft (and the default email link),
//                             which only works in the browser that asked for it.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const sb = await createClient();

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(origin + '/');
    return NextResponse.redirect(origin + '/login?error=expired');
  }

  const code = searchParams.get('code');
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(origin + '/');
    return NextResponse.redirect(origin + '/login?error=browser');
  }

  const err = searchParams.get('error_description');
  return NextResponse.redirect(origin + '/login?error=' + (err && /expired/i.test(err) ? 'expired' : 'signin'));
}
