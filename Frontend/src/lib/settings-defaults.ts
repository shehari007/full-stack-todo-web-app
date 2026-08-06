import type { PublicSettings } from '@/types/api';

/**
 * Fallback settings used when the API cannot be reached.
 *
 * These mirror the defaults in `Server/src/config/settings.ts`. Duplicating
 * them is deliberate: it means the marketing pages, the legal pages and the
 * sign-in screen still render correctly while the API is restarting or during
 * a first-boot deploy where the database has not been seeded yet.
 */
export const FALLBACK_SETTINGS: PublicSettings = {
  branding: {
    siteName: 'TaskFlow',
    tagline: 'A modern, full-stack task manager built for focus.',
    logoText: 'TaskFlow',
    logoAttachmentId: null,
    logoDarkAttachmentId: null,
    faviconAttachmentId: null,
    ogImageAttachmentId: null,
    primaryColor: '#4f46e5',
    accentColor: '#10b981',
    borderRadius: 8,
  },
  seo: {
    titleTemplate: '%s · TaskFlow',
    defaultTitle: 'TaskFlow: Modern Task Management',
    defaultDescription:
      'Plan, track and finish your work. TaskFlow is an open-source task manager with file attachments, professional exports and a built-in admin console.',
    keywords: ['task manager', 'todo app', 'productivity', 'open source', 'self-hosted'],
    indexingEnabled: true,
    canonicalBaseUrl: '',
    twitterHandle: '',
    organization: {
      name: 'TaskFlow',
      legalName: '',
      email: '',
      phone: '',
      addressLine: '',
      website: '',
    },
    verification: { google: '', bing: '' },
  },
  footer: {
    creditLine: 'Built with TaskFlow, open source under the MIT licence.',
    copyrightHolder: 'TaskFlow',
    copyrightTemplate: '© {year} {holder}. All rights reserved.',
    links: [
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Cookies', href: '/legal/cookies' },
    ],
    social: [
      { platform: 'github', href: 'https://github.com/shehari007/full-stack-todo-web-app' },
    ],
  },
  legal: {
    policyVersion: '1.0',
    contactEmail: '',
    cookieBannerEnabled: true,
    cookieBannerText:
      'We use strictly necessary cookies to keep you signed in. With your permission we also record anonymous usage analytics to help improve TaskFlow.',
    privacy: { title: 'Privacy Policy', body: '', effectiveDate: '' },
    terms: { title: 'Terms of Service', body: '', effectiveDate: '' },
    cookies: { title: 'Cookie Policy', body: '', effectiveDate: '' },
  },
  about: {
    version: '2.1.0',
    releaseChannel: 'stable',
    sidebarSubtitle: 'Task management',
    showVersion: true,
    showCredits: true,
    repositoryUrl: 'https://github.com/shehari007/full-stack-todo-web-app',
    changelogUrl: 'https://github.com/shehari007/full-stack-todo-web-app/releases',
    documentationUrl: '/docs/api',
    supportUrl: 'https://github.com/shehari007/full-stack-todo-web-app/issues',
    authorName: 'Muhammad Sheharyar Butt',
    authorUrl: 'https://github.com/shehari007',
    creditTemplate: 'Built by {author}',
  },
  features: {
    registrationEnabled: true,
    requireMfaForPrivileged: false,
    attachmentsEnabled: true,
    analyticsEnabled: true,
    exportsEnabled: true,
    publicLandingEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: 'TaskFlow is undergoing scheduled maintenance.',
  },
};
