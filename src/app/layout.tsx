import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wastely CRM',
  description: 'Deals, contracts, crews and tasks for Wastely.'
};

export const viewport: Viewport = { themeColor: '#161826', colorScheme: 'dark' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request so the browser gets the Supabase URL and anon key as
  // they are set now, not as they were when the build ran.
  await connection();
  const env = JSON.stringify({ url: supabaseUrl() ?? '', anonKey: supabaseAnonKey() ?? '' }).replace(/</g, '\\u003c');
  return (
    <html lang="en-CA">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `window.__SUPABASE_ENV__=${env};` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
