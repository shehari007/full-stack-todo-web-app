/**
 * Control-panel logic.
 *
 * Routes here are thin on purpose: the rules that decide who may act on whom,
 * and the multi-step operations that must not be half-applied, all live in this
 * file so there is exactly one place to audit them.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  attachments,
  auditLogs,
  sessions,
  todos,
  users,
  type User,
  type UserRole,
  type UserStatus,
} from '../../db/schema.js';
import type { AuthContext } from '../../types/express.js';
import { badRequest, conflict, forbidden, internal, notFound } from '../../lib/errors.js';
import { diffForAudit } from '../../lib/audit.js';
import { hashPassword } from '../../lib/password.js';
import { assertNotLastRoot, revokeAllSessions, toPublicUser } from '../auth/auth.service.js';
import type {
  AuditQuery,
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
} from './admin.schemas.js';

/* -------------------------------------------------------------------------- */
/* Authorisation                                                              */
/* -------------------------------------------------------------------------- */

const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['root', 'admin']);

/** `modify` covers edits and quota changes; `destroy` covers role, status and deletion. */
export type ManageIntent = 'modify' | 'destroy';

/**
 * The single gate every user-management route passes through.
 *
 * Two rules, both of which are privilege escalations rather than mere mistakes
 * when they are missing:
 *
 *  - Only root may act on a privileged account. An admin who can edit another
 *    admin can reset that account's password, sign in as it, and inherit
 *    whatever it could do, or simply suspend every other administrator and be
 *    left alone in the panel. The one exemption is an admin editing their own
 *    row, which grants nothing they do not already have.
 *  - Nobody may destroy themselves. Self-demotion and self-suspension are how an
 *    installation ends up with a control panel that no one can open.
 */
export function assertCanManage(
  actor: AuthContext,
  target: Pick<User, 'id' | 'role'>,
  intent: ManageIntent,
): void {
  if (intent === 'destroy' && target.id === actor.userId) {
    throw forbidden(
      'You cannot change the role, status or existence of your own account from here',
    );
  }

  if (actor.role !== 'root' && PRIVILEGED_ROLES.has(target.role) && target.id !== actor.userId) {
    throw forbidden('Only the root account can manage administrator accounts');
  }
}

/**
 * Load a user for a privileged operation, guard included.
 *
 * The full row is returned (callers need `passwordHash` comparisons and the
 * before-image for the audit diff), so it must be passed through `toPublicUser`
 * before it reaches a response.
 */
