import { NextResponse, type NextRequest } from 'next/server';
import { loadInvoice } from '@/lib/documents.server';
import { InvoicePdf, pdfBuffer } from '@/lib/pdf';

export const runtime = 'nodejs';

// /api/pdf/invoice/<invoice id>  (team members)  or  /api/pdf/invoice/<pay token>  (the client's link)
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const doc = await loadInvoice(ref);
  if (!doc) return new NextResponse('Not found', { status: 404 });
  const payUrl = process.env.STRIPE_SECRET_KEY ? request.nextUrl.origin + '/pay/' + doc.invoice.payToken : undefined;
  const pdf = await pdfBuffer(InvoicePdf({ ...doc, payUrl }));
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${doc.invoice.number}.pdf"`,
      'cache-control': 'private, no-store'
    }
  });
}
