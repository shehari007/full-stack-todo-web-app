import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ArrowRightOutlined, GithubOutlined } from '@/components/icons';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { ClosingCta } from '@/components/marketing/ClosingCta';
import { FeatureSections } from '@/components/marketing/FeatureSections';
import { Hero, type HeroAction } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { SpecsStrip } from '@/components/marketing/SpecsStrip';
import { LANDING_CSS } from '@/components/marketing/landing-styles';
import { getCurrentUser, getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/* -------------------------------------------------------------------------- */
/* Metadata                                                                   */
/* -------------------------------------------------------------------------- */

export async function generateMetadata(): Promise<Metadata> {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const { seo } = settings;

  const base = (seo.canonicalBaseUrl || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');

  return {
    /*
     * `absolute` skips the root layout's title template. The configured home
     * title already carries the site name, so the template would repeat it.
     */
    title: { absolute: seo.defaultTitle },
    description: seo.defaultDescription,
    openGraph: {
      type: 'website',
      title: seo.defaultTitle,
      description: seo.defaultDescription,
      ...(base ? { url: `${base}/` } : {}),
    },
    // A relative canonical needs the metadataBase the root layout only sets
    // when a base URL is configured; emitting one without it is invalid.
    ...(base ? { alternates: { canonical: '/' } } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Same predicate as `PublicHeader`, `PublicFooter` and `Sidebar`.
 *
 * Copied rather than imported on purpose: all three of those are `'use client'`
 * modules, and a server component importing a plain function out of one of them
 * type-checks, builds, and then throws at request time. The settings schema
 * accepts any value starting with `/` as well as an http(s) URL, so a repository
 * link can legitimately be a relative path (which must not be opened in a new
 * tab), while `//host` is off-site despite the leading slash.
 */
function isExternal(href: string): boolean {
  return /^(https?:)?\/\/|^mailto:|^tel:/i.test(href);
}

/**
 * The public landing page.
 *
 * Composed from `components/marketing` rather than written inline. The sections
 * carry a good deal of prose and five mock panels between them, and keeping the
 * lot in one file made the part that actually has to be right (the redirects at
 * the top) the hardest thing in it to find.
 */
export default async function LandingPage() {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const user = await getCurrentUser();

  // Checked before the feature flag: someone who is already signed in belongs
  // in the app whether or not the marketing page is switched on.
  if (user) redirect('/dashboard');
  if (!settings.features.publicLandingEnabled) redirect('/login');

  const { about, branding, features, footer } = settings;

  /*
   * The repository lives in two settings sections and administrators fill in
   * whichever screen they happen to open, so this reads both. That is the same
   * rule `PublicHeader` already follows. Reading only the footer's social list
   * meant an operator who filled in the About screen's repository field got a
   * "GitHub repository" row in the header while both source links on the page
   * below it silently fell back to something else.
   */
  const repositoryUrl =
    footer.social.find((entry) => entry.platform.trim().toLowerCase() === 'github')?.href.trim() ||
    about.repositoryUrl.trim();

  const primary: HeroAction = {
    ...(features.registrationEnabled
      ? { href: '/register', label: 'Create a free account' }
      : { href: '/login', label: 'Sign in' }),
    icon: <ArrowRightOutlined aria-hidden="true" />,
  };

  /*
   * The source is the honest second action for an open-source project, but the
   * repository link is a setting and may not be filled in. Without it the
   * secondary action points at the first feature section, which is where an
   * undecided visitor was going next anyway.
   */
  const secondary: HeroAction = repositoryUrl
    ? {
        href: repositoryUrl,
        label: 'Read the source',
        external: isExternal(repositoryUrl),
        icon: <GithubOutlined aria-hidden="true" />,
      }
    : { href: '#feature-tasks', label: 'See what it does' };

  // Real data in the pill rather than a slogan, but only the version the
  // operator has chosen to publish.
  const eyebrow =
    about.showVersion && about.version
      ? `Version ${about.version}${about.releaseChannel ? ` · ${about.releaseChannel}` : ''}`
      : 'Open-source task management';

  const brandVars = {
    '--tf-brand': branding.primaryColor,
    '--tf-brand-accent': branding.accentColor,
    '--tf-lp-radius': `${Math.max(branding.borderRadius, 8)}px`,
  } as React.CSSProperties;

  return (
    <div className="tf-lp" style={brandVars}>
      <style href="tf-landing" precedence="medium">
        {LANDING_CSS}
      </style>

      <PublicHeader settings={settings} />

      <main id="main">
        <Hero
          siteName={branding.siteName}
          tagline={branding.tagline}
          eyebrow={eyebrow}
          primary={primary}
          secondary={secondary}
        />

        <FeatureSections siteName={branding.siteName} />

        <HowItWorks />

        <SpecsStrip />

        <ClosingCta
          siteName={branding.siteName}
          primary={primary}
          source={
            repositoryUrl
              ? { href: repositoryUrl, external: isExternal(repositoryUrl) }
              : undefined
          }
        />
      </main>

      <PublicFooter settings={settings} />
    </div>
  );
}
