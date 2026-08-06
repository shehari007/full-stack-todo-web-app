import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { PersonalAnalytics } from '@/components/analytics/PersonalAnalytics';
import type { PersonalAnalyticsResponse } from '@/components/analytics/analytics-types';

export const metadata: Metadata = {
  title: 'Analytics',
  description: 'How your own tasks have moved over time.',
  // Personal figures behind a session: nothing here is for a crawler.
  robots: { index: false, follow: false },
};

// The window ends at "now", so a cached render would show a stale range.
export const dynamic = 'force-dynamic';

const DEFAULT_WINDOW_DAYS = 90;

export default async function AnalyticsPage() {
  /*
   * The default range is resolved here and handed down as fixed strings. If the
   * client computed its own `now`, its SWR key would differ from the URL this
   * page fetched by a few milliseconds and the server-rendered figures would be
   * discarded on hydration.
   */
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });

  // Null when the API is unreachable or the endpoint is not deployed yet; the
  // client falls back to fetching and to its own error state.
  const initial = await serverGet<PersonalAnalyticsResponse>(
    `/api/analytics/me?${params.toString()}`,
  );

  return (
    <PersonalAnalytics
      initial={initial}
      defaultFrom={from.toISOString()}
      defaultTo={to.toISOString()}
    />
  );
}
