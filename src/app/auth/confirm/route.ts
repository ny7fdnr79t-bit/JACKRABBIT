import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

// The link in the sign-in email lands here. It carries a one-time token hash,
// so it works in whichever browser opens it (unlike a PKCE ?code= link).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get('token_hash');
  const type = (searchParams.get('type') || 'email') as EmailOtpType;
  if (token_hash) {
    const sb = await createClient();
    const { error } = await sb.auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(origin + '/');
  }
  return NextResponse.redirect(origin + '/login?error=link');
}
