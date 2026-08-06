/**
 * HTTP plumbing shared by every route.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { forbidden, unauthorized } from './errors.js';
import type { AuthContext } from '../types/express.js';

/**
 * Wrap an async handler so a rejected promise reaches the error middleware.
 *
 * Express 5 forwards rejections from async handlers by itself, but wrapping
 * keeps the intent explicit at every call site and means the handlers do not
 * silently change behaviour if the app is ever mounted under Express 4.
 */
export function asyncHandler<T extends Request = Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as unknown as T, res, next)).catch(next);
  };
}

/**
 * Read `req.auth`, throwing if it is absent.
 *
 * Routes behind `requireAuth` always have it, but TypeScript cannot know that,
 * and `req.auth!` would silently become a runtime crash the day a route is
 * mounted without the middleware. This fails as a clean 401 instead.
 */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) {
    throw unauthorized();
  }
  return req.auth;
}

/** Assert the caller is root, for operations no delegated admin may perform. */
export function requireRootContext(req: Request): AuthContext {
  const auth = requireAuthContext(req);
  if (auth.role !== 'root') {
    throw forbidden('This action is restricted to the root account');
  }
  return auth;
}

/* -------------------------------------------------------------------------- */
/* Cookies                                                                    */
/* -------------------------------------------------------------------------- */

export const COOKIE_NAMES = {
  access: 'tf_access',
  refresh: 'tf_refresh',
  /** Readable by JavaScript on purpose: it is the double-submit CSRF value. */
  csrf: 'tf_csrf',
} as const;

/**
 * `Path` is scoped so the refresh cookie is only ever sent to the endpoints
 * that consume it, rather than riding along on every API call.
 */
const REFRESH_COOKIE_PATH = '/api/auth';

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  } as const;
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string },
  refreshExpiresAt: Date,
): void {
  const base = baseCookieOptions();

  // Access cookie lifetime matches the token's own expiry, so a stale cookie is
  // never presented to the API.
  res.cookie(COOKIE_NAMES.access, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: parseDurationMs(env.ACCESS_TOKEN_TTL),
  });

  res.cookie(COOKIE_NAMES.refresh, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    expires: refreshExpiresAt,
  });

  // Not HttpOnly: the browser client must read this to echo it back in a header.
  // That is the whole mechanism: an attacker on another origin can cause the
  // cookie to be *sent* but cannot *read* it to build the matching header.
  res.cookie(COOKIE_NAMES.csrf, tokens.csrfToken, {
    ...base,
    httpOnly: false,
    path: '/',
    expires: refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  const base = baseCookieOptions();
  res.clearCookie(COOKIE_NAMES.access, { ...base, path: '/' });
  res.clearCookie(COOKIE_NAMES.refresh, { ...base, path: REFRESH_COOKIE_PATH });
  res.clearCookie(COOKIE_NAMES.csrf, { ...base, httpOnly: false, path: '/' });
}

/** Convert `15m` / `2h` / `30s` / `7d` to milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * multiplier;
}

/* -------------------------------------------------------------------------- */
/* Client metadata                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Caller IP. Trusts `X-Forwarded-For` only as far as `TRUST_PROXY` allows,
 * because Express has already applied that setting when deriving `req.ip`.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Truncated so a hostile client cannot bloat rows with a megabyte user-agent. */
export function clientUserAgent(req: Request): string {
  return (req.get('user-agent') ?? '').slice(0, 512);
}

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

/** Cache header for immutable, content-addressed responses such as attachments. */
export function setImmutableCache(res: Response, checksum: string): void {
  res.setHeader('ETag', `"${checksum}"`);
  res.setHeader('Cache-Control', isProduction ? 'private, max-age=31536000, immutable' : 'no-cache');
}
