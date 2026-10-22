import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Which version is live, so open windows can offer to reload after a deploy.
export function GET() {
  return NextResponse.json({ build: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' }, { headers: { 'cache-control': 'no-store' } });
}
