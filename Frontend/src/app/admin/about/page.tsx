import type { Metadata } from 'next';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { AboutForm } from '@/components/admin/AboutForm';
import { LoadError } from '@/components/admin/LoadError';
import type { AdminSettingsResponse } from '@/components/admin/admin-types';

export const metadata: Metadata = { title: 'About' };
export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  // The whole settings document rather than `loadSettingsSection`: the preview
  // draws the sidebar head as well as its footer, so it needs the brand name
  // from `branding`, and both sections arrive in the one request.
  const [settings, user] = await Promise.all([
    serverGet<AdminSettingsResponse>('/api/admin/settings'),
    getCurrentUser(),
  ]);

  if (!settings) {
    return <LoadError what="about settings" />;
  }

  const { about, branding } = settings.settings;

  /*
   * Read-only for a delegated admin rather than blocked: `about` is root-only on
   * the API, so their save would 403. The values themselves are still worth
   * reading. Same treatment as the Limits and Features screens.
   */
  return (
    <AboutForm initialValues={about} branding={branding} isRoot={user?.role === 'root'} />
  );
}
