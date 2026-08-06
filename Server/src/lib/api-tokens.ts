/**
 * Personal access tokens.
 *
 * These authenticate the public read API (`/api/v1/*`), which exists so a user
 * can render their own task list on their own website without embedding a
 * session cookie or their password anywhere.
 *
 * The security model is narrow on purpose: a token is read-only, is bound to
 * one account's own data, and carries explicit scopes. That is what makes it
 * safe to hand a wildcard CORS policy to that surface. See `modules/public`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Recognisable prefix, so a leaked token can be spotted in a diff or a log and
 * matched by secret scanners. GitHub's `ghp_` convention exists for the same
 * reason.
 */
export const TOKEN_PREFIX = 'tf_pat_';

/** Characters shown in the UI to identify a token without revealing it. */
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

export const TOKEN_SCOPES = ['tasks:read', 'stats:read', 'profile:read'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export interface GeneratedToken {
  /** Shown to the user exactly once. Never stored. */
  plaintext: string;
  hash: string;
  prefix: string;
}

/**
 * Mint a token. 32 random bytes is 256 bits of entropy, which is far beyond
 * brute-forcing, so the stored digest needs no salt or key stretching. Unlike
 * a password, there is no low-entropy secret to protect.
 */
export function generateApiToken(): GeneratedToken {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

  return {
    plaintext,
    hash: hashApiToken(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check, so a malformed header never reaches the database. */
export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20;
}

/**
 * Compare two digests without leaking how far they matched.
 *
 * The lookup is by indexed hash, so this is belt-and-braces rather than the
 * primary defence, but a hex digest comparison is cheap to do properly.
 */
export function tokenHashMatches(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function isValidScope(scope: string): scope is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(scope);
}

/** UTC calendar day key for the usage rollup. */
export function usageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
