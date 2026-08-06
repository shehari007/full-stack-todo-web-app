/**
 * Database schema: the single source of truth for TaskFlow's data model.
 *
 * Migrations are generated from this file (`npm run db:generate`) and applied
 * forward-only (`npm run db:migrate`). Never edit a migration that has shipped;
 * change the schema here and generate a new one.
 *
 * Design notes:
 *  - `username` and `email` are stored already-lowercased and carry plain unique
 *    constraints. That gives case-insensitive identity without needing the
 *    `citext` extension, which Supabase does not enable by default.
 *  - Files live in Postgres as `bytea`. This keeps the project to one backing
 *    store and one backup, which is why uploads are capped hard at 1 MB.
 *  - Rows users can restore are soft-deleted (`deleted_at`); everything else is
 *    removed for real.
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Postgres `bytea`. Drizzle has no built-in, so map it to a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Shared timestamp helper so every table records time the same way. */
const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull();

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `root` is the single owner account: it can manage every user and every
 * setting, and the application refuses to delete or demote the last one.
 * `admin` is a delegated moderator. `user` is everyone else.
 */
export const userRoleEnum = pgEnum('user_role', ['root', 'admin', 'user']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended']);
export const todoStatusEnum = pgEnum('todo_status', ['todo', 'in_progress', 'done']);
export const todoPriorityEnum = pgEnum('todo_priority', ['low', 'medium', 'high', 'urgent']);
export const attachmentKindEnum = pgEnum('attachment_kind', [
  'todo_file',
  'avatar',
  'site_asset',
  'ticket_file',
]);

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'pending',
  'resolved',
  'closed',
]);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);
/** Where the ticket came from: the signed-in app, or the public contact form. */
export const ticketSourceEnum = pgEnum('ticket_source', ['app', 'contact']);

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Lowercased at the application boundary; the unique index enforces identity. */
    username: text('username').notNull(),
    email: text('email').notNull(),

    /** Argon2id digest. Never leaves the server: excluded from every serializer. */
    passwordHash: text('password_hash').notNull(),

    displayName: text('display_name'),
    bio: text('bio'),
    avatarId: uuid('avatar_id'),

    role: userRoleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('active'),

    /* --- Multi-factor authentication (TOTP) --- */
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    /** AES-256-GCM ciphertext of the TOTP secret, never the raw secret. */
    mfaSecret: text('mfa_secret'),
    /** Argon2 digests of one-time recovery codes; consumed codes are removed. */
    mfaRecoveryCodes: jsonb('mfa_recovery_codes').$type<string[]>(),
    mfaEnrolledAt: timestamp('mfa_enrolled_at', { withTimezone: true, mode: 'date' }),
    /**
     * Highest TOTP time step already accepted for this account. Codes at or
     * below it are rejected, so an intercepted code cannot be replayed during
     * the ~90 seconds it would otherwise remain valid.
     */
    mfaLastTimeStep: bigint('mfa_last_time_step', { mode: 'number' }),

    /* --- Storage accounting --- */
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
    /** Per-user override. NULL means "use the role default from site settings". */
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),

    /* --- Preferences --- */
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').notNull().default('system'),

    /* --- Brute-force protection --- */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),

    /**
     * Invalidation cut-off. Access tokens issued before this instant are
     * rejected, which is how "log out everywhere" and forced password resets
     * take effect immediately despite tokens being stateless.
     */
    tokensValidFrom: timestamp('tokens_valid_from', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('users_username_key').on(table.username),
    uniqueIndex('users_email_key').on(table.email),
    index('users_role_idx').on(table.role),
    index('users_created_at_idx').on(table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Sessions (refresh tokens)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One row per active refresh token. Storing them lets an administrator revoke a
 * single device, and lets refresh-token rotation detect replay: if a token that
 * was already rotated is presented again, the whole family is revoked.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** SHA-256 of the token. A database leak must not yield usable tokens. */
    tokenHash: text('token_hash').notNull(),

    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),

    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    /** Set when this token is rotated, pointing at its replacement. */
    replacedBy: uuid('replaced_by'),

    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Personal access tokens                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Long-lived, read-only credentials a user creates for their own integrations:
 * fetching their task list onto a personal site, a status page, a script.
 *
 * Deliberately weaker than a session, and that is the point: a token grants
 * read access to one account's own data and nothing else, so a token pasted
 * into a public repository is an embarrassment rather than an account takeover.
 * Only a SHA-256 of the token is stored; the plaintext is shown once at
 * creation and is unrecoverable afterwards.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** User-supplied label, so a token can be identified and revoked later. */
    name: text('name').notNull(),

    tokenHash: text('token_hash').notNull(),
    /**
     * First characters of the token, stored in the clear purely so the UI can
     * show `tf_pat_a1b2c3...` next to the name. Far too short to be guessable.
     */
    tokenPrefix: text('token_prefix').notNull(),

    /** Granted scopes, e.g. `tasks:read`. Checked on every request. */
    scopes: text('scopes').array().notNull().default(sql`ARRAY[]::text[]`),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    lastUsedIp: text('last_used_ip'),
    /** NULL means it never expires; the UI encourages setting one. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('api_tokens_hash_key').on(table.tokenHash),
    index('api_tokens_user_idx').on(table.userId),
  ],
);

/**
 * Daily request counts per token.
 *
 * A rollup rather than a row per request: an integration polling every minute
 * would otherwise write half a million rows a year per token, to answer a
 * question ("is this thing being used, and how much?") that only needs daily
 * resolution.
 */
export const apiTokenUsage = pgTable(
  'api_token_usage',
  {
    tokenId: uuid('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    /** Calendar day in UTC. */
    day: text('day').notNull(),
    requestCount: integer('request_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('api_token_usage_key').on(table.tokenId, table.day),
    index('api_token_usage_day_idx').on(table.day),
  ],
);

/* -------------------------------------------------------------------------- */
/* Todos                                                                      */
/* -------------------------------------------------------------------------- */

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),

    status: todoStatusEnum('status').notNull().default('todo'),
    priority: todoPriorityEnum('priority').notNull().default('medium'),

    /**
     * A real timestamp, replacing v1's `DD-MM-YYYY` string. Strings could not be
     * sorted, range-filtered, or compared against "now" in SQL.
     */
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),

    /** Manual drag-to-reorder position. Sparse values leave room for insertion. */
    position: integer('position').notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    /* The dashboard's default query: a user's live tasks, newest first. */
    index('todos_user_active_idx')
      .on(table.userId, table.deletedAt, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
    index('todos_user_status_idx').on(table.userId, table.status),
    index('todos_due_at_idx').on(table.dueAt),
    /* Full-text search over title + description, used by the search box. */
    index('todos_search_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.title} || ' ' || coalesce(${table.description}, ''))`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

/**
 * File bytes live directly in Postgres. `data` is `bytea`, so it must never be
 * selected by a list query. Always project explicit columns, or a listing of
 * 50 files will pull 50 MB into memory.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    kind: attachmentKindEnum('kind').notNull(),

    /** Owner. NULL only for `site_asset` rows, which belong to the installation. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    todoId: uuid('todo_id').references(() => todos.id, { onDelete: 'cascade' }),
    /**
     * Set for `ticket_file` rows. Access is decided by who can read the parent
     * ticket, not by `userId`: a guest submission has no owner, and staff must
     * be able to open what a requester attached.
     */
    ticketMessageId: uuid('ticket_message_id'),

    filename: text('filename').notNull(),
    /** Verified against the file's magic bytes, not trusted from the client. */
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    /** SHA-256 of the contents, used as a strong ETag for caching. */
    checksum: text('checksum').notNull(),

    /** Set for images so the UI can size placeholders without decoding. */
    width: integer('width'),
    height: integer('height'),

    data: bytea('data').notNull(),

    createdAt: createdAt(),
  },
  (table) => [
    index('attachments_user_id_idx').on(table.userId),
    index('attachments_todo_id_idx').on(table.todoId),
    index('attachments_kind_idx').on(table.kind),
    index('attachments_ticket_message_idx').on(table.ticketMessageId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Support tickets                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One table serves both the in-app support panel and the public contact form.
 *
 * They are the same thing from the operator's side (a conversation that needs
 * an answer), and splitting them would mean two inboxes, two unread counts and
 * two places to forget something. `source` records which door it came in by,
 * and `userId` is null exactly when it came from a signed-out visitor.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Short human reference (#1042). People quote this in follow-ups, and a
     * UUID is useless for that. Sequential is fine: ticket counts are not a
     * secret worth protecting with a random id.
     */
    number: integer('number').generatedAlwaysAsIdentity().notNull(),

    /** Null for a contact-form submission from someone with no account. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Captured only for guests, so a reply has somewhere to go. */
    guestName: text('guest_name'),
    guestEmail: text('guest_email'),

    subject: text('subject').notNull(),
    category: text('category').notNull().default('general'),

    status: ticketStatusEnum('status').notNull().default('open'),
    priority: ticketPriorityEnum('priority').notNull().default('normal'),
    source: ticketSourceEnum('source').notNull().default('app'),

    assignedToId: uuid('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * Denormalised so the list can sort by activity and show "awaiting reply"
     * without joining and aggregating the messages table on every render.
     */
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true, mode: 'date' }),
    lastReplyByStaff: boolean('last_reply_by_staff').notNull().default(false),
    /** Cleared when staff reply; drives the requester's unread badge. */
    unreadForRequester: boolean('unread_for_requester').notNull().default(false),
    unreadForStaff: boolean('unread_for_staff').notNull().default(true),

    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),

    /** Kept for guest submissions so abuse can be traced back and blocked. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('tickets_number_key').on(table.number),
    index('tickets_user_idx').on(table.userId),
    index('tickets_status_idx').on(table.status),
    index('tickets_assigned_idx').on(table.assignedToId),
    index('tickets_activity_idx').on(table.lastReplyAt),
    /* Abuse forensics: how many submissions came from one address recently. */
    index('tickets_ip_created_idx').on(table.ipAddress, table.createdAt),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),

    /** Null when the author was a signed-out guest. */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Denormalised so a deleted account does not erase who said what. */
    authorName: text('author_name'),

    body: text('body').notNull(),

    /**
     * Staff-only note. Never returned to the requester. The filter for that
     * lives in the SQL, not in the serialiser, so a forgotten `.map` cannot
     * leak one.
     */
    isInternal: boolean('is_internal').notNull().default(false),
    /** True when written by root or an admin, for styling the thread. */
    isStaff: boolean('is_staff').notNull().default(false),

    createdAt: createdAt(),
  },
  (table) => [
    index('ticket_messages_ticket_idx').on(table.ticketId, table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Site settings (the CMS)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Store backing the root control panel: branding, SEO defaults, legal copy,
 * feature flags, upload limits.
 *
 * One row per *section* (`branding`, `seo`, `legal`, ...) rather than one row per
 * individual field. Each row's `value` is a JSON object validated by the
 * matching zod schema in `config/settings.ts`, which keeps the table small and
 * lets the admin UI save a whole section atomically.
 *
 * `isPublic` decides whether a section is served by the unauthenticated
 * `GET /api/settings/public` endpoint the web app reads for SSR metadata.
 * Operational sections such as `limits` stay private.
 */
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  isPublic: boolean('is_public').notNull().default(false),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Append-only record of privileged actions. Deliberately has no update or
 * delete path in the application. The root panel can read and export it, and
 * that is all.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** NULL when the actor was deleted afterwards; the entry itself survives. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorUsername: text('actor_username'),

    /** Dotted verb, e.g. `user.suspend`, `settings.update`, `auth.mfa.disable`. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_actor_idx').on(table.actorId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * First-party, privacy-preserving event stream: no third-party scripts and no
 * cookies. `visitorHash` is a daily-rotating HMAC of IP + user agent, so unique
 * visitors can be counted without the value being reversible or stable enough
 * to track someone across days.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    name: text('name').notNull(),
    path: text('path'),
    referrer: text('referrer'),

    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    visitorHash: text('visitor_hash'),

    /** Coarse buckets only, never a raw user-agent string. */
    device: text('device'),
    country: text('country'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: createdAt(),
  },
  (table) => [
    index('analytics_events_name_idx').on(table.name),
    index('analytics_events_created_at_idx').on(table.createdAt),
    index('analytics_events_path_idx').on(table.path),
  ],
);

/* -------------------------------------------------------------------------- */
/* Cookie consent                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Proof of consent, which GDPR requires to be demonstrable. Keyed by a random
 * client-generated id for signed-out visitors, and linked to the account once
 * the visitor signs in.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Opaque random id from the client, stored in a first-party cookie. */
    anonymousId: text('anonymous_id'),

    /** `necessary` is always true; the rest reflect the visitor's choices. */
    categories: jsonb('categories')
      .$type<{ necessary: true; analytics: boolean; preferences: boolean }>()
      .notNull(),

    /** Which revision of the policy was agreed to, so re-consent can be prompted. */
    policyVersion: text('policy_version').notNull(),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),

    createdAt: createdAt(),
  },
  (table) => [
    index('consent_records_user_idx').on(table.userId),
    index('consent_records_anon_idx').on(table.anonymousId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  requester: one(users, {
    fields: [tickets.userId],
    references: [users.id],
    relationName: 'ticket_requester',
  }),
  assignee: one(users, {
    fields: [tickets.assignedToId],
    references: [users.id],
    relationName: 'ticket_assignee',
  }),
  messages: many(ticketMessages),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({ one, many }) => ({
  ticket: one(tickets, { fields: [ticketMessages.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketMessages.authorId], references: [users.id] }),
  attachments: many(attachments),
}));

export const apiTokensRelations = relations(apiTokens, ({ one, many }) => ({
  user: one(users, { fields: [apiTokens.userId], references: [users.id] }),
  usage: many(apiTokenUsage),
}));

export const apiTokenUsageRelations = relations(apiTokenUsage, ({ one }) => ({
  token: one(apiTokens, { fields: [apiTokenUsage.tokenId], references: [apiTokens.id] }),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  todos: many(todos),
  sessions: many(sessions),
  attachments: many(attachments),
  apiTokens: many(apiTokens),
  avatar: one(attachments, {
    fields: [users.avatarId],
    references: [attachments.id],
    relationName: 'user_avatar',
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const todosRelations = relations(todos, ({ one, many }) => ({
  user: one(users, { fields: [todos.userId], references: [users.id] }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  user: one(users, { fields: [attachments.userId], references: [users.id] }),
  todo: one(todos, { fields: [attachments.todoId], references: [todos.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];
export type TicketPriority = (typeof ticketPriorityEnum.enumValues)[number];
export type TicketSource = (typeof ticketSourceEnum.enumValues)[number];

export type ApiToken = typeof apiTokens.$inferSelect;
export type ApiTokenUsage = typeof apiTokenUsage.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type SiteSetting = typeof siteSettings.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type ConsentRecord = typeof consentRecords.$inferSelect;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type TodoStatus = (typeof todoStatusEnum.enumValues)[number];
export type TodoPriority = (typeof todoPriorityEnum.enumValues)[number];
export type AttachmentKind = (typeof attachmentKindEnum.enumValues)[number];
