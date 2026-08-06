/**
 * Site settings: the schema and defaults behind the root control panel.
 *
 * Each section is a zod schema plus a default value. The schema is used twice:
 * to validate what an administrator submits, and to fill in any field missing
 * from a row that was written by an older version. That second use is what
 * makes adding a new setting safe. Existing rows simply pick up the default
 * instead of surfacing as `undefined` somewhere in the UI.
 */
import { z } from 'zod';

/** A colour the theme will consume, so it must be a literal hex value. */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour such as #4f46e5');

/**
 * Only relative paths or absolute http(s) URLs. This rejects `javascript:` and
 * `data:` URLs, which would otherwise turn an admin-editable footer link into
 * stored XSS for every visitor.
 */
const safeUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => value.startsWith('/') || /^https?:\/\//i.test(value),
    'Must be a relative path or an http(s) URL',
  );

const attachmentId = z.string().uuid().nullable();

/* -------------------------------------------------------------------------- */
/* Branding                                                                   */
/* -------------------------------------------------------------------------- */

export const brandingSchema = z.object({
  siteName: z.string().min(1).max(60),
  tagline: z.string().max(160),
  /** Shown when no logo image is set, and as the PDF export letterhead mark. */
  logoText: z.string().max(24),
  logoAttachmentId: attachmentId,
  logoDarkAttachmentId: attachmentId,
  faviconAttachmentId: attachmentId,
  ogImageAttachmentId: attachmentId,
  primaryColor: hexColor,
  accentColor: hexColor,
  /** Corner rounding in px, applied across the UI theme. */
  borderRadius: z.number().int().min(0).max(24),
});

const brandingDefaults: z.infer<typeof brandingSchema> = {
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
};

/* -------------------------------------------------------------------------- */
/* SEO                                                                        */
/* -------------------------------------------------------------------------- */

export const seoSchema = z.object({
  /** `%s` is replaced by the page title; Next.js consumes this directly. */
  titleTemplate: z.string().min(1).max(120),
  defaultTitle: z.string().min(1).max(120),
  defaultDescription: z.string().max(320),
  keywords: z.array(z.string().max(40)).max(24),
  /** Turn off while staging so a preview deploy is not indexed. */
  indexingEnabled: z.boolean(),
  canonicalBaseUrl: z.string().url().or(z.literal('')),
  twitterHandle: z.string().max(32),
  /** Emitted as JSON-LD `Organization`, and printed on PDF exports. */
  organization: z.object({
    name: z.string().max(120),
    legalName: z.string().max(160),
    email: z.string().email().or(z.literal('')),
    phone: z.string().max(40),
    addressLine: z.string().max(200),
    website: z.string().url().or(z.literal('')),
  }),
  /** Verification tokens, rendered as meta tags. Empty strings are omitted. */
  verification: z.object({
    google: z.string().max(128),
    bing: z.string().max(128),
  }),
});

const seoDefaults: z.infer<typeof seoSchema> = {
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
};

/* -------------------------------------------------------------------------- */
/* Footer and credits                                                         */
/* -------------------------------------------------------------------------- */

export const footerSchema = z.object({
  /** The credit line rendered at the bottom of every page. */
  creditLine: z.string().max(200),
  copyrightHolder: z.string().max(120),
  /** Rendered verbatim; `{year}` is substituted at render time. */
  copyrightTemplate: z.string().max(120),
  links: z
    .array(z.object({ label: z.string().min(1).max(40), href: safeUrl }))
    .max(12),
  social: z
    .array(
      z.object({
        platform: z.enum(['github', 'x', 'linkedin', 'discord', 'youtube', 'website']),
        href: safeUrl,
      }),
    )
    .max(8),
});

const footerDefaults: z.infer<typeof footerSchema> = {
  creditLine: 'Built with TaskFlow, open source under the MIT licence.',
  copyrightHolder: 'TaskFlow',
  copyrightTemplate: '© {year} {holder}. All rights reserved.',
  links: [
    { label: 'Privacy', href: '/legal/privacy' },
    { label: 'Terms', href: '/legal/terms' },
    { label: 'Cookies', href: '/legal/cookies' },
  ],
  social: [{ platform: 'github', href: 'https://github.com/shehari007/full-stack-todo-web-app' }],
};

/* -------------------------------------------------------------------------- */
/* Legal and consent                                                          */
/* -------------------------------------------------------------------------- */

const legalDocument = z.object({
  title: z.string().min(1).max(120),
  /** Markdown. Rendered with a sanitising pipeline, never as raw HTML. */
  body: z.string().max(100_000),
  effectiveDate: z.string().max(40),
});

