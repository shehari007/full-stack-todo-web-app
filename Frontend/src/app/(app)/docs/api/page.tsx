import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, getPublicSettings } from '@/lib/server-api';
import { ApiDocs } from '@/components/docs/ApiDocs';

export const metadata: Metadata = {
  title: 'API documentation',
  description: 'How to read your own tasks from your own website with a personal access token.',
  // Behind the app shell's session check, so a crawler could not read it anyway.
  robots: { index: false, follow: false },
};

export default async function ApiDocsPage() {
  /*
   * The `(app)` layout already turns a signed-out visitor away, but it sends
   * them to a bare `/login` and they land on the dashboard afterwards. Every
   * other page in this group names its own return path, and somebody following
   * a link to the API reference should be brought back to it.
   */
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fdocs%2Fapi');

  /*
   * The examples need this installation's real origin, and the canonical URL is
   * the only place the operator has declared one. It is frequently blank, in
   * which case the client falls back to the browser's own origin after
   * hydration. See `ApiDocs`.
   */
  const settings = await getPublicSettings();

  return (
    <div className="tf-container" style={{ paddingInline: 0 }}>
      <ApiDocs canonicalBaseUrl={settings?.seo.canonicalBaseUrl ?? ''} />
    </div>
  );
}
