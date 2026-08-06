import type { Metadata } from 'next';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { LegalForm } from '@/components/admin/LegalForm';
import { LoadError } from '@/components/admin/LoadError';

export const metadata: Metadata = { title: 'Legal' };
export const dynamic = 'force-dynamic';

export default async function LegalPage() {
  const legal = await loadSettingsSection('legal');

  if (!legal) {
    return <LoadError what="legal settings" />;
  }

  return <LegalForm initialValues={legal} />;
}
