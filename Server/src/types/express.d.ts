import type { UserRole, UserStatus } from '../db/schema.js';
import type { TokenScope } from '../lib/api-tokens.js';

/**
 * The authenticated caller, attached by the `authenticate` middleware.
 *
 * v1 used `res.locals.userAuth`, which is untyped and easy to misspell. This is
 * a typed property on the request so that reading `req.auth.role` is checked at
 * compile time.
 */
export interface AuthContext {
  userId: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
  /**
   * True when credentials arrived in a cookie rather than an `Authorization`
   * header. Only cookie-authenticated requests need a CSRF check, because a
   * bearer token is not attached automatically by the browser, so it cannot be
   * forged cross-site.
   */
  viaCookie: boolean;
  /**
   * Set only when the caller authenticated with a personal access token. Its
   * presence is what distinguishes a token-borne request from a session, which
   * matters because a token is read-only and scope-limited where a session is
   * neither.
   */
  tokenId?: string;
  /**
   * Scopes the token granted. Absent for session callers, since a session is
   * not scope-limited, so an empty array would be the wrong answer for them and
   * `requireScope` must reject rather than pass.
   */
  scopes?: TokenScope[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Correlation id, echoed in the `X-Request-Id` response header and in logs. */
      id: string;
    }
  }
}

export {};
