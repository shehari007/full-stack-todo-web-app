/**
 * Analytics and consent routes: `/api/analytics/*`
 *
 * Consent lives here rather than in its own module because it is the gate on
 * everything else in this file: the collector cannot be reasoned about without
 * the endpoint that grants it permission to run.
 */
import { Router, type Request } from 'express';
import { optionalAuth, requireAuth, requirePrivileged, requireRoot } from '../../middleware/auth.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { analyticsLimiter, exportLimiter, writeLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext, requireRootContext } from '../../lib/http.js';
import { recordAudit } from '../../lib/audit.js';
import { getSettings } from '../../lib/settings.js';
import {
  collectEventSchema,
  consentSchema,
  personalAnalyticsQuerySchema,
  summaryQuerySchema,
  tokenUsageQuerySchema,
  type PersonalAnalyticsQuery,
  type SummaryQuery,
  type TokenUsageQuery,
} from './analytics.schemas.js';
import * as service from './analytics.service.js';

const router: Router = Router();

/* -------------------------------------------------------------------------- */
/* Collection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Public ingestion endpoint.
 *
 * `optionalAuth` attaches `req.auth` when the visitor happens to be signed in,
 * which is what lets the admin-traffic exclusion work; it never rejects, since
 * most callers here are anonymous by design.
 *
 * The two success codes are deliberate: 202 means the event was stored, 204
 * means every rule was applied and nothing was written. A client cannot tell
 * *which* rule declined it (that would hand a tracker a way to probe the
 * visitor's settings), but an operator testing their own install can see at a
 * glance whether collection is live.
 */
