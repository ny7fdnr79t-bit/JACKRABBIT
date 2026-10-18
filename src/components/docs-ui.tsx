'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FilePdf, LinkSimple, Plus, Receipt, Signature, Check } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useCrm } from '@/lib/store';
import { cad, parseBody, type AgreementStatus, type InvoiceKind, type InvoiceStatus, type Span } from '@/lib/docs';
import { fmtD } from '@/lib/crm';

const TAG: Record<InvoiceStatus | AgreementStatus, string> = {
  Draft: 'tag-neutral', Sent: 'tag-accent-2', Paid: 'tag-outline', Signed: 'tag-outline', Void: 'tag-neutral'
};

export function StatusTag({ status, overdue }: { status: InvoiceStatus | AgreementStatus; overdue?: boolean }) {
  if (overdue) return <span className="tag tag-accent">Overdue</span>;
  return <span className={'tag ' + TAG[status]} style={status === 'Void' ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>{status}</span>;
}

const Spans = ({ spans }: { spans: Span[] }) => <>{spans.map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <span key={i}>{x.text}</span>))}</>;

// Renders agreement text (# / ## headings, "- " bullets, **bold**) as HTML.
export function AgreementBody({ body }: { body: string }) {
  const blocks = parseBody(body);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'li') {
      const items = [];
      while (i < blocks.length && blocks[i].kind === 'li') items.push(blocks[i++]);
      i--;
      out.push(<ul key={i}>{items.map((x, k) => <li key={k}><Spans spans={x.spans} /></li>)}</ul>);
    } else if (b.kind === 'h1') out.push(<h1 key={i}><Spans spans={b.spans} /></h1>);
    else if (b.kind === 'h2') out.push(<h2 key={i}><Spans spans={b.spans} /></h2>);
    else out.push(<p key={i}><Spans spans={b.spans} /></p>);
  }
  return <div className="doc-body">{out}</div>;
}

// Copies the client's link (sign or pay) and briefly confirms.
export function CopyLinkButton({ path, label = 'Copy client link' }: { path: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-secondary" type="button" onClick={async () => {
      await navigator.clipboard.writeText(window.location.origin + path);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    }}>{done ? <Check /> : <LinkSimple />}{done ? 'Copied' : label}</button>
  );
}

export const PdfLink = ({ href }: { href: string }) => (
  <a className="btn btn-secondary" href={href} target="_blank" rel="noopener"><FilePdf />PDF</a>
);

export const isOverdue = (status: InvoiceStatus, due: string) => status === 'Sent' && due < new Date().toISOString().slice(0, 10);

// The "Documents" section of the job panel.
export function JobDocuments({ jobId }: { jobId: string }) {
  const { invoices, agreements, createInvoice, createAgreement } = useCrm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const inv = invoices.filter(x => x.jobId === jobId);
  const ags = agreements.filter(x => x.jobId === jobId);
  const make = async (f: () => Promise<string | null>, base: string) => {
    setBusy(true);
    const id = await f();
    setBusy(false);
    if (id) router.push(base + id);
  };
  const newInvoice = (k: InvoiceKind) => make(() => createInvoice(jobId, k), '/invoices/');

  return (
    <section className="section">
      <div className="section-head"><h5>Agreement and invoices</h5></div>
      <div>
        {ags.map(a => (
          <Link key={a.id} href={'/agreements/' + a.id} className="doc-row rule-b-soft">
            <Signature size={16} color="var(--color-neutral-500)" />
            <span>{a.number} · {a.title}</span>
            <span className="meta">{a.signedAt ? 'Signed ' + fmtD(a.signedAt.slice(0, 10)) : a.sentAt ? 'Sent ' + fmtD(a.sentAt.slice(0, 10)) : ''}</span>
            <StatusTag status={a.status} />
          </Link>
        ))}
        {inv.map(x => (
          <Link key={x.id} href={'/invoices/' + x.id} className="doc-row rule-b-soft">
            <Receipt size={16} color="var(--color-neutral-500)" />
            <span>{x.number} · {x.kind}</span>
            <span className="meta num">{cad(x.totalCents)}</span>
            <StatusTag status={x.status} overdue={isOverdue(x.status, x.dueDate)} />
          </Link>
        ))}
        {!ags.length && !inv.length && <div className="meta">No agreement or invoices yet.</div>}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" disabled={busy} onClick={() => make(() => createAgreement(jobId), '/agreements/')}><Plus />Agreement</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => newInvoice('Deposit')}><Plus />Deposit invoice</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => newInvoice('Progress')}><Plus />Progress</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => newInvoice('Final')}><Plus />Final</button>
      </div>
    </section>
  );
}
