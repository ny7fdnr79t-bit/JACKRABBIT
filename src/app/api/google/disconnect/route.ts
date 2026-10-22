import { NextResponse } from 'next/server';
import { currentMember } from '@/lib/auth.server';
import { admin } from '@/lib/supabase/admin';
import { revoke } from '@/lib/google.server';

export const dynamic = 'force-dynamic';

// Disconnects the signed-in member's own Google account and revokes the token.
export async function POST() {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  await revoke(me.id);
  const { error } = await admin().rpc('google_disconnect', { p_profile: me.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