export const legalSchema = z.object({
  /**
   * Bump this whenever a policy changes materially. Stored consent records
   * carry the version they agreed to, so visitors are re-prompted rather than
   * being silently treated as having accepted the new text.
   */
  policyVersion: z.string().min(1).max(20),
  contactEmail: z.string().email().or(z.literal('')),
  cookieBannerEnabled: z.boolean(),
  cookieBannerText: z.string().max(600),
  privacy: legalDocument,
  terms: legalDocument,
  cookies: legalDocument,
});

const legalDefaults: z.infer<typeof legalSchema> = {
  policyVersion: '1.0',
  contactEmail: '',
  cookieBannerEnabled: true,
  cookieBannerText:
    'We use strictly necessary cookies to keep you signed in. With your permission we also record anonymous usage analytics to help improve TaskFlow. You can change your choice at any time.',
  privacy: {
    title: 'Privacy Policy',
    effectiveDate: '',
    body: [
      '## Who we are',
      '',
      'This service is operated by the administrator of this TaskFlow installation. Contact details are published on this page.',
      '',
      '## What we collect',
      '',
      '- **Account data**: your username, email address and, if you provide them, a display name, biography and avatar.',
      '- **Content you create**: your tasks and any files you attach to them.',
      '- **Technical data**: the IP address and browser user-agent of each sign-in, kept so you can review and revoke your active sessions.',
      '- **Analytics**: if you consent, anonymous page-view counts. The visitor identifier is a one-way hash that is re-keyed daily and cannot be traced back to you.',
      '',
      '## Why we can use it',
      '',
      'We process account data and your content to provide the service you asked for (contract). We process security data to protect the service (legitimate interest). We process analytics only with your consent, which you may withdraw at any time.',
      '',
      '## How long we keep it',
      '',
      'Account data and content are kept until you delete your account. Analytics events are deleted automatically after the retention period configured by the administrator.',
      '',
      '## Your rights',
      '',
      'You can export all of your data from your profile page at any time, and deleting your account removes your data permanently. To exercise any other right, contact the administrator.',
      '',
      '## Third parties',
      '',
      "This installation runs no third-party advertising or tracking scripts. Files and data are stored in the operator's own PostgreSQL database.",
    ].join('\n'),
  },
  terms: {
    title: 'Terms of Service',
    effectiveDate: '',
    body: [
      '## Acceptance',
      '',
      'By creating an account you agree to these terms. If you do not agree, do not use the service.',
      '',
      '## Your account',
      '',
      'You are responsible for keeping your password confidential and for everything done through your account. Enabling multi-factor authentication is strongly recommended. Tell the administrator promptly if you believe your account has been compromised.',
      '',
      '## Acceptable use',
      '',
      "Do not use the service to store or distribute unlawful material, to infringe anyone's rights, or to attempt to gain unauthorised access to the system or to other users' data.",
      '',
      '## Your content',
      '',
      'You keep ownership of everything you create here. You grant the operator only the permission needed to store and display that content back to you.',
      '',
      '## Availability',
      '',
      'The service is provided "as is", without warranty of any kind. It may be unavailable during maintenance, and the operator is not liable for any loss arising from downtime or data loss. Keep your own backups of anything important.',
      '',
      '## Termination',
      '',
      'You may delete your account at any time. The operator may suspend accounts that breach these terms.',
      '',
      '## Changes',
      '',
      'These terms may be updated. Material changes raise the policy version, and you will be asked to review them on your next visit.',
    ].join('\n'),
  },
  cookies: {
    title: 'Cookie Policy',
    effectiveDate: '',
    body: [
      '## What we use',
      '',
      'TaskFlow sets a small number of first-party cookies. No third party can read them, and none are used for advertising.',
      '',
      '### Strictly necessary',
      '',
      '| Cookie | Purpose | Lifetime |',
      '| --- | --- | --- |',
      '| `tf_refresh` | Keeps you signed in. Marked `HttpOnly`, so scripts cannot read it. | 30 days |',
      '| `tf_csrf` | Blocks cross-site request forgery on state-changing requests. | Session |',
      '| `tf_consent` | Remembers the cookie choices you made on this banner. | 12 months |',
      '',
      'These are required for the service to function and cannot be switched off.',
      '',
      '### Analytics (optional)',
      '',
      '| Cookie | Purpose | Lifetime |',
      '| --- | --- | --- |',
      '| `tf_visitor` | A random identifier used to count unique visits. Set only if you accept analytics. | 24 hours |',
      '',
      '## Changing your mind',
      '',
      'Use the "Cookie preferences" link in the footer to review or withdraw your consent at any time. Withdrawing consent deletes the optional cookie immediately.',
    ].join('\n'),
  },
};

/* -------------------------------------------------------------------------- */
/* About: version, credits, and the sidebar identity                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything the sidebar and the "about" surfaces display.
 *
 * Kept separate from `branding` because it is versioning and attribution rather
 * than visual identity, and because it is root-only: the version string and the
 * credit links are statements about who runs and maintains the installation,
 * which a delegated moderator should not be able to rewrite.
 */
