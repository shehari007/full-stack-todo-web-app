/**
 * Profile logic: everything a signed-in user may do to their own account.
 *
 * No function here takes a target id: they take the *caller's* id and scope
 * every statement to it in SQL. That is deliberate, because an ownership slip
 * in this module would not be a data leak; it would be account takeover.
 */
import { and, asc, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  attachments,
  consentRecords,
  sessions,
  todos,
  users,
  type User,
  type UserRole,
} from '../../db/schema.js';
import { verifyPassword } from '../../lib/password.js';
import { getSettings } from '../../lib/settings.js';
import {
  badRequest,
  conflict,
  notFound,
  unauthorized,
  unsupportedMediaType,
} from '../../lib/errors.js';
import { assertNotLastRoot, toPublicUser, type PublicUser } from '../auth/auth.service.js';
import {
  deleteAttachment,
  storageQuotaFor,
  storeAttachment,
} from '../attachments/attachments.service.js';
import type {
  ChangeEmailInput,
  DeleteAccountInput,
  UpdateProfileInput,
} from './profile.schemas.js';

/** Bumped when the export document's shape changes, so importers can branch. */
const EXPORT_FORMAT = 'taskflow.account-export/1';

/**
 * Formats an avatar may actually be stored in.
 *
 * `limits.allowedUploadMimeTypes` governs attachments in general and admits
 * PDFs, archives and office documents, none of which can be rendered in an
 * `<img>`. SVG is excluded on top of that: the download route deliberately
 * serves scriptable documents with `Content-Disposition: attachment`, so an SVG
 * avatar could never display even if it were accepted here.
 */
const AVATAR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/x-icon',
]);

/**
 * Load the caller's own row.
 *
 * A soft-deleted account resolves to nothing rather than to a 404: the token
 * belongs to an account that no longer exists, which is a 401.
 */
async function loadUser(userId: string): Promise<User> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) throw unauthorized();
  return user;
}

