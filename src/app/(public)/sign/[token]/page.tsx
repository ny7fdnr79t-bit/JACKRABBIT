import type { Metadata } from 'next';
import { loadAgreement } from '@/lib/documents.server';
import { admin } from '@/lib/supabase/admin';
import { cad, longDate } from '@/lib/docs';
import { AgreementBody } from '@/components/docs-ui';
import PublicHeader, { Notice } from '../../PublicHeader';
import SignForm from './SignForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review and sign' };

export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ signed?: string }> }) {
  const { token } = await params;
  const { signed: justSigned } = await searchParams;
  const doc = await loadAgreement(token);
  if (!doc) return <Notice title="This link isn’t valid">Check that you copied the whole link, or ask Wastely to send it again.</Notice>;
  const { agreement: a, company: c } = doc;
  if (a.status === 'Void') return <Notice title="This agreement was withdrawn">{c.name} has replaced or cancelled it. Contact {c.email} if you have questions.</Notice>;

  // First time the client opens it.
  if (a.status === 'Sent' && !a.viewedAt) {
    await admin().from('agreements').update({ viewed_at: new Date().toISOString() }).eq('id', a.id).is('viewed_at', null);
  }
  const tax = Math.round((a.priceCents * c.taxRate) / 100);
  const pdf = '/api/pdf/agreement/' + token;

  return (
    <main className="pub-wrap">
      <PublicHeader company={c} right={<a className="pub-btn pub-btn-ghost" href={pdf} target="_blank" rel="noopener">Download PDF</a>} />
      {a.status === 'Signed' && (
        <div className="pub-card pub-ok">
          <strong>{justSigned ? 'Thank you, it’s signed.' : 'This agreement is signed.'}</strong>{' '}
          Signed by {a.signerName} on {longDate(a.signedAt)}. You can download a copy with your signature above; {c.name} has one too.
        </div>
      )}
      <div className="pub-summary">
        <div><span className="pub-muted">Agreement</span><strong>{a.number}</strong></div>
        <div><span className="pub-muted">Price</span><strong>{cad(a.priceCents)}</strong></div>
        <div><span className="pub-muted">{c.taxLabel} {c.taxRate}%</span><strong>{cad(tax)}</strong></div>
        <div><span className="pub-muted">Total</span><strong>{cad(a.priceCents + tax)}</strong></div>
      </div>
      <article className="pub-card"><AgreementBody body={a.body} /></article>
      {a.status === 'Sent' && <SignForm token={token} />}
    </main>
  );
}
