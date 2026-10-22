import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/lib/auth.server';
import { createClient } from '@/lib/supabase/server';
import { GoogleError, mailboxFor } from '@/lib/google.server';
import { getThread, sendMail, validEmail } from '@/lib/gmail.server';

export const dynamic = 'force-dynamic';

// POST /api/gmail/send — a new email or a reply in a thread, from the team
// mailbox. The sent message is logged on the deal (communications).
// Body: { to: string[], cc?: string[], subject, body, threadId?, jobId?, contactId? }
export async function POST(req: NextRequest) {
  const me = await currentMember();
  if (!me) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const box = await mailboxFor(me.id);
  if (!box) return NextResponse.json({ error: 'Gmail isn’t connected. Connect it under Team.' }, { status: 409 });

  let b: { to?: unknown; cc?: unknown; subject?: unknown; body?: unknown; threadId?: unknown; jobId?: unknown; contactId?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Unreadable request' }, { status: 400 }); }
  const list = (x: unknown) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : []).map(s => String(s).trim()).filter(Boolean);
  const to = list(b.to), cc = list(b.cc);
  const bad = [...to, ...cc].find(e => !validEmail(e));
  if (!to.length) return NextResponse.json({ error: 'Add who it’s to.' }, { status: 400 });
  if (bad) return NextResponse.json({ error: bad + ' isn’t a valid email address.' }, { status: 400 });
  const text = String(b.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Write a message first.' }, { status: 400 });
  if (text.length > 50_000) return NextResponse.json({ error: 'That message is too long.' }, { status: 400 });
  let subject = String(b.subject || '').trim().slice(0, 300);
  const threadId = typeof b.threadId === 'string' && /^[0-9a-f]{6,32}$/i.test(b.threadId) ? b.threadId : undefined;

  try {
    // Replies keep Gmail's threading: same thread, In-Reply-To the last message.
    let inReplyTo: string | undefined, references: string | undefined;
    if (threadId) {
      const msgs = await getThread(box.profileId, threadId, box.email);
      const last = msgs[msgs.length - 1];
      if (last) {
        inReplyTo = last.messageId || undefined;
        references = last.references || undefined;
        if (!subject) subject = /^re:/i.test(last.subject) ? last.subject : 'Re: ' + last.subject;
      }
    }
    if (!subject) return NextResponse.json({ error: 'Add a subject.' }, { status: 400 });
    const body = me.signature.trim() ? text + '\n\n' + me.signature.trim() : text;
    const sent = await sendMail(box.profileId, { fromName: me.name, fromEmail: box.email, to, cc, subject, body, threadId, inReplyTo, references });

    const sb = await createClient();
    const jobId = typeof b.jobId === 'string' && /^[0-9a-f-]{36}$/.test(b.jobId) ? b.jobId : null;
    const contactId = typeof b.contactId === 'string' && /^[0-9a-f-]{36}$/.test(b.contactId) ? b.contactId : null;
    await sb.from('communications').insert({
      job_id: jobId, contact_id: contactId, user_id: me.id, kind: 'email', direction: 'out',
      subject, body, external_id: sent.id, thread_ref: sent.threadId
    });
    return NextResponse.json({ ok: true, id: sent.id, threadId: sent.threadId });
  } catch (e) {
    const status = e instanceof GoogleError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Couldn’t send the email' }, { status });
  }
}
