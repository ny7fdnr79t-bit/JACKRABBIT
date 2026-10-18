import { NextResponse } from 'next/server';
import { loadAgreement } from '@/lib/documents.server';
import { AgreementPdf, pdfBuffer } from '@/lib/pdf';

export const runtime = 'nodejs';

// /api/pdf/agreement/<agreement id>  (team members)  or  /api/pdf/agreement/<sign token>  (the client's link)
export async function GET(_: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const doc = await loadAgreement(ref);
  if (!doc) return new NextResponse('Not found', { status: 404 });
  const pdf = await pdfBuffer(AgreementPdf(doc));
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${doc.agreement.number}.pdf"`,
      'cache-control': 'private, no-store'
    }
  });
}
