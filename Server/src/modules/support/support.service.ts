/**
 * Support desk logic.
 *
 * Two predicates run this file, and both live in the SQL WHERE clause rather
 * than in a filter applied to fetched rows:
 *
 *  1. **Ownership.** A requester only ever matches `tickets.user_id = me`, so
 *     someone else's ticket id is a 404 instead of a signal that it exists.
 *  2. **Internal notes.** `ticket_messages.is_internal` is filtered in the query
 *     that loads a thread. A staff note is a confidentiality boundary that fails
 *     silently: the note simply turns up in a thread nobody meant to show it
 *     in, and a `.filter()` after the fetch is one forgotten `.map` away from
 *     leaking one. If the database never hands us the row, no serialiser can.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { db } from '../../db/index.js';
import {
  attachments,
  ticketMessages,
  tickets,
  users,
  type TicketPriority,
  type TicketSource,
  type TicketStatus,
  type UserRole,
} from '../../db/schema.js';
import { badRequest, forbidden, internal, notFound } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import type {
  CreateTicketInput,
  CreateTicketMessageInput,
  ListTicketsQuery,
  UpdateTicketInput,
} from './support.schemas.js';

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* Aliased because a ticket joins `users` twice: once as the person who asked, once as the person answering. */
const requesterTable = alias(users, 'ticket_requester');
const assigneeTable = alias(users, 'ticket_assignee');

export function isStaff(role: UserRole): boolean {
  return role === 'root' || role === 'admin';
}

