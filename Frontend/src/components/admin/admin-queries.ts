/**
 * Query shapes and URL builders for the admin tables.
 *
 * Deliberately NOT a `'use client'` module. These are pure functions that both
 * halves need: the server component builds the initial URL for its first fetch,
 * and the client table rebuilds it whenever a filter changes.
 *
 * Exporting them from the table components instead (which are client modules)
 * compiles fine but fails at runtime with "Attempted to call usersEndpoint()
 * from the server". Anything exported from a `'use client'` file becomes a
 * client reference, callable only inside the browser bundle, even when it is
 * plain synchronous code with no React in sight.
 */
import type { UserRole, UserStatus } from '@/types/api';
import type { UserSortField } from '@/components/admin/admin-types';
import type { TicketPriority, TicketStatus, TicketSource } from '@/components/support/ticket-meta';

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export interface UsersQuery {
  page: number;
  pageSize: number;
  search: string;
  role: UserRole | '';
  status: UserStatus | '';
  sort: UserSortField;
  order: 'asc' | 'desc';
}

export const DEFAULT_USERS_QUERY: UsersQuery = {
  page: 1,
  pageSize: 25,
  search: '',
  role: '',
  status: '',
  sort: 'createdAt',
  order: 'desc',
};

/** The querystring the API expects, with empty filters omitted entirely. */
export function usersEndpoint(query: UsersQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    order: query.order,
  });

  if (query.search) params.set('search', query.search);
  if (query.role) params.set('role', query.role);
  if (query.status) params.set('status', query.status);

  return `/api/admin/users?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export interface AuditQuery {
  page: number;
  pageSize: number;
  action: string;
  actorId: string;
  from: string;
  to: string;
}

export const DEFAULT_AUDIT_QUERY: AuditQuery = {
  page: 1,
  pageSize: 25,
  action: '',
  actorId: '',
  from: '',
  to: '',
};

export function auditEndpoint(query: AuditQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });

  if (query.action) params.set('action', query.action);
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);

  return `/api/admin/audit?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Support queue                                                              */
/* -------------------------------------------------------------------------- */

/** The `assignedToId` value that means "nobody has picked this up". */
export const UNASSIGNED = 'unassigned';

/**
 * The filters `listTicketsQuerySchema` actually accepts.
 *
 * Every field below is named exactly as the server reads it. That matters more
 * than usual here: `validate()` parses the query with a non-passthrough zod
 * object, so a parameter this file invents is *stripped in silence* rather than
 * refused. A misnamed filter does not 422. It returns an unfiltered list under
 * a control that looks applied, which is the one failure mode a reviewer cannot
 * see from the screen.
 *
 * Each name below was checked against `listTicketsQuerySchema` and against the
 * predicates in `listFilters()`. A filter the schema accepts but the service
 * never applies would fail just as quietly.
 */
export interface SupportQueueQuery {
  page: number;
  pageSize: number;
  /** Free text. Matched against the subject and the ticket number, never bodies. */
  q: string;
  status: TicketStatus | '';
  priority: TicketPriority | '';
  category: string;
  /** A staff account id, or `UNASSIGNED`. */
  assignedToId: string;
  /** Which door the ticket came in by: the app, or the public contact form. */
  source: TicketSource | '';
  /**
   * Live threads whose last message was not a staff reply. This is the queue's
   * main job: every other control narrows a list, while this one answers "what
   * has nobody replied to".
   *
   * Sent as the literal strings the server's enum expects. `?unanswered=false`
   * would read as true under `z.coerce.boolean()`, which is why the schema
   * declares the two strings instead.
   */
  unanswered: boolean;
}

export const DEFAULT_SUPPORT_QUEUE_QUERY: SupportQueueQuery = {
  page: 1,
  pageSize: 25,
  q: '',
  status: '',
  priority: '',
  category: '',
  assignedToId: '',
  source: '',
  unanswered: false,
};

/**
 * The staff endpoint, and the SWR cache key for a set of filters.
 *
 * `scope=all` is pinned the way `ticketListPath` pins `scope=mine`: this builder
 * is only ever used by the queue, and the API decides whether the caller may ask
 * for that scope at all.
 *
 * Parameters are written in a fixed order so identical filters always produce an
 * identical key and SWR does not refetch the page it is already showing.
 */
export function supportQueueEndpoint(query: SupportQueueQuery): string {
  const params = new URLSearchParams();

  params.set('scope', 'all');
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.priority) params.set('priority', query.priority);
  if (query.category) params.set('category', query.category);
  if (query.assignedToId) params.set('assignedToId', query.assignedToId);
  if (query.source) params.set('source', query.source);
  // Only sent when on: the server reads the absent case as "do not filter",
  // and sending `false` would put a redundant key in the SWR cache handle.
  if (query.unanswered) params.set('unanswered', 'true');
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));

  return `/api/support/tickets?${params.toString()}`;
}

/** How many filters are narrowing the queue. Paging is not one. */
export function countActiveQueueFilters(query: SupportQueueQuery): number {
  return (
    (query.q ? 1 : 0) +
    (query.status ? 1 : 0) +
    (query.priority ? 1 : 0) +
    (query.category ? 1 : 0) +
    (query.assignedToId ? 1 : 0) +
    (query.source ? 1 : 0) +
    (query.unanswered ? 1 : 0)
  );
}
