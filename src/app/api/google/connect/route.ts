import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/lib/auth.server';
import { authUrl, googleConfigured } from '@/lib/google.server';

export const dynamic = 'force-dynamic';

// Returns a Google consent link for the signed-in member. The Team page shows
// it as a normal link, so it opens in a new tab (or, in the Mac app, in the
// default browser, where Google allows sign-in).
export async function POST(req: NextRequest) {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (!googleConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  return NextResponse.json({ url: authUrl(me.id, req.nextUrl.origin) }, { headers: { 'cache-control': 'no-store' } });
}
