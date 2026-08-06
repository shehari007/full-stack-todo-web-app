/**
 * Personal access token management.
 *
 * Like the todos service, every statement here takes the caller's user id and
 * puts it in the WHERE clause: a token id is a UUID a user might paste from
 * somewhere, and "not yours" has to be indistinguishable from "does not exist".
 *
 * `apiTokens.tokenHash` is never projected. The plaintext is returned exactly
 * once, by `createToken`, and the digest has no reason to leave this file.
 */
import { and, asc, count, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { apiTokenUsage, apiTokens } from '../../db/schema.js';
import { internal, notFound, quotaExceeded } from '../../lib/errors.js';
import { generateApiToken, usageDay } from '../../lib/api-tokens.js';
import type { CreateTokenInput } from './tokens.schemas.js';

/**
 * Live tokens per account.
 *
 * Revoked and expired tokens do not count, so the ceiling is on what can
 * actually reach the API rather than on the history of what ever could. Ten is
 * more integrations than a personal account plausibly runs, and it bounds how
 * much damage one compromised session can set up before it is noticed.
 */
const MAX_LIVE_TOKENS = 10;

/** Window the list view and the usage chart both report over. */
const USAGE_WINDOW_DAYS = 30;

export interface TokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  requestCount30d: number;
}

export interface UsagePoint {
  day: string;
  requestCount: number;
}

/**
 * First day of the reporting window, as the `YYYY-MM-DD` key `apiTokenUsage`
 * stores. The column is text, but ISO dates sort lexicographically, so `>=`
 * compares exactly as a date would, and does it on the existing index.
 */
function windowStart(): string {
  return usageDay(new Date(Date.now() - (USAGE_WINDOW_DAYS - 1) * 86_400_000));
}

/** A token is live when it is neither revoked nor past its expiry. */
function liveTokenFilter(userId: string) {
  return and(
    eq(apiTokens.userId, userId),
    isNull(apiTokens.revokedAt),
    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
  );
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTokens(userId: string): Promise<TokenSummary[]> {
  const since = windowStart();

  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      lastUsedIp: apiTokens.lastUsedIp,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
      /*
       * A correlated subquery rather than a join with GROUP BY: the outer query
       * returns at most ten rows, and a join would force every column above
       * into the grouping key for no gain.
       */
      requestCount30d: sql<number>`(
        select coalesce(sum(${apiTokenUsage.requestCount}), 0)::int
        from ${apiTokenUsage}
        where ${apiTokenUsage.tokenId} = ${apiTokens.id}
          and ${apiTokenUsage.day} >= ${since}
      )`,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(asc(apiTokens.createdAt));
}

/**
 * Daily request counts for one token.
 *
 * Days with no traffic are filled in with zero so the chart draws a continuous
 * axis. A sparse series would render a gap as a straight line between two
 * distant dates and imply activity that never happened.
 */
export async function getTokenUsage(userId: string, tokenId: string): Promise<UsagePoint[]> {
  const [token] = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .limit(1);

  if (!token) {
    throw notFound('That token does not exist');
  }

  const since = windowStart();

  const rows = await db
    .select({ day: apiTokenUsage.day, requestCount: apiTokenUsage.requestCount })
    .from(apiTokenUsage)
    .where(and(eq(apiTokenUsage.tokenId, tokenId), gte(apiTokenUsage.day, since)))
    .orderBy(asc(apiTokenUsage.day));

  const counts = new Map(rows.map((row) => [row.day, row.requestCount]));
  const series: UsagePoint[] = [];

  for (let offset = USAGE_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const day = usageDay(new Date(Date.now() - offset * 86_400_000));
    series.push({ day, requestCount: counts.get(day) ?? 0 });
  }

  return series;
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

export async function createToken(
  userId: string,
  input: CreateTokenInput,
): Promise<{ token: TokenSummary; plaintext: string }> {
  const [existing] = await db
    .select({ value: count() })
    .from(apiTokens)
    .where(liveTokenFilter(userId));

  if ((existing?.value ?? 0) >= MAX_LIVE_TOKENS) {
    throw quotaExceeded(
      `You already have ${MAX_LIVE_TOKENS} active tokens. Revoke one to create another.`,
      { limit: MAX_LIVE_TOKENS },
    );
  }

  const generated = generateApiToken();

  const [created] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: input.name,
      tokenHash: generated.hash,
      tokenPrefix: generated.prefix,
      scopes: input.scopes,
      expiresAt:
        input.expiresInDays != null
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
    })
    // Columns are named rather than using a bare `.returning()`, which would
    // pull `tokenHash` back out and put it one spread away from a response body.
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      lastUsedIp: apiTokens.lastUsedIp,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    });

  if (!created) {
    throw internal('Failed to create the token');
  }

  return { token: { ...created, requestCount30d: 0 }, plaintext: generated.plaintext };
}

/**
 * Revoke a token.
 *
 * Soft, not a delete: the row keeps answering "this credential existed and was
 * turned off on this date", which is the question asked after a leak. The
 * ownership predicate is part of the UPDATE, so a token belonging to somebody
 * else matches nothing and reads as missing.
 */
export async function revokeToken(
  userId: string,
  tokenId: string,
): Promise<{ id: string; name: string }> {
  const [revoked] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
    )
    .returning({ id: apiTokens.id, name: apiTokens.name });

  if (!revoked) {
    throw notFound('That token does not exist, or it has already been revoked');
  }

  return revoked;
}