export async function loadManagedUser(
  actor: AuthContext,
  targetId: string,
  intent: ManageIntent,
): Promise<User> {
  const [target] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
    .limit(1);

  if (!target) {
    throw notFound('No such user');
  }

  assertCanManage(actor, target, intent);
  return target;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Named explicitly instead of selecting the row. `passwordHash`, `mfaSecret` and
 * `mfaRecoveryCodes` are then not merely filtered out of the response. They
 * never leave the database.
 */
const userListColumns = {
  id: users.id,
  username: users.username,
  email: users.email,
  displayName: users.displayName,
  avatarId: users.avatarId,
  role: users.role,
  status: users.status,
  mfaEnabled: users.mfaEnabled,
  storageUsedBytes: users.storageUsedBytes,
  storageQuotaBytes: users.storageQuotaBytes,
  lastLoginAt: users.lastLoginAt,
  lockedUntil: users.lockedUntil,
  createdAt: users.createdAt,
} as const;

/** Sorting is a lookup, never interpolation: `?sort=` must not reach the SQL text. */
const USER_SORT_COLUMNS = {
  createdAt: users.createdAt,
  username: users.username,
  email: users.email,
  role: users.role,
  lastLoginAt: users.lastLoginAt,
  storageUsedBytes: users.storageUsedBytes,
} as const;

/** `%` and `_` are wildcards in LIKE, so a search for `100%` must not match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function listUsers(query: ListUsersQuery) {
  const filters: (SQL | undefined)[] = [isNull(users.deletedAt)];

  if (query.role) filters.push(eq(users.role, query.role));
  if (query.status) filters.push(eq(users.status, query.status));

  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    filters.push(
      or(
        ilike(users.username, pattern),
        ilike(users.email, pattern),
        ilike(users.displayName, pattern),
      ),
    );
  }

  const where = and(...filters);
  const direction = query.order === 'asc' ? asc : desc;

  const rows = await db
    .select(userListColumns)
    .from(users)
    .where(where)
    // The id tiebreaker keeps paging stable when the sort column has duplicates,
    // which otherwise lets a row appear on two pages and another on none.
    .orderBy(direction(USER_SORT_COLUMNS[query.sort]), asc(users.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const [totals] = await db.select({ value: count() }).from(users).where(where);
  const total = totals?.value ?? 0;

  return {
    users: rows,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/**
 * One user with the counts the detail screen shows.
 *
 * No guard: nothing here is secret (it is the same public projection the list
 * already returns), and an admin who cannot see that another admin exists cannot
 * be told why an operation on them was refused.
 */
export async function getUserDetail(userId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw notFound('No such user');
  }

  const [todoRows, attachmentRows, sessionRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(todos)
      .where(and(eq(todos.userId, userId), isNull(todos.deletedAt))),
    db.select({ value: count() }).from(attachments).where(eq(attachments.userId, userId)),
    db
      .select({ value: count() })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      ),
  ]);

  return {
    user: toPublicUser(user),
    /* Operational state an administrator needs but a user's own profile does not. */
    security: {
      mfaEnrolledAt: user.mfaEnrolledAt,
      failedLoginCount: user.failedLoginCount,
      lockedUntil: user.lockedUntil,
      tokensValidFrom: user.tokensValidFrom,
      updatedAt: user.updatedAt,
    },
    counts: {
      todos: todoRows[0]?.value ?? 0,
      attachments: attachmentRows[0]?.value ?? 0,
      sessions: sessionRows[0]?.value ?? 0,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Account lifecycle                                                          */
/* -------------------------------------------------------------------------- */

export async function createUser(input: CreateUserInput): Promise<User> {
  // Soft-deleted rows keep their username and email, and so keep their unique
  // index entries. The check must not filter them out or the insert below
  // fails with a raw constraint violation instead of a useful message.
  const [existing] = await db
    .select({ username: users.username })
    .from(users)
    .where(or(eq(users.username, input.username), eq(users.email, input.email)))
    .limit(1);

  if (existing) {
    throw conflict(
      existing.username === input.username
        ? 'That username is already taken'
        : 'An account with that email already exists',
    );
  }

  const [created] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName ?? null,
      role: input.role,
      status: input.status,
    })
    .returning();

  if (!created) {
    throw internal('Failed to create the account');
  }

  return created;
}

/**
 * Apply a profile patch.
 *
 * A status change is routed through the same guard the dedicated status endpoint
 * uses. Without that, `PATCH {"status":"suspended"}` would be a way around the
 * last-root and self-suspension rules.
 */
export async function updateUser(
  actor: AuthContext,
  target: User,
  patch: UpdateUserInput,
): Promise<{ user: User; changes: Record<string, { from: unknown; to: unknown }> }> {
  if (patch.email !== undefined && patch.email !== target.email) {
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, patch.email), ne(users.id, target.id)))
      .limit(1);

    if (clash) {
      throw conflict('An account with that email already exists');
    }
  }

  const suspending = patch.status === 'suspended' && target.status !== 'suspended';
  if (patch.status !== undefined && patch.status !== target.status) {
    await assertStatusChangeAllowed(actor, target, patch.status);
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id))
    .returning();

  if (!updated) {
    throw notFound('That account no longer exists');
  }

  if (suspending) {
    await revokeAllSessions(target.id);
  }

  return {
    user: updated,
    changes: diffForAudit(
      { displayName: target.displayName, email: target.email, status: target.status },
      { displayName: updated.displayName, email: updated.email, status: updated.status },
    ),
  };
}

