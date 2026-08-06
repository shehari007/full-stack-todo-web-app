/**
 * Admin response shapes that the shared `@/types/api` does not cover exactly.
 *
 * Two of the admin endpoints return keys that `types/api.ts` names differently,
 * and one returns a narrower projection than `User`. Rather than render
 * `undefined` into the UI, the real wire shapes are declared here, read straight
 * off the route handlers and services they come from. Each divergence is called
 * out so the integrator can reconcile the two files in one place.
 */
import type { AuditEntry, Pagination, UserRole, UserStatus } from '@/types/api';
import type {
  Ticket,
  TicketMessage,
  TicketStatus,
} from '@/components/support/ticket-meta';
import { TICKET_STATUS_META } from '@/components/support/ticket-meta';

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/admin/users` selects named columns (`userListColumns` in
 * `admin.service.ts`) rather than the row, so `bio`, `timezone`, `locale` and
 * `theme` are absent and `lockedUntil` is present. Typing the list as `User`
 * would promise four fields that never arrive.
 */
export interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarId: string | null;
  role: UserRole;
  status: UserStatus;
  mfaEnabled: boolean;
  storageUsedBytes: number;
  storageQuotaBytes: number | null;
  lastLoginAt: string | null;
  /** Set while a brute-force lockout is in force; null once it lapses. */
  lockedUntil: string | null;
  createdAt: string;
}

export interface AdminUsersResponse {
  users: AdminUserRow[];
  pagination: Pagination;
}

export type UserSortField =
  | 'createdAt'
  | 'username'
  | 'email'
  | 'role'
  | 'lastLoginAt'
  | 'storageUsedBytes';

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export interface SignupPoint {
  date: string;
  count: number;
}

/**
 * `getOverview()` returns the 14-day series under `signups`, while
 * `AdminOverview` in `types/api.ts` calls it `signupSeries`. Both are accepted
 * here and the reader picks whichever arrived, so the chart survives whichever
 * side is corrected first.
 */
export interface AdminOverviewPayload {
  totalUsers: number;
  activeUsers: number;
  newUsersThisWeek: number;
  totalTodos: number;
  completedTodos: number;
  totalAttachments: number;
  storageUsedBytes: number;
  /** Already a fraction of 1, rounded to three places by the server. */
  mfaAdoptionRate: number;
  signups?: SignupPoint[];
  signupSeries?: SignupPoint[];
}

export interface AdminOverviewResponse {
  overview: AdminOverviewPayload;
}

export function signupSeriesOf(overview: AdminOverviewPayload): SignupPoint[] {
  return overview.signupSeries ?? overview.signups ?? [];
}

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `GET /api/analytics/summary` reports two figures per row (`views`/`visitors`
 * for the lists, `visitors`/`events` for devices) where `AnalyticsSummary` in
 * `types/api.ts` has a single `count`, and it also returns the resolved `range`.
 * The panel shows both figures, so it needs the real shape.
 */
export interface AdminAnalyticsSummary {
  range: { from: string; to: string; granularity: 'day' | 'week' };
  totals: { pageViews: number; uniqueVisitors: number; events: number };
  series: Array<{ bucket: string; pageViews: number; uniqueVisitors: number; events: number }>;
  topPaths: Array<{ path: string; views: number; visitors: number }>;
  topReferrers: Array<{ referrer: string; views: number; visitors: number }>;
  deviceBreakdown: Array<{ device: string; visitors: number; events: number }>;
}

export interface AnalyticsSummaryResponse {
  summary: AdminAnalyticsSummary;
}

export interface AnalyticsPurgeResponse {
  purge: { deletedCount: number; retentionDays: number; cutoff: string };
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export interface AuditListResponse {
  entries: AuditEntry[];
  pagination: Pagination;
}

/**
 * Every `action` string `recordAudit` is called with across the API. Used to
 * populate the filter; the field itself is free text on the server, so an
 * unknown value still renders.
 */
export const AUDIT_ACTIONS = [
  'analytics.purge',
  'attachment.delete',
  'auth.login',
  'auth.logout',
  'auth.logout_all',
  'auth.mfa_disabled',
  'auth.mfa_enabled',
  'auth.password_change',
  'auth.register',
  'auth.session_revoked',
  // The support desk. An action missing from this list is not an error (the
  // column is free text and an unknown value still renders), but it is
  // unfilterable, which on this screen means unfindable.
  'contact.submit',
  'data.export',
  'settings.reset',
  'settings.update',
  'site_asset.upload',
  'ticket.create',
  'ticket.reply',
  'ticket.update',
  'todo.bulk_delete',
  'user.create',
  'user.delete',
  'user.mfa_reset',
  'user.password_reset',
  'user.quota_change',
  'user.role_change',
  'user.update',
] as const;

/* -------------------------------------------------------------------------- */
/* Support queue                                                              */
/* -------------------------------------------------------------------------- */

/** An account named on a ticket: the requester, or the staff member holding it. */
export interface TicketParty {
  id: string;
  username: string;
  displayName: string | null;
  /**
   * Staff-only, and only ever on the *requester*.
   *
   * `toTicketView` attaches these to the requester for a staff caller and never
   * to the assignee. To a requester, the administrator holding their ticket is
   * a name, not an address. Optional because a requester's own view of the same
   * shape carries neither.
   */
  email?: string | null;
  avatarId?: string | null;
}

/**
 * A queue row: the requester's `Ticket` plus everything only staff may see.
 *
 * Extends that interface rather than restating it, so the two sides of the desk
 * cannot drift apart. The added fields are exactly the columns
 * `GET /api/support/tickets?scope=all` puts on top of the requester's own list:
 * who asked, who holds it, and the forensics kept for a guest submission.
 */
export interface StaffTicketRow extends Ticket {
  /** Null exactly when a signed-out visitor used the contact form. */
  requester: TicketParty | null;
  guestName: string | null;
  guestEmail: string | null;
  assignee: TicketParty | null;
  /**
   * One flag, resolved for whoever asked.
   *
   * `toTicketView` in `support.service.ts` picks the column (`unreadForStaff`
   * for staff, `unreadForRequester` for the requester) and publishes the result
   * under this single name. Neither column reaches the wire, so reading
   * `row.unreadForStaff` here got `undefined` and the "New" tag never rendered.
   */
  unread: boolean;
  /**
   * Contact-form forensics, so a wave of abuse can be traced back and blocked.
   *
   * Optional rather than `string | null`, because `toTicketView` spreads these
   * in only for a staff caller. The key is *absent*, not null, on a requester's
   * own view of the same ticket. An in-app ticket leaves both null.
   */
  ipAddress?: string | null;
  userAgent?: string | null;
  messageCount?: number;
}

/**
 * A file hanging off a thread message.
 *
 * Narrower than `AttachmentMeta`, and deliberately its own type rather than a
 * reuse of it: `TicketAttachmentView` in `support.service.ts` projects five
 * named columns, and `width`/`height` (required on `AttachmentMeta`) are not
 * among them. Typing the thread's files as `AttachmentMeta` would promise two
 * keys that never arrive.
 */
export interface TicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

/** A thread message as staff see it: internal notes included, files attached. */
export interface StaffTicketMessage extends TicketMessage {
  attachments?: TicketAttachment[];
}

export interface StaffTicketThreadResponse {
  ticket: StaffTicketRow;
  messages: StaffTicketMessage[];
}

/**
 * `GET /api/support/tickets?scope=all`: exactly the two keys the route returns.
 *
 * The headline counts are deliberately *not* here: they come from `/stats`
 * below. The list route returns only what it paged.
 */
export interface SupportQueueResponse {
  tickets: StaffTicketRow[];
  pagination: Pagination;
}

export interface SupportQueueCounts {
  /** Live: `open` or `pending`. */
  open: number;
  /** Live, and the last thing said was not said by us. */
  awaitingReply: number;
  /** Settled since midnight, server time. */
  resolvedToday: number;
}

/**
 * `GET /api/support/stats`: the queue's three headline figures.
 *
 * Staff only and refused rather than scoped down, so this key is never fetched
 * from a screen an ordinary user can reach. Whole-installation counts: deriving
 * them from the loaded page instead would be worse than showing nothing, since
 * one page of 25 rows cannot count a queue of 400.
 */
export const SUPPORT_STATS_KEY = '/api/support/stats';

export interface SupportStatsResponse {
  counts: SupportQueueCounts;
}

/**
 * `pending` reads "Awaiting your reply" to a requester, and that possessive
 * inverts across the desk: on the staff side it is the requester who owes the
 * answer. Exactly one word changes. Every other label, colour, icon and hint
 * still comes from `TICKET_STATUS_META`, so the two screens stay one vocabulary.
 */
const STAFF_STATUS_LABEL: Partial<Record<TicketStatus, string>> = {
  pending: 'Awaiting requester',
};

export function staffStatusLabel(status: TicketStatus): string {
  return STAFF_STATUS_LABEL[status] ?? TICKET_STATUS_META[status].label;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The `support` section of `Server/src/config/settings.ts`.
 *
 * Declared here rather than in `@/types/api` for the same reason as the shapes
 * above: this file is where a section the shared types file has not caught up
 * with is written down. It is structurally identical to the server's
 * `supportSchema`, so it stays assignable if the two are ever merged.
 */
export interface SupportSettings {
  categories: string[];
  contactHeading: string;
  contactIntro: string;
  responseTimeNote: string;
  acknowledgement: string;
  contactMaxPerHour: number;
  contactMinFillSeconds: number;
  contactMaxMessageLength: number;
  contactRequiresAccount: boolean;
}

export type SettingsSectionKey =
  | 'branding'
  | 'seo'
  | 'footer'
  | 'legal'
  | 'about'
  | 'support'
  | 'limits'
  | 'features'
  | 'analytics';

/** What `GET /api/admin/settings` returns: every section, public and private. */
export interface AdminSettingsResponse {
  settings: {
    branding: import('@/types/api').BrandingSettings;
    seo: import('@/types/api').SeoSettings;
    footer: import('@/types/api').FooterSettings;
    legal: import('@/types/api').LegalSettings;
    about: import('@/types/api').AboutSettings;
    support: SupportSettings;
    limits: import('@/types/api').LimitsSettings;
    features: import('@/types/api').FeatureSettings;
    analytics: import('@/types/api').AnalyticsSettings;
  };
}

/** `PUT`/`reset` echo back only the section that changed. */
export type SettingsSectionResponse<T> = { settings: Record<string, T> };
