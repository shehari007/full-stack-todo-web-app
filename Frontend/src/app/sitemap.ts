import type { MetadataRoute } from 'next';
import { getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * Sitemap for the publicly reachable pages.
 *
 * Only marketing and legal pages are listed. Dashboard, task and admin routes
 * are behind authentication, so listing them would advertise URLs that every
 * crawler receives a redirect from, which is noise in Search Console for no
 * benefit.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const base = (settings.seo.canonicalBaseUrl || process.env.NEXT_PUBLIC_SITE_URL || '').replace(
    /\/$/,
    '',
  );

  // Without a configured base URL a sitemap of relative paths is invalid, so
  // emit nothing rather than something a crawler will reject.
  if (!base) return [];

  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    ...(settings.features.registrationEnabled
      ? [
          {
            url: `${base}/register`,
            lastModified: now,
            changeFrequency: 'yearly' as const,
            priority: 0.5,
          },
        ]
      : []),
    { url: `${base}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/legal/cookies`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
