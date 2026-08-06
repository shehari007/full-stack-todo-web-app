import type { Metadata } from 'next';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { loadSettingsSection } from '@/components/admin/load-settings';
import { AnalyticsClient } from '@/components/admin/AnalyticsClient';
import type { AnalyticsSummaryResponse } from '@/components/admin/admin-types';
import type { InstallationAnalyticsResponse } from '@/components/analytics/analytics-types';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

const DEFAULT_WINDOW_DAYS = 30;

export default async function AnalyticsPage() {
  /*
   * The default window is resolved here and handed down as fixed strings. If the
   * client computed its own `now`, its SWR key would differ from the URL this
   * page fetched by a few milliseconds and the server-rendered numbers would be
   * thrown away on hydration.
   */
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    granularity: 'day',
  });

  const [summary, installation, settings, user] = await Promise.all([
    serverGet<AnalyticsSummaryResponse>(`/api/analytics/summary?${params.toString()}`),
    /*
     * The same window as the summary. `/installation` is built on `getSummary`
     * and clips its storage curve to the resolved range, so an unparameterised
     * call would fetch the server's default window instead, and the key would
     * then not match the one `AnalyticsClient` asks for, throwing this render
     * away on hydration.
     */
    serverGet<InstallationAnalyticsResponse>(`/api/analytics/installation?${params.toString()}`),
    loadSettingsSection('analytics'),
    getCurrentUser(),
  ]);

  return (
    <AnalyticsClient
      initialSummary={summary}
      initialSettings={settings}
      initialInstallation={installation}
      defaultFrom={from.toISOString()}
      defaultTo={to.toISOString()}
      isRoot={user?.role === 'root'}
    />
  );
}
