import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/server-api';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { LimitsForm } from '@/components/admin/LimitsForm';
import { LoadError } from '@/components/admin/LoadError';

export const metadata: Metadata = { title: 'Limits' };
export const dynamic = 'force-dynamic';

export default async function LimitsPage() {
  const [limits, user] = await Promise.all([loadSettingsSection('limits'), getCurrentUser()]);

  if (!limits) {
    return <LoadError what="limits settings" />;
  }

  /*
   * The API allows any privileged account to write this section, so the
   * read-only mode for admins is a panel convention rather than a boundary. See
   * ROOT_ONLY_SECTIONS in permissions.ts. The page still renders for them:
   * knowing what the ceilings are is exactly what an admin fielding "why was my
   * upload rejected" needs.
   */
  return <LimitsForm initialValues={limits} isRoot={user?.role === 'root'} />;
}