export async function getProfile(userId: string): Promise<PublicUser> {
  return toPublicUser(await loadUser(userId));
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

export async function updateProfile(
  userId: string,
  patch: UpdateProfileInput,
): Promise<PublicUser> {
  const [updated] = await db
    .update(users)
    // Safe to spread: `validate()` parsed this through a non-passthrough zod
    // object, so the patch cannot smuggle in `role` or `storageQuotaBytes`.
    // Drizzle skips `undefined` keys, so absent fields are left untouched while
    // an explicit `null` still clears the column.
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning();

  if (!updated) throw unauthorized();
  return toPublicUser(updated);
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

export async function changeEmail(
  userId: string,
  input: ChangeEmailInput,
): Promise<{ user: PublicUser; previousEmail: string }> {
  const user = await loadUser(userId);

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw unauthorized('Your password is incorrect', 'INVALID_CREDENTIALS');
  }

  if (user.email === input.email) {
    throw badRequest('That is already your email address');
  }

  // Soft-deleted accounts keep their row, and with it their entry in the unique
  // index, so this looks at every user, not only live ones. Checking here
  // rather than relying on the constraint turns a 23505 into a field-level
  // message the sign-up form can point at.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, input.email), ne(users.id, userId)))
    .limit(1);

  if (taken) {
    throw conflict('An account with that email already exists');
  }

  const [updated] = await db
    .update(users)
    .set({ email: input.email, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw unauthorized();
  return { user: toPublicUser(updated), previousEmail: user.email };
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Clear the pointer before removing the row. `users.avatar_id` carries no
 * foreign key, so a failure between the two steps would otherwise leave a
 * profile pointing at an attachment that is gone.
 */
async function detachAvatar(userId: string, avatarId: string, actorRole: UserRole): Promise<void> {
  await db.update(users).set({ avatarId: null, updatedAt: new Date() }).where(eq(users.id, userId));
  await deleteAttachment(avatarId, userId, actorRole);
}

export async function setAvatar(
  actor: { userId: string; role: UserRole },
  file: { buffer: Buffer; filename: string; declaredMime: string },
): Promise<PublicUser> {
  const user = await loadUser(actor.userId);

  // The new file is stored before the old one is removed. Deleting first needs
  // less headroom against the quota, but it means every rejected upload (wrong
  // type, over the size ceiling, empty body) destroys the avatar the user
  // already had, and the request that destroyed it answers with an error.
  const stored = await storeAttachment({
    buffer: file.buffer,
    filename: file.filename,
    declaredMime: file.declaredMime,
    kind: 'avatar',
    userId: user.id,
    todoId: null,
    actorRole: actor.role,
  });

  // `storeAttachment` enforces the installation-wide allowlist, which accepts
  // documents and archives. An avatar has to be an image on top of that, and the
  // magic-byte type it settled on is the authoritative answer; the client's
  // `Content-Type` never reaches this check.
  if (!AVATAR_MIME_TYPES.has(stored.mimeType)) {
    // Undo the write rather than leaving an orphan charged to the quota. The old
    // avatar is still in place and still pointed at, so this fails cleanly.
    await deleteAttachment(stored.id, user.id, actor.role);
    throw unsupportedMediaType('An avatar must be a PNG, JPEG, WebP, GIF or ICO image');
  }

  if (user.avatarId) {
    await detachAvatar(user.id, user.avatarId, actor.role);
  }

  const [updated] = await db
    .update(users)
    .set({ avatarId: stored.id, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  if (!updated) throw unauthorized();
  return toPublicUser(updated);
}

export async function removeAvatar(actor: {
  userId: string;
  role: UserRole;
}): Promise<PublicUser> {
  const user = await loadUser(actor.userId);

  if (!user.avatarId) {
    throw notFound('You do not have an avatar set');
  }

  await detachAvatar(user.id, user.avatarId, actor.role);

  // Re-read rather than patching the copy loaded above. Removing the file gave
  // its bytes back to the allowance, so `storageUsedBytes` on that copy is
  // already stale and would be reported to the client too high.
  return toPublicUser(await loadUser(user.id));
}

/* -------------------------------------------------------------------------- */
/* Data portability                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Everything the account holds, in one document: the GDPR Article 20
 * portability right.
 *
 * Soft-deleted todos are included on purpose: a task in the trash is still the
 * user's data, and an export that quietly omits it is an incomplete answer to a
 * legal request.
 *
 * Attachment *bytes* are not. `attachments.data` is bytea, and base64-inlining
 * a full quota would build tens of megabytes of string in memory to serve one
 * request; the metadata carries the id each file can be downloaded by instead.
 */
export async function buildAccountExport(userId: string) {
  const user = await loadUser(userId);

  const [todoRows, attachmentRows, sessionRows, consentRows] = await Promise.all([
    db.select().from(todos).where(eq(todos.userId, userId)).orderBy(asc(todos.createdAt)),

    db
      .select({
        id: attachments.id,
        kind: attachments.kind,
        todoId: attachments.todoId,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        byteSize: attachments.byteSize,
        checksum: attachments.checksum,
        width: attachments.width,
        height: attachments.height,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.userId, userId))
      .orderBy(asc(attachments.createdAt)),

    // `tokenHash` is excluded: it is a live credential, and a downloaded export
    // file is the least controlled place this data ever ends up.
    db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt)),

    db
      .select({
        id: consentRecords.id,
        categories: consentRecords.categories,
        policyVersion: consentRecords.policyVersion,
        ipAddress: consentRecords.ipAddress,
        userAgent: consentRecords.userAgent,
        createdAt: consentRecords.createdAt,
      })
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId))
      .orderBy(desc(consentRecords.createdAt)),
  ]);

  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    profile: toPublicUser(user),
    todos: todoRows,
    attachments: attachmentRows,
    sessions: sessionRows,
    consentRecords: consentRows,
  };
}

export type AccountExport = Awaited<ReturnType<typeof buildAccountExport>>;

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

export interface ProfileStats {
  todos: {
    active: number;
    byStatus: { todo: number; inProgress: number; done: number };
    overdue: number;
    inTrash: number;
  };
  attachments: { count: number };
  storage: {
    usedBytes: number;
    quotaBytes: number;
    remainingBytes: number;
    percentUsed: number;
  };
  account: {
    createdAt: Date;
    ageDays: number;
    lastLoginAt: Date | null;
    mfaEnabled: boolean;
    activeSessions: number;
  };
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const user = await loadUser(userId);

  const [limits, todoTotals, attachmentTotals, sessionTotals] = await Promise.all([
    getSettings('limits'),

    // One pass over the user's todos with FILTER clauses, rather than six round
    // trips. `count(*)` returns bigint, which pg would hand back as a string.
    db
      .select({
        active: sql<number>`(count(*) filter (where ${todos.deletedAt} is null))::int`,
        todo: sql<number>`(count(*) filter (where ${todos.deletedAt} is null and ${todos.status} = 'todo'))::int`,
        inProgress: sql<number>`(count(*) filter (where ${todos.deletedAt} is null and ${todos.status} = 'in_progress'))::int`,
        done: sql<number>`(count(*) filter (where ${todos.deletedAt} is null and ${todos.status} = 'done'))::int`,
        overdue: sql<number>`(count(*) filter (where ${todos.deletedAt} is null and ${todos.status} <> 'done' and ${todos.dueAt} < now()))::int`,
        inTrash: sql<number>`(count(*) filter (where ${todos.deletedAt} is not null))::int`,
      })
      .from(todos)
      .where(eq(todos.userId, userId)),

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

  const [counts = { active: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, inTrash: 0 }] =
    todoTotals;
  const [files = { value: 0 }] = attachmentTotals;
  const [activeSessions = { value: 0 }] = sessionTotals;

  // Reused from the attachments module rather than re-derived: a quota rule that
  // exists twice eventually disagrees with itself, and the disagreement shows up
  // as an upload accepted by one path and rejected by the other.
  const quotaBytes = storageQuotaFor(user.role, user.storageQuotaBytes, limits);

  return {
    todos: {
      active: counts.active,
      byStatus: { todo: counts.todo, inProgress: counts.inProgress, done: counts.done },
      overdue: counts.overdue,
      inTrash: counts.inTrash,
    },
    attachments: { count: files.value },
    storage: {
      usedBytes: user.storageUsedBytes,
      quotaBytes,
      remainingBytes: Math.max(quotaBytes - user.storageUsedBytes, 0),
      // A zero quota means no allowance at all, which is fully consumed by
      // definition, so reporting 0% there would draw an empty, reassuring bar.
      percentUsed:
        quotaBytes > 0
          ? Math.min(Math.round((user.storageUsedBytes / quotaBytes) * 100), 100)
          : 100,
    },
    account: {
      createdAt: user.createdAt,
      ageDays: Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: user.mfaEnabled,
      activeSessions: activeSessions.value,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Account deletion                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Check both confirmations and return the account they clear.
 *
 * Split from `purgeAccount` so the route can write its audit entry in between:
 * `audit_logs.actor_id` is a foreign key, so an entry inserted after the row is
 * gone would be rejected and the record of the deletion lost.
 */
export async function confirmAccountDeletion(
  userId: string,
  input: DeleteAccountInput,
): Promise<User> {
  const user = await loadUser(userId);

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw unauthorized('Your password is incorrect', 'INVALID_CREDENTIALS');
  }

  // Usernames are stored already-lowercased, so the typed confirmation is
  // normalised the same way the account was. Otherwise someone who registered
  // as `Alice` could never match the `alice` on the row.
  if (input.confirmUsername.toLowerCase() !== user.username) {
    throw badRequest('Type your username exactly as shown to confirm deletion');
  }

  // Even self-service deletion goes through this: an installation whose last
  // root is gone has no reachable control panel and no recovery path short of
  // editing the database by hand.
  await assertNotLastRoot(userId);

  return user;
}

/**
 * Remove the account for real.
 *
 * Not a soft delete. `deleted_at` exists so *content* can be restored from the
 * trash, not so erased accounts can linger; a user exercising GDPR Article 17
 * gets erasure. Every child table references `users.id` with `ON DELETE
 * CASCADE`, so todos, attachments, sessions and consent records go with it,
 * while audit rows survive on their denormalised `actor_username` once
 * `actor_id` is nulled.
 */
export async function purgeAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
