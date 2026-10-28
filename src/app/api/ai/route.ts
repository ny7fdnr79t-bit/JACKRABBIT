import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { SYSTEM_PROMPT } from '@/lib/assistant/prompt';
import { runTool, TOOLS, type ToolCtx } from '@/lib/assistant/tools';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = 'claude-opus-5-5';
const MAX_ROUNDS = 12;
const MAX_HISTORY_BYTES = 1_500_000;

type Msg = Anthropic.Beta.BetaMessageParam;

let anthropic: Anthropic | null = null;

// One assistant turn: the client sends the conversation so far (exactly as
// this route returned it last time) plus a new message. The history is only
// ever appended to, which keeps Claude's earlier reasoning and the prompt
// cache valid. Tools run with the caller's own Supabase session, so row level
// security decides what the assistant may read and change.
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'The assistant isn’t set up yet: ANTHROPIC_API_KEY is missing on the server.' }, { status: 503 });

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const { data: me } = await sb.from('profiles').select('id,name,role,active').eq('id', auth.user.id).maybeSingle();
  if (!me?.active) return NextResponse.json({ error: 'Your account isn’t active yet.' }, { status: 403 });

  const raw = await request.text();
  if (raw.length > MAX_HISTORY_BYTES) return NextResponse.json({ error: 'This conversation is too long. Start a new one.', reset: true }, { status: 413 });
  let body: { history?: Msg[]; message?: string; context?: { screen?: string; job?: string } };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const text = String(body.message || '').trim().slice(0, 8000);
  if (!text) return NextResponse.json({ error: 'Type a message.' }, { status: 400 });
  const history = Array.isArray(body.history) ? body.history.filter(m => m && (m.role === 'user' || m.role === 'assistant')) : [];

  // Facts that change between turns ride along with the new message rather than in the system prompt.
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const where = [body.context?.screen && `screen: ${String(body.context.screen).slice(0, 40)}`, body.context?.job && `open deal id: ${String(body.context.job).slice(0, 40)}`].filter(Boolean).join(', ');
  const messages: Msg[] = [...history, {
    role: 'user',
    content: [{ type: 'text', text: `<context>Today is ${now} (${iso}). ${me.name} (${me.role}) is asking${where ? '; ' + where : ''}.</context>\n\n${text}` }]
  }];

  const ctx: ToolCtx = { sb, me: { id: me.id, name: me.name, role: me.role }, turnId: crypto.randomUUID(), prompt: text, changes: [], nav: null };
  anthropic ??= new Anthropic();

  const call = (msgs: Msg[]) => anthropic!.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages: msgs
  });

  let reply = '';
  let stripped = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await call(messages);
      } catch (e) {
        // If an earlier turn's reasoning can't be replayed, drop it once and carry on without it.
        if (e instanceof Anthropic.BadRequestError && !stripped && hasThinking(messages)) {
          stripped = true;
          stripThinking(messages);
          res = await call(messages);
        } else throw e;
      }
      messages.push({ role: 'assistant', content: res.content });

      if (res.stop_reason === 'refusal') { reply = 'I can’t help with that one. Try rephrasing, or do it from the screen directly.'; break; }
      if (res.stop_reason === 'pause_turn') continue;
      if (res.stop_reason !== 'tool_use') {
        reply = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
        if (res.stop_reason === 'max_tokens') reply += (reply ? '\n\n' : '') + '(I ran out of room. Ask me to continue.)';
        break;
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const b of res.content) {
        if (b.type !== 'tool_use') continue;
        const r = await runTool(ctx, b.name, b.input);
        results.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, is_error: r.isError });
      }
      messages.push({ role: 'user', content: results });
      if (round === MAX_ROUNDS - 1) reply = 'That took more steps than I allow in one go. Tell me to keep going if you want me to continue.';
    }
  } catch (e) {
    console.error('assistant error', e);
    const detail = e instanceof Anthropic.APIError ? apiReason(e) : '';
    const msg = e instanceof Anthropic.RateLimitError ? 'The assistant is busy. Try again in a minute.'
      : e instanceof Anthropic.AuthenticationError ? 'The assistant’s API key isn’t valid. Check ANTHROPIC_API_KEY in Vercel.'
      : e instanceof Anthropic.PermissionDeniedError ? 'This Anthropic key isn’t allowed to use the assistant’s model. ' + detail
      : e instanceof Anthropic.BadRequestError && /credit balance/i.test(detail) ? 'The Anthropic account has no credit left. Add credit at console.anthropic.com → Billing, then try again.'
      : e instanceof Anthropic.APIError ? `The assistant hit an error (${e.status}): ${detail || 'no details'}`
      : 'The assistant hit an error. Try again.';
    // Changes already made this turn are kept and can still be undone.
    return NextResponse.json({ error: msg, changes: ctx.changes, turnId: ctx.turnId }, { status: 502 });
  }

  // If the last turn ended mid-tool-round (step limit), close it so the next request is valid.
  const last = messages[messages.length - 1];
  if (last.role === 'user') messages.push({ role: 'assistant', content: [{ type: 'text', text: reply }] });

  return NextResponse.json({ reply: reply || 'Done.', changes: ctx.changes, turnId: ctx.turnId, nav: ctx.nav, history: messages });
}

// Anthropic's own explanation, e.g. "Your credit balance is too low…".
function apiReason(e: InstanceType<typeof Anthropic.APIError>) {
  const body = e.error as { error?: { message?: string } } | undefined;
  return String(body?.error?.message || e.message || '').slice(0, 300);
}

const hasThinking = (msgs: Msg[]) => msgs.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'thinking' || b.type === 'redacted_thinking'));
function stripThinking(msgs: Msg[]) {
  for (const m of msgs) if (Array.isArray(m.content)) m.content = m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking') as typeof m.content;
}
