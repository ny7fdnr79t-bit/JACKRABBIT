import type { Metadata } from 'next';
import { loadInvoice } from '@/lib/documents.server';
import { stripe } from '@/lib/stripe';
import { cad, lineTotal, longDate } from '@/lib/docs';
import { payInvoice } from '../../actions';
import PublicHeader, { Notice } from '../../PublicHeader';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invoice' };

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const doc = await loadInvoice(token);
  if (!doc) return <Notice title="This link isn’t valid">Check that you copied the whole link, or ask Wastely to send it again.</Notice>;
  const { invoice: inv, company: c, job } = doc;
  if (inv.status === 'Void') return <Notice title={`Invoice ${inv.number} was cancelled`}>No payment is needed. Contact {c.email} if you have questions.</Notice>;
  const canCard = !!stripe() && inv.status === 'Sent' && inv.totalCents > 0;
  const pay = payInvoice.bind(null, token);

  return (
    <main className="pub-wrap">
      <PublicHeader company={c} right={<a className="pub-btn pub-btn-ghost" href={'/api/pdf/invoice/' + token} target="_blank" rel="noopener">Download PDF</a>} />
      {inv.status === 'Paid' && <div className="pub-card pub-ok"><strong>Paid. Thank you.</strong> Received {longDate(inv.paidAt)}.</div>}
      {inv.status === 'Sent' && paid && <div className="pub-card pub-ok"><strong>Thank you, your payment is being processed.</strong> This page will show it as paid once it clears. Bank debits can take a few business days.</div>}

      <div className="pub-summary">
        <div><span className="pub-muted">Invoice</span><strong>{inv.number}</strong></div>
        <div><span className="pub-muted">Issued</span><strong>{longDate(inv.issueDate)}</strong></div>
        <div><span className="pub-muted">Due</span><strong>{longDate(inv.dueDate)}</strong></div>
        <div><span className="pub-muted">Amount due</span><strong>{inv.status === 'Paid' ? cad(0) : cad(inv.totalCents)}</strong></div>
      </div>

      <article className="pub-card">
        <div className="pub-muted" style={{ marginBottom: 4 }}>{inv.kind} invoice for</div>
        <div style={{ fontWeight: 600 }}>{inv.billTo.client || job.client}</div>
        <div className="pub-muted">{job.title}{(inv.billTo.site || job.site) ? ' · ' + (inv.billTo.site || job.site) : ''}</div>
        <table className="pub-table">
          <thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead>
          <tbody>{inv.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td>{l.qty}</td><td>{cad(lineTotal(l))}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={2}>Subtotal</td><td>{cad(inv.subtotalCents)}</td></tr>
            <tr><td colSpan={2}>{inv.taxLabel} {inv.taxRate}%</td><td>{cad(inv.taxCents)}</td></tr>
            <tr className="pub-total"><td colSpan={2}>Total (CAD)</td><td>{cad(inv.totalCents)}</td></tr>
          </tfoot>
        </table>
        {inv.notes && <p className="pub-muted" style={{ marginTop: 16 }}>{inv.notes}</p>}
      </article>

      {inv.status === 'Sent' && !paid && (
        <section className="pub-card pub-form">
          <h2 className="pub-h2">Pay this invoice</h2>
          {canCard && <form action={pay}><button className="pub-btn" type="submit">Pay {cad(inv.totalCents)} online</button></form>}
          <div className="pub-muted">
            {c.etransferEmail && <p>E-transfer to <strong>{c.etransferEmail}</strong> with {inv.number} in the message.</p>}
            <p>Cheque payable to <strong>{c.name}</strong>{c.address ? ', mailed to ' + c.address : ''}.</p>
          </div>
        </section>
      )}
    </main>
  );
}
