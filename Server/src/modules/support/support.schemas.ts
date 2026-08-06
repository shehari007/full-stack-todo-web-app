/**
 * Request schemas for the support desk and the public contact form.
 *
 * Two things are deliberately *not* validated here, because zod cannot see the
 * database: the category list and the message ceiling both live in editable site
 * settings, so they are enforced in the service and the route. The lengths below
 * are the hard structural ceilings that stop an oversized body being processed
 * at all, whatever an operator has configured.
 */
import { z } from 'zod';
import { ticketPriorityEnum, ticketSourceEnum, ticketStatusEnum } from '../../db/schema.js';

/** The staff queue is browsed in pages; this keeps one page renderable. */
const MAX_PAGE_SIZE = 100;
/** Structural ceiling on any ticket body. The contact form's cap sits under it. */
const MAX_BODY_LENGTH = 20_000;
const MAX_SUBJECT_LENGTH = 200;
/** Matches `supportSchema.categories`' own per-entry cap in config/settings.ts. */
const MAX_CATEGORY_LENGTH = 40;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * List filters arrive as `?status=open&status=pending`, as `?status=open,pending`
 * or as a single value depending on the HTTP client. Normalising all three here
 * lets every filter below stay a plain `z.array`.
 */
function toList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;

  const entries = (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    typeof entry === 'string' ? entry.split(',') : [entry],
  );
  const cleaned = entries
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
    .filter((entry) => entry !== '');

  return cleaned.length > 0 ? cleaned : undefined;
}

export const ticketStatusSchema = z.enum(ticketStatusEnum.enumValues);
export const ticketPrioritySchema = z.enum(ticketPriorityEnum.enumValues);
export const ticketSourceSchema = z.enum(ticketSourceEnum.enumValues);

const categorySchema = z.string().trim().min(1).max(MAX_CATEGORY_LENGTH);

/**
 * Deduplicated on entry: each id is bound with one UPDATE and the caller is told
 * how many rows it touched, so the same id twice would look like a failed bind.
 */
const attachmentIdsSchema = z
  .array(z.string().uuid())
  .max(MAX_ATTACHMENTS_PER_MESSAGE, `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`)
  .transform((ids) => Array.from(new Set(ids)));

/* -------------------------------------------------------------------------- */
/* Authenticated desk                                                         */
/* -------------------------------------------------------------------------- */

export const ticketIdParamSchema = z.object({
  id: z.string().uuid('That is not a valid ticket id'),
});

export const listTicketsQuerySchema = z.object({
  /**
   * `mine` is the default for everyone, including staff: an administrator
   * opening the support page should see their own conversations first, and
   * reaching the whole queue should be a deliberate act rather than a side
   * effect of having a role.
   */
  scope: z.enum(['mine', 'all']).default('mine'),

  status: z.preprocess(toList, z.array(ticketStatusSchema).optional()),
  priority: z.preprocess(toList, z.array(ticketPrioritySchema).optional()),
  category: categorySchema.optional(),

  /** Which door the ticket came in by: the app, or the public contact form. */
  source: ticketSourceSchema.optional(),

  /**
   * The triage inbox: live threads whose last message was not a staff reply.
   *
   * Declared as the two literal strings rather than `z.coerce.boolean()`, which
   * reads `?unanswered=false` as *true* (every non-empty string is truthy) and
   * would filter a queue the caller explicitly asked not to filter.
   */
  unanswered: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),

  // An empty search box submits `?q=`, which asks for everything rather than
  // being a validation failure.
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),

  /** `unassigned` is a real filter state: it is the triage inbox. */
  assignedToId: z.union([z.literal('unassigned'), z.string().uuid()]).optional(),

  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Give the ticket a subject').max(MAX_SUBJECT_LENGTH),
  category: categorySchema,
  /**
   * Accepted from every caller, then clamped for non-staff in the service. The
   * schema does not reject `urgent` outright because a rejection would tell a
   * user their choice was refused for a reason they cannot act on; the service
   * quietly lowers it instead and the response carries the real value.
   */
  priority: ticketPrioritySchema.default('normal'),
  message: z.string().trim().min(1, 'Describe the problem').max(MAX_BODY_LENGTH),
  attachmentIds: attachmentIdsSchema.optional(),
});

export const createTicketMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(MAX_BODY_LENGTH),
  /**
   * Accepted from anyone and honoured only for staff. Silently ignoring it for a
   * requester is safer than rejecting: rejection would confirm that internal
   * notes exist, and the flag is trivially added to a hand-rolled request.
   */
  isInternal: z.boolean().default(false),
  attachmentIds: attachmentIdsSchema.optional(),
});

/**
 * `closedAt`, `lastReplyAt` and the unread flags are absent on purpose: they
 * are derived from what actually happened to the ticket, never asserted by a
 * client.
 */
export const updateTicketSchema = z
  .object({
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    category: categorySchema.optional(),
    /** `null` unassigns. */
    assignedToId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

/* -------------------------------------------------------------------------- */
/* Public contact form                                                        */
/* -------------------------------------------------------------------------- */

export const contactSubmissionSchema = z.object({
  /**
   * Optional in the schema and required in the route only for signed-out
   * visitors: a signed-in sender already has an identity and an address on
   * their account, so making them retype both would be theatre.
   */
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().max(254).email('That does not look like an email address').optional(),

  subject: z.string().trim().min(3, 'Give your message a subject').max(MAX_SUBJECT_LENGTH),
  category: categorySchema,
  message: z.string().trim().min(1, 'Write your message').max(MAX_BODY_LENGTH),

  /**
   * Honeypot. Named `website` because that is a field name form-filling bots
   * recognise and complete; a real visitor never sees it, so any value at all
   * means the sender was not a person. Declared here because `validate()` strips
   * unknown keys. Left out of the schema, the trap would never reach the route.
   */
  website: z.string().max(200).optional().default(''),

  /**
   * Milliseconds since the epoch, captured when the form mounted. Compared
   * against `support.contactMinFillSeconds` in the route.
   */
  startedAt: z.coerce.number().int().positive(),
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type CreateTicketMessageInput = z.infer<typeof createTicketMessageSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type ContactSubmissionInput = z.infer<typeof contactSubmissionSchema>;
