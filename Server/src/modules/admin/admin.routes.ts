/**
 * Admin routes: `/api/admin/*`
 *
 * The whole router sits behind `requireAuth` + `requirePrivileged`; the handful
 * of operations that only the owner of the installation may perform add
 * `requireRoot` on top. No route decides for itself who may act on a given
 * account. Each loads its target through `loadManagedUser`, which applies the
 * one shared guard.
 */
import express, { Router, type Request } from 'express';
import { requireAuth, requirePrivileged, requireRoot } from '../../middleware/auth.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { uploadLimiter, writeLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext, requireRootContext } from '../../lib/http.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { getAllSettings, getSettings, resetSettings, updateSettings } from '../../lib/settings.js';
import { isRootOnlySetting, type SettingsKey } from '../../config/settings.js';
import type { UserRole } from '../../db/schema.js';
import { toPublicUser } from '../auth/auth.service.js';
import { storeAttachment } from '../attachments/attachments.service.js';
import {
  auditQuerySchema,
  createUserSchema,
  listUsersQuerySchema,
  quotaChangeSchema,
  resetPasswordSchema,
  roleChangeSchema,
  settingsKeyParamSchema,
  settingsPatchSchema,
  statusChangeSchema,
  updateUserSchema,
  userIdParamSchema,
  type AuditQuery,
  type ListUsersQuery,
} from './admin.schemas.js';
import * as service from './admin.service.js';

const router: Router = Router();

/*
 * Repeated here even though the mount in `routes.ts` already applies them: this
 * is the router where a missing guard means a stranger editing accounts, and it
 * must not depend on a mount site remembering. The cost is one repeated token
 * verification and one primary-key lookup per request.
 */
router.use(requireAuth, requirePrivileged);

/** `validate({ query })` stashes its result on a property Express does not declare. */
type QueryRequest = Request & { _validatedQuery?: unknown };

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/users',
  validate({ query: listUsersQuerySchema }),
  asyncHandler<QueryRequest>(async (req, res) => {
    const result = await service.listUsers(validatedQuery<ListUsersQuery>(req));
    res.status(200).json(result);
  }),
);

router.get(
  '/users/:id',
  validate({ params: userIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    res.status(200).json(await service.getUserDetail(id));
  }),
);

router.post(
  '/users',
  requireRoot,
  writeLimiter,
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    requireRootContext(req);
    const created = await service.createUser(req.body);

    await recordAudit(req, {
      action: 'user.create',
      targetType: 'user',
      targetId: created.id,
      metadata: { username: created.username, role: created.role, status: created.status },
    });

    res.status(201).json({ user: toPublicUser(created) });
  }),
);

router.patch(
  '/users/:id',
  writeLimiter,
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const target = await service.loadManagedUser(auth, id, 'modify');
    const { user, changes } = await service.updateUser(auth, target, req.body);

    await recordAudit(req, {
      action: 'user.update',
      targetType: 'user',
      targetId: user.id,
      metadata: { username: user.username, changes },
    });

    res.status(200).json({ user: toPublicUser(user) });
  }),
);

router.put(
  '/users/:id/role',
  requireRoot,
  writeLimiter,
  validate({ params: userIdParamSchema, body: roleChangeSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireRootContext(req);
    const { id } = req.params as unknown as { id: string };

    const target = await service.loadManagedUser(auth, id, 'destroy');
    const user = await service.changeUserRole(target, req.body.role);

    await recordAudit(req, {
      action: 'user.role_change',
      targetType: 'user',
      targetId: user.id,
      metadata: { username: user.username, from: target.role, to: user.role },
    });

    res.status(200).json({ user: toPublicUser(user) });
  }),
);

router.put(
  '/users/:id/status',
  writeLimiter,
  validate({ params: userIdParamSchema, body: statusChangeSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };
    const { status, reason } = req.body;

    const target = await service.loadManagedUser(auth, id, 'destroy');
    const user = await service.changeUserStatus(auth, target, status);

    await recordAudit(req, {
      action: status === 'suspended' ? 'user.suspend' : 'user.reactivate',
      targetType: 'user',
      targetId: user.id,
      metadata: { username: user.username, from: target.status, to: user.status, reason },
    });

    res.status(200).json({ user: toPublicUser(user) });
  }),
);

router.put(
  '/users/:id/quota',
  writeLimiter,
  validate({ params: userIdParamSchema, body: quotaChangeSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const target = await service.loadManagedUser(auth, id, 'modify');
    const user = await service.setUserQuota(target, req.body.storageQuotaBytes);

    await recordAudit(req, {
      action: 'user.quota_change',
      targetType: 'user',
      targetId: user.id,
      metadata: {
        username: user.username,
        from: target.storageQuotaBytes,
        to: user.storageQuotaBytes,
      },
    });

    res.status(200).json({ user: toPublicUser(user) });
  }),
);

router.post(
  '/users/:id/reset-password',
  requireRoot,
  writeLimiter,
  validate({ params: userIdParamSchema, body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireRootContext(req);
    const { id } = req.params as unknown as { id: string };

    const target = await service.loadManagedUser(auth, id, 'modify');
    await service.resetUserPassword(target, req.body.newPassword);

    // The new password itself is never passed to the audit trail, only the fact
    // that a reset happened.
    await recordAudit(req, {
      action: 'user.password_reset',
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username },
    });

    res.status(200).json({
      message: 'Password reset. Every session for that account has been signed out.',
    });
  }),
);

