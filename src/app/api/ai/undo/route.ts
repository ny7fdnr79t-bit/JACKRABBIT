import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { applyUndo, type UndoOp } from '@/lib/assistant/tools';

export const runtime = 'nodejs';

// Reverses every change from one assistant turn, newest first, using the
// caller's own session (so it can only undo what they're allowed to change).
export async function POST(request: Request) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const { turnId } = await request.json().catch(() => ({}));
  if (typeof turnId !== 'string' || !/^[0-9a-f-]{36}$/.test(turnId)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { data: rows, error } = await sb.from('ai_actions').select('id, undo, summary')
    .eq('turn_id', turnId).eq('user_id', auth.user.id).is('undone_at', null).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ error: 'Nothing to undo. It may already be undone.' }, { status: 404 });

  const undone: string[] = [];
  for (const r of rows) {
    try {
      await applyUndo(sb, r.undo as UndoOp[]);
    } catch (e) {
      return NextResponse.json({
        error: `Couldn’t undo “${r.summary}”: ${e instanceof Error ? e.message : 'unknown error'}. It may have changed since.`,
        undone
      }, { status: 409 });
    }
    await sb.from('ai_actions').update({ undone_at: new Date().toISOString() }).eq('id', r.id);
    undone.push(r.summary);
  }
  return NextResponse.json({ undone });
}
