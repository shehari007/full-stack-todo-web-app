/**
 * Request schemas for the profile module.
 */
import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';

/**
 * Built once at module load. `Intl.supportedValuesOf` walks the whole ICU
 * timezone table, which is far too much work to repeat on every PATCH.
 */
const SUPPORTED_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

/**
 * IANA names only. An unvalidated string here survives the write and then
 * throws a `RangeError` inside `Intl.DateTimeFormat` weeks later, in whichever
 * export or reminder happens to format a date first.
 */
const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((value) => SUPPORTED_TIMEZONES.has(value), 'Not a recognised IANA time zone');

/** BCP 47 shape. The set of locales the UI actually ships is a client concern. */
const localeSchema = z
  .string()
  .trim()
  .max(16)
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Enter a language tag such as `en` or `pt-BR`');

export const themeSchema = z.enum(['light', 'dark', 'system']);

/**
 * An emptied text input arrives as `""`. Folding it to NULL keeps "no bio" a
 * single state. Otherwise every consumer has to test for both.
 */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

/**
 * Fields are individually optional, but an entirely empty patch is rejected:
 * answering 200 to a request that changed nothing hides a client bug rather
 * than surfacing it.
 */
export const updateProfileSchema = z
  .object({
    displayName: nullableText(64),
    bio: nullableText(500),
    timezone: timezoneSchema,
    locale: localeSchema,
    theme: themeSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');

export const changeEmailSchema = z.object({
  email: emailSchema,
  /**
   * Re-authentication. The email address is the account's recovery channel, so
   * quietly repointing it is exactly what a hijacked session is worth.
   */
  currentPassword: z.string().min(1, 'Confirm your password'),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Confirm your password'),
  /**
   * Typed-out username. Compared against the caller's own in the handler, which
   * is the only place the expected value is known.
   */
  confirmUsername: z.string().trim().min(1, 'Type your username to confirm'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
