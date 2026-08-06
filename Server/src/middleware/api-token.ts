/**
 * Personal access token authentication.
 *
 * Separate from `middleware/auth.ts` on purpose. That middleware accepts a
 * session (from a cookie or from a bearer JWT) and grants whatever the account
 * can do. This one accepts a personal access token and nothing else, and grants
 * only the scopes that token was minted with.
 *
 * Keeping them apart is what lets the public API refuse cookies outright. A
 * single middleware that tried both would, on a surface with wildcard CORS,
 * quietly answer with the visitor's logged-in session.
 */
import type { RequestHandler } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiTokenUsage, apiTokens, users } from '../db/schema.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { asyncHandler, clientIp } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import {
  hashApiToken,
  isValidScope,
  looksLikeApiToken,
  tokenHashMatches,
  usageDay,
  type TokenScope,
} from '../lib/api-tokens.js';

/** Same wording for every rejection, so the endpoint is not a token oracle. */
const REJECTION = 'A valid personal access token is required';

/**
 * Record that a token was used, without the caller waiting for it.
 *
 * Two writes per request against a read endpoint would double its latency and,
 * worse, make a locked row or a full disk turn a working GET into a 500. This
 * follows `recordAudit`'s bargain: the write is attempted, a failure is logged,
 * and the response goes out either way. Losing a usage count is a cosmetic
 * problem; failing the read is not.
 */
function recordUsage(tokenId: string, ipAddress: string): void {
  const now = new Date();

  void Promise.all([
    db
      .insert(apiTokenUsage)
      .values({ tokenId, day: usageDay(now), requestCount: 1 })
      .onConflictDoUpdate({
        target: [apiTokenUsage.tokenId, apiTokenUsage.day],
        // Read-modify-write in the statement, so concurrent requests on the same
        // token accumulate instead of overwriting each other's count.
        set: { requestCount: sql`${apiTokenUsage.requestCount} + 1` },
      }),
    db.update(apiTokens).set({ lastUsedAt: now, lastUsedIp: ipAddress }).where(eq(apiTokens.id, tokenId)),
  ]).catch((error: unknown) => {
    logger.warn({ err: error, tokenId }, 'Failed to record API token usage');
  });
}

/**
 * Resolve an `Authorization: Bearer tf_pat_...` header and attach `req.auth`.
 *
 * Rejects everything else, including a perfectly valid session cookie. That is
 * the point of the middleware. See `modules/public/public.routes.ts`.
 */
export const authenticateApiToken: RequestHandler = asyncHandler(async (req, _res, next) => {
  /*
   * `optionalAuth` runs application-wide and may already have resolved a
   * session from the visitor's cookie. Dropping it here, before anything else,
   * means no path through this middleware can leave a cookie-derived identity
   * attached to a request on the token-only surface.
   */
  delete req.auth;

  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized(REJECTION);
  }

  const presented = header.slice(7).trim();
  // Shape check first: a session JWT, an empty header or a stray string is
  // rejected without touching the database at all.
  if (!looksLikeApiToken(presented)) {
    throw unauthorized(REJECTION);
  }

  const digest = hashApiToken(presented);

  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      tokenHash: apiTokens.tokenHash,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      username: users.username,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(apiTokens)
    // The owner is joined rather than fetched afterwards, so suspension and
    // deletion are checked on the same round trip that finds the token, and
    // take effect the moment they happen, since nothing about the account is
    // baked into the credential.
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, digest))
    .limit(1);

  if (!row || !tokenHashMatches(row.tokenHash, digest)) {
    throw unauthorized(REJECTION);
  }

  if (row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
    throw unauthorized(REJECTION);
  }

  if (row.deletedAt) {
    throw unauthorized(REJECTION);
  }

  if (row.status === 'suspended') {
    // Named rather than folded into `REJECTION`: the holder of a personal token
    // is the account owner, and "your account is suspended" is the one thing
    // that tells them what to do about it.
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }

  /*
   * Filtered against the current scope list, not trusted as stored. A scope
   * retired in a later release stays in old rows, and honouring it would mean a
   * permission the code no longer models still grants access.
   */
  const granted = row.scopes.filter(isValidScope);

  req.auth = {
    userId: row.userId,
    username: row.username,
    role: row.role,
    status: row.status,
    // A token has no session. Its own id stands in so the shared `AuthContext`
    // stays satisfied; `tokenId` below is what code branches on, and nothing on
    // this surface reads session state.
    sessionId: row.id,
    viaCookie: false,
    tokenId: row.id,
    scopes: granted,
  };

  recordUsage(row.id, clientIp(req));

  next();
});

/**
 * Require one scope.
 *
 * A session-authenticated caller is rejected too, not waved through: routes
 * behind this are token-only, and "no scopes because there is no token" must
 * never read as "all scopes".
 */
export function requireScope(scope: TokenScope): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth?.tokenId || !req.auth.scopes) {
      next(unauthorized(REJECTION));
      return;
    }

    if (!req.auth.scopes.includes(scope)) {
      next(forbidden(`This token does not carry the "${scope}" scope`));
      return;
    }

    next();
  };
}
