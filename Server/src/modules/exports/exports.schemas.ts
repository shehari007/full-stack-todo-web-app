/**
 * Request schemas for the exports module.
 */
import { z } from 'zod';
import { todoFilterSchema } from '../todos/todos.schemas.js';

export const EXPORT_FORMATS = ['pdf', 'csv', 'xlsx', 'json', 'md', 'ics'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const exportFormatSchema = z.enum(EXPORT_FORMATS);

/**
 * The todos filter, plus a format.
 *
 * Extending the todos module's own schema rather than restating it means the
 * two can never disagree about what `status=done,todo` parses to, and a filter
 * added to the task list is exportable without anyone remembering to mirror it
 * here. Unknown keys are still stripped, so pagination parameters a client
 * copies across from the list view are simply ignored: an export is always the
 * whole matching set, not one page of it.
 */
export const exportTodosQuerySchema = todoFilterSchema.extend({
  format: exportFormatSchema.default('pdf'),
});

export type ExportTodosQuery = z.infer<typeof exportTodosQuerySchema>;