router.post(
  '/users/:id/reset-mfa',
  requireRoot,
  writeLimiter,
  validate({ params: userIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireRootContext(req);
    const { id } = req.params as unknown as { id: string };

    const target = await service.loadManagedUser(auth, id, 'modify');
    await service.resetUserMfa(target);

    await recordAudit(req, {
      action: 'user.mfa_reset',
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username, wasEnrolled: target.mfaEnabled },
    });

    res.status(200).json({
      message: 'Multi-factor authentication cleared. The user can enrol a new authenticator.',
    });
  }),
);

router.delete(
  '/users/:id',
  requireRoot,
  writeLimiter,
  validate({ params: userIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireRootContext(req);
    const { id } = req.params as unknown as { id: string };

    const target = await service.loadManagedUser(auth, id, 'destroy');
    await service.deleteUser(target);

    // Written after the row is gone: the entry keeps `actorUsername` and the
    // target's username as text, so it stays readable with no rows to join to.
    await recordAudit(req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username, email: target.email, role: target.role },
    });

    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Settings CMS                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Editorial sections are open to admins; policy sections are not.
 *
 * `requirePrivileged` on the router is not enough on its own. It would let a
 * delegated admin rewrite `limits` and `features`, which is where storage
 * quotas, open registration, maintenance mode and the "administrators must use
 * MFA" switch live. An admin able to turn off the control that binds them is
 * not really constrained by it.
 */
function assertMaySetSection(role: UserRole, key: SettingsKey): void {
  if (isRootOnlySetting(key) && role !== 'root') {
    throw forbidden(`The "${key}" settings section can only be changed by the root account`);
  }
}

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.status(200).json({ settings: await getAllSettings() });
  }),
);

router.put(
  '/settings/:key',
  writeLimiter,
  validate({ params: settingsKeyParamSchema, body: settingsPatchSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { key } = req.params as unknown as { key: SettingsKey };

    assertMaySetSection(auth.role, key);

    const before = await getSettings(key);
    const after = await updateSettings(key, req.body, auth.userId);

    await recordAudit(req, {
      action: 'settings.update',
      targetType: 'settings',
      targetId: key,
      metadata: service.summariseSettingsChange(before, after),
    });

    res.status(200).json({ settings: { [key]: after } });
  }),
);

router.post(
  '/settings/:key/reset',
  writeLimiter,
  validate({ params: settingsKeyParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { key } = req.params as unknown as { key: SettingsKey };

    assertMaySetSection(auth.role, key);

    const value = await resetSettings(key, auth.userId);

    await recordAudit(req, {
      action: 'settings.reset',
      targetType: 'settings',
      targetId: key,
    });

    res.status(200).json({ settings: { [key]: value } });
  }),
);

/**
 * Upload a logo, favicon or social image.
 *
 * Same transport as the attachments module: raw bytes in the body, the intended
 * name percent-encoded in `X-Filename`. `SITE_ASSET_BODY_LIMIT` is the largest
 * value `limitsSchema` permits for a privileged upload, so it only stops an
 * absurd body from being buffered at all. The configured ceiling, the
 * magic-byte check and the filename sanitiser all live in `storeAttachment`.
 *
 * The response carries the attachment id, which the administrator then saves
 * into `branding.logoAttachmentId` or one of its siblings.
 */
const SITE_ASSET_BODY_LIMIT = '50mb';

router.post(
  '/assets',
  requireRoot,
  uploadLimiter,
  // `type: () => true` because the declared content type is not trusted for
  // anything here, least of all for deciding whether to read the body.
  express.raw({ type: () => true, limit: SITE_ASSET_BODY_LIMIT }),
  asyncHandler(async (req, res) => {
    const auth = requireRootContext(req);

    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw badRequest('Send the file bytes as the raw request body');
    }

    const attachment = await storeAttachment({
      buffer: body,
      filename: req.get('x-filename') ?? '',
      declaredMime: req.get('content-type') ?? null,
      kind: 'site_asset',
      // Site assets belong to the installation rather than to whoever uploaded
      // them, so they outlive that account and count against no one's quota.
      userId: null,
      actorRole: auth.role,
    });

    await recordAudit(req, {
      action: 'site_asset.upload',
      targetType: 'attachment',
      targetId: attachment.id,
      metadata: {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
      },
    });

    res.status(201).json({ attachment });
  }),
);

/* -------------------------------------------------------------------------- */
/* Audit log and overview                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Read-only by design. The table is append-only: there is deliberately no
 * update or delete route, so an administrator covering their tracks would have
 * to reach the database directly.
 */
router.get(
  '/audit',
  validate({ query: auditQuerySchema }),
  asyncHandler<QueryRequest>(async (req, res) => {
    res.status(200).json(await service.listAuditLogs(validatedQuery<AuditQuery>(req)));
  }),
);

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.status(200).json({ overview: await service.getOverview() });
  }),
);

export default router;
