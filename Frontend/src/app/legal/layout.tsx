import type { ReactNode } from 'react';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * Public shell for the legal documents.
 *
 * The same header and footer as the marketing pages, on purpose: a privacy
 * policy that drops the visitor onto a bare page with no way back looks like a
 * different site, which is the opposite of the reassurance it is meant to give.
 *
 * `#main` is the target of the skip link in the root layout, so it has to exist
 * on every page that has a header to skip past.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <PublicHeader settings={settings} />
      <main id="main" style={{ flex: '1 0 auto' }}>
        {children}
      </main>
      <PublicFooter settings={settings} />
    </div>
  );
}
