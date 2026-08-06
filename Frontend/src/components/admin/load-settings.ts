import { serverGet } from '@/lib/server-api';
import type { AdminSettingsResponse, SettingsSectionKey } from '@/components/admin/admin-types';

/**
 * Read one section for a server-rendered settings page.
 *
 * Every section screen does this so the form is server-rendered with its real
 * values. A client-side fetch would paint an empty form first, and on a page of
 * text inputs that reads as "the settings were lost".
 *
 * Server components only: `serverGet` reaches for the request's cookies.
 */
export async function loadSettingsSection<K extends SettingsSectionKey>(
  key: K,
): Promise<AdminSettingsResponse['settings'][K] | null> {
  const response = await serverGet<AdminSettingsResponse>('/api/admin/settings');
  return response?.settings[key] ?? null;
}
