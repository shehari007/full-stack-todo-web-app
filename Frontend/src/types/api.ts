/**
 * Shapes returned by the TaskFlow API.
 *
 * Kept in step with `Server/src/db/schema.ts` and the module serialisers by
 * hand. A shared workspace package would remove the duplication, but it would
 * also force the two apps to build together, which is a worse trade for a
 * project people are meant to be able to deploy the halves of separately.
 */

export type UserRole = 'root' | 'admin' | 'user';
export type UserStatus = 'active' | 'suspended';
export type TodoStatus = 'todo' | 'in_progress' | 'done';
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarId: string | null;
  role: UserRole;
  status: UserStatus;
  mfaEnabled: boolean;
  timezone: string;
  locale: string;
  theme: string;
  storageUsedBytes: number;
  storageQuotaBytes: number | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface Todo {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: string | null;
  completedAt: string | null;
  tags: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  attachments?: AttachmentMeta[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TodoStats {
  total: number;
  byStatus: Record<TodoStatus, number>;
  byPriority: Record<TodoPriority, number>;
  overdue: number;
  dueToday: number;
  completedThisWeek: number;
  completionRate: number;
  currentStreak: number;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

/* -------------------------------------------------------------------------- */
/* API tokens                                                                 */
/* -------------------------------------------------------------------------- */

/** Mirrors `TOKEN_SCOPES` in `Server/src/lib/api-tokens.ts`. Read-only, all of them. */
export type TokenScope = 'tasks:read' | 'stats:read' | 'profile:read';

/**
 * A token as the owner sees it. The secret itself is never in this shape: the
 * API stores only a SHA-256 digest, so `tokenPrefix` is all there is to show.
 */
export interface ApiTokenSummary {
  id: string;
  name: string;
  /** `tf_pat_` plus the first six characters: enough to recognise, useless to a thief. */
  tokenPrefix: string;
  scopes: TokenScope[];
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  /** Null means it never expires. */
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  requestCount30d: number;
}

/** One day of the per-token rollup. `day` is a UTC `YYYY-MM-DD` key. */
export interface ApiTokenUsagePoint {
  day: string;
  requestCount: number;
}

/* -------------------------------------------------------------------------- */
/* Site settings                                                              */
/* -------------------------------------------------------------------------- */

export interface BrandingSettings {
  siteName: string;
  tagline: string;
  logoText: string;
  logoAttachmentId: string | null;
  logoDarkAttachmentId: string | null;
  faviconAttachmentId: string | null;
  ogImageAttachmentId: string | null;
  primaryColor: string;
  accentColor: string;
  borderRadius: number;
}

export interface SeoSettings {
  titleTemplate: string;
  defaultTitle: string;
  defaultDescription: string;
  keywords: string[];
  indexingEnabled: boolean;
  canonicalBaseUrl: string;
  twitterHandle: string;
  organization: {
    name: string;
    legalName: string;
    email: string;
    phone: string;
    addressLine: string;
    website: string;
  };
  verification: { google: string; bing: string };
}

export interface FooterSettings {
  creditLine: string;
  copyrightHolder: string;
  copyrightTemplate: string;
  links: Array<{ label: string; href: string }>;
  social: Array<{ platform: string; href: string }>;
}

export interface LegalDocument {
  title: string;
  body: string;
  effectiveDate: string;
}

export interface LegalSettings {
  policyVersion: string;
  contactEmail: string;
  cookieBannerEnabled: boolean;
  cookieBannerText: string;
  privacy: LegalDocument;
  terms: LegalDocument;
  cookies: LegalDocument;
}

/** Version, sidebar identity and attribution. Root-only on the API. */
export interface AboutSettings {
  version: string;
  releaseChannel: string;
  sidebarSubtitle: string;
  showVersion: boolean;
  showCredits: boolean;
  repositoryUrl: string;
  changelogUrl: string;
  documentationUrl: string;
  supportUrl: string;
  authorName: string;
  authorUrl: string;
  /** `{author}` is substituted when the sidebar renders it. */
  creditTemplate: string;
}

export interface FeatureSettings {
  registrationEnabled: boolean;
  requireMfaForPrivileged: boolean;
  attachmentsEnabled: boolean;
  analyticsEnabled: boolean;
  exportsEnabled: boolean;
  publicLandingEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

export interface LimitsSettings {
  maxUploadBytes: number;
  maxUploadBytesPrivileged: number;
  userStorageQuotaBytes: number;
  privilegedStorageQuotaBytes: number;
  maxAttachmentsPerTodo: number;
  maxTodosPerUser: number;
  allowedUploadMimeTypes: string[];
}

export interface AnalyticsSettings {
  retentionDays: number;
  respectDoNotTrack: boolean;
  excludeAdminTraffic: boolean;
}

/** What the unauthenticated `/api/settings/public` endpoint returns. */
export interface PublicSettings {
  branding: BrandingSettings;
  seo: SeoSettings;
  footer: FooterSettings;
  legal: LegalSettings;
  about: AboutSettings;
  features: FeatureSettings;
}

/** Everything, as returned to the admin panel. */
export interface AllSettings extends PublicSettings {
  limits: LimitsSettings;
  analytics: AnalyticsSettings;
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  newUsersThisWeek: number;
  totalTodos: number;
  completedTodos: number;
  totalAttachments: number;
  storageUsedBytes: number;
  mfaAdoptionRate: number;
  signupSeries: Array<{ date: string; count: number }>;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AnalyticsSummary {
  totals: { pageViews: number; uniqueVisitors: number; events: number };
  series: Array<{ bucket: string; pageViews: number; uniqueVisitors: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  deviceBreakdown: Array<{ device: string; count: number }>;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'MFA_REQUIRED'
  | 'MFA_INVALID'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'MAINTENANCE'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
