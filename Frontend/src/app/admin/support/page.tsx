import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { SupportQueue } from '@/components/admin/SupportQueue';
import { loadSettingsSection } from '@/components/admin/load-settings';
import {
  DEFAULT_SUPPORT_QUEUE_QUERY,
  supportQueueEndpoint,
} from '@/components/admin/admin-queries';
import type { SupportQueueResponse } from '@/components/admin/admin-types';

export const metadata: Metadata = { title: 'Support queue' };
export const dynamic = 'force-dynamic';

export default async function SupportQueuePage() {
  const actor = await getCurrentUser();

  // The layout above has already redirected in this case; the check is repeated
  // because `actor.id` decides what "assign to me" means and cannot be optional.
  if (!actor) redirect('/login');

  /*
   * The categories come from the `support` settings section rather than from the
   * tickets already in the queue: a category an operator has just added should
   * appear in the filter before the first ticket uses it, and one they removed
   * should disappear once the last ticket using it is gone.
   */
  const [initial, support] = await Promise.all([
    serverGet<SupportQueueResponse>(supportQueueEndpoint(DEFAULT_SUPPORT_QUEUE_QUERY)),
    loadSettingsSection('support'),
  ]);

  return (
    <SupportQueue
      actor={{ id: actor.id, username: actor.username }}
      initial={initial}
      initialQuery={DEFAULT_SUPPORT_QUEUE_QUERY}
      categories={support?.categories ?? []}
    />
  );
}
