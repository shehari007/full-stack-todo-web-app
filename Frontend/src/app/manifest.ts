import type { MetadataRoute } from 'next';
import { getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * Web app manifest, so TaskFlow can be installed to a home screen.
 * Name and theme colour follow the CMS branding section.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { branding, seo } = (await getPublicSettings()) ?? FALLBACK_SETTINGS;

  return {
    name: branding.siteName,
    short_name: branding.siteName.slice(0, 12),
    description: seo.defaultDescription,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: branding.primaryColor,
    orientation: 'portrait-primary',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/logo192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
