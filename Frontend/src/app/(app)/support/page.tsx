import { Suspense } from 'react';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { TicketList } from '@/components/support/TicketList';
import {
  parseTicketFilters,
  ticketListPath,
  type TicketListResponse,
} from '@/components/support/ticket-meta';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Your support tickets, and the conversations attached to them.',
  // A personal support history has nothing to offer a crawler, and the page is
  // behind a session anyway.
  robots: { index: false, follow: false },
};

interface SupportPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The support desk.
 *
 * The first page is fetched here rather than in the browser so a bookmarked
 * `/support?status=open` arrives with its rows already rendered. The client
 * component re-derives the same filters from the URL, which turns that server
 * payload into its initial SWR cache entry instead of a throwaway.
 */
export default async function SupportPage({ searchParams }: SupportPageProps) {
  const filters = parseTicketFilters(await searchParams);

  // Null when the API is unreachable or the session has lapsed; the client falls
  // back to fetching, and to its own error state, rather than 500-ing the page.
  const initialData = await serverGet<TicketListResponse>(ticketListPath(filters));

  return (
    // `tf-container` for the max width and centring only: `tf-shell__content`
    // already pads this region, and keeping the class's own inline padding as
    // well costs 64px of a 360px screen.
    <div className="tf-container" style={{ paddingInline: 0 }}>
      {/* `useSearchParams` needs a boundary; the fallback matches the real
          height so the page does not jump when the list mounts. */}
      <Suspense fallback={<div style={{ minHeight: '60vh' }} aria-hidden="true" />}>
        <TicketList initialData={initialData} initialFilters={filters} />
      </Suspense>
    </div>
  );
}
