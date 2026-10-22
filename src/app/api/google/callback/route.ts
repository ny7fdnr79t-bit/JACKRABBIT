import { NextResponse, type NextRequest } from 'next/server';
import { admin } from '@/lib/supabase/admin';
import { exchangeCode, GOOGLE_SCOPES, verifyState } from '@/lib/google.server';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string, ok: boolean) {
  const html = `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Wastely CRM</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#161826;color:#e9e9ed;font:15px/1.5 Inter,-apple-system,system-ui,sans-serif;padding:16px}
.card{max-width:420px;background:#1d2031;border-radius:14px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:10px}
h1{margin:0;font-size:20px;font-weight:500;color:${ok ? '#c9c2f2' : '#f2b8a2'}}p{margin:0;color:#b3b3c2}a{color:#9184d9}</style></head>
<body><div class="card"><h1>${esc(title)}</h1>${body}</div></body></html>`;
  return new NextResponse(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

// Google sends people here after they approve (or cancel) the connection.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get('error')) {
    return page('Gmail not connected', `<p>Google said: ${esc(q.get('error') || '')}. Nothing was changed. You can close this tab and try again from Team in Wastely CRM.</p>`, false);
  }
  const profileId = verifyState(q.get('state') || '');
  const code = q.get('code');
  if (!profileId || !code) {
    return page('Link expired', '<p>This connect link is no longer valid. Go back to Team in Wastely CRM and click Connect Gmail again.</p>', false);
  }
  try {
    const t = await exchangeCode(code, req.nextUrl.origin);
    const granted = (t.scope || '').split(' ');
    const missing = GOOGLE_SCOPES.filter(s => s.startsWith('https://') && !granted.includes(s));
    if (!t.refresh_token) throw new Error('Google didn’t return a long-lived token. Try connecting again.');
    if (missing.some(s => s.includes('gmail'))) {
      return page('Permissions missing', '<p>Wastely CRM needs permission to read and send Gmail. Go back to Team, click Connect Gmail again, and leave every box ticked.</p>', false);
    }
    const db = admin();
    const { data: prof } = await db.from('profiles').select('id,active').eq('id', profileId).maybeSingle();
    if (!prof?.active) throw new Error('That CRM profile isn’t active.');
    const { error } = await db.rpc('google_token_save', { p_profile: profileId, p_email: t.email, p_scopes: t.scope || '', p_refresh: t.refresh_token });
    if (error) throw new Error(error.message);
    return page('Gmail connected', `<p><strong>${esc(t.email)}</strong> is now connected to Wastely CRM.</p><p>You can close this tab and go back to the CRM. Email threads now show on each deal.</p>`, true);
  } catch (e) {
    console.error('[google/callback]', e instanceof Error ? e.message : e);
    return page('Gmail not connected', `<p>${esc(e instanceof Error ? e.message : 'Something went wrong.')}</p><p>Go back to Team in Wastely CRM and try again.</p>`, false);
  }
}
