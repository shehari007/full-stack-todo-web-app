import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';
import { legalMetadata, loadLegalDocument } from '@/lib/legal';

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata('cookies');
}

export default async function CookiePolicyPage() {
  const { settings, doc } = await loadLegalDocument('cookies');

  return (
    <LegalDocumentView
      doc={doc}
      policyVersion={settings.legal.policyVersion}
      contactEmail={settings.legal.contactEmail}
      // Offering the control where the banner is *not* mounted would render a
      // button whose event has no listener.
      showConsentControl={settings.legal.cookieBannerEnabled}
    />
  );
}
