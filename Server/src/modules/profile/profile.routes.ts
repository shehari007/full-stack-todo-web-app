/**
 * Profile routes: `/api/profile/*`
 *
 * Every handler acts on the caller's own account. No route in this module reads
 * a user id from the request; `req.auth.userId` is the only identity in play.
 */
import { Router, raw, type RequestHandler } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  authLimiter,
  exportLimiter,
  uploadLimiter,
  writeLimiter,
} from '../../middleware/rate-limit.js';
import {
  asyncHandler,
  clearAuthCookies,
  requireAuthContext,
} from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { getSettings } from '../../lib/settings.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { maxUploadBytesFor } from '../attachments/attachments.service.js';
import {
  changeEmailSchema,
  deleteAccountSchema,
  updateProfileSchema,
} from './profile.schemas.js';
import * as service from './profile.service.js';

const router: Router = Router();

// Applied once rather than repeated per route: there is no anonymous surface in
// this module, so a route added later is authenticated by default instead of by
// remembering.
router.use(requireAuth);

/**
 * Avatars arrive as a raw body rather than multipart. There is exactly one file
 * and no accompanying fields, so a multipart parser would be a dependency and a
 * parsing surface bought for nothing.
 *
 * A fixed `8mb` backstop used to sit here, which meant a standard user (whose
 * real ceiling is 1 MB) could have eight megabytes buffered into memory before
 * `storeAttachment` looked at the size and rejected it. The whole point of a
 * parser limit is to refuse the body while it is still on the wire, so it has to
 * be the same number the upload will actually be judged against. This mirrors
 * `attachments.routes.ts`: a parser per distinct limit, built on demand, because
 * `express.raw` fixes its limit at construction and cannot consult settings that
 * an administrator can edit at runtime.
 */
const rawParsers = new Map<number, RequestHandler>();

const avatarBody: RequestHandler = asyncHandler(async (req, res, next) => {
  const limits = await getSettings('limits');
  const limit = maxUploadBytesFor(req.auth?.role ?? 'user', limits);

  let parser = rawParsers.get(limit);
  if (!parser) {
    // The declared content type is not trusted for anything here, least of all
    // for deciding whether to read the body at all.
    parser = raw({ type: () => true, limit });
    rawParsers.set(limit, parser);
  }

  parser(req, res, next);
});

/**
 * A raw upload carries no form field, so the name comes from a header. It is
 * stripped down hard because the value is echoed back in a `Content-Disposition`
 * when the avatar is served.
 */
function avatarFilename(header: string | undefined): string {
  const cleaned = (header ?? '')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'avatar';
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    res.status(200).json({ user: await service.getProfile(auth.userId) });
  }),
);

router.patch(
  '/',
  writeLimiter,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const user = await service.updateProfile(auth.userId, req.body);
    res.status(200).json({ user });
  }),
);

/**
 * Metered with the sign-in limiter, not the write limiter: the body carries a
 * password, so an unmetered version is a password oracle for anyone holding a
 * stolen session cookie.
 */
router.put(
  '/email',
  authLimiter,
  validate({ body: changeEmailSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { user, previousEmail } = await service.changeEmail(auth.userId, req.body);

    await recordAudit(req, {
      action: 'user.update',
      targetType: 'user',
      targetId: user.id,
      metadata: { field: 'email', from: previousEmail, to: user.email },
    });

    res.status(200).json({ user });
  }),
);

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  '/avatar',
  uploadLimiter,
  avatarBody,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    // An avatar is an attachment row like any other, so the installation-wide
    // switch governs it too.
    const features = await getSettings('features');
    if (!features.attachmentsEnabled) {
      throw forbidden('File uploads are disabled on this installation');
    }

    const buffer: unknown = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw badRequest('Send the image as the raw request body, with its Content-Type set');
    }

    const user = await service.setAvatar(
      { userId: auth.userId, role: auth.role },
      {
        buffer,
        filename: avatarFilename(req.get('x-filename')),
        // A hint only. `storeAttachment` sniffs the magic bytes and stores what
        // it actually found, so a mislabelled Content-Type cannot walk a file
        // past the allowlist.
        declaredMime: req.get('content-type') ?? 'application/octet-stream',
      },
    );

    res.status(200).json({ user });
  }),
);

router.delete(
  '/avatar',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const user = await service.removeAvatar({ userId: auth.userId, role: auth.role });
    res.status(200).json({ user });
  }),
);

/* -------------------------------------------------------------------------- */
/* Data portability                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately not gated on `features.exportsEnabled`. That flag governs the
 * report generators; this is the GDPR portability right, and an operator must
 * not be able to withdraw it by flipping a feature switch.
 */
router.get(
  '/export',
  exportLimiter,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const data = await service.buildAccountExport(auth.userId);

    await recordAudit(req, {
      action: 'data.export',
      targetType: 'user',
      targetId: auth.userId,
      metadata: {
        scope: 'self',
        todos: data.todos.length,
        attachments: data.attachments.length,
      },
    });

    const datestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // The username is constrained to `[a-zA-Z0-9_-]` at registration, so it
    // cannot break out of the quoted filename.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="taskflow-export-${auth.username}-${datestamp}.json"`,
    );

    // Serialised by hand rather than via `res.json` so the file a user opens in
    // a text editor is indented and readable.
    res.status(200).send(JSON.stringify(data, null, 2));
  }),
);

/* -------------------------------------------------------------------------- */
/* Account deletion                                                           */
/* -------------------------------------------------------------------------- */

router.delete(
  '/',
  authLimiter,
  validate({ body: deleteAccountSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const user = await service.confirmAccountDeletion(auth.userId, req.body);

    // Written before the row goes. `audit_logs.actor_id` is a foreign key, so an
    // entry inserted afterwards would be rejected, and the one action most
    // worth having a record of would be the one action with no record.
    await recordAudit(req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: user.id,
      metadata: { self: true, username: user.username, role: user.role },
    });

    await service.purgeAccount(user.id);

    clearAuthCookies(res);
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    res.status(200).json({ stats: await service.getProfileStats(auth.userId) });
  }),
);

export default router;
