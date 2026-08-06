/**
 * API route table. Everything below is mounted under `/api`.
 */
import { Router } from 'express';
import { requireAuth, requirePrivileged, enforceMfaPolicy } from './middleware/auth.js';

import authRoutes from './modules/auth/auth.routes.js';
import todoRoutes from './modules/todos/todos.routes.js';
import attachmentRoutes from './modules/attachments/attachments.routes.js';
import profileRoutes from './modules/profile/profile.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import exportRoutes from './modules/exports/exports.routes.js';
import tokenRoutes from './modules/tokens/tokens.routes.js';
import publicApiRoutes from './modules/public/public.routes.js';
import supportRoutes from './modules/support/support.routes.js';
import contactRoutes from './modules/support/contact.routes.js';

const router: Router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* Public routes, no session required. */
router.use('/auth', authRoutes);
router.use('/settings', settingsRoutes);
router.use('/analytics', analyticsRoutes);

/*
 * The contact form. Public because the whole point is that someone with no
 * account (or someone locked out of theirs) can still reach the operator.
 * `optionalAuth` has already run in `createApp`, so the router can still tell a
 * signed-in sender from a guest without asking for a session.
 */
router.use('/contact', contactRoutes);

/* Authenticated. */
router.use('/todos', requireAuth, todoRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/profile', requireAuth, profileRoutes);
router.use('/exports', requireAuth, exportRoutes);
router.use('/tokens', requireAuth, tokenRoutes);

/*
 * The support desk. Not behind `requirePrivileged`, because every signed-in
 * user has a ticket list here, and the staff queue is a `scope` the router
 * refuses to anyone who is not root or admin.
 */
router.use('/support', requireAuth, supportRoutes);

/*
 * Versioned read API for personal access tokens. Deliberately not behind
 * `requireAuth`: it accepts a token and refuses a session cookie, which is what
 * lets it carry its own wildcard CORS policy. That reasoning is written out in
 * the router itself.
 */
router.use('/v1', publicApiRoutes);

/*
 * Control panel. `enforceMfaPolicy` sits here rather than globally so that when
 * an installation turns on "require MFA for administrators", the affected users
 * can still reach their own security settings to enrol.
 */
router.use('/admin', requireAuth, requirePrivileged, enforceMfaPolicy, adminRoutes);

export default router;
