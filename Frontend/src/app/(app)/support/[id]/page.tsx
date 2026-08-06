import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { TicketThread } from '@/components/support/TicketThread';
import { ticketDetailPath, type TicketDetailResponse } from '@/components/support/ticket-meta';

export const metadata: Metadata = {
  title: 'Ticket',
  description: 'A support conversation.',
  robots: { index: false, follow: false },
};

interface TicketPageProps {
  params: Promise<{ id: string }>;
}

/**
 * One support conversation.
 *
 * A missing ticket is deliberately not `notFound()`: `serverGet` returns null
 * for an unreachable API just as it does for a 404, and rendering the framework
 * 404 for a restarting API would tell somebody their ticket had been deleted.
 * The client refetches and can tell the two apart from the status code.
 */
export default async function TicketPage({ params }: TicketPageProps) {
  const { id } = await params;

  const initial = await serverGet<TicketDetailResponse>(ticketDetailPath(id));

  return (
    // `tf-container` for the max width and centring only; the shell already pads
    // this region. Narrow because a thread is a column of prose.
    <div className="tf-container tf-container--narrow" style={{ paddingInline: 0 }}>
      <TicketThread ticketId={id} initial={initial} />
    </div>
  );
}
