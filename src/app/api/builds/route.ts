import { NextResponse } from 'next/server';
import { currentMember } from '@/lib/session.server';
import { BuildError, buildsConfigured, fileRequest, listBuilds } from '@/lib/builds.server';

export const runtime = 'nodejs';

// GET: every app change requested from the CRM, with live status from GitHub.
export async function GET() {
  const s = await currentMember();
  if (!s) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (!buildsConfigured()) return NextResponse.json({ configured: false, builds: [] });
  try {
    const [builds, { data: review }] = await Promise.all([
      listBuilds(s.sb),
      s.sb.from('self_reviews').select('at,suggestions,summary').order('at', { ascending: false }).limit(1).maybeSingle()
    ]);
    return NextResponse.json({ configured: true, builds, lastReview: review }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof BuildError ? e.message : 'Couldn’t load builds.' }, { status: 502 });
  }
}

// POST { title, description }: request a new change (Leadership only).
export async function POST(request: Request) {
  const s = await currentMember();
  if (!s) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (s.me.role !== 'Leadership') return NextResponse.json({ error: 'Only Leadership can request app changes.' }, { status: 403 });
  const { title, description } = await request.json().catch(() => ({}));
  const t = String(title || '').trim().slice(0, 120), d = String(description || '').trim().slice(0, 6000);
  if (!t || !d) return NextResponse.json({ error: 'Give a title and describe the change.' }, { status: 400 });
  try {
    return NextResponse.json(await fileRequest(s.sb, s.me, t, d));
  } catch (e) {
    return NextResponse.json({ error: e instanceof BuildError ? e.message : 'Couldn’t file the request.' }, { status: 502 });
  }
}
