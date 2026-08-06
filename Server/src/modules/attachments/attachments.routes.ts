/**
 * Attachment routes: `/api/attachments/*`
 *
 * Uploads arrive as a raw body rather than as multipart form data. The bytes go
 * straight into a `bytea` column, so a multipart parser would only add a
 * dependency, a temp-file lifecycle and a second place for a filename to come
 * from. The intended name travels in `X-Filename` instead, percent-encoded.
 */
import express, { Router, type RequestHandler } from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { uploadLimiter, writeLimiter } from '../../middleware/rate-limit.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { asyncHandler, requireAuthContext, setImmutableCache } from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { getSettings } from '../../lib/settings.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import {
  attachmentIdParamSchema,
  listAttachmentsQuerySchema,
  todoAttachmentParamSchema,
  type ListAttachmentsQuery,
} from './attachments.schemas.js';
import * as service from './attachments.service.js';

const router: Router = Router();

/* -------------------------------------------------------------------------- */
/* Raw body                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `express.raw` fixes its limit when the parser is constructed, but the real
 * ceiling lives in editable site settings and differs by role, so a parser is
 * built per distinct limit and reused. This is only a backstop that stops an
 * oversized body being buffered at all; the service still checks the size
 * itself, because body-parser's rejection is a bare 413 rather than a
 * `QUOTA_EXCEEDED` carrying the numbers the client needs to explain it.
 */
const rawParsers = new Map<number, RequestHandler>();

const rawUploadBody: RequestHandler = asyncHandler(async (req, res, next) => {
  const limits = await getSettings('limits');
  const limit = service.maxUploadBytesFor(req.auth?.role ?? 'user', limits);

  let parser = rawParsers.get(limit);
  if (!parser) {
    // `type: () => true` because the client's declared content type is not
    // trusted for anything here, least of all for deciding whether to read the
    // body at all.
    parser = express.raw({ type: () => true, limit });
    rawParsers.set(limit, parser);
  }

  parser(req, res, next);
});

/* -------------------------------------------------------------------------- */
/* Serving                                                                    */
/* -------------------------------------------------------------------------- */

/** Types safe to render in place. Anything else is downloaded. */
const INLINE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
  'application/pdf',
]);

/**
 * `image/svg+xml` is deliberately absent from the inline set.
 *
 * An SVG is a scriptable document: rendered inline it executes on this origin,
 * which turns any accepted upload into stored XSS against every other route
 * here, including the ones that read auth cookies. Forcing a download, plus the
 * `default-src 'none'` policy set on the response, means the file can be stored
 * and handed back without ever being live.
 */
function contentDisposition(filename: string, mimeType: string): string {
  const disposition = INLINE_MIME_TYPES.has(mimeType) ? 'inline' : 'attachment';

  // Two forms: a plain one for old clients, and RFC 5987 for the real name.
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** `If-None-Match` is a list, and each entry may be weak-prefixed. */
function etagMatches(header: string | undefined, checksum: string): boolean {
  if (!header) return false;

  return header
    .split(',')
    .map((entry) => entry.trim().replace(/^W\//, ''))
    .some((entry) => entry === '*' || entry === `"${checksum}"`);
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  '/todos/:todoId',
  requireAuth,
  uploadLimiter,
  validate({ params: todoAttachmentParamSchema }),
  rawUploadBody,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { todoId } = req.params as unknown as { todoId: string };

    const features = await getSettings('features');
    if (!features.attachmentsEnabled) {
      throw forbidden('File attachments are switched off on this installation');
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest('Send the file bytes as the raw request body');
    }

    const attachment = await service.storeAttachment({
      buffer: req.body,
      filename: req.get('x-filename') ?? '',
      declaredMime: req.get('content-type') ?? null,
      kind: 'todo_file',
      userId: auth.userId,
      todoId,
      actorRole: auth.role,
    });

    res.status(201).json({ attachment });
  }),
);

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

router.get(
  '/',
  requireAuth,
  validate({ query: listAttachmentsQuerySchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const query = validatedQuery<ListAttachmentsQuery>(req);

    const { items, total } = await service.listAttachments({
      userId: auth.userId,
      page: query.page,
      pageSize: query.pageSize,
      kind: query.kind,
      todoId: query.todoId,
    });

    res.status(200).json({
      attachments: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Download                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `optionalAuth` rather than `requireAuth`: `site_asset` rows are the logo and
 * favicon, which have to load for signed-out visitors. Access for everything
 * else is decided inside the service, as a SQL predicate.
 */
router.get(
  '/:id',
  optionalAuth,
  validate({ params: attachmentIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const viewer = req.auth ? { userId: req.auth.userId, role: req.auth.role } : null;

    const attachment = await service.findAccessibleAttachment(id, viewer);
    if (!attachment) {
      throw notFound('That file does not exist');
    }

    setImmutableCache(res, attachment.checksum);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Applied to every file, not just SVG: these bytes came from a user, and a
    // policy of `none` means anything the browser does choose to render can
    // neither run script nor call home.
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

    // Answered before the payload is fetched, so a cache hit never pulls the
    // `bytea` out of Postgres at all.
    if (etagMatches(req.get('if-none-match'), attachment.checksum)) {
      res.status(304).end();
      return;
    }

    const data = await service.readAttachmentBytes(attachment.id);
    if (!data) {
      throw notFound('That file does not exist');
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(data.byteLength));
    res.setHeader('Content-Disposition', contentDisposition(attachment.filename, attachment.mimeType));
    res.status(200).end(data);
  }),
);

/* -------------------------------------------------------------------------- */
/* Delete                                                                     */
/* -------------------------------------------------------------------------- */

router.delete(
  '/:id',
  requireAuth,
  writeLimiter,
  validate({ params: attachmentIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const attachment = await service.deleteAttachment(id, auth.userId, auth.role);

    await recordAudit(req, {
      action: 'attachment.delete',
      targetType: 'attachment',
      targetId: attachment.id,
      metadata: {
        filename: attachment.filename,
        byteSize: attachment.byteSize,
        kind: attachment.kind,
        // Recorded because a moderator deleting someone else's file is the case
        // this entry exists for.
        ownerId: attachment.userId,
      },
    });

    res.status(200).json({ attachment });
  }),
);

export default router;
