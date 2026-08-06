/**
 * The support desk's shared vocabulary: the shapes the API returns, the words
 * and colours every screen labels a ticket with, and the translation between a
 * query string and a request.
 *
 * Deliberately NOT a `'use client'` module. The server pages call
 * `parseTicketFilters` and `ticketListPath` to render the first page, and the
 * client components call the same two to keep revalidating it. Marking this
 * file client-only would turn those server-side calls into "Attempted to call
 * ticketListPath() from the server" at request time: a runtime 500 rather than
 * a build error, which is why the placement is worth stating.
 *
 * The icons come through `@/components/icons` rather than straight from
 * `@ant-design/icons`: that package evaluates `React.createContext` while its
 * entry module loads, which is not available in React's server build and would
 * crash any server page that pulls this module in. See that file's own note.
 */
import type { ComponentType } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FireOutlined,
  MinusCircleOutlined,
  MinusOutlined,
} from '@/components/icons';
import type { Pagination } from '@/types/api';

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** Mirrors `ticketStatusEnum` in `Server/src/db/schema.ts`. */
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
/** Mirrors `ticketPriorityEnum`. */
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
/** Which door the ticket came in by: the app, or the public contact form. */
export type TicketSource = 'app' | 'contact';

export interface Ticket {
  id: string;
  /** The short human reference people quote in follow-ups. Rendered as `#1042`. */
  number: number;
  subject: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  /** Null until somebody replies; the list falls back to `createdAt`. */
  lastReplyAt: string | null;
  lastReplyByStaff: boolean;
  /**
   * Whether *this caller* has something new on the ticket.
   *
   * The API keeps two columns (`unread_for_requester` and `unread_for_staff`)
   * and never ships either name. `toTicketView` picks the one that belongs to
   * the viewer and serialises it as this single `unread` key, so a requester is
   * not told anything about the queue's state. Set when staff reply, cleared by
   * the server as a side effect of loading the thread.
   */
  unread: boolean;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  /** Denormalised by the API, so a deleted account still shows who wrote what. */
  authorName: string | null;
  body: string;
  /** True when the author was root or an admin. Drives the "Support" tag. */
  isStaff: boolean;
  /**
   * Staff-only note. Present only in the staff view. The API filters these out
   * of a requester's thread in SQL, so this is always absent or false here, and
   * the thread still checks it rather than trusting that.
   */
  isInternal?: boolean;
  createdAt: string;
}

/** `GET /api/support/tickets`. */
export interface TicketListResponse {
  tickets: Ticket[];
  pagination: Pagination;
}

/** `GET /api/support/tickets/:id`. */
export interface TicketDetailResponse {
  ticket: Ticket;
  messages: TicketMessage[];
}

/** `GET /api/support/tickets/unread-count`: the sidebar badge. */
export const UNREAD_COUNT_KEY = '/api/support/tickets/unread-count';

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * An Ant Design icon, as it crosses the client boundary.
 *
 * Typed by what this app actually passes it (nothing) rather than by
 * `AntdIconProps`, which would mean a deep import into the icon package's
 * internals for no gain.
 */
export type TicketIcon = ComponentType<{ className?: string }>;

export interface TicketStatusMeta {
  label: string;
  /** An Ant Design preset name, so it follows the light/dark algorithm. */
  color: string;
  icon: TicketIcon;
  /** Plain-language gloss; the list and thread both explain the state with it. */
  hint: string;
}

export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'pending', 'resolved', 'closed'];

export const TICKET_STATUS_META: Record<TicketStatus, TicketStatusMeta> = {
  open: {
    label: 'Open',
    color: 'processing',
    icon: ExclamationCircleOutlined,
    hint: 'Waiting for the support team.',
  },
  pending: {
    label: 'Awaiting your reply',
    color: 'warning',
    icon: ClockCircleOutlined,
    hint: 'The team has asked you something and is waiting to hear back.',
  },
  resolved: {
    label: 'Resolved',
    color: 'success',
    icon: CheckCircleOutlined,
    hint: 'Answered. Reply again if it is not sorted.',
  },
  closed: {
    label: 'Closed',
    color: 'default',
    icon: MinusCircleOutlined,
    hint: 'Finished. Reopen it if you need to pick the conversation back up.',
  },
};

export interface TicketPriorityMeta {
  label: string;
  color: string;
  icon: TicketIcon;
}

