/**
 * Authentication logic.
 *
 * Route handlers stay thin; the rules that matter for security live here.
 */
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { sessions, users, type User, type UserRole } from '../../db/schema.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  generateRecoveryCode,
  randomToken,
  encrypt,
  decrypt,
} from '../../lib/crypto.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../lib/tokens.js';
import { AppError, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { generateTotpSecret, verifyTotp } from '../../lib/totp.js';
import { logger } from '../../lib/logger.js';

/** Lock an account after this many consecutive failures. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;
const RECOVERY_CODE_COUNT = 10;

/**
 * A valid Argon2 digest of a throwaway value.
 *
 * When a sign-in names an account that does not exist we verify against this
 * instead of returning early. Without it, "no such user" answers in under a
 * millisecond while a real account takes ~50 ms, and that difference alone
 * lets an attacker enumerate valid usernames.
 */
let decoyDigest: string | null = null;
async function burnTiming(candidate: string): Promise<void> {
  decoyDigest ??= await hashPassword(randomToken(16));
  await verifyPassword(decoyDigest, candidate);
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                              */
/* -------------------------------------------------------------------------- */

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarId: string | null;
  role: UserRole;
  status: string;
  mfaEnabled: boolean;
  timezone: string;
  locale: string;
  theme: string;
  storageUsedBytes: number;
  storageQuotaBytes: number | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/**
 * The only shape a user is ever sent to a client in.
 *
 * Built by naming every field explicitly rather than deleting sensitive ones
 * from the row: with a denylist, any column added later leaks by default.
 */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    avatarId: user.avatarId,
    role: user.role,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    timezone: user.timezone,
    locale: user.locale,
    theme: user.theme,
    storageUsedBytes: user.storageUsedBytes,
    storageQuotaBytes: user.storageQuotaBytes,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export async function registerUser(input: {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}): Promise<User> {
  const [existing] = await db
    .select({ username: users.username, email: users.email })
    .from(users)
    .where(or(eq(users.username, input.username), eq(users.email, input.email)))
    .limit(1);

  if (existing) {
    /*
     * One message for both collisions. Naming which field clashed turns
     * registration into an email-lookup service: submit a random username with
     * someone's address and the response tells you whether they have an
     * account here. The username half is discoverable anyway (usernames are
     * public), so the cost of the vaguer message is small.
     */
    throw conflict('That username or email is already registered');
  }

  const passwordHash = await hashPassword(input.password);

  const [created] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email,
      passwordHash,
      displayName: input.displayName ?? null,
      // Role is never taken from the request. New accounts are always `user`;
      // promotion happens only through the admin module.
      role: 'user',
    })
    .returning();

  if (!created) {
    throw new AppError(500, 'INTERNAL', 'Failed to create account');
  }

  return created;
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                    */
/* -------------------------------------------------------------------------- */

export type AuthenticateResult =
  | { kind: 'authenticated'; user: User }
  | { kind: 'mfa_required'; user: User };

/**
 * Verify a password and decide whether MFA is still owed.
 *
 * Every failure path raises the same `INVALID_CREDENTIALS` error, so the
 * response cannot be used to tell "no such account" from "wrong password".
 * Lockout and suspension are the deliberate exceptions: a user who is locked
 * out needs to be told why, and that state is only reachable by someone who
 * already knows the account exists.
 */
export async function authenticate(
  identifier: string,
  password: string,
): Promise<AuthenticateResult> {
  const lookup = identifier.toLowerCase();

  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        or(eq(users.username, lookup), eq(users.email, lookup)),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (!user) {
    await burnTiming(password);
    throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
  }

  /*
   * The password is checked first, and its result decides which error the
   * caller sees.
   *
   * Reporting "locked" or "suspended" before verifying the password turns those
   * states into an account-existence oracle: an unknown username answers 401
   * while a real one answers 423 or 403, no password required. Checking the
   * password first means only someone who already knows it learns anything.
   */
  const valid = await verifyPassword(user.passwordHash, password);

  const isLocked = user.lockedUntil != null && user.lockedUntil > new Date();

  if (!valid) {
    // Do not extend the lock while it is already running. Otherwise repeated
    // guessing during a lockout keeps pushing the expiry further out.
    if (!isLocked) {
      await registerFailedLogin(user);
    }
    throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
  }

  if (isLocked) {
    const minutes = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 60_000);
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  if (user.status === 'suspended') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }

  // A correct password clears the failure counter even when MFA is still owed:
  // the counter exists to stop password guessing, and the password is now known
  // to be correct. MFA attempts are metered separately by `mfaLimiter`.
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
  }

  return user.mfaEnabled
    ? { kind: 'mfa_required', user }
    : { kind: 'authenticated', user };
}

