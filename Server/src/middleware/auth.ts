/**
 * Authentication and authorisation.
 *
 * Credentials are accepted from two places:
 *  1. The `tf_access` cookie: how the web app authenticates, so that Next.js
 *     server components can forward the request without ever handling a raw
 *     token in JavaScript.
 *  2. An `Authorization: Bearer` header, for scripts and API clients.
 *
 * Only cookie-borne credentials require a CSRF check, because only cookies are
 * attached automatically by the browser on a cross-site request.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import type { UserRole } from '../db/schema.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { COOKIE_NAMES, asyncHandler } from '../lib/http.js';
import { safeEqual } from '../lib/crypto.js';
import { getSettings } from '../lib/settings.js';
import { env } from '../config/env.js';

/** Pull a token out of the request, noting which channel it arrived on. */
function extractToken(req: Request): { token: string; viaCookie: boolean } | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return { token, viaCookie: false };
  }

  const cookieToken = req.cookies?.[COOKIE_NAMES.access];
  if (typeof cookieToken === 'string' && cookieToken) {
    return { token: cookieToken, viaCookie: true };
  }

  return null;
}

/**
 * Resolve the caller and attach `req.auth`.
 *
 * The user row is loaded on every authenticated request rather than trusting
 * the token's claims alone. That costs one indexed primary-key lookup, and buys
 * immediate effect for suspension, role changes and "sign out everywhere".
 * With claims-only trust, a suspended user would keep full access until their
 * access token expired.
 */
async function resolveAuth(req: Request): Promise<void> {
  const extracted = extractToken(req);
  if (!extracted) return;

  const claims = await verifyAccessToken(extracted.token);

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      tokensValidFrom: users.tokensValidFrom,
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);

  if (!user || user.deletedAt) {
    throw unauthorized('Invalid or expired session');
  }

  if (user.status === 'suspended') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }

  /*
   * Tokens issued before `tokensValidFrom` are rejected. Changing a password or
   * signing out everywhere pushes that timestamp forward, which invalidates
   * every outstanding access token at once without needing to track them.
   *
   * Both sides are compared in whole seconds. A JWT's `iat` has one-second
   * resolution and is rounded down, while `tokens_valid_from` is a Postgres
   * timestamp with microsecond precision. Comparing them in milliseconds
   * rejects any token minted in the same second the timestamp was written,
   * which locked out every user immediately after registering or changing
   * their password, since both set the column and issue a token together.
   */
  const issuedAtSeconds = typeof claims.iat === 'number' ? claims.iat : 0;
  const validFromSeconds = Math.floor(user.tokensValidFrom.getTime() / 1000);
  if (issuedAtSeconds < validFromSeconds) {
    throw unauthorized('Session expired. Please sign in again');
  }

  /*
   * The access token names the session that minted it, and that session must
   * still be live. Without this check, revoking a session ("sign out this
   * device", or an ordinary logout) only deleted the refresh token's row and
   * left the stateless access token working for the rest of its 15 minutes.
   * Someone who had copied the cookie kept full access across the sign-out that
   * was supposed to stop them.
   *
   * It is one indexed lookup, on a query that already has to run.
   */
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, claims.sid),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    throw unauthorized('Session ended. Please sign in again');
  }

  req.auth = {
    userId: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    sessionId: claims.sid,
    viaCookie: extracted.viaCookie,
  };
}

/** Populate `req.auth` when credentials are present; never rejects. */
export const optionalAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  try {
    await resolveAuth(req);
  } catch {
    // Anonymous access is valid on these routes, so a bad token is simply ignored.
  }
  next();
});

/** Populate `req.auth`, rejecting the request when credentials are missing or bad. */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  await resolveAuth(req);
  if (!req.auth) {
    throw unauthorized();
  }
  next();
});

/**
 * Restrict a route to the given roles.
 *
 * `root` is intentionally *not* implicit: every call site lists the roles it
 * allows. Passing `['admin']` alone really does exclude root, which matters for
 * the few places where that is the correct behaviour.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(forbidden('You do not have permission to do that'));
      return;
    }
    next();
  };
}

/** Root or admin. The common case for the control panel. */
export const requirePrivileged = requireRole('root', 'admin');

