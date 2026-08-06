/**
 * Task logic.
 *
 * Every statement in this file takes the caller's user id as its first argument
 * and puts it in the WHERE clause. That is not a formality. Filtering after the
 * fetch would mean the database happily handed us someone else's row, and the
 * predicate is what makes a wrong id indistinguishable from a forbidden one: a
 * 404, not a leak.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { db } from '../../db/index.js';
import {
  attachments,
  todos,
  users,
  type Todo,
  type TodoPriority,
  type TodoStatus,
} from '../../db/schema.js';
import { internal, notFound, quotaExceeded } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import type {
  BulkTodoInput,
  CreateTodoInput,
  TodoFilter,
  TodoListQuery,
  TodoSortKey,
  UpdateTodoInput,
} from './todos.schemas.js';

/**
 * `plainto_tsquery` drops stop words and single letters, so a search for "hr"
 * or "an" against the GIN index returns nothing at all. Below this length a
 * substring match is the only honest answer.
 */
const MIN_TSQUERY_LENGTH = 3;

/**
 * Ranking is spelled out rather than leaning on the enum's declaration order.
 * Postgres sorts enums by that order, so reordering `todoPriorityEnum` in
 * schema.ts (a plausible edit) would otherwise silently redefine what
 * "sort by priority" means.
 */
const PRIORITY_RANK = sql`case ${todos.priority}
    when 'urgent' then 4
    when 'high' then 3
    when 'medium' then 2
    else 1
  end`;

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

function searchPredicate(term: string): SQL | undefined {
  if (term.length < MIN_TSQUERY_LENGTH) {
    // `%` and `_` are LIKE wildcards, and someone typing them means the literal
    // character. Unescaped, a lone `%` would match the entire table.
    const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    return or(ilike(todos.title, pattern), ilike(todos.description, pattern));
  }

  // Matches the expression behind `todos_search_idx`, character for character.
  // Any divergence here and Postgres silently stops using the index.
  return sql`to_tsvector('english', ${todos.title} || ' ' || coalesce(${todos.description}, '')) @@ plainto_tsquery('english', ${term})`;
}

