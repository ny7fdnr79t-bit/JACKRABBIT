import 'server-only';
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { cad, lineTotal, longDate, parseBody, type Agreement, type Company, type Invoice, type Span } from '@/lib/docs';
import type { JobInfo, SignedInfo } from '@/lib/documents.server';

// Built-in Helvetica only covers WinAnsi characters; swap the few we use that it lacks.
const t = (s: string | null | undefined) => String(s ?? '').replace(/−/g, '-').replace(/→/g, '->');

// No automatic hyphenation: names, addresses and service names stay whole.
Font.registerHyphenationCallback(word => [word]);

const INK = '#1d1e26', MUTED = '#5f6270', RULE = '#d9dbe4', ACCENT = '#5d5294';

const s = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: INK, lineHeight: 1.45 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  brand: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: ACCENT, lineHeight: 1.2, marginBottom: 6 },
  muted: { color: MUTED },
  docTitle: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'right', lineHeight: 1.2, marginBottom: 6 },
  label: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  block: { marginTop: 24 },
  th: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: RULE },
  td: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: RULE },
  totals: { marginTop: 12, marginLeft: 'auto', width: 220 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: { fontFamily: 'Helvetica-Bold', fontSize: 12, borderTopWidth: 1, borderTopColor: INK, paddingTop: 6, marginTop: 4 },
  stamp: { position: 'absolute', top: 120, right: 48, fontSize: 28, fontFamily: 'Helvetica-Bold', color: ACCENT, opacity: 0.25, transform: 'rotate(-12deg)' },
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 8, color: MUTED, textAlign: 'center' },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  h2: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  p: { marginBottom: 6 },
  li: { flexDirection: 'row', marginBottom: 3, paddingLeft: 6 },
  sigBox: { width: '47%', borderTopWidth: 1, borderTopColor: INK, paddingTop: 6, marginTop: 8 }
});

const Spans = ({ spans }: { spans: Span[] }) => (
  <>{spans.map((x, i) => <Text key={i} style={x.bold ? { fontFamily: 'Helvetica-Bold' } : undefined}>{t(x.text)}</Text>)}</>
);

function CompanyBlock({ c }: { c: Company }) {
  return (
    <View>
      <Text style={s.brand}>{t(c.name)}</Text>
      {c.address ? <Text style={s.muted}>{t(c.address)}</Text> : null}
      <Text style={s.muted}>{[c.email, c.phone].filter(Boolean).map(t).join('  ·  ')}</Text>
      {c.hstNumber ? <Text style={s.muted}>{t(c.taxLabel)} # {t(c.hstNumber)}</Text> : null}
    </View>
  );
}

export function InvoicePdf({ invoice: inv, company: c, job, payUrl }: { invoice: Invoice; company: Company; job: JobInfo; payUrl?: string }) {
  const b = inv.billTo;
  return (
    <Document title={inv.number} author={c.name}>
      <Page size="LETTER" style={s.page}>
        <View style={s.row}>
          <CompanyBlock c={c} />
          <View>
            <Text style={s.docTitle}>{inv.kind === 'Final' ? 'INVOICE' : inv.kind.toUpperCase() + ' INVOICE'}</Text>
            <Text style={{ textAlign: 'right' }}>{inv.number}</Text>
            <Text style={[s.muted, { textAlign: 'right' }]}>Issued {longDate(inv.issueDate)}</Text>
            <Text style={[s.muted, { textAlign: 'right' }]}>Due {longDate(inv.dueDate)}</Text>
          </View>
        </View>
        {inv.status === 'Paid' && <Text style={s.stamp}>PAID</Text>}
        {inv.status === 'Void' && <Text style={s.stamp}>VOID</Text>}

        <View style={[s.row, s.block]}>
          <View style={{ width: '48%' }}>
            <Text style={s.label}>Bill to</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t(b.client || job.client)}</Text>
            {b.contact ? <Text>{t(b.contact)}</Text> : null}
            {b.email ? <Text style={s.muted}>{t(b.email)}</Text> : null}
            {b.phone ? <Text style={s.muted}>{t(b.phone)}</Text> : null}
          </View>
          <View style={{ width: '48%' }}>
            <Text style={s.label}>Job</Text>
            <Text>{t(job.title)}</Text>
            {(b.site || job.site) ? <Text style={s.muted}>{t(b.site || job.site)}</Text> : null}
          </View>
        </View>

        <View style={s.block}>
          <View style={s.row}>
            <Text style={[s.th, { flex: 1 }]}>Description</Text>
            <Text style={[s.th, { width: 50, textAlign: 'right' }]}>Qty</Text>
            <Text style={[s.th, { width: 80, textAlign: 'right' }]}>Unit</Text>
            <Text style={[s.th, { width: 90, textAlign: 'right' }]}>Amount</Text>
          </View>
          {inv.lines.map((l, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={[s.td, { flex: 1, paddingRight: 8 }]}>{t(l.description)}</Text>
              <Text style={[s.td, { width: 50, textAlign: 'right' }]}>{String(l.qty)}</Text>
              <Text style={[s.td, { width: 80, textAlign: 'right' }]}>{t(cad(l.unit_cents))}</Text>
              <Text style={[s.td, { width: 90, textAlign: 'right' }]}>{t(cad(lineTotal(l)))}</Text>
            </View>
          ))}
          <View style={s.totals}>
            <View style={s.totalRow}><Text style={s.muted}>Subtotal</Text><Text>{t(cad(inv.subtotalCents))}</Text></View>
            <View style={s.totalRow}><Text style={s.muted}>{t(inv.taxLabel)} {inv.taxRate}%</Text><Text>{t(cad(inv.taxCents))}</Text></View>
            <View style={[s.totalRow, s.grand]}><Text>Total (CAD)</Text><Text>{t(cad(inv.totalCents))}</Text></View>
          </View>
        </View>

        {inv.status !== 'Paid' && inv.status !== 'Void' && (
          <View style={s.block}>
            <Text style={s.label}>How to pay</Text>
            {payUrl ? <Text>Card: {payUrl}</Text> : null}
            {c.etransferEmail ? <Text>E-transfer: {t(c.etransferEmail)} (include {inv.number} in the message)</Text> : null}
            <Text>Cheque: payable to {t(c.name)}</Text>
          </View>
        )}
        {inv.status === 'Paid' && inv.paidAt && (
          <View style={s.block}><Text>Paid {longDate(inv.paidAt)}{inv.paidVia ? ' by ' + t(inv.paidVia).toLowerCase() : ''}. Thank you.</Text></View>
        )}
        {inv.notes ? <View style={s.block}><Text style={s.label}>Notes</Text><Text>{t(inv.notes)}</Text></View> : null}
        <Text style={s.footer} fixed>{t(c.footer)}</Text>
      </Page>
    </Document>
  );
}

