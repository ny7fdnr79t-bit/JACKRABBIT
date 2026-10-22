import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { admin } from '@/lib/supabase/admin';

// Google OAuth for Gmail (and Calendar in a later step). The client ID and
// secret live only in Vercel env vars; refresh tokens live in Supabase Vault.

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events'
];

export class GoogleError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// The address Google sends people back to. It must match the redirect URI
// saved on the OAuth client, so it uses the production domain.
export function appUrl(fallbackOrigin?: string) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return fallbackOrigin || 'http://localhost:3000';
}
export const redirectUri = (origin?: string) => appUrl(origin) + '/api/google/callback';

// ── Signed state: ties the Google consent back to a CRM profile without
// needing the CRM session in the browser that finishes it (so the Mac app can
// send people to their normal browser for Google sign-in).
const stateKey = () => createHmac('sha256', 'wastely-google-state').update(process.env.SUPABASE_SERVICE_ROLE_KEY || '').digest();
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signState(profileId: string) {
  const body = b64u(JSON.stringify({ p: profileId, t: Date.now(), n: randomBytes(8).toString('hex') }));
  const sig = b64u(createHmac('sha256', stateKey()).update(body).digest());
  return body + '.' + sig;
}

export function verifyState(state: string): string | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', stateKey()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { p, t } = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p !== 'string' || Date.now() - Number(t) > 60 * 60 * 1000) return null;
    return p;
  } catch { return null; }
}

export function authUrl(profileId: string, origin: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(profileId)
  });
  if (loginHint) q.set('login_hint', loginHint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params })
  });
  const j = (await r.json()) as TokenResponse;
  if (!r.ok || j.error) throw new GoogleError(j.error_description || j.error || 'Google sign-in failed', r.status === 400 ? 400 : 502);
  return j;
}

export async function exchangeCode(code: string, origin: string) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin) });
  // The id_token comes straight from Google over TLS, so reading it is enough here.
  const claims = t.id_token ? JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()) : {};
  return { ...t, email: String(claims.email || '') };
}

// ── Access tokens, cached per server instance until shortly before expiry.
const cache = new Map<string, { token: string; until: number }>();

export async function accessToken(profileId: string): Promise<string> {
  const hit = cache.get(profileId);
  if (hit && hit.until > Date.now()) return hit.token;
  const { data: refresh, error } = await admin().rpc('google_token_get', { p_profile: profileId });
  if (error) throw new GoogleError(error.message);
  if (!refresh) throw new GoogleError('Gmail isn’t connected. Connect it under Team.', 409);
  try {
    const t = await tokenRequest({ refresh_token: refresh as string, grant_type: 'refresh_token' });
    cache.set(profileId, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleError && e.status === 400) throw new GoogleError('The Gmail connection expired or was removed. Reconnect it under Team.', 409);
    throw e;
  }
}

export async function revoke(profileId: string) {
  cache.delete(profileId);
  const { data: refresh } = await admin().rpc('google_token_get', { p_profile: profileId });
  if (refresh) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(refresh as string), { method: 'POST' }).catch(() => {});
}

// Whose mailbox to use: your own connection if you have one, otherwise the
// team's first connected mailbox (so both of you see the same email).
export async function mailboxFor(profileId: string): Promise<{ profileId: string; email: string } | null> {
  const { data } = await admin().from('google_accounts').select('profile_id,email,connected_at').order('connected_at');
  if (!data?.length) return null;
  const mine = data.find(r => r.profile_id === profileId) || data[0];
  return { profileId: mine.profile_id, email: mine.email };
}

export async function google<T = any>(profileId: string, url: string, init?: RequestInit): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const token = await accessToken(profileId);
  const r = await fetch(url, { ...init, headers: { ...(init?.headers || {}), Authorization: 'Bearer ' + token } });
  const text = await r.text();
  const body = text ? JSON.parse(text) : {};
  if (!r.ok) {
    if (r.status === 401) cache.delete(profileId);
    throw new GoogleError(body?.error?.message || 'Google request failed (' + r.status + ')', r.status === 403 ? 403 : 502);
  }
  return body as T;
}
