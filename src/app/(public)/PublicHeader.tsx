import type { Company } from '@/lib/docs';

export default function PublicHeader({ company: c, right }: { company: Company; right?: React.ReactNode }) {
  return (
    <header className="pub-head">
      <div>
        <div className="pub-brand">{c.name}</div>
        <div className="pub-muted">{[c.address, c.email, c.phone].filter(Boolean).join(' · ')}</div>
      </div>
      {right}
    </header>
  );
}

export function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="pub-wrap">
      <div className="pub-card"><h1 className="pub-h1">{title}</h1>{children && <p className="pub-muted">{children}</p>}</div>
    </main>
  );
}
