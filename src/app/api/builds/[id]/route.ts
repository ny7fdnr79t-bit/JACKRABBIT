import { NextResponse } from 'next/server';
import { currentMember } from '@/lib/session.server';
import { BuildError, discard, publish, requestChanges, rollback } from '@/lib/builds.server';

export const runtime = 'nodejs';

// POST { action: 'changes' | 'publish' | 'discard' | 'rollback', feedback? } — Leadership only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await currentMember();
  if (!s) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (s.me.role !== 'Leadership') return NextResponse.json({ error: 'Only Leadership can change builds.' }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const { action, feedback } = await request.json().catch(() => ({}));
  try {
    if (action === 'changes') {
      const f = String(feedback || '').trim().slice(0, 4000);
      if (!f) return NextResponse.json({ error: 'Say what to change.' }, { status: 400 });
      await requestChanges(s.sb, s.me, id, f);
      return NextResponse.json({ ok: true });
    }
    if (action === 'publish') return NextResponse.json(await publish(s.sb, s.me, id));
    if (action === 'discard') { await discard(s.sb, s.me, id); return NextResponse.json({ ok: true }); }
    if (action === 'rollback') return NextResponse.json(await rollback(s.sb, s.me, id));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof BuildError ? e.message : 'Something went wrong.' }, { status: 502 });
  }
}
