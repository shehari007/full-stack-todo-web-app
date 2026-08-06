'use client';

/*
 * A client component despite rendering static markup: `@ant-design/icons` calls
 * `createContext` at module scope, which is not available in a server component
 * and fails the build with "createContext is not a function". The footer also
 * embeds Logo, which reads the theme, so it would need the client boundary
 * regardless.
 */
import Link from 'next/link';
import { Tag, theme } from 'antd';
import {
  BehanceOutlined,
  DiscordOutlined,
  DribbbleOutlined,
  FacebookOutlined,
  GithubOutlined,
  GitlabOutlined,
  GlobalOutlined,
  InstagramOutlined,
  LinkOutlined,
  LinkedinOutlined,
  MailOutlined,
  MastodonFilled,
  MediumOutlined,
  RedditOutlined,
  SlackOutlined,
  TelegramFilled,
  ThreadsFilled,
  TikTokOutlined,
  TwitterOutlined,
  XOutlined,
  YoutubeOutlined,
} from '@/components/icons';
import { Logo } from '@/components/brand/Logo';
import { ConsentPreferencesButton } from '@/components/layout/ConsentPreferencesButton';
import type { PublicSettings } from '@/types/api';

/*
 * Elements rather than component references: the icons take no props here, and
 * storing them as ReactNode keeps the map free of the icon library's generic
 * prop types, which do not narrow cleanly through a Record.
 */
const SOCIAL_ICONS: Record<string, React.ReactNode> = {
  behance: <BehanceOutlined />,
  discord: <DiscordOutlined />,
  dribbble: <DribbbleOutlined />,
  email: <MailOutlined />,
  facebook: <FacebookOutlined />,
  github: <GithubOutlined />,
  gitlab: <GitlabOutlined />,
  instagram: <InstagramOutlined />,
  linkedin: <LinkedinOutlined />,
  mail: <MailOutlined />,
  mastodon: <MastodonFilled />,
  medium: <MediumOutlined />,
  reddit: <RedditOutlined />,
  slack: <SlackOutlined />,
  telegram: <TelegramFilled />,
  threads: <ThreadsFilled />,
  tiktok: <TikTokOutlined />,
  twitter: <TwitterOutlined />,
  website: <GlobalOutlined />,
  x: <XOutlined />,
  youtube: <YoutubeOutlined />,
};

const CSS = `
.tf-pf__top {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2rem 1.5rem;
  padding-bottom: 2rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--tf-border-subtle);
}
/* Two columns before four: at tablet widths a 1.7fr brand column plus three
   link columns leaves the link labels wrapping mid-word. */
@media (min-width: 640px) {
  .tf-pf__top { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* The tagline needs the full row; halved it breaks after three words. */
  .tf-pf__brand { grid-column: 1 / -1; }
}
@media (min-width: 1024px) {
  .tf-pf__top { grid-template-columns: 1.7fr repeat(3, minmax(0, 1fr)); gap: 2rem; }
  .tf-pf__brand { grid-column: auto; }
}

.tf-pf__brand { min-width: 0; max-width: 34rem; }
.tf-pf__tagline { margin: 0.75rem 0 0; font-size: 0.9375rem; line-height: 1.6; max-width: 42ch; }
.tf-pf__version {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 1.1rem 0 0;
  font-size: 0.8125rem;
  color: var(--tf-text-subtle);
  font-variant-numeric: tabular-nums;
}
.tf-pf__social {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}
.tf-pf__social a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--tf-border);
  border-radius: 10px;
  color: var(--tf-text-muted);
  font-size: 1rem;
  text-decoration: none;
  transition: color 140ms ease, border-color 140ms ease;
}
.tf-pf__social a:hover,
.tf-pf__social a:focus-visible { color: var(--tf-text); border-color: var(--tf-text-subtle); }

.tf-pf__col { min-width: 0; }
.tf-pf__heading {
  margin: 0 0 0.6rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--tf-text-subtle);
}
.tf-pf__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tf-pf__link,
.tf-pf__linkbtn {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  font-size: 0.9375rem;
  color: var(--tf-text-muted);
  text-decoration: none;
  transition: color 140ms ease;
}
.tf-pf__link:hover,
.tf-pf__link:focus-visible,
.tf-pf__linkbtn:hover,
.tf-pf__linkbtn:focus-visible { color: var(--tf-text); }
/* The consent control has to be a <button> because it opens a dialog, but it
   belongs to a list of links, so it is reset to match them. */
.tf-pf__linkbtn {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
/* An admin-entered href that is neither a path nor http(s) is shown as its
   label only (see isSafeHref). */
.tf-pf__dead { display: inline-flex; align-items: center; min-height: 32px; font-size: 0.9375rem; color: var(--tf-text-subtle); }
/* A fingertip needs more than a cursor does; 40px is the WCAG 2.2 target-size
   minimum, applied only where there is no fine pointer to keep the desktop
   columns from stretching to twice their height. */
@media (pointer: coarse) {
  .tf-pf__link,
  .tf-pf__linkbtn,
  .tf-pf__dead { min-height: 40px; }
  .tf-pf__social a { width: 40px; height: 40px; }
}

.tf-pf__extra { margin-bottom: 1.25rem; }
.tf-pf .tf-footer__links { font-size: 0.9375rem; }

.tf-pf__bottom { gap: 0.75rem 1.5rem; font-size: 0.875rem; }
.tf-pf__legal { display: flex; flex-wrap: wrap; gap: 0.15rem 1.25rem; min-width: 0; }
.tf-pf__legal p { margin: 0; }
.tf-pf__status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--tf-text-muted);
}
.tf-pf__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tf-pf-status);
}
`;

