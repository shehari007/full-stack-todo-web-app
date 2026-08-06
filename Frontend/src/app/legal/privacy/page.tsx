import type { Metadata } from 'next';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';
import { legalMetadata, loadLegalDocument } from '@/lib/legal';

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata('privacy');
}

export default async function PrivacyPolicyPage() {
  const { settings, doc } = await loadLegalDocument('privacy');

  return (
    <LegalDocumentView
      doc={doc}
      policyVersion={settings.legal.policyVersion}
      contactEmail={settings.legal.contactEmail}
    />
  );
}
