'use client';

import { useEffect, useRef, useState } from 'react';
import { signAgreement } from '../../actions';

export default function SignForm({ token }: { token: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [f, setF] = useState({ name: '', title: '', email: '', agree: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Size the canvas to its box at device resolution so strokes stay sharp.
  useEffect(() => {
    const c = canvas.current!;
    const fit = () => {
      const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr; c.height = r.height * dpr;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d1e26';
      setHasInk(false);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const down = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext('2d')!; const [x, y] = pos(e);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
    setHasInk(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext('2d')!; const [x, y] = pos(e);
    ctx.lineTo(x, y); ctx.stroke();
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setHasInk(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasInk) return setErr('Draw your signature in the box.');
    setBusy(true); setErr('');
    const res = await signAgreement(token, { ...f, signature: canvas.current!.toDataURL('image/png') });
    // On success the action redirects; we only get here on an error.
    if (res?.error) { setErr(res.error); setBusy(false); }
  };

  return (
    <form className="pub-card pub-form" onSubmit={submit}>
      <h2 className="pub-h2">Sign this agreement</h2>
      <div className="pub-grid">
        <label>Full name<input className="pub-input" required autoComplete="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label><span>Title <span className="pub-muted">(optional)</span></span><input className="pub-input" autoComplete="organization-title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label>Email<input className="pub-input" type="email" required autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
      </div>
      <div>
        <div className="pub-sig-head"><span>Signature</span><button type="button" className="pub-link" onClick={clear}>Clear</button></div>
        <canvas ref={canvas} className="pub-sig" aria-label="Draw your signature" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
      <label className="pub-check">
        <input type="checkbox" checked={f.agree} onChange={e => setF({ ...f, agree: e.target.checked })} />
        <span>I have read this agreement, I agree to it, and I am authorised to sign for the client. I agree that my electronic signature is binding.</span>
      </label>
      {err && <div className="pub-err" role="alert">{err}</div>}
      <button className="pub-btn" type="submit" disabled={busy}>{busy ? 'Signing…' : 'Sign agreement'}</button>
    </form>
  );
}
