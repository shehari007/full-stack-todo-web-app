/**
 * Request schemas for the analytics module.
 */
import { z } from 'zod';

/**
 * Event names form an operator-defined vocabulary (`page_view`, `todo_created`)
 * that is used as a grouping key in reports and as a filter in the admin UI, so
 * the character set is deliberately narrow.
 */
export const eventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9_.:-]*$/i,
    'Event names may only contain letters, numbers, and . _ : -',
  );

/**
 * Scalars only, and few of them. Allowing a nested object would let a client
 * post an arbitrary blob (including personal data we never asked for and have
 * no lawful basis to keep) into a column administrators can export.
 */
const metadataSchema = z
  .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 10, 'At most 10 metadata keys are allowed');

export const collectEventSchema = z.object({
  name: eventNameSchema,
  /** A full `location.href` is accepted; only the pathname is ever stored. */
  path: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  metadata: metadataSchema.optional(),
});

/**
 * `from`/`to` are half-open (`to` is exclusive), so consecutive windows tile
 * without double-counting the events on the boundary.
 */
export const summaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  granularity: z.enum(['day', 'week']).default('day'),
});

/**
 * The personal productivity window. Same half-open convention as
 * `summaryQuerySchema`.
 *
 * `timezone` is only shape-checked here. Whether Postgres actually knows the
 * name is decided in the service, which falls back to the account's own zone.
 * An unknown zone makes `AT TIME ZONE` raise, and that must not turn a stale
 * profile value into a 500 on the dashboard.
 */
export const personalAnalyticsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

/**
 * Token usage is asked for in whole days because the underlying rollup only has
 * daily resolution. A narrower unit would be an answer the data cannot give.
 */
export const tokenUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

/**
 * Note what is *absent*: `necessary`. Zod strips unknown keys, so a client that
 * posts `necessary: false` simply has it discarded, and the server writes the
 * value itself. Strictly necessary cookies are not a choice, and the API must
 * not offer a shape that implies they are.
 */
export const consentSchema = z.object({
  categories: z.object({
    analytics: z.boolean(),
    preferences: z.boolean(),
  }),
  /**
   * Opaque client-generated id, so a signed-out visitor's consent can still be
   * produced on request. Constrained to an unambiguous alphabet because it is
   * only ever compared, never interpreted.
   */
  anonymousId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Anonymous id must be URL-safe')
    .optional(),
});

/**
 * The `tf_consent` cookie payload. Single-letter keys keep it under ~40 bytes,
 * which matters for a cookie that rides along on every request to the origin.
 */
export const consentCookieSchema = z.object({
  a: z.union([z.literal(0), z.literal(1)]),
  p: z.union([z.literal(0), z.literal(1)]),
  v: z.string().min(1).max(20),
});

export type CollectEventInput = z.infer<typeof collectEventSchema>;
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type PersonalAnalyticsQuery = z.infer<typeof personalAnalyticsQuerySchema>;
export type TokenUsageQuery = z.infer<typeof tokenUsageQuerySchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
