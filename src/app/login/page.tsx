'use client';

import { useEffect, useState } from 'react';
import { Recycle, GoogleLogo, MicrosoftOutlookLogo, EnvelopeSimple } from '@phosphor-icons/react';
import { supabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
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
    setMsg(error ? error.message : 'Check your email for a sign-in link.');
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
          <div className="meta">{sso ? 'Use your Wastely work account.' : 'Enter your work email and we’ll send you a sign-in link.'}</div>
        </div>
        {providers?.google && <button className="btn btn-primary" disabled={busy} onClick={() => oauth('google')}><GoogleLogo size={17} />Continue with Google</button>}
        {providers?.azure && <button className="btn btn-secondary" disabled={busy} onClick={() => oauth('azure')}><MicrosoftOutlookLogo size={17} />Continue with Microsoft</button>}
        {sso && <div className="hr" />}
        <form onSubmit={magic} style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input className="input" type="email" placeholder="you@wastely.ca" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
          <button className="btn btn-secondary" disabled={busy} type="submit"><EnvelopeSimple size={16} />Email link</button>
        </form>
        {msg && <div className="meta" role="status">{msg}</div>}
      </div>
    </main>
  );
}
