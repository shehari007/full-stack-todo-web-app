/**
 * Auth routes: `/api/auth/*`
 */
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter, mfaLimiter } from '../../middleware/rate-limit.js';
import {
  COOKIE_NAMES,
  asyncHandler,
  clearAuthCookies,
  clientIp,
  clientUserAgent,
  requireAuthContext,
  setAuthCookies,
} from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { getSettings } from '../../lib/settings.js';
import { badRequest, forbidden, unauthorized } from '../../lib/errors.js';
import { signMfaChallenge, verifyMfaChallenge } from '../../lib/tokens.js';
import { buildOtpAuthUri, renderQrCode } from '../../lib/totp.js';
import {
  changePasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerSchema,
  revokeSessionSchema,
} from './auth.schemas.js';
import * as service from './auth.service.js';

const router: Router = Router();

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

router.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const features = await getSettings('features');
    if (!features.registrationEnabled) {
      throw forbidden('Registration is currently closed on this installation');
    }

    const { username, email, password, displayName } = req.body;
    const user = await service.registerUser({ username, email, password, displayName });

    await recordAudit(req, { action: 'auth.register', targetType: 'user', targetId: user.id }, {
      id: user.id,
      username: user.username,
    });

    // Sign the new account straight in. A separate sign-in step here adds
    // friction without adding safety.
    const session = await service.issueSession(user, {
      ipAddress: clientIp(req),
      userAgent: clientUserAgent(req),
    });
    setAuthCookies(res, session, session.expiresAt);

    res.status(201).json({
      user: service.toPublicUser(user),
      accessToken: session.accessToken,
      csrfToken: session.csrfToken,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                    */
/* -------------------------------------------------------------------------- */

router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;
    const result = await service.authenticate(identifier, password);

    /* Password was right, but a second factor is still owed. */
    if (result.kind === 'mfa_required') {
      const challengeToken = await signMfaChallenge(result.user.id);
      res.status(200).json({
        mfaRequired: true,
        challengeToken,
        // Tells the client whether to offer the recovery-code field.
        methods: ['totp', 'recovery_code'],
      });
      return;
    }

    const session = await service.issueSession(result.user, {
      ipAddress: clientIp(req),
      userAgent: clientUserAgent(req),
    });
    setAuthCookies(res, session, session.expiresAt);

    await recordAudit(req, { action: 'auth.login' }, {
      id: result.user.id,
      username: result.user.username,
    });

    res.status(200).json({
      user: service.toPublicUser(result.user),
      accessToken: session.accessToken,
      csrfToken: session.csrfToken,
    });
  }),
);

/** Second step of sign-in for MFA-enabled accounts. */
router.post(
  '/mfa/verify',
  mfaLimiter,
  validate({ body: mfaVerifySchema }),
  asyncHandler(async (req, res) => {
    const { challengeToken, code } = req.body;

    const userId = await verifyMfaChallenge(challengeToken);
    const user = await service.verifySecondFactor(userId, code);

    const session = await service.issueSession(user, {
      ipAddress: clientIp(req),
      userAgent: clientUserAgent(req),
    });
    setAuthCookies(res, session, session.expiresAt);

    await recordAudit(
      req,
      { action: code.includes('-') ? 'auth.mfa_recovery_used' : 'auth.login' },
      { id: user.id, username: user.username },
    );

    res.status(200).json({
      user: service.toPublicUser(user),
      accessToken: session.accessToken,
      csrfToken: session.csrfToken,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Session lifecycle                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Exchange the refresh cookie for a fresh token pair.
 *
 * Deliberately not behind `requireAuth`: the whole point is that the access
 * token has already expired.
 */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE_NAMES.refresh];
    if (typeof token !== 'string' || !token) {
      throw unauthorized('No active session');
    }

    const { session, user } = await service.rotateSession(token, {
      ipAddress: clientIp(req),
      userAgent: clientUserAgent(req),
    });

    setAuthCookies(res, session, session.expiresAt);

    res.status(200).json({
      user: service.toPublicUser(user),
      accessToken: session.accessToken,
      csrfToken: session.csrfToken,
    });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE_NAMES.refresh];

    if (typeof token === 'string' && token) {
      // Best-effort: an already-invalid token still clears the cookies below.
      try {
        const { hashRefreshToken } = await import('../../lib/tokens.js');
        const { sessions } = await import('../../db/schema.js');
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.tokenHash, hashRefreshToken(token)));
      } catch {
        /* ignore */
      }
    }

    if (req.auth) {
      await recordAudit(req, { action: 'auth.logout' });
    }

    clearAuthCookies(res);
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);

    if (!user) throw unauthorized();
    res.status(200).json({ user: service.toPublicUser(user) });
  }),
);

