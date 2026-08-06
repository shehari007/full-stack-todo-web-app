import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { UsersTable } from '@/components/admin/UsersTable';
import { DEFAULT_USERS_QUERY, usersEndpoint } from '@/components/admin/admin-queries';
import type { AdminUsersResponse } from '@/components/admin/admin-types';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const actor = await getCurrentUser();

  // The layout above has already redirected in this case; the check is repeated
  // because `actor.role` decides which buttons render and must not be optional.
  if (!actor) redirect('/login');

  const initial = await serverGet<AdminUsersResponse>(usersEndpoint(DEFAULT_USERS_QUERY));

  return (
    <UsersTable
      actor={{ id: actor.id, role: actor.role }}
      initial={initial}
      initialQuery={DEFAULT_USERS_QUERY}
    />
  );
}
