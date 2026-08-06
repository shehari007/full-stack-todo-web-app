/**
 * Token issuing and verification.
 *
 * Two token types, deliberately different in kind:
 *
 *  - **Access token**: a short-lived signed JWT (15 min). Stateless, so every
 *    request validates it without touching the database.
 *  - **Refresh token**: a long-lived *opaque* random string (30 days). It is
 *    not a JWT: it has a row in `sessions`, which is what makes "sign out this
 *    device" and rotation-replay detection possible. A JWT cannot be revoked.
 *
 * Only a peppered HMAC of the refresh token is stored, so a database dump does
 * not hand an attacker working tokens.
 */
import { createHmac } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';
import { randomToken } from './crypto.js';
import type { UserRole } from '../db/schema.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const mfaSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

const ISSUER = 'taskflow';
const AUDIENCE = 'taskflow-web';

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: UserRole;
  /** Session this token belongs to, so revoking the session can invalidate it. */
  sid: string;
}

/* -------------------------------------------------------------------------- */
/* Access tokens                                                              */
/* -------------------------------------------------------------------------- */

export async function signAccessToken(params: {
  userId: string;
  role: UserRole;
  sessionId: string;
}): Promise<string> {
  return new SignJWT({ role: params.role, sid: params.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(params.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // Pinned: never let the token's own header pick the algorithm.
    });
    return payload as AccessTokenClaims;
  } catch {
    // Never surface the underlying reason: "expired" vs "bad signature" is
    // useful information to an attacker probing tokens.
    throw unauthorized('Invalid or expired session');
  }
}

/* -------------------------------------------------------------------------- */
/* MFA challenge tokens                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Issued when a password check succeeds but the account has MFA on. It proves
 * "this person knows the password" for the two minutes it takes to type a code,
 * and grants nothing else. It is signed with a different key and carries a
 * different audience, so `verifyAccessToken` will not accept it.
 */
export async function signMfaChallenge(userId: string): Promise<string> {
  return new SignJWT({ purpose: 'mfa' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience('taskflow-mfa')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(mfaSecret);
}

export async function verifyMfaChallenge(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, mfaSecret, {
      issuer: ISSUER,
      audience: 'taskflow-mfa',
      algorithms: ['HS256'],
    });
    if (payload.purpose !== 'mfa' || !payload.sub) {
      throw new Error('wrong purpose');
    }
    return payload.sub;
  } catch {
    throw unauthorized('MFA challenge expired. Please sign in again', 'MFA_INVALID');
  }
}

/* -------------------------------------------------------------------------- */
/* Refresh tokens                                                             */
/* -------------------------------------------------------------------------- */

export function generateRefreshToken(): string {
  return randomToken(32);
}

/**
 * Peppered HMAC used as the `sessions.token_hash` lookup key. Keyed rather than
 * a bare SHA-256 so that read access to the table is not enough to build a
 * lookup table offline.
 */
export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
