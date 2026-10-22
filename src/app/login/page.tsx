'use client';

import { useState } from 'react';
import { Recycle, EnvelopeSimple, ArrowLeft } from '@phosphor-icons/react';
import { supabase } from '@/lib/supabase/client';

// Email sign-in with a one-time code. A code works inside the Mac app; a
// link in the email would open in the default browser instead. Accounts are
// created by Leadership under Team, never here.
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    setMsg('');
    const { error } = await supabase().auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) {
      setMsg(/signups? not allowed|not found|not authorized/i.test(error.message)
        ? 'That email doesn’t have access to Wastely CRM.'
        : error.message);
      return;
    }
    setSent(true);
    setMsg('We emailed you a sign-in code. It works for one hour.');
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return;
    setBusy(true);
    setMsg('');
    const { error } = await supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
    if (error) {
      setBusy(false);
      setMsg(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired. Check the latest email, or send a new code.' : error.message);
      return;
    }
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
          <div className="meta">{sent ? <>Enter the code sent to {email.trim()}.</> : 'We’ll email you a sign-in code.'}</div>
        </div>
        {!sent ? (
          <form onSubmit={sendCode} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <input className="input" type="email" autoComplete="email" autoFocus placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" required />
            <button className="btn btn-primary" disabled={busy} type="submit"><EnvelopeSimple size={16} />{busy ? 'Sending…' : 'Email me a code'}</button>
          </form>
        ) : (
          <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="Code" maxLength={10}
              value={code} onChange={e => setCode(e.target.value)} aria-label="Sign-in code"
              style={{ fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }} />
            <button className="btn btn-primary" disabled={busy || code.replace(/\D/g, '').length < 6} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <button type="button" className="link-btn" onClick={() => { setSent(false); setCode(''); setMsg(''); }}><ArrowLeft size={12} /> Different email</button>
              <button type="button" className="link-btn" disabled={busy} onClick={sendCode}>Send a new code</button>
            </div>
          </form>
        )}
        {msg && <div className="meta" role="status">{msg}</div>}
      </div>
    </main>
  );
}
