'use client';

import { useEffect, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

// An open window keeps running the version it loaded. This checks for a newer
// deploy when the window regains focus and every few minutes, and offers a
// reload instead of reloading on its own (so nothing half-typed is lost).
export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (BUILD === 'dev') return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        const { build } = await r.json();
        if (build && build !== 'dev' && build !== BUILD) setStale(true);
      } catch {} finally { busy = false; }
    };
    check();
    const t = setInterval(check, 3 * 60 * 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(t); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!stale) return null;
  return (
    <div className="toast" role="status" style={{ bottom: 'auto', top: 16, zIndex: 60, boxShadow: 'var(--shadow-lg)' }}>
      <span>Wastely CRM has been updated.</span>
      <button className="btn btn-primary" style={{ minHeight: 28, padding: '4px 10px', fontSize: 13 }} onClick={() => window.location.reload()}>
        <ArrowClockwise />Reload
      </button>
    </div>
  );
}
