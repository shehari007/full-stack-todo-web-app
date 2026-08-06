/**
 * Request schemas for the admin module.
 */
import { z } from 'zod';
import { userRoleEnum, userStatusEnum } from '../../db/schema.js';
import { SETTINGS_KEYS } from '../../config/settings.js';
import { passwordSchema } from '../../lib/password.js';
import { emailSchema, usernameSchema } from '../auth/auth.schemas.js';

/**
 * Derived from the Postgres enums rather than re-typed, so adding a role can
 * never leave the API accepting a value the column will reject.
 */
const roleSchema = z.enum(userRoleEnum.enumValues);
const statusSchema = z.enum(userStatusEnum.enumValues);

/** `pageSize` is capped: without a ceiling, `?pageSize=100000` is a denial of service. */
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const userIdParamSchema = z.object({ id: z.string().uuid() });

export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.optional(),
  status: statusSchema.optional(),
  /**
   * A closed set, not a column name. The service maps these to column
   * references; a free-form string would end up interpolated into ORDER BY.
   */
  sort: z
    .enum(['createdAt', 'username', 'email', 'role', 'lastLoginAt', 'storageUsedBytes'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(64).optional(),
  /**
   * Explicit and required. Registration hard-codes `user`; this is the only
   * path that mints a privileged account, so the caller must say so out loud.
   */
  role: roleSchema,
  status: statusSchema.default('active'),
});

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().max(64).nullable().optional(),
    email: emailSchema.optional(),
    status: statusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const roleChangeSchema = z.object({ role: roleSchema });

export const statusChangeSchema = z.object({
  status: statusSchema,
  /** Recorded in the audit entry so a suspension can be explained months later. */
  reason: z.string().trim().max(280).optional(),
});

export const quotaChangeSchema = z.object({
  /** `null` clears the override and returns the account to its role default. */
  storageQuotaBytes: z
    .number()
    .int()
    .min(0)
    .max(1024 ** 4, 'Quota must be at most 1 TiB')
    .nullable(),
});

export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export const settingsKeyParamSchema = z.object({ key: z.enum(SETTINGS_KEYS) });

/**
 * The body is only checked for shape here. Its contents are validated by the
 * section's own schema inside `updateSettings`, which merges the patch over the
 * current value first. Validating the fragment alone would reject every
 * partial update.
 */
export const settingsPatchSchema = z.record(z.string(), z.unknown());

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().trim().max(64).optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
