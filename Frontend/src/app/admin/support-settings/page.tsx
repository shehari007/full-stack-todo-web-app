import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/server-api';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { SupportSettingsForm } from '@/components/admin/SupportSettingsForm';

export const metadata: Metadata = { title: 'Support settings' };
export const dynamic = 'force-dynamic';

export default async function SupportSettingsPage() {
  const user = await getCurrentUser();
  const isRoot = user?.role === 'root';

  /*
   * Not fetched at all for a delegated admin. `GET /api/admin/settings` would
   * serve them the section (only the write is reserved), but the screen they
   * get is a refusal, so there is nothing for the values to render into and no
   * reason to put them in the page payload.
   */
  const support = isRoot ? await loadSettingsSection('support') : null;

  return <SupportSettingsForm initialValues={support} isRoot={isRoot} />;
}
