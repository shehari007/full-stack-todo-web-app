import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { OverviewClient } from '@/components/admin/OverviewClient';
import type { AdminOverviewResponse } from '@/components/admin/admin-types';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  // Fetched here so the stat cards are populated in the server-rendered HTML;
  // the client then re-validates rather than starting from an empty dashboard.
  const initial = await serverGet<AdminOverviewResponse>('/api/admin/overview');

  return <OverviewClient initial={initial} />;
}
