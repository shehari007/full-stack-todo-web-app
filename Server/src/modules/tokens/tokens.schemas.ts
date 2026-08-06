/**
 * Request schemas for the personal access token module.
 */
import { z } from 'zod';
import { TOKEN_SCOPES, isValidScope } from '../../lib/api-tokens.js';

/**
 * A token that never expires is the one that ends up in a public repository
 * five years after the integration was switched off, so the API refuses to mint
 * anything longer-lived than a year.
 */
const MAX_EXPIRY_DAYS = 365;

export const createTokenSchema = z.object({
  name: z.string().trim().min(1, 'Give the token a name you will recognise').max(80),

  scopes: z
    .array(z.string().trim())
    .min(1, 'Grant the token at least one scope')
    .max(TOKEN_SCOPES.length)
    .superRefine((scopes, ctx) => {
      for (const [index, scope] of scopes.entries()) {
        if (!isValidScope(scope)) {
          ctx.addIssue({
            code: 'custom',
            // Indexed so the client can highlight the offending checkbox.
            path: [index],
            message: `Unknown scope "${scope}"`,
          });
        }
      }
    })
    // The refinement above is what rejects; `filter` re-applies the same
    // predicate purely so the parsed value carries the narrowed union type.
    // Deduplicated because a scope listed twice is stored twice and read back
    // twice, and the UI would render it as two grants of the same permission.
    .transform((scopes) => Array.from(new Set(scopes.filter(isValidScope)))),

  /** `null` and an absent field both mean "no expiry". */
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).nullable().optional(),
});

export const tokenIdParamSchema = z.object({
  id: z.string().uuid('That is not a valid token id'),
});

export type CreateTokenInput = z.infer<typeof createTokenSchema>;