export const aboutSchema = z.object({
  /** Shown in the sidebar footer, e.g. `2.1.0`. Free text with no semver check. */
  version: z.string().max(24),
  /** `stable` | `beta` | `dev` etc. Rendered as a small tag beside the version. */
  releaseChannel: z.string().max(16),
  /** Second line under the sidebar logo. Empty hides it. */
  sidebarSubtitle: z.string().max(48),
  showVersion: z.boolean(),
  showCredits: z.boolean(),

  repositoryUrl: safeUrl.or(z.literal('')),
  changelogUrl: safeUrl.or(z.literal('')),
  documentationUrl: safeUrl.or(z.literal('')),
  supportUrl: safeUrl.or(z.literal('')),

  authorName: z.string().max(64),
  authorUrl: safeUrl.or(z.literal('')),
  /** Rendered verbatim in the sidebar footer; `{author}` is substituted. */
  creditTemplate: z.string().max(80),
});

const aboutDefaults: z.infer<typeof aboutSchema> = {
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
};

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Private section. These are the authoritative runtime limits; the environment
 * variables of the same name only seed them on first boot, so an administrator
 * can raise a quota without redeploying.
 */
export const limitsSchema = z.object({
  /** Hard ceiling per file. Files live in Postgres, so this stays modest. */
  maxUploadBytes: z.number().int().min(1024).max(10 * 1024 * 1024),
  /** Root and admin may be given a larger allowance than standard users. */
  maxUploadBytesPrivileged: z.number().int().min(1024).max(50 * 1024 * 1024),
  userStorageQuotaBytes: z.number().int().min(0),
  privilegedStorageQuotaBytes: z.number().int().min(0),
  maxAttachmentsPerTodo: z.number().int().min(0).max(50),
  maxTodosPerUser: z.number().int().min(0).max(100_000),
  /**
   * Allowlist, not a blocklist. Checked against the file's real magic bytes,
   * so renaming `payload.html` to `photo.png` does not get past it.
   */
  allowedUploadMimeTypes: z.array(z.string().max(100)).max(40),
});