async function registerFailedLogin(user: User): Promise<void> {
  /*
   * A lock that has run out starts the count again from one. Carrying the old
   * counter forward meant the first wrong password after a lock expired was
   * already at the threshold and re-locked the account immediately, so one
   * request every fifteen minutes could keep a named account, including root,
   * permanently locked out. The lockout is meant to slow guessing, not to be a
   * cheap denial-of-service against a known username.
   */
  const lockHasLapsed = user.lockedUntil != null && user.lockedUntil <= new Date();
  const attempts = lockHasLapsed ? 1 : user.failedLoginCount + 1;
  const shouldLock = attempts >= MAX_FAILED_LOGINS;

  await db
    .update(users)
    .set({
      failedLoginCount: attempts,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    })
    .where(eq(users.id, user.id));

  if (shouldLock) {
    logger.warn({ userId: user.id }, 'Account locked after repeated failed sign-in attempts');
  }
}

/* -------------------------------------------------------------------------- */
/* MFA verification at sign-in                                                */
/* -------------------------------------------------------------------------- */

/**
 * Check a TOTP code or a recovery code for a user mid-sign-in.
 *
 * Accepts either: a six-digit authenticator code, or one of the `XXXXX-XXXXX-
 * XXXXX` recovery codes, which is consumed on use.
 */
export async function verifySecondFactor(userId: string, code: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    throw unauthorized('Multi-factor authentication is not enabled for this account', 'MFA_INVALID');
  }

  const trimmed = code.trim().toUpperCase();

  /* --- Recovery code path --- */
  if (trimmed.includes('-')) {
    const stored = user.mfaRecoveryCodes ?? [];

    for (const digest of stored) {
      if (await verifyPassword(digest, trimmed)) {
        // Single use: remove it so the same slip of paper cannot be replayed.
        await db
          .update(users)
          .set({ mfaRecoveryCodes: stored.filter((entry) => entry !== digest) })
          .where(eq(users.id, user.id));

        logger.warn({ userId: user.id }, 'MFA recovery code consumed');
        return user;
      }
    }

    throw unauthorized('That recovery code is not valid', 'MFA_INVALID');
  }

  /* --- Authenticator code path --- */
  const result = await verifyTotp({
    token: trimmed,
    secret: decrypt(user.mfaSecret),
    afterTimeStep: user.mfaLastTimeStep,
  });

  if (!result.valid) {
    throw unauthorized('That code is not valid', 'MFA_INVALID');
  }

  // Record the consumed step so the same code cannot be used again.
  if (result.timeStep != null) {
    await db
      .update(users)
      .set({ mfaLastTimeStep: result.timeStep })
      .where(eq(users.id, user.id));
  }

  return user;
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: Date;
}

/** Create a session row and mint the token trio for it. */
export async function issueSession(
  user: User,
  context: { ipAddress: string; userAgent: string },
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();

  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      expiresAt,
      lastUsedAt: new Date(),
    })
    .returning({ id: sessions.id });

  if (!session) {
    throw new AppError(500, 'INTERNAL', 'Failed to start session');
  }

  const accessToken = await signAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: session.id,
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return {
    accessToken,
    refreshToken,
    csrfToken: randomToken(24),
    sessionId: session.id,
    expiresAt,
  };
}

/**
 * Exchange a refresh token for a new pair, rotating the stored token.
 *
 * Rotation plus replay detection: if a token that was already rotated is
 * presented again, that means it was captured, so every session for the user is
 * revoked rather than just refusing this one request.
 */
export async function rotateSession(
  refreshToken: string,
  context: { ipAddress: string; userAgent: string },
): Promise<{ session: IssuedSession; user: User }> {
  const tokenHash = hashRefreshToken(refreshToken);

  const [existing] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!existing) {
    throw unauthorized('Session expired. Please sign in again');
  }

  if (existing.revokedAt) {
    logger.warn(
      { userId: existing.userId, sessionId: existing.id },
      'Reuse of a rotated refresh token detected, revoking all sessions for this account',
    );
    await revokeAllSessions(existing.userId);
    throw unauthorized('Session expired. Please sign in again');
  }

  if (existing.expiresAt <= new Date()) {
    throw unauthorized('Session expired. Please sign in again');
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, existing.userId), isNull(users.deletedAt)))
    .limit(1);

  if (!user) {
    throw unauthorized('Session expired. Please sign in again');
  }
  if (user.status === 'suspended') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }

  const next = await issueSession(user, context);

  await db
    .update(sessions)
    .set({ revokedAt: new Date(), replacedBy: next.sessionId })
    .where(eq(sessions.id, existing.id));

  return { session: next, user };
}

export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return revoked.length > 0;
}

/**
 * Revoke every session and invalidate every outstanding access token.
 *
 * Marking the session rows alone is not enough: access tokens are stateless and
 * would stay valid until they expired. Pushing `tokensValidFrom` forward is
 * what makes sign-out take effect immediately.
 */
