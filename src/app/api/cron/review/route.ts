import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase/admin';
import { ReviewError, runReview } from '@/lib/review.server';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Weekly self-review, called by Vercel Cron (see vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; anything else is turned away.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runReview(admin(), null));
  } catch (e) {
    return NextResponse.json({ error: e instanceof ReviewError ? e.message : 'The review couldn’t run.' }, { status: 502 });
  }
}