const limitsDefaults: z.infer<typeof limitsSchema> = {
  maxUploadBytes: 1024 * 1024, // 1 MB
  maxUploadBytesPrivileged: 5 * 1024 * 1024, // 5 MB
  userStorageQuotaBytes: 25 * 1024 * 1024, // 25 MB
  privilegedStorageQuotaBytes: 512 * 1024 * 1024, // 512 MB
  maxAttachmentsPerTodo: 10,
  maxTodosPerUser: 5000,
  allowedUploadMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/x-icon',
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

/* -------------------------------------------------------------------------- */
/* Support desk and contact form                                              */
/* -------------------------------------------------------------------------- */

/**
 * Public section: the contact page renders this copy, and the ticket forms use
 * the same category list so an operator only maintains one.
 *
 * The anti-abuse numbers live here rather than in code so an installation under
 * a spam wave can tighten them from the control panel instead of redeploying.
 */
export const supportSchema = z.object({
  /** Shared by the public contact form and the in-app ticket composer. */
  categories: z.array(z.string().min(1).max(40)).min(1).max(12),
  contactHeading: z.string().max(80),
  contactIntro: z.string().max(600),
  /** Sets expectations on the form, e.g. "Usually within two working days". */
  responseTimeNote: z.string().max(120),
  /** Shown after a successful submission. */
  acknowledgement: z.string().max(400),

  /* --- Anti-abuse --- */
  /** Submissions allowed from one address per hour. */
  contactMaxPerHour: z.number().int().min(1).max(60),
  /**
   * Seconds a visitor must spend on the form before it will accept a
   * submission. A script posts instantly; a person cannot type a message in
   * under three seconds.
   */
  contactMinFillSeconds: z.number().int().min(0).max(60),
  contactMaxMessageLength: z.number().int().min(100).max(20_000),
  /** Turns off guest submissions entirely without hiding the page. */
  contactRequiresAccount: z.boolean(),
});

const supportDefaults: z.infer<typeof supportSchema> = {
  categories: [
    'General question',
    'Bug report',
    'Feature request',
    'Account or billing',
    'Security concern',
  ],
  contactHeading: 'Get in touch',
  contactIntro:
    'Questions, bug reports and feature ideas are all welcome. Send a message and it will land in the support queue.',
  responseTimeNote: 'Most messages are answered within two working days.',
  acknowledgement:
    'Thanks, your message is in the queue. Keep the reference number handy if you need to follow up.',
  contactMaxPerHour: 3,
  contactMinFillSeconds: 3,
  contactMaxMessageLength: 5000,
  contactRequiresAccount: false,
};

/* -------------------------------------------------------------------------- */
/* Features                                                                   */
/* -------------------------------------------------------------------------- */

export const featuresSchema = z.object({
  registrationEnabled: z.boolean(),
  /** When on, privileged accounts cannot use the app until MFA is enrolled. */
  requireMfaForPrivileged: z.boolean(),
  attachmentsEnabled: z.boolean(),
  analyticsEnabled: z.boolean(),
  exportsEnabled: z.boolean(),
  publicLandingEnabled: z.boolean(),
  /** The in-app support desk for signed-in users. */
  ticketsEnabled: z.boolean(),
  /** The public contact form. Independent, so guest submissions can be closed
   *  during a spam wave while signed-in users keep their support channel. */
  contactFormEnabled: z.boolean(),
  /** Serves a 503 to everyone except root, for deploys and migrations. */
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().max(400),
});

const featuresDefaults: z.infer<typeof featuresSchema> = {
  registrationEnabled: true,
  requireMfaForPrivileged: false,
  attachmentsEnabled: true,
  analyticsEnabled: true,
  exportsEnabled: true,
  publicLandingEnabled: true,
  ticketsEnabled: true,
  contactFormEnabled: true,
  maintenanceMode: false,
  maintenanceMessage: 'TaskFlow is undergoing scheduled maintenance. Please check back shortly.',
};

/* -------------------------------------------------------------------------- */
/* Analytics                                                                  */
/* -------------------------------------------------------------------------- */

export const analyticsSchema = z.object({
  /** Events older than this are purged by the retention job. */
  retentionDays: z.number().int().min(1).max(730),
  /** Honour the browser's `DNT: 1` header even when consent was given. */
  respectDoNotTrack: z.boolean(),
  /** Keep operators' own visits out of their numbers. */
  excludeAdminTraffic: z.boolean(),
});

const analyticsDefaults: z.infer<typeof analyticsSchema> = {
  retentionDays: 90,
  respectDoNotTrack: true,
  excludeAdminTraffic: true,
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The complete set of sections. Adding a setting means adding a field to one of
 * the schemas above and a matching default. Nothing else needs to change,
 * because the admin UI is generated from this registry.
 */
/**
 * `rootOnly` marks the sections a delegated `admin` may read but not write.
 *
 * The split is between *content* and *policy*. Branding, SEO, footer and legal
 * copy are editorial, and a moderator being able to fix a typo is the point of
 * having admins. Limits and feature flags are neither: they control storage
 * quotas, whether registration is open, whether administrators are required to
 * use MFA, and maintenance mode. An admin who could edit those could switch off
 * the MFA requirement that constrains them, or raise their own quota, which
 * makes the admin/root distinction decorative.
 */
export const SETTINGS_REGISTRY = {
  branding: { schema: brandingSchema, defaults: brandingDefaults, isPublic: true, rootOnly: false },
  seo: { schema: seoSchema, defaults: seoDefaults, isPublic: true, rootOnly: false },
  footer: { schema: footerSchema, defaults: footerDefaults, isPublic: true, rootOnly: false },
  legal: { schema: legalSchema, defaults: legalDefaults, isPublic: true, rootOnly: false },
  about: { schema: aboutSchema, defaults: aboutDefaults, isPublic: true, rootOnly: true },
  /* Public so the contact page can render its copy to signed-out visitors, but
     root-only to write: the anti-abuse thresholds live in it. */
  support: { schema: supportSchema, defaults: supportDefaults, isPublic: true, rootOnly: true },
  limits: { schema: limitsSchema, defaults: limitsDefaults, isPublic: false, rootOnly: true },
  features: { schema: featuresSchema, defaults: featuresDefaults, isPublic: true, rootOnly: true },
  analytics: {
    schema: analyticsSchema,
    defaults: analyticsDefaults,
    isPublic: false,
    rootOnly: true,
  },
} as const;

export type SettingsKey = keyof typeof SETTINGS_REGISTRY;

export type SettingsShape = {
  [K in SettingsKey]: z.infer<(typeof SETTINGS_REGISTRY)[K]['schema']>;
};

export const SETTINGS_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingsKey[];

/** Sections served to signed-out visitors. */
export const PUBLIC_SETTINGS_KEYS = SETTINGS_KEYS.filter(
  (key) => SETTINGS_REGISTRY[key].isPublic,
);

/** Sections only the root account may write. */
export const ROOT_ONLY_SETTINGS_KEYS = SETTINGS_KEYS.filter(
  (key) => SETTINGS_REGISTRY[key].rootOnly,
);

export function isRootOnlySetting(key: SettingsKey): boolean {
  return SETTINGS_REGISTRY[key].rootOnly;
}

export function defaultsFor<K extends SettingsKey>(key: K): SettingsShape[K] {
  return structuredClone(SETTINGS_REGISTRY[key].defaults) as SettingsShape[K];
}
