/**
 * Checks that run before the setup scripts touch the database.
 *
 * These exist because the first thing anyone does against a new production
 * database is run migrations, and that is exactly when a network or
 * configuration problem is least legible. Drizzle reports a failure as
 * `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`, which points at the
 * migration rather than at DNS, and the actual cause is several `cause` links
 * down the chain.
 */
import { lookup } from 'node:dns/promises';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Failures worth retrying, as opposed to a hostname that is simply wrong.
 *
 * `EAI_AGAIN` is the interesting one: a dual-stack `getaddrinfo` returns it for
 * the whole lookup when the IPv6 half fails, even when the host has a perfectly
 * good A record. Consumer routers do this often enough that a first deploy
 * hitting it is common, and it clears on a retry seconds later.
 */
const RETRYABLE = new Set(['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED']);

/** Walk the `cause` chain, since drizzle and pg both wrap the original error. */
export function rootErrorCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < 6; depth += 1) {
    const code = (current as { code?: string }).code;
    if (typeof code === 'string' && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Block until the database hostname resolves.
 *
 * Asks for IPv4 explicitly: the dual-stack query is the one that fails on a
 * resolver like this, and every managed Postgres host publishes an A record.
 * Costs one cached lookup when DNS is healthy.
 */
export async function waitForHostname(attempts = 5): Promise<void> {
  const { hostname } = new URL(env.DATABASE_URL);

  // A literal address or a unix socket has nothing to resolve.
  if (!hostname || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('/')) {
    return;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await lookup(hostname, { family: 4 });
      return;
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'unknown';

      if (attempt === attempts) {
        throw new Error(
          `Could not resolve "${hostname}" after ${attempts} attempts (${code}).\n\n` +
            (code === 'ENOTFOUND'
              ? `  Check DATABASE_URL for a typo in the hostname.`
              : `  This is usually a local DNS problem rather than a wrong hostname.`) +
            `\n  Check it from a terminal:  nslookup ${hostname}\n` +
            `  If that works but this does not, your resolver is failing the IPv6 lookup. ` +
            `Point the machine at a public DNS server such as 1.1.1.1 and try again.`,
        );
      }

      logger.warn({ hostname, code, attempt }, 'Database hostname did not resolve, retrying');
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

/**
 * Retry an operation whose failure looks transient.
 *
 * Only the codes in `RETRYABLE` are retried. A wrong password or a missing
 * table fails immediately, because repeating those wastes the operator's time
 * and buries the message that would have told them what to fix.
 */
export async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = rootErrorCode(error);

      if (!code || !RETRYABLE.has(code) || attempt === attempts) {
        throw error;
      }

      logger.warn({ label, code, attempt }, 'Transient database error, retrying');
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  throw lastError;
}
