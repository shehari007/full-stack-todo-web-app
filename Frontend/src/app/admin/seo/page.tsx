import type { Metadata } from 'next';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { SeoForm } from '@/components/admin/SeoForm';
import { LoadError } from '@/components/admin/LoadError';

export const metadata: Metadata = { title: 'SEO' };
export const dynamic = 'force-dynamic';

export default async function SeoPage() {
  const seo = await loadSettingsSection('seo');

  if (!seo) {
    return <LoadError what="SEO settings" />;
  }

  return <SeoForm initialValues={seo} />;
}