function listFilters(userId: string, query: TodoFilter): Array<SQL | undefined> {
  const filters: Array<SQL | undefined> = [eq(todos.userId, userId), isNull(todos.deletedAt)];

  if (query.q) filters.push(searchPredicate(query.q));
  if (query.status?.length) filters.push(inArray(todos.status, query.status));
  if (query.priority?.length) filters.push(inArray(todos.priority, query.priority));

  // `&&` is array overlap: match a task carrying *any* of the requested tags.
  // `sql.param` stops the template from expanding the array into a `(a, b)` tuple.
  if (query.tags?.length) filters.push(sql`${todos.tags} && ${sql.param(query.tags)}::text[]`);

  if (query.dueFrom) filters.push(gte(todos.dueAt, query.dueFrom));
  if (query.dueTo) filters.push(lte(todos.dueAt, query.dueTo));
  if (!query.includeCompleted) filters.push(ne(todos.status, 'done'));

  // "Now" comes from Postgres so that overdue means the same thing here as it
  // does in the stats query, whatever the app server's clock says.
  if (query.overdue === true) {
    filters.push(and(lt(todos.dueAt, sql`now()`), ne(todos.status, 'done')));
  }
  if (query.overdue === false) {
    filters.push(
      or(isNull(todos.dueAt), gte(todos.dueAt, sql`now()`), eq(todos.status, 'done')),
    );
  }

  return filters;
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listTodos(
  userId: string,
  query: TodoListQuery,
): Promise<{ todos: Todo[]; pagination: Pagination }> {
  const where = and(...listFilters(userId, query));

  const sortTargets: Record<TodoSortKey, SQLWrapper> = {
    created: todos.createdAt,
    due: todos.dueAt,
    priority: PRIORITY_RANK,
    position: todos.position,
    title: todos.title,
  };

  const primary =
    query.sort === 'due'
      ? // Undated tasks belong at the end in *both* directions: "no due date" is
        // not the same as "due first". `sql.raw` is safe here because the value
        // comes from a closed enum, never from the request string.
        sql`${todos.dueAt} ${sql.raw(query.order)} nulls last`
      : (query.order === 'asc' ? asc : desc)(sortTargets[query.sort]);

  const rows = await db
    .select()
    .from(todos)
    .where(where)
    // Ties broken on the primary key, otherwise two rows with equal sort keys
    // can swap between pages and the client shows one twice.
    .orderBy(primary, asc(todos.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const [totals] = await db.select({ value: count() }).from(todos).where(where);
  const total = totals?.value ?? 0;

  return {
    todos: rows,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Single task                                                                */
/* -------------------------------------------------------------------------- */

export interface AttachmentSummary {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  createdAt: Date;
}

export async function getTodo(
  userId: string,
  todoId: string,
): Promise<Todo & { attachments: AttachmentSummary[] }> {
  const [todo] = await db
    .select()
    .from(todos)
    .where(and(eq(todos.id, todoId), eq(todos.userId, userId), isNull(todos.deletedAt)))
    .limit(1);

  if (!todo) {
    throw notFound('That task does not exist');
  }

  // `attachments.data` is bytea. Naming the columns explicitly is the difference
  // between a few hundred bytes of metadata and every file in the response.
  const files = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      byteSize: attachments.byteSize,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(eq(attachments.todoId, todo.id))
    .orderBy(asc(attachments.createdAt));

  return { ...todo, attachments: files };
}

/* -------------------------------------------------------------------------- */
/* Create, update, delete                                                     */
/* -------------------------------------------------------------------------- */

export async function createTodo(userId: string, input: CreateTodoInput): Promise<Todo> {
  const limits = await getSettings('limits');

  const [existing] = await db
    .select({ value: count() })
    .from(todos)
    .where(and(eq(todos.userId, userId), isNull(todos.deletedAt)));

  // Soft-deleted tasks are excluded above, so emptying the trash genuinely frees
  // the allowance. A limit of 0 freezes creation outright, which is the only
  // sensible reading of the setting and gives operators a kill switch.
  if ((existing?.value ?? 0) >= limits.maxTodosPerUser) {
    throw quotaExceeded(
      `You have reached the limit of ${limits.maxTodosPerUser} tasks. Delete something to make room.`,
      { limit: limits.maxTodosPerUser },
    );
  }

  const [created] = await db
    .insert(todos)
    .values({
      userId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      dueAt: input.dueAt ?? null,
      tags: input.tags ?? [],
      // New tasks land at the end of the manual order instead of piling up on
      // position 0 with everything else that was never dragged.
      position: sql`coalesce((select max(${todos.position}) from ${todos} where ${todos.userId} = ${userId} and ${todos.deletedAt} is null), 0) + 1`,
      completedAt: input.status === 'done' ? new Date() : null,
    })
    .returning();

  if (!created) {
    throw internal('Failed to create the task');
  }

  return created;
}

export async function updateTodo(
  userId: string,
  todoId: string,
  input: UpdateTodoInput,
): Promise<Todo> {
  const patch: PgUpdateSetSource<typeof todos> = { updatedAt: new Date() };

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.position !== undefined) patch.position = input.position;

  if (input.status !== undefined) {
    patch.status = input.status;
    // `completedAt` is derived, never accepted from the client. `coalesce` keeps
    // the original timestamp when an already-done task is saved again, so
    // editing a finished task does not look like finishing it a second time.
    patch.completedAt =
      input.status === 'done' ? sql`coalesce(${todos.completedAt}, now())` : null;
  }

  const [updated] = await db
    .update(todos)
    .set(patch)
    .where(and(eq(todos.id, todoId), eq(todos.userId, userId), isNull(todos.deletedAt)))
    .returning();

  if (!updated) {
    throw notFound('That task does not exist');
  }

  return updated;
}

export async function softDeleteTodo(userId: string, todoId: string): Promise<Todo> {
  const [deleted] = await db
    .update(todos)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(todos.id, todoId), eq(todos.userId, userId), isNull(todos.deletedAt)))
    .returning();

  if (!deleted) {
    throw notFound('That task does not exist');
  }

  return deleted;
}

export async function restoreTodo(userId: string, todoId: string): Promise<Todo> {
  const [restored] = await db
    .update(todos)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(todos.id, todoId), eq(todos.userId, userId), isNotNull(todos.deletedAt)))
    .returning();

  if (!restored) {
    throw notFound('That task is not in the trash');
  }

  return restored;
}

