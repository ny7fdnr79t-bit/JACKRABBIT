// Client-facing pages (signing, paying): a light, print-like look, no CRM chrome.
export const metadata = { robots: { index: false, follow: false } };

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="public">{children}</div>;
}
