/**
 * Request schemas for the todos module.
 */
import { z } from 'zod';
import { todoPriorityEnum, todoStatusEnum } from '../../db/schema.js';

/** Keeps one page from becoming an unbounded table scan the client cannot render. */
const MAX_PAGE_SIZE = 100;
/** A bulk action is one statement, so the ceiling is about audit noise and payload size. */
const MAX_BULK_IDS = 200;
/** A manual reorder rewrites one row per id; beyond this the client should paginate. */
const MAX_REORDER_IDS = 500;

/**
 * List filters arrive as `?tags=work&tags=home`, as `?tags=work,home`, or as a
 * single value, depending on which HTTP client is talking to us. Normalising all
 * three shapes here lets every filter below stay a plain `z.array`.
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

/**
 * `z.coerce.boolean()` is the wrong tool for query strings: it applies JavaScript
 * truthiness, so `?overdue=false` would arrive as `true`.
 */
const booleanParam = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

/** Tags are matched exactly, so they are trimmed and length-capped on the way in. */
const tagSchema = z.string().trim().min(1).max(32);

const tagArraySchema = z.array(tagSchema).max(20, 'A task can carry at most 20 tags');

/** Deduplicated on entry: the same tag twice is meaningless and breaks tag counts. */
const tagListSchema = tagArraySchema.transform((tags) => Array.from(new Set(tags)));
const nonEmptyTagListSchema = tagArraySchema
  .min(1, 'Name at least one tag')
  .transform((tags) => Array.from(new Set(tags)));

export const todoStatusSchema = z.enum(todoStatusEnum.enumValues);
export const todoPrioritySchema = z.enum(todoPriorityEnum.enumValues);
export const todoSortSchema = z.enum(['created', 'due', 'priority', 'position', 'title']);
export const todoOrderSchema = z.enum(['asc', 'desc']);

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What to select and in which order, but not which page of it.
 *
 * Kept separate from pagination because the exports module extends this schema
 * to build its own query: an export is always the whole matching set, and
 * sharing the definition is what stops the two views from disagreeing about
 * what `status=todo,done` means.
 */
export const todoFilterSchema = z.object({
  // An empty search box submits `?q=`, which is a request for everything rather
  // than a validation failure.
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),

  status: z.preprocess(toList, z.array(todoStatusSchema).optional()),
  priority: z.preprocess(toList, z.array(todoPrioritySchema).optional()),
  tags: z.preprocess(toList, z.array(tagSchema).max(20).optional()),

  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  overdue: booleanParam.optional(),
  includeCompleted: booleanParam.default(true),

  sort: todoSortSchema.default('created'),
  order: todoOrderSchema.default('desc'),
});

export const listTodosQuerySchema = todoFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export const todoIdParamSchema = z.object({
  id: z.string().uuid('That is not a valid task id'),
});

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export const createTodoSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().trim().max(10_000).nullable().optional(),
  status: todoStatusSchema.optional(),
  priority: todoPrioritySchema.optional(),
  dueAt: z.coerce.date().nullable().optional(),
  tags: tagListSchema.optional(),
});

/**
 * `completedAt` is deliberately absent: it is derived from `status` by the
 * service, so a client cannot claim a task was finished last year.
 */
export const updateTodoSchema = createTodoSchema
  .extend({ position: z.number().int().min(0).max(1_000_000).optional() })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field to update',
  );

const bulkIdsSchema = z
  .array(z.string().uuid())
  .min(1, 'Select at least one task')
  .max(MAX_BULK_IDS, `Up to ${MAX_BULK_IDS} tasks can be changed at once`);

/**
 * A discriminated union rather than `{ action, value?: unknown }`: it makes the
 * payload `value` must carry a property of the action itself, so `setPriority`
 * without a priority is rejected by validation instead of by a SQL error.
 */
export const bulkTodoSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), ids: bulkIdsSchema }),
  z.object({ action: z.literal('reopen'), ids: bulkIdsSchema }),
  z.object({ action: z.literal('delete'), ids: bulkIdsSchema }),
  z.object({ action: z.literal('restore'), ids: bulkIdsSchema }),
  z.object({ action: z.literal('setPriority'), ids: bulkIdsSchema, value: todoPrioritySchema }),
  z.object({ action: z.literal('addTags'), ids: bulkIdsSchema, value: nonEmptyTagListSchema }),
  z.object({ action: z.literal('removeTags'), ids: bulkIdsSchema, value: nonEmptyTagListSchema }),
]);

export const reorderTodosSchema = z.object({
  /** Position is the array index, so a repeated id would ask for two positions at once. */
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_REORDER_IDS)
    .refine((ids) => new Set(ids).size === ids.length, 'Each task may appear only once'),
});

export type TodoFilter = z.infer<typeof todoFilterSchema>;
export type TodoListQuery = z.infer<typeof listTodosQuerySchema>;
export type TodoSortKey = z.infer<typeof todoSortSchema>;
export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type BulkTodoInput = z.infer<typeof bulkTodoSchema>;
export type ReorderTodosInput = z.infer<typeof reorderTodosSchema>;
