import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/server-api';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { FeaturesForm } from '@/components/admin/FeaturesForm';
import { LoadError } from '@/components/admin/LoadError';

export const metadata: Metadata = { title: 'Features' };
export const dynamic = 'force-dynamic';

export default async function FeaturesPage() {
  const [features, user] = await Promise.all([loadSettingsSection('features'), getCurrentUser()]);

  if (!features) {
    return <LoadError what="feature flags" />;
  }

  // See ROOT_ONLY_SECTIONS in permissions.ts for why admins get a read-only view
  // of a section the API would in fact let them write.
  return <FeaturesForm initialValues={features} isRoot={user?.role === 'root'} />;
}