/**
 * Whether the href leaves the app, so it needs `target`/`rel` and a plain <a>.
 *
 * Protocol-relative on purpose: `//host` passes the server's `safeUrl` (it
 * starts with `/`) but is not ours, so it must never reach `next/link` as an
 * internal route.
 */
function isExternal(href: string): boolean {
  return /^(https?:)?\/\/|^mailto:|^tel:/i.test(href);
}

/**
 * Mirrors `safeUrl` in `Server/src/config/settings.ts`: a relative path or an
 * absolute http(s) URL, nothing else.
 *
 * The API already rejects anything else on write, but rows written by an older
 * version were never re-validated, so a `javascript:` href could still be
 * sitting in the settings table. Repeating the check here means the worst case
 * is a link that renders as inert text rather than stored XSS on every page.
 */
function isSafeHref(href: string): boolean {
  return href.startsWith('/') || /^https?:\/\//i.test(href);
}

/** Ignores case and a trailing slash, which are the two ways the same destination gets typed twice. */
function normalizeHref(href: string): string {
  const trimmed = href.trim().toLowerCase();
  return trimmed.length > 1 && trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

interface FooterLink {
  label: string;
  href: string;
}

function FooterLinkItem({ link }: { link: FooterLink }) {
  if (!isSafeHref(link.href)) {
    return (
      <li>
        <span className="tf-pf__dead">{link.label}</span>
      </li>
    );
  }

  return (
    <li>
      {isExternal(link.href) ? (
        <a
          className="tf-pf__link"
          href={link.href}
          target="_blank"
          // noreferrer as well as noopener: without it the target page learns
          // which of our pages sent the visitor.
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      ) : (
        <Link className="tf-pf__link" href={link.href}>
          {link.label}
        </Link>
      )}
    </li>
  );
}

function FooterColumn({
  title,
  links,
  children,
}: {
  title: string;
  links: readonly FooterLink[];
  children?: React.ReactNode;
}) {
  return (
    <nav className="tf-pf__col" aria-label={title}>
      <h2 className="tf-pf__heading">{title}</h2>
      <ul className="tf-pf__list">
        {links.map((link) => (
          // Keyed on the label too: nothing stops two entries pointing at the
          // same URL, and the href alone would collide.
          <FooterLinkItem key={`${link.label}-${link.href}`} link={link} />
        ))}
        {children}
      </ul>
    </nav>
  );
}

export function PublicFooter({ settings }: { settings: PublicSettings }) {
  const { about, branding, features, footer, legal } = settings;
  const { token } = theme.useToken();

  const holder = footer.copyrightHolder.trim() || branding.siteName;
  /*
   * Rendered from the server's clock. The page is already dynamic (it reads the
   * session), so there is no cached copy left holding last year's notice.
   */
  const copyright = footer.copyrightTemplate
    .replaceAll('{year}', String(new Date().getFullYear()))
    .replaceAll('{holder}', holder);

  const version = about.version.trim();
  // Administrators type it both ways; prefixing unconditionally gives "vv2.1.0".
  const versionLabel = /^v/i.test(version) ? version : `v${version}`;

  const productLinks: FooterLink[] = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Tasks', href: '/tasks' },
    /* Gated on the same flags the features themselves are: a footer that
       advertises Analytics on an installation where it is switched off sends
       people to a screen that is not there. */
    ...(features.analyticsEnabled ? [{ label: 'Analytics', href: '/analytics' }] : []),
    // Exports are a menu on the task list, not a route of their own.
    ...(features.exportsEnabled ? [{ label: 'Exports', href: '/tasks' }] : []),
    { label: 'Features', href: '/#features' },
    { label: 'How it works', href: '/#how-it-works' },
  ];

  /* The three about URLs are optional in the CMS: an empty string means the
     operator has no such page, not that it should render pointing at "". */
  const developerLinks: FooterLink[] = [
    { label: 'API documentation', href: about.documentationUrl },
    { label: 'Personal access tokens', href: '/settings/tokens' },
    { label: 'Changelog', href: about.changelogUrl },
    { label: 'GitHub', href: about.repositoryUrl },
  ].filter((link) => link.href.trim() !== '');

  const companyLinks: FooterLink[] = [
    { label: 'Contact', href: '/contact' },
    { label: 'Support', href: about.supportUrl },
    { label: 'Privacy', href: '/legal/privacy' },
    { label: 'Terms', href: '/legal/terms' },
    { label: 'Cookies', href: '/legal/cookies' },
  ].filter((link) => link.href.trim() !== '');

  /*
   * The CMS list is additive, not a replacement, but its shipped default is
   * Privacy/Terms/Cookies, which the Company column now covers. Rendering both
   * would print those three twice on a stock installation, so anything the
   * fixed columns already link to is dropped and only an operator's own
   * additions survive.
   */
  const fixedHrefs = new Set(
    [...productLinks, ...developerLinks, ...companyLinks].map((link) => normalizeHref(link.href)),
  );
  const extraLinks = footer.links.filter((link) => !fixedHrefs.has(normalizeHref(link.href)));

  /*
   * The dot reports the one piece of service state the footer actually holds:
   * the operator's maintenance flag, which is what makes the API serve 503 to
   * everyone but root. It is not an uptime probe and does not pretend to be,
   * hence "normal" rather than "operational", and no link to a status page we
   * do not run.
   */
  const underMaintenance = features.maintenanceMode;

  const socialLinks = footer.social.filter((entry) => isSafeHref(entry.href));

  return (
    <footer className="tf-footer tf-pf">
      <style href="tf-public-footer" precedence="medium">
        {CSS}
      </style>

      <div className="tf-container">
        <div className="tf-pf__top">
          <div className="tf-pf__brand">
            <Logo branding={branding} />
            <p className="tf-pf__tagline tf-muted">{branding.tagline}</p>

            {about.showVersion && version ? (
              <p className="tf-pf__version">
                <span>{versionLabel}</span>
                {about.releaseChannel ? (
                  <Tag variant="filled" style={{ marginInlineEnd: 0, fontSize: '0.6875rem' }}>
                    {about.releaseChannel}
                  </Tag>
                ) : null}
              </p>
            ) : null}

            {socialLinks.length > 0 ? (
              <ul className="tf-pf__social">
                {socialLinks.map((entry) => {
                  const key = entry.platform.trim().toLowerCase();
                  return (
                    <li key={`${key}-${entry.href}`}>
                      <a
                        href={entry.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${branding.siteName} on ${entry.platform}`}
                      >
                        <span aria-hidden="true">
                          {SOCIAL_ICONS[key] ?? <LinkOutlined />}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Developers" links={developerLinks} />

          <FooterColumn title="Policies" links={companyLinks}>
            {/* Pointless without the banner mounted: the event would have no
                listener and the button would look broken. */}
            {legal.cookieBannerEnabled ? (
              <li>
                <ConsentPreferencesButton className="tf-pf__linkbtn" />
              </li>
            ) : null}
          </FooterColumn>
        </div>

        {extraLinks.length > 0 ? (
          <nav className="tf-pf__extra" aria-label="More from this site">
            <ul className="tf-footer__links">
              {extraLinks.map((link) => (
                <FooterLinkItem key={`${link.label}-${link.href}`} link={link} />
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="tf-footer__inner tf-pf__bottom">
          <div className="tf-pf__legal">
            <p className="tf-muted">{copyright}</p>
            {footer.creditLine ? <p className="tf-muted">{footer.creditLine}</p> : null}
          </div>

          <p
            className="tf-pf__status"
            style={
              {
                '--tf-pf-status': underMaintenance ? token.colorWarning : token.colorSuccess,
              } as React.CSSProperties
            }
          >
            {/* The dot is decoration: the state is in the text beside it, so
                nothing depends on telling amber from green. */}
            <span className="tf-pf__dot" aria-hidden="true" />
            {underMaintenance ? 'Maintenance in progress' : 'All systems normal'}
          </p>
        </div>
      </div>
    </footer>
  );
}