export async function changeUserRole(target: User, role: UserRole): Promise<User> {
  if (target.role === role) {
    throw badRequest(`That account is already ${role}`);
  }

  // Demoting the only root leaves the installation with no way back into the
  // control panel short of editing the database by hand.
  if (target.role === 'root') {
    await assertNotLastRoot(target.id);
  }

  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, target.id))
    .returning();

  if (!updated) {
    throw notFound('That account no longer exists');
  }

  // Sessions are deliberately left alone: `resolveAuth` reads the role from the
  // row on every request, so the new role is already in force everywhere.
  return updated;
}

/** Shared by the status endpoint and by `PATCH` so neither can bypass it. */
async function assertStatusChangeAllowed(
  actor: AuthContext,
  target: User,
  status: UserStatus,
): Promise<void> {
  if (status !== 'suspended') return;

  if (target.id === actor.userId) {
    throw forbidden('You cannot suspend your own account');
  }

  await assertNotLastRoot(target.id);
}

export async function changeUserStatus(
  actor: AuthContext,
  target: User,
  status: UserStatus,
): Promise<User> {
  if (target.status === status) {
    throw badRequest(`That account is already ${status}`);
  }

  await assertStatusChangeAllowed(actor, target, status);

  const [updated] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, target.id))
    .returning();

  if (!updated) {
    throw notFound('That account no longer exists');
  }

  // A suspended account that keeps a live refresh token would simply mint itself
  // a new session once the access token expired.
  if (status === 'suspended') {
    await revokeAllSessions(target.id);
  }

  return updated;
}

export async function setUserQuota(target: User, storageQuotaBytes: number | null): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ storageQuotaBytes, updatedAt: new Date() })
    .where(eq(users.id, target.id))
    .returning();

  if (!updated) {
    throw notFound('That account no longer exists');
  }

  return updated;
}

/**
 * Force a new password.
 *
 * The lockout counter is cleared alongside it: an administrator resetting a
 * password is the recovery path for a locked-out user, so leaving the lock in
 * place would defeat the operation.
 */
export async function resetUserPassword(target: User, newPassword: string): Promise<void> {
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      tokensValidFrom: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id));

  await revokeAllSessions(target.id);
}

/**
 * Clear multi-factor authentication: the recovery path when a user loses their
 * authenticator and their recovery codes.
 *
 * Sessions are revoked because the account has just been downgraded to a single
 * factor; anything still signed in was authorised under the old configuration.
 */
export async function resetUserMfa(target: User): Promise<void> {
  await db
    .update(users)
    .set({
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: null,
      mfaEnrolledAt: null,
      mfaLastTimeStep: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.id));

  await revokeAllSessions(target.id);
}

/**
 * Remove an account for real.
 *
 * Sessions, todos and attachments go with it through `ON DELETE CASCADE`. Audit
 * entries do not: their `actorId` is nulled while `actorUsername` survives, so
 * the record of what the account did outlives the account itself.
 */
export async function deleteUser(target: User): Promise<void> {
  await assertNotLastRoot(target.id);
  await db.delete(users).where(eq(users.id, target.id));
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Values larger than this are recorded as a name only. Legal documents run to
 * tens of thousands of characters, and a settings diff that inlined two copies
 * of a privacy policy would bloat the audit table on every save.
 */
const AUDIT_VALUE_MAX_CHARS = 200;

export function summariseSettingsChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { fields: string[]; changes: Record<string, { from: unknown; to: unknown }> } {
  const diff = diffForAudit(before, after);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [field, change] of Object.entries(diff)) {
    const size = JSON.stringify(change).length;
    changes[field] =
      size > AUDIT_VALUE_MAX_CHARS ? { from: '[omitted]', to: '[omitted]' } : change;
  }

  return { fields: Object.keys(diff), changes };
}