export const TICKET_PRIORITY_META: Record<TicketPriority, TicketPriorityMeta> = {
  low: { label: 'Low', color: 'default', icon: ArrowDownOutlined },
  normal: { label: 'Normal', color: 'blue', icon: MinusOutlined },
  high: { label: 'High', color: 'orange', icon: ArrowUpOutlined },
  urgent: { label: 'Urgent', color: 'red', icon: FireOutlined },
};

/**
 * What the requester's own composer may ask for.
 *
 * `urgent` is missing on purpose, though not because the API refuses it.
 * `createTicket` accepts the value and quietly stores `high` instead for a
 * non-staff caller, answering with the priority it really saved. Offering the
 * option would therefore be worse than a rejection: the form would appear to
 * work and the ticket would come back marked something else. Triage is the
 * support team's call, so the control does not pretend otherwise.
 */
export const REQUESTER_TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high'];

/** `#1042`: the reference people quote back at you. */
export function ticketReference(number: number): string {
  return `#${number}`;
}

/**
 * Whether the conversation is finished.
 *
 * Only `closed` locks the composer. `resolved` deliberately does not: the whole
 * point of that state is that the team believes it is answered, and the person
 * who asked is the one who gets to disagree.
 */
export function isTicketClosed(ticket: Ticket): boolean {
  return ticket.status === 'closed';
}

/** When the thread last moved, for sorting and for the "last activity" column. */
export function lastActivityAt(ticket: Ticket): string {
  return ticket.lastReplyAt ?? ticket.createdAt;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

export interface TicketFilterState {
  q: string;
  /** One status, or none. A ticket has exactly one, so a multi-select would
   *  mostly be a way to reconstruct "all". */
  status: TicketStatus | null;
  page: number;
  pageSize: number;
}

export const DEFAULT_TICKET_PAGE_SIZE = 20;

export const DEFAULT_TICKET_FILTERS: TicketFilterState = {
  q: '',
  status: null,
  page: 1,
  pageSize: DEFAULT_TICKET_PAGE_SIZE,
};

export type RawSearchParams = URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * Duck-typed rather than `instanceof`: what `useSearchParams` returns is a
 * Next.js subclass, and what a server component's `searchParams` resolves to is
 * a plain object that is not a `URLSearchParams` at all.
 */
function isSearchParams(value: RawSearchParams): value is URLSearchParams {
  return typeof (value as URLSearchParams).get === 'function';
}

function readOne(params: RawSearchParams, key: string): string | undefined {
  if (isSearchParams(params)) return params.get(key) ?? undefined;

  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Turn a query string (or a server component's `searchParams`) into filters. */
export function parseTicketFilters(params: RawSearchParams): TicketFilterState {
  const status = readOne(params, 'status') ?? '';

  return {
    q: (readOne(params, 'q') ?? '').slice(0, 200),
    status: isTicketStatus(status) ? status : null,
    page: Math.max(1, toInt(readOne(params, 'page'), 1)),
    // Clamped rather than trusted: the API caps the page size, and a hand-edited
    // `?pageSize=5000` would come back a 422 instead of a list.
    pageSize: Math.min(Math.max(toInt(readOne(params, 'pageSize'), DEFAULT_TICKET_PAGE_SIZE), 1), 100),
  };
}

/**
 * The query string for the address bar. Defaults are left out so a plain
 * `/support` stays plain and a shared link carries only what was chosen.
 */
export function serialiseTicketFilters(filters: TicketFilterState): string {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_TICKET_PAGE_SIZE) {
    params.set('pageSize', String(filters.pageSize));
  }

  return params.toString();
}

/**
 * The API path for a set of filters, and therefore the SWR cache key.
 *
 * Every parameter is written explicitly and in a fixed order so that identical
 * filters always produce an identical key, and SWR does not refetch the page it
 * is already showing. `scope=mine` is pinned here: this screen is the
 * requester's own desk, and the queue lives behind a separate staff screen.
 */
export function ticketListPath(filters: TicketFilterState): string {
  const params = new URLSearchParams();

  params.set('scope', 'mine');
  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));

  return `/api/support/tickets?${params.toString()}`;
}

/** The detail endpoint, and the SWR key for one thread. */
export function ticketDetailPath(id: string): string {
  return `/api/support/tickets/${encodeURIComponent(id)}`;
}

/** How many filters are narrowing the list. Paging is not one. */
export function countActiveTicketFilters(filters: TicketFilterState): number {
  return (filters.q ? 1 : 0) + (filters.status ? 1 : 0);
}
