import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider, themeInitScript } from '@/providers/ThemeProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { CookieConsent } from '@/components/consent/CookieConsent';
import { AnalyticsTracker } from '@/components/analytics/AnalyticsTracker';
import { getCurrentUser, getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  // `swap` shows fallback text immediately rather than blocking paint on the
  // webfont, which is what the "avoid invisible text" audit checks for.
  display: 'swap',
});

/**
 * Page metadata, built from the CMS at request time.
 *
 * Titles, descriptions, Open Graph images and verification tags are all
 * editable from the root control panel, so this cannot be a static object.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const { seo, branding } = settings;

  const base = seo.canonicalBaseUrl || process.env.NEXT_PUBLIC_SITE_URL || '';
  const ogImage = branding.ogImageAttachmentId
    ? `/api/attachments/${branding.ogImageAttachmentId}`
    : '/main-logo.png';

  return {
    ...(base ? { metadataBase: new URL(base) } : {}),
    title: {
      default: seo.defaultTitle,
      template: seo.titleTemplate,
    },
    description: seo.defaultDescription,
    applicationName: branding.siteName,
    keywords: seo.keywords,
    authors: [{ name: seo.organization.name || branding.siteName }],
    creator: seo.organization.name || branding.siteName,

    /*
     * Staging deployments set indexingEnabled=false so a preview never competes
     * with production in search results.
     */
    robots: seo.indexingEnabled
      ? { index: true, follow: true, googleBot: { index: true, follow: true } }
      : { index: false, follow: false, nocache: true },

    openGraph: {
      type: 'website',
      siteName: branding.siteName,
      title: seo.defaultTitle,
      description: seo.defaultDescription,
      images: [{ url: ogImage, width: 1200, height: 630, alt: branding.siteName }],
      ...(base ? { url: base } : {}),
    },

    twitter: {
      card: 'summary_large_image',
      title: seo.defaultTitle,
      description: seo.defaultDescription,
      images: [ogImage],
      ...(seo.twitterHandle ? { creator: seo.twitterHandle } : {}),
    },

    icons: {
      icon: branding.faviconAttachmentId
        ? `/api/attachments/${branding.faviconAttachmentId}`
        : '/favicon.ico',
      apple: '/logo192.png',
    },

    ...(seo.verification.google || seo.verification.bing
      ? {
          verification: {
            ...(seo.verification.google ? { google: seo.verification.google } : {}),
            ...(seo.verification.bing ? { other: { 'msvalidate.01': seo.verification.bing } } : {}),
          },
        }
      : {}),

    alternates: base ? { canonical: '/' } : undefined,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lock zoom: pinch-to-zoom is an accessibility requirement.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1117' },
  ],
};

/**
 * Serialise a value for embedding inside a `<script>` element.
 *
 * `JSON.stringify` escapes quotes and backslashes but leaves `<` alone, so a
 * value containing the literal text `</script>` closes the element early and
 * everything after it is parsed as HTML. These values come from the CMS, which
 * means an administrator could otherwise store markup that runs as script for
 * every visitor, including root, whose session that script could then use.
 *
 * Escaping `<` to its `\u003c` JSON escape is the standard fix: the parsed
 * value is byte-for-byte identical, but the text `</script>` can no longer
 * appear in the document. `\u2028` and `\u2029` are escaped for the same
 * reason: they are literal line terminators in JavaScript but legal inside a
 * JSON string.
 */
function toJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const user = await getCurrentUser();

  /** JSON-LD so search engines can render a rich result for the organisation. */
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: settings.seo.organization.name || settings.branding.siteName,
    ...(settings.seo.organization.legalName
      ? { legalName: settings.seo.organization.legalName }
      : {}),
    ...(settings.seo.organization.website ? { url: settings.seo.organization.website } : {}),
    ...(settings.seo.organization.email
      ? { contactPoint: { '@type': 'ContactPoint', email: settings.seo.organization.email } }
      : {}),
    description: settings.seo.defaultDescription,
  };

  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Must run before first paint. See themeInitScript. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: toJsonLd(organizationJsonLd) }}
        />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ThemeProvider branding={settings.branding}>
          <AuthProvider initialUser={user} settings={settings}>
            {children}
            {settings.legal.cookieBannerEnabled ? <CookieConsent legal={settings.legal} /> : null}
            {settings.features.analyticsEnabled ? <AnalyticsTracker /> : null}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
