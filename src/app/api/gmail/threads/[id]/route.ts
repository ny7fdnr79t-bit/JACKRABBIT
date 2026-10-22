import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/lib/auth.server';
import { GoogleError, mailboxFor } from '@/lib/google.server';
import { getThread } from '@/lib/gmail.server';

export const dynamic = 'force-dynamic';

// GET /api/gmail/threads/<thread id> — the messages in one thread, as plain text.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f]{6,32}$/i.test(id)) return NextResponse.json({ error: 'Bad thread id' }, { status: 400 });
  const box = await mailboxFor(me.id);
  if (!box) return NextResponse.json({ error: 'not_connected' }, { status: 409 });
  try {
    const messages = await getThread(box.profileId, id, box.email);
    return NextResponse.json({ mailbox: box.email, messages }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const status = e instanceof GoogleError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gmail request failed' }, { status });
  }
}