export interface Viewer {
  userId: string;
  username: string;
  role: UserRole;
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface TicketParty {
  id: string;
  username: string;
  displayName: string | null;
  /**
   * Staff only, and only for the requester. Answering a ticket outside the
   * thread needs an address; a requester already knows their own, and the
   * assignee's is never published, because a requester must not be able to read
   * the personal address of the administrator holding their ticket.
   */
  email?: string | null;
  avatarId?: string | null;
}

export interface TicketView {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  assignedToId: string | null;
  lastReplyAt: Date | null;
  lastReplyByStaff: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** The flag that belongs to whoever asked; a requester is never told the queue's. */
  unread: boolean;
  messageCount: number;
  requester: TicketParty | null;
  assignee: TicketParty | null;
  /** Staff only: how to reach a signed-out visitor who used the contact form. */
  guestName?: string | null;
  guestEmail?: string | null;
  /**
   * Staff only: the forensics kept on a guest submission, so a wave of abuse can
   * be traced back and blocked. Personal data, and never shown to a requester.
   */
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface TicketAttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: Date;
}

export interface TicketMessageView {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  isInternal: boolean;
  isStaff: boolean;
  createdAt: Date;
  attachments: TicketAttachmentView[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface TicketRow {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  requesterId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  assignedToId: string | null;
  lastReplyAt: Date | null;
  lastReplyByStaff: boolean;
  unreadForRequester: boolean;
  unreadForStaff: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  requesterUsername: string | null;
  requesterDisplayName: string | null;
  requesterEmail: string | null;
  requesterAvatarId: string | null;
  assigneeUsername: string | null;
  assigneeDisplayName: string | null;
  messageCount: number;
}

/**
 * How many messages the *caller* can see.
 *
 * Counting every row for a requester would publish the number of internal notes
 * on their ticket: a thread showing "4 messages" above three visible ones tells
 * them staff wrote something they were not shown.
 */
function messageCountExpression(viewerIsStaff: boolean): SQL<number> {
  if (viewerIsStaff) {
    return sql<number>`(select count(*) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id})::int`;
  }
  return sql<number>`(select count(*) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id} and ${ticketMessages.isInternal} = false)::int`;
}

function ticketSelection(viewerIsStaff: boolean) {
  return {
    id: tickets.id,
    number: tickets.number,
    subject: tickets.subject,
    category: tickets.category,
    status: tickets.status,
    priority: tickets.priority,
    source: tickets.source,
    requesterId: tickets.userId,
    guestName: tickets.guestName,
    guestEmail: tickets.guestEmail,
    assignedToId: tickets.assignedToId,
    lastReplyAt: tickets.lastReplyAt,
    lastReplyByStaff: tickets.lastReplyByStaff,
    unreadForRequester: tickets.unreadForRequester,
    unreadForStaff: tickets.unreadForStaff,
    closedAt: tickets.closedAt,
    createdAt: tickets.createdAt,
    updatedAt: tickets.updatedAt,
    ipAddress: tickets.ipAddress,
    userAgent: tickets.userAgent,
    requesterUsername: requesterTable.username,
    requesterDisplayName: requesterTable.displayName,
    requesterEmail: requesterTable.email,
    requesterAvatarId: requesterTable.avatarId,
    assigneeUsername: assigneeTable.username,
    assigneeDisplayName: assigneeTable.displayName,
    messageCount: messageCountExpression(viewerIsStaff),
  };
}

/**
 * `contact` is only ever passed for the requester, and only when the viewer is
 * staff. The projection is selected for everyone, so the decision of who is
 * told an address is made here, in one place, rather than in four call sites.
 */
function party(
  id: string | null,
  username: string | null,
  displayName: string | null,
  contact?: { email: string | null; avatarId: string | null },
): TicketParty | null {
  if (!id || !username) return null;
  return { id, username, displayName, ...(contact ?? {}) };
}

function toTicketView(row: TicketRow, viewerIsStaff: boolean): TicketView {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    category: row.category,
    status: row.status,
    priority: row.priority,
    source: row.source,
    assignedToId: row.assignedToId,
    lastReplyAt: row.lastReplyAt,
    lastReplyByStaff: row.lastReplyByStaff,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    unread: viewerIsStaff ? row.unreadForStaff : row.unreadForRequester,
    messageCount: row.messageCount,
    requester: party(
      row.requesterId,
      row.requesterUsername,
      row.requesterDisplayName,
      viewerIsStaff ? { email: row.requesterEmail, avatarId: row.requesterAvatarId } : undefined,
    ),
    // Never carries contact details: to a requester the assignee is the
    // administrator holding their ticket, and that person's address is not
    // theirs to have.
    assignee: party(row.assignedToId, row.assigneeUsername, row.assigneeDisplayName),
    // A guest's name and address, and the address the submission came from, are
    // the personal data on this row. Only the people who have to answer, and
    // who trace abuse back, ever receive them.
    ...(viewerIsStaff
      ? {
          guestName: row.guestName,
          guestEmail: row.guestEmail,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
        }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Access predicates                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The row-level scope for a single ticket.
 *
 * `undefined` for staff means "no extra predicate", which drizzle drops from the
 * `and(...)`. Staff genuinely may open any ticket, because answering them is
 * the job.
 */
function ticketScope(viewer: Viewer): SQL | undefined {
  return isStaff(viewer.role) ? undefined : eq(tickets.userId, viewer.userId);
}

/**
 * The states a conversation is still live in.
 *
 * The `unanswered` filter and the queue's "awaiting reply" figure are both
 * defined against this list, so the number on the card and the rows behind the
 * button cannot disagree: a resolved thread the requester had the last word on
 * is finished, not waiting.
 */
const LIVE_STATUSES: readonly TicketStatus[] = ['open', 'pending'];

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

function listFilters(viewer: Viewer, query: ListTicketsQuery): Array<SQL | undefined> {
  const viewerIsStaff = isStaff(viewer.role);
  const filters: Array<SQL | undefined> = [];

  // `scope=all` is refused for non-staff by the route before this runs; the
  // predicate is repeated here so a future caller that forgets the check still
  // gets its own tickets rather than everybody's.
  if (query.scope === 'mine' || !viewerIsStaff) {
    filters.push(eq(tickets.userId, viewer.userId));
  }

  if (query.status?.length) filters.push(inArray(tickets.status, query.status));
  if (query.priority?.length) filters.push(inArray(tickets.priority, query.priority));
  if (query.category) filters.push(eq(tickets.category, query.category));
  if (query.source) filters.push(eq(tickets.source, query.source));

  /*
   * Both halves are needed. `lastReplyByStaff = false` alone would drag every
   * closed thread the requester had the last word on back into the triage
   * inbox, which is the opposite of what the button is for.
   */
  if (query.unanswered) {
    filters.push(eq(tickets.lastReplyByStaff, false));
    filters.push(inArray(tickets.status, [...LIVE_STATUSES]));
  }

  if (query.assignedToId === 'unassigned') {
    filters.push(isNull(tickets.assignedToId));
  } else if (query.assignedToId) {
    filters.push(eq(tickets.assignedToId, query.assignedToId));
  }

  if (query.q) {
    /*
     * Subject and reference number only, never message bodies. Searching bodies
     * would mean repeating the `is_internal` filter inside the search predicate,
     * and getting it wrong there leaks an internal note through a subject the
     * requester can already see, a bug that would look like a search quirk.
     */
    const pattern = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const numeric = /^#?(\d{1,9})$/.exec(query.q)?.[1];

    filters.push(
      or(
        ilike(tickets.subject, pattern),
        numeric ? eq(tickets.number, Number(numeric)) : undefined,
      ),
    );
  }

  return filters;
}

export async function listTickets(
  viewer: Viewer,
  query: ListTicketsQuery,
): Promise<{ tickets: TicketView[]; pagination: Pagination }> {
  const viewerIsStaff = isStaff(viewer.role);
  const where = and(...listFilters(viewer, query));

  const rows: TicketRow[] = await db
    .select(ticketSelection(viewerIsStaff))
    .from(tickets)
    .leftJoin(requesterTable, eq(requesterTable.id, tickets.userId))
    .leftJoin(assigneeTable, eq(assigneeTable.id, tickets.assignedToId))
    .where(where)
    // Most recent activity first, falling back to creation for a ticket nobody
    // has answered yet. Ties are broken on the number so two tickets created in
    // the same millisecond cannot swap between pages and appear twice.
    .orderBy(desc(sql`coalesce(${tickets.lastReplyAt}, ${tickets.createdAt})`), desc(tickets.number))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const [totals] = await db.select({ value: count() }).from(tickets).where(where);
  const total = totals?.value ?? 0;

  return {
    tickets: rows.map((row) => toTicketView(row, viewerIsStaff)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Single ticket                                                              */
/* -------------------------------------------------------------------------- */

async function findTicketView(viewer: Viewer, ticketId: string): Promise<TicketRow | null> {
  const viewerIsStaff = isStaff(viewer.role);

  const [row] = await db
    .select(ticketSelection(viewerIsStaff))
    .from(tickets)
    .leftJoin(requesterTable, eq(requesterTable.id, tickets.userId))
    .leftJoin(assigneeTable, eq(assigneeTable.id, tickets.assignedToId))
    .where(and(eq(tickets.id, ticketId), ticketScope(viewer)))
    .limit(1);

  return row ?? null;
}

/** Metadata for the files hanging off a set of messages, grouped by message. */
async function attachmentsByMessage(
  messageIds: string[],
): Promise<Map<string, TicketAttachmentView[]>> {
  const grouped = new Map<string, TicketAttachmentView[]>();
  if (messageIds.length === 0) return grouped;

  // `attachments.data` is bytea, so naming the columns is the difference between a
  // few hundred bytes of metadata and every file in the thread.
  const rows = await db
    .select({
      id: attachments.id,
      ticketMessageId: attachments.ticketMessageId,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      byteSize: attachments.byteSize,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(inArray(attachments.ticketMessageId, messageIds))
    .orderBy(asc(attachments.createdAt));

  for (const row of rows) {
    if (!row.ticketMessageId) continue;
    const bucket = grouped.get(row.ticketMessageId) ?? [];
    bucket.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      createdAt: row.createdAt,
    });
    grouped.set(row.ticketMessageId, bucket);
  }

  return grouped;
}

/**
 * The thread, plus the side effect of marking it read for whoever looked.
 *
 * Both unread flags are cleared where they apply rather than one being chosen,
 * because a staff member who opened their own ticket is genuinely both sides of
 * it at once and would otherwise carry a badge they can never clear.
 */
export async function getTicketThread(
  viewer: Viewer,
  ticketId: string,
): Promise<{ ticket: TicketView; messages: TicketMessageView[] }> {
  const viewerIsStaff = isStaff(viewer.role);

  const row = await findTicketView(viewer, ticketId);
  if (!row) {
    throw notFound('That ticket does not exist');
  }

  const messageRows = await db
    .select()
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.ticketId, row.id),
        // The confidentiality boundary, in the WHERE clause. See the file header.
        viewerIsStaff ? undefined : eq(ticketMessages.isInternal, false),
      ),
    )
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));

  const files = await attachmentsByMessage(messageRows.map((message) => message.id));

  const patch: PgUpdateSetSource<typeof tickets> = {};
  if (viewerIsStaff) patch.unreadForStaff = false;
  if (row.requesterId === viewer.userId) patch.unreadForRequester = false;

  if (Object.keys(patch).length > 0) {
    await db.update(tickets).set(patch).where(eq(tickets.id, row.id));
  }

  return {
    // The view is built from the row as it was *before* the flags were cleared,
    // so the client can still render "this was new" on the render that opened it.
    ticket: toTicketView(row, viewerIsStaff),
    messages: messageRows.map((message) => ({
      id: message.id,
      ticketId: message.ticketId,
      authorId: message.authorId,
      authorName: message.authorName,
      body: message.body,
      isInternal: message.isInternal,
      isStaff: message.isStaff,
      createdAt: message.createdAt,
      attachments: files.get(message.id) ?? [],
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Bind already-uploaded files to a new message.
 *
 * The ownership predicate is the point: without `user_id = me`, anyone could
 * post a reply carrying somebody else's attachment id and pull that file into a
 * thread they are allowed to read. `ticket_message_id IS NULL` stops a file
 * being moved out of an existing thread, and `todo_id IS NULL` stops one being
 * stolen off a task. A short bind count means at least one id failed a check, so
 * the whole message is rolled back rather than posted with files silently
 * missing.
 */
async function bindAttachments(
  tx: Tx,
  messageId: string,
  ownerId: string,
  ids: string[] | undefined,
): Promise<TicketAttachmentView[]> {
  if (!ids?.length) return [];

  const bound = await tx
    .update(attachments)
    .set({ ticketMessageId: messageId })
    .where(
      and(
        inArray(attachments.id, ids),
        eq(attachments.userId, ownerId),
        isNull(attachments.ticketMessageId),
        isNull(attachments.todoId),
      ),
    )
    .returning({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      byteSize: attachments.byteSize,
      createdAt: attachments.createdAt,
    });

  if (bound.length !== ids.length) {
    throw badRequest('One of those files could not be attached');
  }

  return bound;
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

/** The category list is operator-editable, so it is checked against settings. */
async function assertKnownCategory(category: string): Promise<void> {
  const support = await getSettings('support');
  if (!support.categories.includes(category)) {
    throw badRequest('Choose one of the listed categories', { categories: support.categories });
  }
}

export async function createTicket(
  viewer: Viewer,
  input: CreateTicketInput,
): Promise<TicketView> {
  await assertKnownCategory(input.category);

  /*
   * `urgent` is the queue's triage signal, not a mood. Left open, every ticket
   * arrives urgent and the column stops meaning anything, so a non-staff caller
   * asking for it is quietly served `high` instead of being refused, and the
   * response carries the value that was actually stored. Staff, who own the
   * queue, keep the full range.
   */
  const priority: TicketPriority =
    !isStaff(viewer.role) && input.priority === 'urgent' ? 'high' : input.priority;

  const now = new Date();

  const ticketId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tickets)
      .values({
        userId: viewer.userId,
        subject: input.subject,
        category: input.category,
        priority,
        source: 'app',
        status: 'open',
        lastReplyAt: now,
        lastReplyByStaff: false,
        unreadForStaff: true,
        unreadForRequester: false,
      })
      .returning({ id: tickets.id });

    if (!created) {
      throw internal('Failed to open the ticket');
    }

    const [message] = await tx
      .insert(ticketMessages)
      .values({
        ticketId: created.id,
        authorId: viewer.userId,
        authorName: viewer.username,
        body: input.message,
        isInternal: false,
        isStaff: isStaff(viewer.role),
      })
      .returning({ id: ticketMessages.id });

    if (!message) {
      throw internal('Failed to record the first message');
    }

    await bindAttachments(tx, message.id, viewer.userId, input.attachmentIds);

    return created.id;
  });

  const row = await findTicketView(viewer, ticketId);
  if (!row) {
    throw internal('The ticket was created but could not be read back');
  }

  return toTicketView(row, isStaff(viewer.role));
}

/* -------------------------------------------------------------------------- */
/* Reply                                                                      */
/* -------------------------------------------------------------------------- */

export async function addTicketMessage(
  viewer: Viewer,
  ticketId: string,
  input: CreateTicketMessageInput,
): Promise<TicketMessageView> {
  const viewerIsStaff = isStaff(viewer.role);
  // `isInternal` is honoured only for staff. A requester who sends it gets an
  // ordinary public message, which is what they were always able to post.
  const isInternalNote = viewerIsStaff && input.isInternal;

  return db.transaction(async (tx) => {
    /*
     * The ownership predicate is in the WHERE clause, so a requester replying to
     * a stranger's ticket gets the same 404 as one that does not exist.
     * `FOR UPDATE` serialises two replies landing together. Without it both can
     * read the same unread flags and the second overwrites the first's.
     */
    const [ticket] = await tx
      .select({ id: tickets.id, status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), ticketScope(viewer)))
      .for('update')
      .limit(1);

    if (!ticket) {
      throw notFound('That ticket does not exist');
    }

    const [message] = await tx
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        authorId: viewer.userId,
        authorName: viewer.username,
        body: input.body,
        isInternal: isInternalNote,
        isStaff: viewerIsStaff,
      })
      .returning();

    if (!message) {
      throw internal('Failed to record the reply');
    }

    const files = await bindAttachments(tx, message.id, viewer.userId, input.attachmentIds);

    const now = new Date();

    /*
     * An internal note moves *nothing* on the ticket row, not even `updatedAt`.
     *
     * It is not a reply: setting `lastReplyByStaff` would mark the ticket as
     * answered when nobody has answered it, and raising the requester's unread
     * flag would put a badge on a message they are never shown. `updatedAt`
     * belongs in that same list and used to be excluded from it, which was the
     * hole: the requester receives `updatedAt` on their own ticket, so a
     * timestamp that moved with no new message in the thread announced that
     * staff had written something they were not shown. The note's existence
     * was disclosed just as surely as its text would have been.
     */
    if (!isInternalNote) {
      const patch: PgUpdateSetSource<typeof tickets> = {
        updatedAt: now,
        lastReplyAt: now,
        lastReplyByStaff: viewerIsStaff,
        unreadForRequester: viewerIsStaff,
        unreadForStaff: !viewerIsStaff,
      };

      // A reply is a live conversation, so it takes a finished ticket back off
      // the shelf rather than being answered into a closed thread nobody reads.
      if (ticket.status === 'closed' || ticket.status === 'resolved') {
        patch.status = 'open';
        patch.closedAt = null;
      }

      await tx.update(tickets).set(patch).where(eq(tickets.id, ticket.id));
    }

    return {
      id: message.id,
      ticketId: message.ticketId,
      authorId: message.authorId,
      authorName: message.authorName,
      body: message.body,
      isInternal: message.isInternal,
      isStaff: message.isStaff,
      createdAt: message.createdAt,
      attachments: files,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one change a requester may make to their own ticket.
 *
 * Written as its own path rather than as a per-field permission check, because
 * "a requester may close their ticket, and that is all" is the entire rule.
 * Spreading it across four `if (field !== undefined && !staff) throw` guards
 * would make the next field added to `updateTicketSchema` default to *allowed*
 * for requesters unless somebody remembered to add a fifth guard.
 *
 * There is deliberately no reopen here, and the requester is not stranded by
 * that: `addTicketMessage` puts a closed or resolved ticket back to `open` when
 * a message lands on it, so replying *is* the reopen. The thread UI keeps its
 * composer on a closed ticket for exactly that reason.
 */
async function closeOwnTicket(
  viewer: Viewer,
  ticketId: string,
  input: UpdateTicketInput,
): Promise<TicketView> {
  const requested = Object.keys(input);
  if (requested.length !== 1 || input.status !== 'closed') {
    throw forbidden(
      'You can only close your own ticket. Priority, category and assignment are set by the support team.',
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(tickets)
    .set({ status: 'closed', closedAt: now, updatedAt: now })
    .where(and(eq(tickets.id, ticketId), eq(tickets.userId, viewer.userId)))
    .returning({ id: tickets.id });

  if (!updated) {
    throw notFound('That ticket does not exist');
  }

  const row = await findTicketView(viewer, updated.id);
  if (!row) {
    throw internal('The ticket was updated but could not be read back');
  }

  return toTicketView(row, false);
}

export async function updateTicket(
  viewer: Viewer,
  ticketId: string,
  input: UpdateTicketInput,
): Promise<TicketView> {
  if (!isStaff(viewer.role)) {
    return closeOwnTicket(viewer, ticketId, input);
  }

  if (input.category !== undefined) {
    await assertKnownCategory(input.category);
  }

  if (input.assignedToId) {
    /*
     * Only root and admin can reach the queue, so assigning a ticket to an
     * ordinary user would file it somewhere nobody can open: it would vanish
     * from the triage inbox without ever appearing in anyone's workload.
     */
    const [assignee] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.assignedToId),
          inArray(users.role, ['root', 'admin']),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    if (!assignee) {
      throw badRequest('Tickets can only be assigned to an administrator');
    }
  }

  const now = new Date();
  const patch: PgUpdateSetSource<typeof tickets> = { updatedAt: now };

  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.category !== undefined) patch.category = input.category;
  if (input.assignedToId !== undefined) patch.assignedToId = input.assignedToId;

  if (input.status !== undefined) {
    patch.status = input.status;
    // Derived here rather than accepted from the client, and `coalesce` keeps the
    // original instant when an already-closed ticket is saved again.
    patch.closedAt =
      input.status === 'closed' ? sql`coalesce(${tickets.closedAt}, now())` : null;

    // Staff settling a ticket have dealt with it, so the queue badge should not
    // keep claiming it needs attention.
    if (input.status === 'resolved' || input.status === 'closed') {
      patch.unreadForStaff = false;
    }
  }

  const [updated] = await db
    .update(tickets)
    .set(patch)
    .where(eq(tickets.id, ticketId))
    .returning({ id: tickets.id });

  if (!updated) {
    throw notFound('That ticket does not exist');
  }

  const row = await findTicketView(viewer, updated.id);
  if (!row) {
    throw internal('The ticket was updated but could not be read back');
  }

  return toTicketView(row, true);
}

/* -------------------------------------------------------------------------- */
/* Unread badge                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One number for the sidebar. Staff count the queue's unread flag, a user counts
 * their own. The two are different columns, and a user must never be given a
 * count derived from tickets they cannot open.
 */
export async function getUnreadCount(viewer: Viewer): Promise<number> {
  const predicate = isStaff(viewer.role)
    ? eq(tickets.unreadForStaff, true)
    : and(eq(tickets.userId, viewer.userId), eq(tickets.unreadForRequester, true));

  const [row] = await db.select({ value: count() }).from(tickets).where(predicate);
  return row?.value ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Queue counts                                                               */
/* -------------------------------------------------------------------------- */

export interface QueueCounts {
  /** Live: `open` or `pending`. */
  open: number;
  /** Live, and the last thing said was not said by us. */
  awaitingReply: number;
  /** Settled since midnight, server time. */
  resolvedToday: number;
}

/**
 * The three headline figures above the staff queue.
 *
 * Whole-installation counts with no ownership predicate, which is exactly why
 * the route refuses this to anyone but staff before calling it: every figure
 * describes tickets the caller must be allowed to open. One pass with three
 * filtered aggregates rather than three round trips.
 *
 * `resolvedToday` is measured on `updatedAt` rather than `closedAt`: `closedAt`
 * is stamped only for `closed`, and a ticket marked `resolved` (the state staff
 * actually settle one in) never sets it.
 */
export async function getQueueCounts(): Promise<QueueCounts> {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tickets.status} in ('open', 'pending'))::int`,
      awaitingReply: sql<number>`count(*) filter (where ${tickets.status} in ('open', 'pending') and ${tickets.lastReplyByStaff} = false)::int`,
      resolvedToday: sql<number>`count(*) filter (where ${tickets.status} in ('resolved', 'closed') and ${tickets.updatedAt} >= date_trunc('day', now()))::int`,
    })
    .from(tickets);

  return {
    open: row?.open ?? 0,
    awaitingReply: row?.awaitingReply ?? 0,
    resolvedToday: row?.resolvedToday ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Public contact form                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Submissions from one address in the last hour.
 *
 * Counted in SQL against the rows that were actually written, which is the half
 * of the contact form's throttling that survives a process restart or a second
 * instance; the in-memory limiter in front of the route does not.
 */
export async function countRecentContactSubmissions(ipAddress: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(tickets)
    .where(
      and(
        eq(tickets.ipAddress, ipAddress),
        sql`${tickets.createdAt} > now() - interval '1 hour'`,
      ),
    );

  return row?.value ?? 0;
}

export interface ContactSubmission {
  subject: string;
  category: string;
  message: string;
  /** Set when the sender happened to be signed in; null for a guest. */
  userId: string | null;
  /** Stored only for guests; a signed-in sender is identified by `userId`. */
  guestName: string | null;
  guestEmail: string | null;
  /** Denormalised onto the message so a deleted account keeps its attribution. */
  authorName: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Write a contact-form ticket.
 *
 * Returns only the reference number: the route must not echo the submitted
 * content back, so there is nothing else worth handing it.
 */
export async function createContactTicket(
  input: ContactSubmission,
): Promise<{ id: string; number: number }> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tickets)
      .values({
        userId: input.userId,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        subject: input.subject,
        category: input.category,
        // A visitor cannot set their own priority from the public form, because
        // that would make `urgent` the default choice of every unhappy sender.
        priority: 'normal',
        status: 'open',
        source: 'contact',
        lastReplyAt: now,
        lastReplyByStaff: false,
        unreadForStaff: true,
        unreadForRequester: false,
        // Kept for forensics: this is the only identifier a guest submission has
        // when a wave of them has to be traced and blocked.
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .returning({ id: tickets.id, number: tickets.number });

    if (!created) {
      throw internal('Failed to record your message');
    }

    await tx.insert(ticketMessages).values({
      ticketId: created.id,
      authorId: input.userId,
      authorName: input.authorName,
      body: input.message,
      isInternal: false,
      isStaff: false,
    });

    return created;
  });
}
