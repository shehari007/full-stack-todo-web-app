import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { AuditTable } from '@/components/admin/AuditTable';
import { DEFAULT_AUDIT_QUERY, auditEndpoint } from '@/components/admin/admin-queries';
import type { AuditListResponse } from '@/components/admin/admin-types';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const initial = await serverGet<AuditListResponse>(auditEndpoint(DEFAULT_AUDIT_QUERY));

  return <AuditTable initial={initial} initialQuery={DEFAULT_AUDIT_QUERY} />;
}