export function AgreementPdf({ agreement: a, company: c, signed }: { agreement: Agreement; company: Company; job: JobInfo; signed: SignedInfo }) {
  const blocks = parseBody(a.body);
  return (
    <Document title={a.number + ' ' + a.title} author={c.name}>
      <Page size="LETTER" style={s.page}>
        <View style={[s.row, { marginBottom: 20 }]}>
          <CompanyBlock c={c} />
          <View>
            <Text style={{ textAlign: 'right' }}>{a.number}</Text>
            {a.status === 'Void' && <Text style={{ textAlign: 'right', color: ACCENT, fontFamily: 'Helvetica-Bold' }}>VOID</Text>}
          </View>
        </View>
        {blocks.map((b, i) =>
          b.kind === 'h1' ? <Text key={i} style={s.h1}><Spans spans={b.spans} /></Text>
          : b.kind === 'h2' ? <Text key={i} style={s.h2} minPresenceAhead={40}><Spans spans={b.spans} /></Text>
          : b.kind === 'li' ? <View key={i} style={s.li}><Text style={{ width: 10 }}>•</Text><Text style={{ flex: 1 }}><Spans spans={b.spans} /></Text></View>
          : <Text key={i} style={s.p}><Spans spans={b.spans} /></Text>
        )}

        <View style={[s.row, { marginTop: 36 }]} wrap={false}>
          <View style={s.sigBox}>
            <Text style={s.label}>For {t(c.name)}</Text>
            <Text style={s.muted}>Issued {longDate(a.sentAt)}</Text>
          </View>
          <View style={s.sigBox}>
            <Text style={s.label}>Client</Text>
            {a.status === 'Signed' && signed.signature ? (
              <>
                <Image src={signed.signature} style={{ height: 48, objectFit: 'contain', alignSelf: 'flex-start' }} />
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t(a.signerName)}</Text>
                {a.signerTitle ? <Text style={s.muted}>{t(a.signerTitle)}</Text> : null}
                <Text style={s.muted}>Signed {longDate(a.signedAt)}</Text>
              </>
            ) : (
              <Text style={[s.muted, { marginTop: 40 }]}>Name, title and date</Text>
            )}
          </View>
        </View>
        {a.status === 'Signed' && (
          <Text style={[s.muted, { fontSize: 7.5, marginTop: 18 }]} wrap={false}>
            Signed electronically {a.signedAt ? new Date(a.signedAt).toISOString() : ''}{signed.signerEmail ? ' by ' + t(signed.signerEmail) : ''}{signed.signerIp ? ' from ' + signed.signerIp : ''}.
            Document fingerprint (SHA-256): {signed.sha256}
          </Text>
        )}
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${a.number}  ·  Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

export const pdfBuffer = (doc: React.ReactElement) => renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
