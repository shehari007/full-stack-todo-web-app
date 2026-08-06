import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/server-api';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { BrandingForm } from '@/components/admin/BrandingForm';
import { LoadError } from '@/components/admin/LoadError';

export const metadata: Metadata = { title: 'Branding' };
export const dynamic = 'force-dynamic';

export default async function BrandingPage() {
  // Fetched on the server so the form paints with its real values; the asset
  // uploads are root-only, which is why the viewer's role comes along too.
  const [branding, user] = await Promise.all([loadSettingsSection('branding'), getCurrentUser()]);

  if (!branding) {
    return <LoadError what="branding settings" />;
  }

  return <BrandingForm initialValues={branding} isRoot={user?.role === 'root'} />;
}
