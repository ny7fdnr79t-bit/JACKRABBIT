import { NextResponse } from 'next/server';
import { currentMember } from '@/lib/session.server';
import { ReviewError, runReview } from '@/lib/review.server';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST: run the self-review now (Leadership only).
export async function POST() {
  const s = await currentMember();
  if (!s) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (s.me.role !== 'Leadership') return NextResponse.json({ error: 'Only Leadership can run the review.' }, { status: 403 });
  try {
    return NextResponse.json(await runReview(s.sb, s.me.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof ReviewError ? e.message : 'The review couldn’t run.' }, { status: 502 });
  }
}
