import type { MetadataRoute } from 'next';
import { getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const base = (settings.seo.canonicalBaseUrl || process.env.NEXT_PUBLIC_SITE_URL || '').replace(
    /\/$/,
    '',
  );

  /*
   * A staging or preview deployment turns indexing off in the control panel and
   * gets a blanket disallow, so it cannot outrank or duplicate production.
   */
  if (!settings.seo.indexingEnabled) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Authenticated areas and the API return redirects or 401s to crawlers;
        // excluding them keeps crawl budget on pages that actually render.
        disallow: ['/api/', '/admin/', '/dashboard/', '/tasks/', '/profile/', '/settings/'],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
