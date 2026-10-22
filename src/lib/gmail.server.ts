import 'server-only';
import { google } from '@/lib/google.server';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type ThreadSummary = { id: string; subject: string; snippet: string; from: string; date: string; count: number; unread: boolean };
export type Message = {
  id: string; from: string; to: string; cc: string; date: string; subject: string;
  messageId: string; references: string; text: string; quoted: string; attachments: string[]; outgoing: boolean;
};

type Header = { name: string; value: string };
type Part = { mimeType?: string; filename?: string; headers?: Header[]; body?: { data?: string; size?: number }; parts?: Part[] };
type GMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

const header = (p: Part | undefined, name: string) => p?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

export const validEmail = (e: string) => /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/.test(e);

const decode = (data?: string) => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyOf(p: Part | undefined): { text: string; attachments: string[] } {
  let plain = '', html = '';
  const attachments: string[] = [];
  const walk = (x?: Part) => {
    if (!x) return;
    if (x.filename) { attachments.push(x.filename); return; }
    if (x.mimeType === 'text/plain' && !plain) plain = decode(x.body?.data);
    else if (x.mimeType === 'text/html' && !html) html = decode(x.body?.data);
    x.parts?.forEach(walk);
  };
  walk(p);
  return { text: (plain || htmlToText(html)).replace(/\r\n/g, '\n').trim(), attachments };
}

// Splits off the quoted earlier messages so the thread reads cleanly.
function splitQuoted(text: string) {
  const lines = text.split('\n');
  const i = lines.findIndex((l, n) =>
    /^On .{4,200}wrote:\s*$/.test(l.trim()) ||
    (/^On .{4,120}$/.test(l.trim()) && /wrote:\s*$/.test((lines[n + 1] || '').trim())) ||
    /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) ||
    /^From: .+/.test(l.trim()) && /^(Sent|Date): /.test((lines[n + 1] || '').trim()));
  if (i <= 0) return { text: text.trim(), quoted: '' };
  return { text: lines.slice(0, i).join('\n').trim(), quoted: lines.slice(i).join('\n').trim() };
}

export async function listThreads(profileId: string, email: string, max = 15): Promise<ThreadSummary[]> {
  const q = `from:${email} OR to:${email} OR cc:${email}`;
  const list = await google<{ threads?: { id: string }[] }>(profileId, `${API}/threads?maxResults=${max}&q=${encodeURIComponent(q)}`);
  const ids = (list.threads || []).map(t => t.id);
  const meta = '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
  const threads = await Promise.all(ids.map(id => google<{ id: string; messages: GMessage[] }>(profileId, `${API}/threads/${id}?format=metadata${meta}`)));
  return threads.map(t => {
    const first = t.messages[0];
    const last = t.messages[t.messages.length - 1];
    return {
      id: t.id,
      subject: header(first.payload, 'Subject') || '(no subject)',
      snippet: (last.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      from: header(last.payload, 'From'),
      date: new Date(Number(last.internalDate || 0)).toISOString(),
      count: t.messages.length,
      unread: t.messages.some(m => m.labelIds?.includes('UNREAD'))
    };
  });
}

export async function getThread(profileId: string, threadId: string, mailbox: string): Promise<Message[]> {
  const t = await google<{ messages: GMessage[] }>(profileId, `${API}/threads/${encodeURIComponent(threadId)}?format=full`);
  return t.messages.map(m => {
    const { text, attachments } = bodyOf(m.payload);
    const split = splitQuoted(text);
    const from = header(m.payload, 'From');
    return {
      id: m.id,
      from,
      to: header(m.payload, 'To'),
      cc: header(m.payload, 'Cc'),
      date: new Date(Number(m.internalDate || 0)).toISOString(),
      subject: header(m.payload, 'Subject'),
      messageId: header(m.payload, 'Message-ID') || header(m.payload, 'Message-Id'),
      references: header(m.payload, 'References'),
      text: split.text,
      quoted: split.quoted,
      attachments,
      outgoing: m.labelIds?.includes('SENT') || from.toLowerCase().includes(mailbox.toLowerCase())
    };
  });
}

const noBreaks = (s: string) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');

export async function sendMail(profileId: string, m: {
  fromName: string; fromEmail: string; to: string[]; cc: string[]; subject: string; body: string;
  threadId?: string; inReplyTo?: string; references?: string;
}) {
  const headers = [
    `From: ${encodeWord(noBreaks(m.fromName))} <${m.fromEmail}>`,
    `To: ${m.to.join(', ')}`,
    ...(m.cc.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    `Subject: ${encodeWord(noBreaks(m.subject))}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${noBreaks(m.inReplyTo)}`, `References: ${noBreaks([m.references, m.inReplyTo].filter(Boolean).join(' '))}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ];
  const b64 = Buffer.from(m.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const raw = Buffer.from(headers.join('\r\n') + '\r\n\r\n' + b64, 'utf8').toString('base64url');
  return google<{ id: string; threadId: string }>(profileId, `${API}/messages/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(m.threadId ? { raw, threadId: m.threadId } : { raw })
  });
}