/* -------------------------------------------------------------------------- */
/* Bulk operations                                                            */
/* -------------------------------------------------------------------------- */

const pluckIds = (rows: Array<{ id: string }>): string[] => rows.map((row) => row.id);

/**
 * Apply one action to many tasks in a single statement.
 *
 * The alternative, a loop of updates, costs one round trip per id and can
 * fail halfway, leaving the user staring at a half-completed batch. The returned
 * ids are the rows that actually changed, so ids belonging to someone else (or
 * already in the requested state) simply do not come back.
 */
export async function bulkMutate(userId: string, input: BulkTodoInput): Promise<string[]> {
  const scope = [eq(todos.userId, userId), inArray(todos.id, input.ids)];
  const now = new Date();

  switch (input.action) {
    case 'complete':
      return pluckIds(
        await db
          .update(todos)
          .set({
            status: 'done',
            completedAt: sql`coalesce(${todos.completedAt}, now())`,
            updatedAt: now,
          })
          .where(and(...scope, isNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );

    case 'reopen':
      return pluckIds(
        await db
          .update(todos)
          .set({ status: 'todo', completedAt: null, updatedAt: now })
          .where(and(...scope, isNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );

    case 'delete':
      return pluckIds(
        await db
          .update(todos)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(...scope, isNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );

    case 'restore':
      return pluckIds(
        await db
          .update(todos)
          .set({ deletedAt: null, updatedAt: now })
          .where(and(...scope, isNotNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );

    case 'setPriority':
      return pluckIds(
        await db
          .update(todos)
          .set({ priority: input.value, updatedAt: now })
          .where(and(...scope, isNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );

    case 'addTags':
      return pluckIds(
        await db
          .update(todos)
          .set({
            // Union then sort: concatenation alone would duplicate tags the task
            // already carries, and the order has to be deterministic or every
            // save shuffles the chips in the UI.
            tags: sql`array(select distinct unnest(${todos.tags} || ${sql.param(input.value)}::text[]) order by 1)`,
            updatedAt: now,
          })
          .where(and(...scope, isNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );

    case 'removeTags':
      return pluckIds(
        await db
          .update(todos)
          .set({
            tags: sql`array(select tag from unnest(${todos.tags}) as tag where tag <> all(${sql.param(input.value)}::text[]))`,
            updatedAt: now,
          })
          .where(and(...scope, isNull(todos.deletedAt)))
          .returning({ id: todos.id }),
      );
  }
}

/**
 * Rewrite manual ordering from the array index.
 *
 * One statement with a CASE expression rather than an update per id: a drag that
 * touches 200 rows is 200 round trips otherwise, and a failure partway through
 * leaves the board in an order the user never asked for.
 */
export async function reorderTodos(userId: string, ids: string[]): Promise<string[]> {
  const branches = ids.map((id, index) => sql`when ${todos.id} = ${id} then ${index}`);
  const position = sql`case ${sql.join(branches, sql` `)} else ${todos.position} end`;

  const rows = await db
    .update(todos)
    .set({ position, updatedAt: new Date() })
    .where(and(eq(todos.userId, userId), inArray(todos.id, ids), isNull(todos.deletedAt)))
    .returning({ id: todos.id });

  return pluckIds(rows);
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

export interface TodoStats {
  total: number;
  byStatus: Record<TodoStatus, number>;
  byPriority: Record<TodoPriority, number>;
  overdue: number;
  dueToday: number;
  completedThisWeek: number;
  /** A fraction from 0 to 1; the client decides whether that is a percentage or a bar. */
  completionRate: number;
  currentStreak: number;
}

/**
 * A zone Postgres does not recognise makes `AT TIME ZONE` raise, which would
 * turn one bad profile value into a 500 on the dashboard. Node and Postgres both
 * read the IANA database, so anything Node accepts is safe to pass on.
 *
 * Exported because the analytics module buckets by day in the same zone, and two
 * copies of this guard would eventually disagree about what "safe" means.
 */
export function safeTimeZone(value: string | undefined): string {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

export async function getStats(userId: string): Promise<TodoStats> {
  // Day and week boundaries are the user's own, not the server's: a task due
  // "today" in Karachi is not due today in UTC, and a streak broken at midnight
  // UTC would look broken to someone who worked all evening.
  const [owner] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const zone = safeTimeZone(owner?.timezone);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      statusTodo: sql<number>`(count(*) filter (where ${todos.status} = 'todo'))::int`,
      statusInProgress: sql<number>`(count(*) filter (where ${todos.status} = 'in_progress'))::int`,
      statusDone: sql<number>`(count(*) filter (where ${todos.status} = 'done'))::int`,
      priorityLow: sql<number>`(count(*) filter (where ${todos.priority} = 'low'))::int`,
      priorityMedium: sql<number>`(count(*) filter (where ${todos.priority} = 'medium'))::int`,
      priorityHigh: sql<number>`(count(*) filter (where ${todos.priority} = 'high'))::int`,
      priorityUrgent: sql<number>`(count(*) filter (where ${todos.priority} = 'urgent'))::int`,
      overdue: sql<number>`(count(*) filter (where ${todos.dueAt} < now() and ${todos.status} <> 'done'))::int`,
      // `<> 'done'` for the same reason `overdue` has it: these are counts of
      // work still outstanding. Without it, ticking off a task due today leaves
      // the number unchanged, and the card cannot be reconciled with the rows
      // the client lists underneath it.
      dueToday: sql<number>`(count(*) filter (where (${todos.dueAt} at time zone ${zone})::date = (now() at time zone ${zone})::date and ${todos.status} <> 'done'))::int`,
      completedThisWeek: sql<number>`(count(*) filter (where ${todos.completedAt} >= date_trunc('week', now() at time zone ${zone}) at time zone ${zone}))::int`,
    })
    .from(todos)
    .where(and(eq(todos.userId, userId), isNull(todos.deletedAt)));

  const total = counts?.total ?? 0;
  const done = counts?.statusDone ?? 0;

  return {
    total,
    byStatus: {
      todo: counts?.statusTodo ?? 0,
      in_progress: counts?.statusInProgress ?? 0,
      done,
    },
    byPriority: {
      low: counts?.priorityLow ?? 0,
      medium: counts?.priorityMedium ?? 0,
      high: counts?.priorityHigh ?? 0,
      urgent: counts?.priorityUrgent ?? 0,
    },
    overdue: counts?.overdue ?? 0,
    dueToday: counts?.dueToday ?? 0,
    completedThisWeek: counts?.completedThisWeek ?? 0,
    completionRate: total > 0 ? Math.round((done / total) * 1000) / 1000 : 0,
    currentStreak: await currentStreak(userId, zone),
  };
}

/**
 * Consecutive days, ending today or yesterday, on which something was completed.
 *
 * Classic gaps-and-islands: number the distinct completion days newest-first and
 * keep the leading run where `day + row_number` stays constant. Yesterday counts
 * as an anchor so a streak is not reported as broken at 09:00 before the user
 * has had a chance to finish anything today.
 */
async function currentStreak(userId: string, zone: string): Promise<number> {
  const result = await db.execute<{ streak: number }>(sql`
    with days as (
      select distinct (${todos.completedAt} at time zone ${zone})::date as day
      from ${todos}
      where ${todos.userId} = ${userId}
        and ${todos.deletedAt} is null
        and ${todos.completedAt} is not null
    ),
    ranked as (
      select day, (row_number() over (order by day desc))::int as rn from days
    )
    select coalesce((
      select count(*)::int
      from ranked, (select day from ranked where rn = 1) as anchor
      where anchor.day >= (now() at time zone ${zone})::date - 1
        and ranked.day + ranked.rn = anchor.day + 1
    ), 0)::int as streak
  `);

  return result.rows[0]?.streak ?? 0;
}
