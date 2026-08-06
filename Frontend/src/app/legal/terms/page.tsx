import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';
import { legalMetadata, loadLegalDocument } from '@/lib/legal';

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata('terms');
}

export default async function TermsOfServicePage() {
  const { settings, doc } = await loadLegalDocument('terms');

  return (
    <LegalDocumentView
      doc={doc}
      policyVersion={settings.legal.policyVersion}
      contactEmail={settings.legal.contactEmail}
    />
  );
}
