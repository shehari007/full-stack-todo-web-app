import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { StaffTicketThread } from '@/components/admin/StaffTicketThread';
import { LoadError } from '@/components/admin/LoadError';
import { ticketDetailPath } from '@/components/support/ticket-meta';
import type { StaffTicketThreadResponse } from '@/components/admin/admin-types';

export const metadata: Metadata = { title: 'Ticket' };
export const dynamic = 'force-dynamic';

export default async function StaffTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentUser();

  if (!actor) redirect('/login');

  /*
   * Fetched on the server so the thread paints with its messages already in it.
   * A client-side fetch would show an empty conversation first, which on this
   * screen reads as "this ticket has no messages" rather than as "loading".
   */
  const initial = await serverGet<StaffTicketThreadResponse>(ticketDetailPath(id));

  if (!initial) {
    return (
      <LoadError
        what="ticket"
        description="Either no ticket has that reference, or the API did not answer. Go back to the queue and open it from there."
      />
    );
  }

  return (
    <StaffTicketThread
      ticketId={id}
      initial={initial}
      actor={{ id: actor.id, username: actor.username }}
    />
  );
}
