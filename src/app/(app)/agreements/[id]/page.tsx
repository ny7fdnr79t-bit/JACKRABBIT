'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, PaperPlaneTilt, Prohibit, Trash, FloppyDisk, Eye, PencilSimple } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { cad } from '@/lib/docs';
import { fmtD } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { AgreementBody, CopyLinkButton, PdfLink, StatusTag } from '@/components/docs-ui';
import { useOpenJob } from '@/lib/useOpenJob';

export default function AgreementPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, agreements, jobs, updateAgreement, deleteAgreement } = useCrm();
  const router = useRouter();
  const openJob = useOpenJob();
  const a = agreements.find(x => x.id === id);
  const [body, setBody] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (a && body === null) { setBody(a.body); setTitle(a.title); } }, [a, body]);
  if (!ready) return <Loading />;
  if (!a || body === null) return <div className="page"><Link href="/agreements" className="btn btn-ghost"><ArrowLeft />Agreements</Link><div className="meta">Agreement not found.</div></div>;

  const job = jobs.find(j => j.id === a.jobId);
  const draft = a.status === 'Draft';
  const dirty = body !== a.body || title !== a.title;
  const act = async (f: () => Promise<boolean>) => { setBusy(true); const ok = await f(); setBusy(false); return ok; };
  const save = () => act(() => updateAgreement(a.id, { body, title }));
  const day = (iso: string | null) => (iso ? fmtD(iso.slice(0, 10)) : '');

  const send = async () => {
    if (dirty && !(await save())) return;
    if (!confirm('Mark ' + a.number + ' as sent? The wording is locked after this.')) return;
    if (await act(() => updateAgreement(a.id, { status: 'Sent' }))) {
      await navigator.clipboard.writeText(window.location.origin + '/sign/' + a.signToken).catch(() => {});
      alert('Marked as sent. The signing link is copied, so paste it into your email to ' + (job?.contact?.email || 'the client') + '.');
    }
  };

  return (
    <div className="page page-narrow" style={{ maxWidth: 1040 }}>
      <Link href="/agreements" className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 13 }}><ArrowLeft />Agreements</Link>
      <header className="page-head">
        <div>
          <div className="meta">{cad(a.priceCents)} + tax{job ? ' · ' : ''}{job && <button className="link-btn" onClick={() => openJob(job.id, '/pipeline')}>{job.client} — {job.title}</button>}</div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{a.number}<StatusTag status={a.status} /></h3>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <PdfLink href={'/api/pdf/agreement/' + a.id} />
          {draft && <>
            <button className="btn btn-secondary" onClick={() => setEditing(!editing)}>{editing ? <Eye /> : <PencilSimple />}{editing ? 'Preview' : 'Edit wording'}</button>
            <button className="btn btn-secondary" disabled={busy || !dirty} onClick={save}><FloppyDisk />{dirty ? 'Save' : 'Saved'}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={async () => { if (confirm('Delete draft ' + a.number + '?') && await deleteAgreement(a.id)) router.push('/agreements'); }}><Trash />Delete</button>
            <button className="btn btn-primary" disabled={busy} onClick={send}><PaperPlaneTilt />Mark sent and copy link</button>
          </>}
          {a.status === 'Sent' && <>
            <CopyLinkButton path={'/sign/' + a.signToken} label="Copy signing link" />
            <button className="btn btn-secondary" disabled={busy} onClick={() => confirm('Void ' + a.number + '? The signing link will stop working.') && act(() => updateAgreement(a.id, { status: 'Void' }))}><Prohibit />Void</button>
          </>}
        </div>
      </header>

      {a.status === 'Sent' && <div className="meta">Sent {day(a.sentAt)}. {a.viewedAt ? 'The client opened it ' + day(a.viewedAt) + '.' : 'Not opened yet.'} To change the wording, void it and create a new one.</div>}
      {a.status === 'Signed' && <div className="meta">Signed by {a.signerName}{a.signerTitle ? ', ' + a.signerTitle : ''} on {day(a.signedAt)}. The PDF includes the signature and a fingerprint of the signed text.</div>}
      {draft && <div className="meta">Filled in from the deal and the template under Team. Edit anything before sending. Headings start with # or ##, bullets with “- ”, and **text** is bold.</div>}

      {draft && editing ? (
        <div className="section">
          <div className="field"><label htmlFor="a-title">Title</label><input id="a-title" className="input" value={title} onChange={e => setTitle(e.target.value)} /></div>
          <textarea className="input" aria-label="Agreement wording" value={body} onChange={e => setBody(e.target.value)} style={{ minHeight: '60vh', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.6 }} />
        </div>
      ) : (
        <div className="paper"><AgreementBody body={body} /></div>
      )}
    </div>
  );
}