/** Root only. Reserved for irreversible or installation-wide operations. */
export const requireRoot = requireRole('root');

/* -------------------------------------------------------------------------- */
/* CSRF                                                                       */
/* -------------------------------------------------------------------------- */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check for cookie-authenticated, state-changing requests.
 *
 * The client reads the non-HttpOnly `tf_csrf` cookie and echoes it in the
 * `X-CSRF-Token` header. A cross-site attacker can cause the cookie to be sent
 * but cannot read it (same-origin policy prevents that), so it cannot produce
 * the matching header.
 *
 * Bearer-authenticated requests skip the check: the browser never attaches an
 * `Authorization` header on its own, so there is nothing to forge.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  /*
   * Cross-origin state-changing requests are refused outright, before the
   * cookie checks below.
   *
   * The double-submit token cannot cover sign-in: the visitor has no session
   * yet, so there is no cookie to echo. That left `POST /api/auth/login` open
   * to a cross-site form submission (a simple request, no preflight), which
   * would log the victim into the *attacker's* account, so everything they
   * then wrote landed in storage the attacker could read. `SameSite=Lax`
   * does not help, because it restricts sending cookies, not receiving them.
   *
   * `Sec-Fetch-Site` is set by the browser and cannot be forged by page script.
   * `Origin` is checked as well for older clients. Requests with neither header
   * are not browser requests (curl, a server-to-server call) and are allowed:
   * those cannot be CSRF, since there is no victim session to ride on.
   */
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    next(forbidden('Cross-site requests are not allowed'));
    return;
  }

  const origin = req.get('origin');
  if (origin && !env.ALLOWED_ORIGINS.includes(origin)) {
    next(forbidden('Cross-site requests are not allowed'));
    return;
  }

  // No cookie credentials in play means no further CSRF surface.
  const hasAuthCookie = typeof req.cookies?.[COOKIE_NAMES.access] === 'string';
  const hasRefreshCookie = typeof req.cookies?.[COOKIE_NAMES.refresh] === 'string';
  if (!hasAuthCookie && !hasRefreshCookie) {
    next();
    return;
  }

  // A bearer token takes precedence over cookies and is not forgeable cross-site.
  if (req.get('authorization')?.startsWith('Bearer ')) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[COOKIE_NAMES.csrf];
  const headerToken = req.get('x-csrf-token');

  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    !cookieToken ||
    !safeEqual(cookieToken, headerToken)
  ) {
    next(forbidden('CSRF token missing or invalid'));
    return;
  }

  next();
};

/* -------------------------------------------------------------------------- */
/* Policy gates                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Enforce the "privileged accounts must use MFA" policy when it is switched on.
 *
 * The MFA setup routes themselves are exempt, otherwise turning the policy on
 * would lock every administrator out of the only screen that could satisfy it.
 */
export const enforceMfaPolicy: RequestHandler = asyncHandler(async (req, _res, next) => {
  const auth = req.auth;
  if (!auth || auth.role === 'user') {
    next();
    return;
  }

  const features = await getSettings('features');
  if (!features.requireMfaForPrivileged) {
    next();
    return;
  }

  const [user] = await db
    .select({ mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user?.mfaEnabled) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'This installation requires multi-factor authentication for administrator accounts. Enrol from your security settings to continue.',
      { details: { reason: 'mfa_enrolment_required' } },
    );
  }

  next();
});

/**
 * Maintenance mode. Root keeps full access so the installation can be fixed
 * from the control panel while everyone else sees a 503.
 */
export const maintenanceGate: RequestHandler = asyncHandler(async (req, res, next) => {
  const features = await getSettings('features');

  if (!features.maintenanceMode || req.auth?.role === 'root') {
    next();
    return;
  }

  // Leave auth and health endpoints reachable so root can still sign in.
  if (req.path.startsWith('/auth') || req.path === '/health' || req.path.startsWith('/settings')) {
    next();
    return;
  }

  res.setHeader('Retry-After', '600');
  res.status(503).json({
    error: { code: 'MAINTENANCE', message: features.maintenanceMessage },
  });
});
