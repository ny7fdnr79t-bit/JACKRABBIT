import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/lib/auth.server';
import { GoogleError, mailboxFor } from '@/lib/google.server';
import { listThreads, validEmail } from '@/lib/gmail.server';

export const dynamic = 'force-dynamic';

// GET /api/gmail/threads?email=client@example.com — recent threads with that address.
export async function GET(req: NextRequest) {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const email = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!validEmail(email)) return NextResponse.json({ error: 'That isn’t a valid email address.' }, { status: 400 });
  const box = await mailboxFor(me.id);
  if (!box) return NextResponse.json({ error: 'not_connected' }, { status: 409 });
  try {
    const threads = await listThreads(box.profileId, email);
    return NextResponse.json({ mailbox: box.email, threads }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const status = e instanceof GoogleError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gmail request failed' }, { status });
  }
}
