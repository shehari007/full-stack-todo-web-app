/**
 * Rate limiting.
 *
 * v1 shipped a hand-written in-memory limiter. This uses `express-rate-limit`,
 * which handles the parts that are easy to get wrong: correct `RateLimit-*`
 * headers, IPv6 subnet normalisation (otherwise one host with a /64 gets
 * effectively unlimited attempts), and a store interface.
 *
 * The default store is per-process memory. That is correct for a single Node
 * instance and honest about its limits elsewhere: behind several instances or
 * on serverless, each process keeps its own counters, so the effective limit is
 * multiplied by the instance count. Set `REDIS_URL` and swap in
 * `rate-limit-redis` for a shared counter. See docs/DEPLOYMENT.md.
 */
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env.js';

function build(options: Partial<Options> & { limit: number; windowMs: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Counting a request the caller was going to be allowed anyway is wasteful,
    // but counting failures is the point for auth routes, so this stays false
    // except where explicitly overridden.
    skipSuccessfulRequests: false,
    // Tests would otherwise trip limits while exercising endpoints in a loop.
    skip: () => isTest,
    handler: (_req, res, _next, opts) => {
      res.status(opts.statusCode).json({
        error: {
          code: 'RATE_LIMITED',
          message: opts.message as string,
          retryAfterSeconds: Math.ceil(opts.windowMs / 1000),
        },
      });
    },
    ...options,
  });
}

/**
 * Key by user id when known, falling back to IP.
 *
 * Per-user keying matters behind NAT and on shared networks, where a whole
 * office would otherwise share one budget. `ipKeyGenerator` is used for the
 * anonymous case because it normalises IPv6 to a /64. Keying on the full
 * address would let one client rotate through billions of addresses.
 */
function userOrIpKey(req: Request): string {
  return req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown');
}

/**
 * Key credential endpoints on the identity being attacked, not on the caller's
 * address.
 *
 * IP keying is wrong here, and dangerously so. The web app proxies `/api/*`
 * through Next.js, so every browser request reaches Express from the Next
 * server's address. An IP-keyed limiter therefore puts the entire installation
 * in one bucket: eleven failed sign-ins from anyone would return 429 to every
 * user for the next fifteen minutes. `TRUST_PROXY` does not help, because the
 * forwarded chain still ends at the proxy's own egress address.
 *
 * Keying on the submitted identifier makes the limit do what it was meant to:
 * slow down guessing against one account, without one attacker being able to
 * deny sign-in to everybody else.
 */
function credentialKey(req: Request): string {
  const body = req.body as
    | { identifier?: unknown; username?: unknown; email?: unknown; challengeToken?: unknown }
    | undefined;

  const identifier = body?.identifier ?? body?.username ?? body?.email;
  if (typeof identifier === 'string' && identifier.trim()) {
    return `id:${identifier.trim().toLowerCase().slice(0, 254)}`;
  }

  /*
   * The MFA step carries a challenge token instead of a username. The token is
   * re-issued on every sign-in attempt, so keying on the token itself would
   * hand out a fresh budget each time and remove the limit entirely. Key on
   * the account inside it instead.
   */
  if (typeof body?.challengeToken === 'string') {
    const subject = unverifiedSubject(body.challengeToken);
    if (subject) return `mfa:${subject}`;
  }

  // Signed-in callers (password change, MFA management) key on the account.
  if (req.auth?.userId) {
    return `user:${req.auth.userId}`;
  }

  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/**
 * Read `sub` from a JWT without verifying it.
 *
 * Deliberately unverified: this only picks a rate-limit bucket, and the real
 * signature check happens later in the handler. A forged token merely fills a
 * bucket belonging to an account that will reject it anyway, so trusting the
 * claim here costs nothing and avoids doing crypto on every request.
 */
function unverifiedSubject(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof decoded.sub === 'string' ? decoded.sub.slice(0, 64) : null;
  } catch {
    return null;
  }
}

/** Broad ceiling for the whole API. Generous: it is a backstop, not a policy. */
export const generalLimiter = build({
  windowMs: 60_000,
  limit: 300,
  keyGenerator: userOrIpKey,
  message: 'Too many requests. Please slow down and try again shortly.',
});

/**
 * Sign-in, registration and password reset. Strict, because these are the
 * endpoints worth brute-forcing. Successful requests are not counted, so a
 * legitimate user who signs in repeatedly is never locked out; only failures
 * accumulate.
 */
export const authLimiter = build({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: credentialKey,
  message: 'Too many attempts. Please wait 15 minutes before trying again.',
});

/**
 * MFA code submission. Tighter than sign-in: a six-digit code is only 1,000,000
 * possibilities, so an attacker who already has the password must not get many
 * guesses.
 */
export const mfaLimiter = build({
  windowMs: 15 * 60_000,
  limit: 8,
  skipSuccessfulRequests: true,
  keyGenerator: credentialKey,
  message: 'Too many verification attempts. Please wait 15 minutes.',
});

/** Uploads are expensive in bandwidth and database write volume. */
export const uploadLimiter = build({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: userOrIpKey,
  message: 'Too many uploads. Please wait a moment before uploading more files.',
});

/** Exports build a whole document in memory, so they are metered separately. */
export const exportLimiter = build({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: userOrIpKey,
  message: 'Too many export requests. Please wait a moment.',
});

/** Write operations on tasks. Loose enough to never be felt in normal use. */
export const writeLimiter = build({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: userOrIpKey,
  message: 'Too many changes at once. Please slow down.',
});

/**
 * The public read API (`/api/v1/*`), keyed on the token rather than the address.
 *
 * These are server-to-server calls. A dozen users' integrations can run on the
 * same PaaS and leave from one egress address, so an IP-keyed budget would let
 * the busiest of them throttle everybody else, and would give an attacker a
 * cheap way to take another customer's integration offline. The token id is the
 * thing being metered, and it is the thing that identifies the caller.
 *
 * Mounted after `authenticateApiToken`, so `tokenId` is always set by the time
 * the key is computed; the IP fallback only covers a misordering.
 */
export const publicApiLimiter = build({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: (req: Request) =>
    req.auth?.tokenId ? `token:${req.auth.tokenId}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`,
  message: 'This token is making too many requests. The limit is 120 per minute.',
});

/**
 * The public contact form. Strict, and keyed on the address rather than on
 * `userOrIpKey`, because the callers worth metering here have no account.
 * Keying on a user would give every signed-out visitor the same bucket.
 *
 * This is only the cheap half of the contact form's throttling. It refuses a
 * flood before a database connection is taken, but it lives in per-process
 * memory and forgets everything on restart, so the route also counts the rows
 * that were actually written in the last hour. That count is the durable,
 * operator-configurable limit; this one is the doorman.
 *
 * The window is an hour to match `support.contactMaxPerHour`, and the limit sits
 * above it so the database count (the number an operator can actually tune) is
 * what a legitimate-looking sender hits first, with this as the backstop for
 * traffic that never gets that far.
 */
export const contactLimiter = build({
  windowMs: 60 * 60_000,
  limit: 10,
  keyGenerator: (req: Request) => `contact:${ipKeyGenerator(req.ip ?? 'unknown')}`,
  message: 'Too many messages from this address. Please wait an hour before sending another.',
});

/** Anonymous analytics ingestion, keyed by IP since there is no user. */
export const analyticsLimiter = build({
  windowMs: 60_000,
  limit: 60,
  message: 'Too many events.',
});