export async function listAuditLogs(query: AuditQuery) {
  const filters: (SQL | undefined)[] = [];

  if (query.action) filters.push(eq(auditLogs.action, query.action));
  if (query.actorId) filters.push(eq(auditLogs.actorId, query.actorId));
  if (query.targetType) filters.push(eq(auditLogs.targetType, query.targetType));
  if (query.targetId) filters.push(eq(auditLogs.targetId, query.targetId));
  if (query.from) filters.push(gte(auditLogs.createdAt, query.from));
  if (query.to) filters.push(lte(auditLogs.createdAt, query.to));

  const where = filters.length > 0 ? and(...filters) : undefined;

  const entries = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const [totals] = await db.select({ value: count() }).from(auditLogs).where(where);
  const total = totals?.value ?? 0;

  return {
    entries,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

const SPARKLINE_DAYS = 14;

/** An alias, not an interface: only aliases satisfy Drizzle's row-type bound. */
type SignupPoint = { date: string; count: number };

/**
 * Dashboard figures.
 *
 * Every number is an aggregate computed by Postgres. Counting in JavaScript
 * would mean streaming every user, todo and attachment row into the process to
 * produce eight integers.
 */
export async function getOverview() {
  const [userTotals, todoTotals, attachmentTotals, signups] = await Promise.all([
    db
      .select({
        totalUsers: sql<number>`count(*)::int`,
        activeUsers: sql<number>`(count(*) filter (where ${users.status} = 'active'))::int`,
        newUsersThisWeek: sql<number>`
          (count(*) filter (where ${users.createdAt} >= now() - interval '7 days'))::int
        `,
        mfaUsers: sql<number>`(count(*) filter (where ${users.mfaEnabled}))::int`,
      })
      .from(users)
      .where(isNull(users.deletedAt)),

    db
      .select({
        totalTodos: sql<number>`count(*)::int`,
        completedTodos: sql<number>`(count(*) filter (where ${todos.status} = 'done'))::int`,
      })
      .from(todos)
      .where(isNull(todos.deletedAt)),

    db
      .select({
        totalAttachments: sql<number>`count(*)::int`,
        // Cast to bigint rather than left as numeric: the INT8 parser turns it
        // into a JS number, whereas numeric arrives as a string.
        storageUsedBytes: sql<number>`coalesce(sum(${attachments.byteSize}), 0)::bigint`,
      })
      .from(attachments),

    // `generate_series` supplies the days themselves, so a day with no signups
    // is a zero in the series rather than a missing point the client must infer.
    db.execute<SignupPoint>(sql`
      select to_char(series.day, 'YYYY-MM-DD') as date,
             count(u.id)::int as count
        from generate_series(
               current_date - make_interval(days => ${SPARKLINE_DAYS - 1}),
               current_date,
               interval '1 day'
             ) as series(day)
        left join ${users} u
          on u.created_at >= series.day
         and u.created_at < series.day + interval '1 day'
         and u.deleted_at is null
       group by series.day
       order by series.day
    `),
  ]);

  const totalUsers = userTotals[0]?.totalUsers ?? 0;
  const mfaUsers = userTotals[0]?.mfaUsers ?? 0;

  return {
    totalUsers,
    activeUsers: userTotals[0]?.activeUsers ?? 0,
    newUsersThisWeek: userTotals[0]?.newUsersThisWeek ?? 0,
    totalTodos: todoTotals[0]?.totalTodos ?? 0,
    completedTodos: todoTotals[0]?.completedTodos ?? 0,
    totalAttachments: attachmentTotals[0]?.totalAttachments ?? 0,
    // Every stored byte, including site assets, which belong to the installation
    // rather than to any user's quota.
    storageUsedBytes: attachmentTotals[0]?.storageUsedBytes ?? 0,
    mfaAdoptionRate: totalUsers === 0 ? 0 : Math.round((mfaUsers / totalUsers) * 1000) / 1000,
    signups: signups.rows,
  };
}
