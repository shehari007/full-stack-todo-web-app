/**
 * Export routes: `/api/exports/*`
 */
import { Router } from 'express';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { exportLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext } from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { getSettings } from '../../lib/settings.js';
import { forbidden } from '../../lib/errors.js';
import { exportTodosQuerySchema, type ExportTodosQuery } from './exports.schemas.js';
import * as service from './exports.service.js';

const router: Router = Router();

/**
 * Download the caller's tasks in the requested format.
 *
 * The filters are the task list's own, so whatever the user is looking at on
 * screen is what lands in the file. Scope is always the caller: an
 * administrator wanting somebody else's data goes through the admin module,
 * where that access is audited as such.
 */
router.get(
  '/todos',
  requireAuth,
  exportLimiter,
  validate({ query: exportTodosQuerySchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    const features = await getSettings('features');
    if (!features.exportsEnabled) {
      throw forbidden('Exports are currently disabled on this installation');
    }

    const { format, ...filters } = validatedQuery<ExportTodosQuery>(req);

    const artifact = await service.buildTodoExport({
      userId: auth.userId,
      format,
      filters,
    });

    await recordAudit(req, {
      action: 'data.export',
      targetType: 'todos',
      metadata: { format, rowCount: artifact.rowCount },
    });

    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    res.setHeader('Content-Length', artifact.buffer.byteLength);
    // A report is a snapshot of live data, and it is personal to the caller.
    // Neither the browser nor an intermediary should be holding on to it.
    res.setHeader('Cache-Control', 'no-store, private');

    res.status(200).send(artifact.buffer);
  }),
);

export default router;