router.post(
  '/collect',
  analyticsLimiter,
  optionalAuth,
  validate({ body: collectEventSchema }),
  asyncHandler(async (req, res) => {
    const outcome = await service.collectEvent(req, req.body);
    res.status(outcome === 'recorded' ? 202 : 204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  '/summary',
  requireAuth,
  requirePrivileged,
  validate({ query: summaryQuerySchema }),
  // The generic widens `req` to the shape `validate({ query })` actually leaves
  // behind. Express 5 makes `req.query` a getter, so the parsed value is stashed
  // beside it rather than replacing it.
  asyncHandler<Request & { _validatedQuery?: unknown }>(async (req, res) => {
    const summary = await service.getSummary(validatedQuery<SummaryQuery>(req));
    res.status(200).json({ summary });
  }),
);

/**
 * The whole installation, for an operator. Traffic as `/summary` reports it,
 * plus the figures that only make sense at that scale: active users, weekly
 * retention, storage growth, export and upload volume.
 */
router.get(
  '/installation',
  requireAuth,
  requirePrivileged,
  validate({ query: summaryQuerySchema }),
  asyncHandler(async (req, res) => {
    const installation = await service.getInstallationAnalytics(validatedQuery<SummaryQuery>(req));
    res.status(200).json({ installation });
  }),
);

/**
 * The summary as a downloadable CSV.
 *
 * Metered by `exportLimiter` and audited as `data.export` like every other
 * download, which is not bookkeeping for its own sake: `exportVolume` on the
 * installation report is counted from those audit entries, so an export that
 * skipped the trail would be an export that never happened.
 */
router.get(
  '/summary.csv',
  requireAuth,
  requirePrivileged,
  exportLimiter,
  validate({ query: summaryQuerySchema }),
  asyncHandler(async (req, res) => {
    const summary = await service.getSummary(validatedQuery<SummaryQuery>(req));
    const csv = service.summaryToCsv(summary);

    await recordAudit(req, {
      action: 'data.export',
      targetType: 'analytics_summary',
      metadata: {
        format: 'csv',
        from: summary.range.from,
        to: summary.range.to,
        granularity: summary.range.granularity,
      },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.setHeader('Content-Length', csv.buffer.byteLength);
    // A snapshot of live figures. No browser or intermediary should keep it.
    res.setHeader('Cache-Control', 'no-store, private');

    res.status(200).send(csv.buffer);
  }),
);

/* -------------------------------------------------------------------------- */
/* Personal reporting                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own productivity. Available to every signed-in user, and scoped
 * to them in SQL. There is no id in the path to tamper with.
 */
router.get(
  '/me',
  requireAuth,
  validate({ query: personalAnalyticsQuerySchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const analytics = await service.getPersonalAnalytics(
      auth.userId,
      validatedQuery<PersonalAnalyticsQuery>(req),
    );

    // Personal and derived from live data; a shared cache must never hold it.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ analytics });
  }),
);

/** Daily request counts for the caller's own personal access tokens. */
router.get(
  '/tokens',
  requireAuth,
  validate({ query: tokenUsageQuerySchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const usage = await service.getTokenUsage(auth.userId, validatedQuery<TokenUsageQuery>(req));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ usage });
  }),
);

/* -------------------------------------------------------------------------- */
/* Retention                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Run the retention purge on demand. The scheduled job calls the same service
 * function, so this changes when data disappears, never whether it does.
 */
router.post(
  '/purge',
  requireAuth,
  requireRoot,
  asyncHandler(async (req, res) => {
    // The route middleware already restricts this to root; the assertion is
    // repeated at the point of use because the operation is irreversible.
    requireRootContext(req);

    const { retentionDays, cutoff } = await service.retentionCutoff();
    const deletedCount = await service.purgeExpiredEvents();

    await recordAudit(req, {
      action: 'analytics.purge',
      targetType: 'analytics_events',
      metadata: { deletedCount, retentionDays, cutoff: cutoff.toISOString() },
    });

    res.status(200).json({
      purge: { deletedCount, retentionDays, cutoff: cutoff.toISOString() },
    });
  }),
);

/* -------------------------------------------------------------------------- */
/* Consent                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Record a choice. Public, because the banner is answered before anyone signs
 * in; `optionalAuth` links the record to the account when there is one, so a
 * signed-in visitor's consent follows them to their next device.
 */
router.post(
  '/consent',
  writeLimiter,
  optionalAuth,
  validate({ body: consentSchema }),
  asyncHandler(async (req, res) => {
    const legal = await getSettings('legal');
    const { categories, anonymousId } = req.body;

    // The version is read from settings, never accepted from the client: it is
    // the claim that a specific published text was shown, and only the server
    // knows which text that was.
    const stored = await service.recordConsent(req, {
      categories,
      policyVersion: legal.policyVersion,
      userId: req.auth?.userId ?? null,
      anonymousId: anonymousId ?? null,
    });

    service.writeConsentCookie(res, {
      analytics: stored.analytics,
      preferences: stored.preferences,
      policyVersion: legal.policyVersion,
    });

    res.status(200).json({
      consent: {
        categories: stored,
        policyVersion: legal.policyVersion,
        activePolicyVersion: legal.policyVersion,
        reconsentRequired: false,
      },
    });
  }),
);

router.get(
  '/consent',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const hadCookie = service.readConsentCookie(req) !== null;
    const consent = await service.getConsentState(req);

    /*
     * Restore the cookie when a signed-in visitor has a stored record but no
     * cookie: a new device, or one where site data was cleared.
     *
     * Without this the two halves of the module disagree: `getConsentState`
     * answers from the database and reports `reconsentRequired: false`, so the
     * banner correctly stays hidden, but `/collect` reads *only* the cookie and
     * therefore declines every event as `no_consent`. The visitor is never asked
     * again and collection never resumes, with nothing in the response to tell
     * the client that anything is wrong.
     *
     * Re-issuing is not a new decision being made on the visitor's behalf: the
     * `consent_records` row is the evidence, and the cookie is only this
     * browser's copy of it. A record against a superseded policy is deliberately
     * not restored. That one has to go back through the banner.
     */
    if (
      !hadCookie &&
      consent.categories &&
      consent.policyVersion !== null &&
      consent.policyVersion === consent.activePolicyVersion
    ) {
      service.writeConsentCookie(res, {
        analytics: consent.categories.analytics,
        preferences: consent.categories.preferences,
        policyVersion: consent.policyVersion,
      });
    }

    // Per-caller and cookie-dependent, so it must never be held by a shared cache.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ consent });
  }),
);

export default router;