router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const rows = await service.listSessions(auth.userId);

    res.status(200).json({
      sessions: rows.map((row) => ({ ...row, current: row.id === auth.sessionId })),
    });
  }),
);

router.delete(
  '/sessions/:sessionId',
  requireAuth,
  validate({ params: revokeSessionSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { sessionId } = req.params as unknown as { sessionId: string };

    const revoked = await service.revokeSession(sessionId, auth.userId);
    if (!revoked) {
      throw badRequest('That session is no longer active');
    }

    await recordAudit(req, {
      action: 'auth.session_revoked',
      targetType: 'session',
      targetId: sessionId,
    });

    if (sessionId === auth.sessionId) {
      clearAuthCookies(res);
    }
    res.status(204).end();
  }),
);

router.post(
  '/sessions/revoke-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    await service.revokeAllSessions(auth.userId);
    await recordAudit(req, { action: 'auth.logout_all' });

    clearAuthCookies(res);
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

router.post(
  '/password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { currentPassword, newPassword } = req.body;

    await service.changePassword(auth.userId, currentPassword, newPassword, auth.sessionId);
    await recordAudit(req, { action: 'auth.password_change' });

    res.status(200).json({
      message: 'Password updated. Other devices have been signed out.',
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* MFA management                                                             */
/* -------------------------------------------------------------------------- */

/** Step 1: issue a secret and the QR code to scan. */
router.post(
  '/mfa/setup',
  requireAuth,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const secret = await service.beginMfaEnrolment(auth.userId);

    const branding = await getSettings('branding');
    const uri = await buildOtpAuthUri({
      secret,
      accountLabel: auth.username,
      issuer: branding.siteName,
    });

    res.status(200).json({
      secret, // Shown so the user can enter it by hand if the camera fails.
      otpauthUri: uri,
      qrCode: await renderQrCode(uri),
    });
  }),
);

/** Step 2: prove the authenticator works, then switch MFA on. */
router.post(
  '/mfa/enable',
  requireAuth,
  mfaLimiter,
  validate({ body: mfaEnableSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { recoveryCodes } = await service.confirmMfaEnrolment(auth.userId, req.body.code);

    await recordAudit(req, { action: 'auth.mfa_enabled' });

    res.status(200).json({
      message: 'Multi-factor authentication is now enabled.',
      // Only time these are ever visible.
      recoveryCodes,
    });
  }),
);

router.post(
  '/mfa/disable',
  requireAuth,
  mfaLimiter,
  validate({ body: mfaDisableSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    // If the installation mandates MFA for staff, they may not opt out.
    if (auth.role !== 'user') {
      const features = await getSettings('features');
      if (features.requireMfaForPrivileged) {
        throw forbidden(
          'This installation requires multi-factor authentication for administrator accounts',
        );
      }
    }

    await service.disableMfa(auth.userId, req.body.password, req.body.code);
    await recordAudit(req, { action: 'auth.mfa_disabled' });

    res.status(200).json({ message: 'Multi-factor authentication has been disabled.' });
  }),
);

router.post(
  '/mfa/recovery-codes',
  requireAuth,
  mfaLimiter,
  validate({ body: mfaDisableSchema.pick({ password: true }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const recoveryCodes = await service.regenerateRecoveryCodes(auth.userId, req.body.password);

    res.status(200).json({
      message: 'New recovery codes generated. Your previous codes no longer work.',
      recoveryCodes,
    });
  }),
);

export default router;