export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        ...(exceptSessionId ? [sql`${sessions.id} <> ${exceptSessionId}`] : []),
      ),
    );

  if (!exceptSessionId) {
    await db.update(users).set({ tokensValidFrom: new Date() }).where(eq(users.id, userId));
  }
}

export async function listSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(sql`${sessions.lastUsedAt} DESC NULLS LAST`);
}

/** Housekeeping: drop rows that can no longer authenticate anything. */
export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < now() - interval '7 days'`)
    .returning({ id: sessions.id });

  return deleted.length;
}

/* -------------------------------------------------------------------------- */
/* Password changes                                                           */
/* -------------------------------------------------------------------------- */

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw unauthorized();

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw unauthorized('Your current password is incorrect', 'INVALID_CREDENTIALS');
  }

  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw new AppError(400, 'BAD_REQUEST', 'Your new password must be different from the current one');
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      updatedAt: new Date(),
      // Invalidate access tokens issued before this moment.
      tokensValidFrom: new Date(),
    })
    .where(eq(users.id, userId));

  // Sign out other devices: a password change is the standard response to
  // suspecting compromise, so leaving other sessions alive would defeat it.
  await revokeAllSessions(userId, keepSessionId);
}

/* -------------------------------------------------------------------------- */
/* MFA enrolment                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Step one of enrolment: generate a secret and store it encrypted, but leave
 * `mfaEnabled` false. The account is only switched over in `confirmMfaEnrolment`
 * once a working code proves the authenticator was actually set up. Otherwise
 * a mistyped setup would lock the user out of their own account.
 */
export async function beginMfaEnrolment(userId: string): Promise<string> {
  const [user] = await db
    .select({ mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw unauthorized();
  if (user.mfaEnabled) {
    throw conflict('Multi-factor authentication is already enabled');
  }

  const secret = await generateTotpSecret();

  await db
    .update(users)
    .set({ mfaSecret: encrypt(secret) })
    .where(eq(users.id, userId));

  return secret;
}

export async function confirmMfaEnrolment(
  userId: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user?.mfaSecret) {
    throw new AppError(400, 'BAD_REQUEST', 'Start multi-factor setup before confirming it');
  }
  if (user.mfaEnabled) {
    throw conflict('Multi-factor authentication is already enabled');
  }

  const result = await verifyTotp({ token: code, secret: decrypt(user.mfaSecret) });
  if (!result.valid) {
    throw unauthorized('That code is not valid. Check your authenticator app', 'MFA_INVALID');
  }

  const plainCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const hashedCodes = await Promise.all(plainCodes.map((entry) => hashPassword(entry)));

  await db
    .update(users)
    .set({
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      mfaRecoveryCodes: hashedCodes,
      mfaLastTimeStep: result.timeStep ?? null,
    })
    .where(eq(users.id, userId));

  // Returned once, in this response only. They are stored hashed, so they
  // cannot be shown again.
  return { recoveryCodes: plainCodes };
}

/**
 * Turn MFA off. Requires the password, and a current code when one can still be
 * produced. Otherwise a hijacked session could quietly strip the second factor.
 */
export async function disableMfa(
  userId: string,
  password: string,
  code?: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw unauthorized();

  if (!user.mfaEnabled) {
    throw conflict('Multi-factor authentication is not enabled');
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    throw unauthorized('Your password is incorrect', 'INVALID_CREDENTIALS');
  }

  if (code) {
    await verifySecondFactor(userId, code);
  } else {
    throw new AppError(
      400,
      'MFA_REQUIRED',
      'Enter a code from your authenticator app, or a recovery code, to disable MFA',
    );
  }

  await db
    .update(users)
    .set({
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: null,
      mfaEnrolledAt: null,
      mfaLastTimeStep: null,
    })
    .where(eq(users.id, userId));
}

export async function regenerateRecoveryCodes(
  userId: string,
  password: string,
): Promise<string[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw unauthorized();

  if (!user.mfaEnabled) {
    throw conflict('Multi-factor authentication is not enabled');
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw unauthorized('Your password is incorrect', 'INVALID_CREDENTIALS');
  }

  const plainCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const hashedCodes = await Promise.all(plainCodes.map((entry) => hashPassword(entry)));

  await db.update(users).set({ mfaRecoveryCodes: hashedCodes }).where(eq(users.id, userId));

  return plainCodes;
}

/* -------------------------------------------------------------------------- */
/* Root account protection                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Guard against removing the last root account.
 *
 * Deleting, suspending or demoting the only root would leave the installation
 * with no one able to reach the control panel, and no recovery path short of
 * editing the database by hand.
 */
export async function assertNotLastRoot(userId: string): Promise<void> {
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (target?.role !== 'root') return;

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'root'), isNull(users.deletedAt), eq(users.status, 'active')));

  if (count <= 1) {
    throw forbidden(
      'This is the last active root account. Promote another user to root before changing it.',
    );
  }
}
