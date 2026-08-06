/**
 * Support desk routes: `/api/support/*`
 *
 * `requireAuth` is applied where this router is mounted and is deliberately not
 * repeated here: it costs a user lookup per request. Every handler still reads
 * the caller through `requireAuthContext`, so a mount that forgot the middleware
 * fails as a 401 rather than serving somebody else's ticket.
 */
// `Request` is imported explicitly: @types/node declares a global `Request`
// (the fetch API one) that would otherwise shadow Express's.
import { Router, type Request, type RequestHandler } from 'express';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext } from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import {
  createTicketMessageSchema,
  createTicketSchema,
  listTicketsQuerySchema,
  ticketIdParamSchema,
  updateTicketSchema,
  type CreateTicketInput,
  type CreateTicketMessageInput,
  type ListTicketsQuery,
  type UpdateTicketInput,
} from './support.schemas.js';
import * as service from './support.service.js';
import type { Viewer } from './support.service.js';

const router: Router = Router();

/** The caller, in the shape the service works in. */
function viewerFrom(req: Request): Viewer {
  const auth = requireAuthContext(req);
  return { userId: auth.userId, username: auth.username, role: auth.role };
}

/**
 * The desk can be switched off, but only for the people who open tickets.
 *
 * Staff keep full access when `ticketsEnabled` is false, because the flag is how
 * an operator stops *new* conversations arriving. Locking the queue at the same
 * moment would strand every thread already waiting for an answer.
 */
const requireTicketsEnabled: RequestHandler = asyncHandler(async (req, _res, next) => {
  const features = await getSettings('features');
  if (!features.ticketsEnabled && !service.isStaff(req.auth?.role ?? 'user')) {
    throw forbidden('The support desk is currently unavailable');
  }
  next();
});

router.use(requireTicketsEnabled);

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The queue's headline counts.
 *
 * Staff only, and refused rather than quietly scoped down. These are
 * whole-installation figures with no ownership predicate behind them, so there
 * is no honest answer to give a requester: the same three labels counted over
 * their own tickets would be different numbers wearing the same names.
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const viewer = viewerFrom(req);
    if (!service.isStaff(viewer.role)) {
      throw forbidden('The support queue is restricted to the support team');
    }

    const counts = await service.getQueueCounts();

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ counts });
  }),
);

router.get(
  '/tickets',
  validate({ query: listTicketsQuerySchema }),
  asyncHandler(async (req, res) => {
    const viewer = viewerFrom(req);
    const query = validatedQuery<ListTicketsQuery>(req);

    /*
     * `scope=all` is the staff queue. Refused outright rather than quietly
     * downgraded to `mine`, so an ordinary user who tampers with the parameter
     * gets an answer they can understand instead of a list that silently is not
     * what they asked for.
     */
    if (query.scope === 'all' && !service.isStaff(viewer.role)) {
      throw forbidden('The support queue is restricted to the support team');
    }

    const { tickets, pagination } = await service.listTickets(viewer, query);

    // Per-caller, and it carries unread state: never let a shared cache hold it.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ tickets, pagination });
  }),
);

/** Declared before `/tickets/:id`; otherwise "unread-count" is parsed as an id. */
router.get(
  '/tickets/unread-count',
  asyncHandler(async (req, res) => {
    const count = await service.getUnreadCount(viewerFrom(req));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ count });
  }),
);

router.get(
  '/tickets/:id',
  validate({ params: ticketIdParamSchema }),
  asyncHandler(async (req, res) => {
    const viewer = viewerFrom(req);
    const { id } = req.params as unknown as { id: string };

    const thread = await service.getTicketThread(viewer, id);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(thread);
  }),
);

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

router.post(
  '/tickets',
  writeLimiter,
  validate({ body: createTicketSchema }),
  asyncHandler(async (req, res) => {
    const viewer = viewerFrom(req);
    const ticket = await service.createTicket(viewer, req.body as CreateTicketInput);

    await recordAudit(req, {
      action: 'ticket.create',
      targetType: 'ticket',
      targetId: ticket.id,
      // The subject, never the body: the audit log is read by administrators
      // looking for who did what, not as a second copy of everyone's messages.
      metadata: {
        number: ticket.number,
        category: ticket.category,
        priority: ticket.priority,
        source: ticket.source,
      },
    });

    res.status(201).json({ ticket });
  }),
);

router.post(
  '/tickets/:id/messages',
  writeLimiter,
  validate({ params: ticketIdParamSchema, body: createTicketMessageSchema }),
  asyncHandler(async (req, res) => {
    const viewer = viewerFrom(req);
    const { id } = req.params as unknown as { id: string };

    const message = await service.addTicketMessage(
      viewer,
      id,
      req.body as CreateTicketMessageInput,
    );

    await recordAudit(req, {
      action: 'ticket.reply',
      targetType: 'ticket',
      targetId: id,
      metadata: {
        messageId: message.id,
        // Worth recording: an internal note is the one message type the
        // requester will never see, so "who wrote it" has to be answerable.
        isInternal: message.isInternal,
        isStaff: message.isStaff,
        attachments: message.attachments.length,
      },
    });

    res.status(201).json({ message });
  }),
);

/**
 * Staff controls. A requester reaches the same handler and the service allows
 * them exactly one change (closing their own ticket) and refuses everything else.
 */
router.patch(
  '/tickets/:id',
  writeLimiter,
  validate({ params: ticketIdParamSchema, body: updateTicketSchema }),
  asyncHandler(async (req, res) => {
    const viewer = viewerFrom(req);
    const { id } = req.params as unknown as { id: string };
    const input = req.body as UpdateTicketInput;

    const ticket = await service.updateTicket(viewer, id, input);

    await recordAudit(req, {
      action: 'ticket.update',
      targetType: 'ticket',
      targetId: ticket.id,
      metadata: { number: ticket.number, changes: input },
    });

    res.status(200).json({ ticket });
  }),
);

export default router;
