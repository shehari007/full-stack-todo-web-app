/**
 * Public settings: `/api/settings/*`
 *
 * Unauthenticated on purpose. Next.js calls this while rendering on the server
 * to build `<title>`, Open Graph tags and the footer, which happens before any
 * visitor has a session, and for a crawler, never will.
 */
import { Router } from 'express';
import { asyncHandler } from '../../lib/http.js';
import { getAllSettings } from '../../lib/settings.js';
import { PUBLIC_SETTINGS_KEYS, type SettingsShape } from '../../config/settings.js';

const router: Router = Router();

/**
 * Only the sections flagged `isPublic` in the registry are served. The filter is
 * the registry itself rather than a list kept here, so a new private section
 * cannot be leaked by someone forgetting to update a second place. `limits` and
 * `analytics` are excluded because they describe how to attack the installation,
 * not how to render it.
 */
router.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const all = await getAllSettings();

    const settings: Partial<SettingsShape> = {};
    for (const key of PUBLIC_SETTINGS_KEYS) {
      settings[key] = all[key] as never;
    }

    // Short and public: every page render asks for this, and a stale banner
    // colour for up to a minute costs nothing next to a database round trip on
    // every request for every visitor.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ settings });
  }),
);

export default router;
