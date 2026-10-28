'use client';

import { useEffect, useState } from 'react';
import { Recycle, GoogleLogo, MicrosoftOutlookLogo, EnvelopeSimple } from '@phosphor-icons/react';
import { supabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Which sign-in methods are switched on in Supabase (Authentication → Providers).
  const [providers, setProviders] = useState<{ google: boolean; azure: boolean } | null>(null);
  const redirectTo = () => window.location.origin + '/auth/callback';

  useEffect(() => {
    fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } })
      .then(r => r.json())
      .then(s => setProviders({ google: !!s?.external?.google, azure: !!s?.external?.azure }))
      .catch(() => setProviders({ google: false, azure: false }));
  }, []);
  const sso = !!providers && (providers.google || providers.azure);

  const oauth = async (provider: 'google' | 'azure') => {
    setBusy(true);
    const { error } = await supabase().auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectTo(), scopes: provider === 'azure' ? 'email' : undefined }
    });
    if (error) { setMsg(error.message); setBusy(false); }
  };

  const magic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
    setBusy(false);
    if (error) return setMsg(error.message);
    setSent(true);
    setMsg('');
  };

  // The email has both a link and a code; the code works on any device or browser.
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.replace(/\s/g, '');
    if (!token) return;
    setBusy(true);
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error) { setBusy(false); return setMsg(error.message.includes('expired') || error.message.includes('invalid') ? 'That code didn’t work or has expired. Check it, or send a new one.' : error.message); }
    window.location.assign('/');
  };

  return (
    <main className="login">
      <div className="dialog login-card">
        <div className="brand">
          <div className="brand-mark"><Recycle /></div>
          <span className="brand-name">Wastely</span>
        </div>
        <div>
          <div className="dialog-title">Sign in</div>
          <div className="meta">{sso ? 'Use your Wastely work account.' : 'Enter your work email and we’ll send you a sign-in code.'}</div>
        </div>
        {providers?.google && <button className="btn btn-primary" disabled={busy} onClick={() => oauth('google')}><GoogleLogo size={17} />Continue with Google</button>}
        {providers?.azure && <button className="btn btn-secondary" disabled={busy} onClick={() => oauth('azure')}><MicrosoftOutlookLogo size={17} />Continue with Microsoft</button>}
        {sso && <div className="hr" />}
        {!sent ? (
          <form onSubmit={magic} style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input className="input" type="email" required autoComplete="email" placeholder="you@wastely.ca" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
            <button className="btn btn-secondary" disabled={busy} type="submit"><EnvelopeSimple size={16} />{busy ? 'Sending…' : 'Email me'}</button>
          </form>
        ) : (
          <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="meta" style={{ fontSize: 13 }}>We emailed <strong style={{ color: 'var(--color-text)', fontWeight: 500 }}>{email}</strong>. Type the code from the email, or click its link.</div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input className="input" autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="Code" value={code} onChange={e => setCode(e.target.value)} aria-label="Sign-in code" style={{ letterSpacing: '0.2em' }} />
              <button className="btn btn-primary" disabled={busy || !code.trim()} type="submit">{busy ? 'Checking…' : 'Sign in'}</button>
            </div>
            <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => { setSent(false); setCode(''); setMsg(''); }}>Use a different email or send a new code</button>
          </form>
        )}
        {msg && <div className="meta" role="status">{msg}</div>}
      </div>
    </main>
  );
}
