import type { Metadata } from 'next';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { FooterForm } from '@/components/admin/FooterForm';
import { LoadError } from '@/components/admin/LoadError';

export const metadata: Metadata = { title: 'Footer' };
export const dynamic = 'force-dynamic';

export default async function FooterPage() {
  const footer = await loadSettingsSection('footer');

  if (!footer) {
    return <LoadError what="footer settings" />;
  }

  return <FooterForm initialValues={footer} />;
}
