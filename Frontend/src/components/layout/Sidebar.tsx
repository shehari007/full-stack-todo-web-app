'use client';

import { useId, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import useSWR from 'swr';
import { Badge, Tag, Tooltip, theme } from 'antd';
import {
  ApiOutlined,
  AreaChartOutlined,
  BgColorsOutlined,
  CheckSquareOutlined,
  ControlOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileProtectOutlined,
  FileSearchOutlined,
  FlagOutlined,
  GithubOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  LinkOutlined,
  MessageOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Logo } from '@/components/brand/Logo';
import { swrFetcher } from '@/lib/api';
import { UNREAD_COUNT_KEY } from '@/components/support/ticket-meta';
import { useAuth } from '@/providers/AuthProvider';
import type { AboutSettings, BrandingSettings } from '@/types/api';

/* -------------------------------------------------------------------------- */
/* Navigation model                                                           */
/* -------------------------------------------------------------------------- */

interface NavEntry {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Match this href only, never its children. See `isActive`. */
  exact?: boolean;
  /** The settings section this screen edits; see `ADMIN_READ_ONLY_SECTIONS`. */
  section?: string;
  /** Carries the support desk's unread-reply count. See `useSupportUnread`. */
  showUnreadBadge?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  entries: readonly NavEntry[];
}

const WORKSPACE_GROUP: NavGroup = {
  id: 'workspace',
  label: 'Workspace',
  entries: [
    { href: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
    { href: '/tasks', label: 'Tasks', icon: <CheckSquareOutlined /> },
    { href: '/analytics', label: 'My analytics', icon: <LineChartOutlined /> },
  ],
};

const ACCOUNT_GROUP: NavGroup = {
  id: 'account',
  label: 'Account',
  entries: [
    { href: '/profile', label: 'Profile', icon: <UserOutlined /> },
    {
      href: '/support',
      label: 'Support',
      icon: <CustomerServiceOutlined />,
      showUnreadBadge: true,
    },
    { href: '/settings/tokens', label: 'API tokens', icon: <ApiOutlined /> },
    { href: '/settings/security', label: 'Security', icon: <SafetyCertificateOutlined /> },
  ],
};

const ADMIN_GROUP: NavGroup = {
  id: 'administration',
  label: 'Administration',
  entries: [
    // `/admin` is a prefix of every other entry here, so it must match exactly or
    // the Overview row lights up on all eleven screens.
    { href: '/admin', label: 'Overview', icon: <ControlOutlined />, exact: true },
    { href: '/admin/users', label: 'Users', icon: <TeamOutlined /> },
    // A different icon from the Account group's "Support" row on purpose: that
    // row is the reader's own tickets; this one is everybody's.
    { href: '/admin/support', label: 'Support queue', icon: <InboxOutlined /> },
    { href: '/admin/analytics', label: 'Analytics', icon: <AreaChartOutlined /> },
    { href: '/admin/branding', label: 'Branding', icon: <BgColorsOutlined /> },
    { href: '/admin/seo', label: 'SEO', icon: <GlobalOutlined /> },
    { href: '/admin/legal', label: 'Legal', icon: <FileProtectOutlined /> },
    { href: '/admin/footer', label: 'Footer', icon: <LinkOutlined /> },
    { href: '/admin/about', label: 'About', icon: <InfoCircleOutlined />, section: 'about' },
    { href: '/admin/limits', label: 'Limits', icon: <DatabaseOutlined />, section: 'limits' },
    { href: '/admin/features', label: 'Features', icon: <FlagOutlined />, section: 'features' },
    {
      href: '/admin/support-settings',
      label: 'Support settings',
      icon: <MessageOutlined />,
      section: 'support',
    },
    { href: '/admin/audit', label: 'Audit log', icon: <FileSearchOutlined /> },
  ],
};

const BASE_GROUPS: readonly NavGroup[] = [WORKSPACE_GROUP, ACCOUNT_GROUP];

/**
 * The screens a delegated `admin` may open but not save.
 *
 * These rows stay navigable. `GET /api/admin/settings` carries `requirePrivileged`
 * and nothing more, so an admin can read every section; only the write is
 * reserved, by `assertMaySetSection` (via `isRootOnlySetting`) inside
 * `PUT /api/admin/settings/:key`. There is no `requireRoot` on that route.
 * `AboutForm`, `LimitsForm` and `FeaturesForm` each already render themselves
 * disabled with a "Read-only for your account" notice for exactly this viewer,
 * so hiding the rows would strand three screens that were built to be read.
 * The tag is the advance warning that the save will not be theirs to make.
 *
 * This is a usability property, not a boundary: an admin who edits their role in
 * devtools gets the tag removed and a 403 when they save.
 *
 * The same convention is written down as `ROOT_ONLY_SECTIONS` in
 * `components/admin/permissions.ts`, which the Limits and Features pages cite in
 * prose but nothing imports. That copy predates `about` getting the same
 * read-only treatment, so it is the shorter list; if the two are ever merged,
 * this is the one that matches what the three forms actually do.
 *
 * `analytics` is root-only server-side as well but is deliberately absent: that
 * screen is a report a delegated admin is meant to read in full, and only the
 * retention form inside it is gated, so tagging the whole row would overstate it.
 *
 * `support` is the one entry where the tag understates what happens: that screen
 * refuses a delegated admin outright rather than rendering itself disabled,
 * because its anti-abuse thresholds are policy rather than copy. The tag is
 * still the right advance warning: the row is reserved for root either way.
 */
const ADMIN_READ_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  'about',
  'support',
  'limits',
  'features',
]);

function isActive(pathname: string, entry: NavEntry): boolean {
  if (entry.exact) return pathname === entry.href;
  return pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}

function isReadOnlyFor(entry: NavEntry, isRoot: boolean): boolean {
  if (isRoot || entry.section === undefined) return false;
  return ADMIN_READ_ONLY_SECTIONS.has(entry.section);
}

/**
 * Footer and credit URLs are admin-editable and `safeUrl` in the settings schema
 * accepts either an absolute http(s) URL or a relative path. The shipped
 * `documentationUrl` default is the internal `/docs/api`.
 *
 * Same predicate as `PublicFooter`, and protocol-relative on purpose: `//host`
 * passes `safeUrl` (it starts with `/`) but is not ours, so it must not be
 * handed to `next/link` as an internal route.
 */
function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\/|^mailto:|^tel:/i.test(href);
}

/**
 * How many of the reader's own tickets have a staff reply they have not opened.
 *
 * The sidebar is mounted twice at once (the desktop rail and the mobile drawer,
 * which is `forceRender`ed), so both copies subscribe to one SWR key and share a
 * single request rather than issuing two.
 *
 * Polled rather than pushed: a reply that lands while the tab is open should
 * turn up without a reload, but this is a badge, not a chat, and a minute of
 * staleness costs nothing. `enabled` is false when the desk is switched off,
 * which stops the poll rather than merely hiding its result.
 */
function useSupportUnread(enabled: boolean): number {
  const { data } = useSWR<{ count: number }>(enabled ? UNREAD_COUNT_KEY : null, swrFetcher, {
    refreshInterval: 60_000,
  });

  return data?.count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Exported rather than rendered here: the sidebar is mounted twice at once (the
 * desktop sider and the mobile drawer, which is `forceRender`ed), and the shell
 * injects this once for both.
 *
 * Accent colours come in as custom properties set from the Ant Design token, not
 * as literals, so they follow the primary colour an administrator picks in
 * Branding, and follow it into dark mode, where the token algorithm produces a
 * different tint for the same brand colour.
 */
export const SIDEBAR_CSS = `
.tf-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.tf-nav__head {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  padding: 1.25rem 1rem 1.1rem;
  text-align: center;
  border-bottom: 1px solid var(--tf-border);
}
.tf-nav__head .tf-brand { flex-direction: column; gap: 0; }
.tf-nav__head .tf-brand__mark { width: 40px; height: 40px; border-radius: 12px; }
.tf-nav__brand-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.tf-nav__title {
  font-size: 1.05rem;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--tf-text);
  overflow-wrap: anywhere;
}
.tf-nav__subtitle {
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--tf-text-muted);
  overflow-wrap: anywhere;
}

.tf-nav__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 0.85rem 0.6rem;
}
.tf-nav__group { position: relative; }
.tf-nav__group-label {
  margin: 0 0 0.4rem;
  padding-inline: 0.7rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--tf-text-subtle);
}
.tf-nav__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tf-nav__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 40px;
  padding: 0.4rem 0.7rem 0.4rem 0.85rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  line-height: 1.25;
  color: var(--tf-text-muted);
  text-decoration: none;
  transition: background-color 140ms ease, color 140ms ease;
}
a.tf-nav__item:hover {
  background: var(--tf-nav-hover-bg);
  color: var(--tf-text);
}
.tf-nav__item--active,
a.tf-nav__item--active:hover {
  background: var(--tf-nav-accent-bg);
  color: var(--tf-nav-accent);
  font-weight: 600;
}
/* The bar, not the tint, is what marks the current page: a background alone is
   colour carrying meaning, which is lost to anyone who cannot distinguish it. */
.tf-nav__item--active::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  top: 50%;
  width: 3px;
  height: 60%;
  transform: translateY(-50%);
  border-radius: 0 3px 3px 0;
  background: var(--tf-nav-accent);
}
/* Carries what the "Root" tag means to a screen reader, which cannot see a
   gold pill, and is the only carrier of it while the rail is collapsed. */
.tf-nav__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.tf-nav__icon {
  display: inline-flex;
  flex: none;
  font-size: 1rem;
}
.tf-nav__label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tf-nav__foot {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--tf-border);
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--tf-text-muted);
}
.tf-nav__version {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.tf-nav__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem;
  margin-inline-start: -0.4rem;
}
.tf-nav__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  font-size: 0.95rem;
  color: var(--tf-text-muted);
  transition: background-color 140ms ease, color 140ms ease;
}
.tf-nav__link:hover {
  background: var(--tf-nav-hover-bg);
  color: var(--tf-nav-accent);
}
.tf-nav__credit { margin: 0; }
.tf-nav__credit a { color: var(--tf-nav-accent); text-decoration: none; }
.tf-nav__credit a:hover { text-decoration: underline; }

/* Collapsed: icons only. Labels stay in the DOM so the accessible name of every
   row survives, and the tooltip is what restores them on screen. */
.tf-nav--collapsed .tf-nav__head,
.tf-nav--collapsed .tf-nav__body,
.tf-nav--collapsed .tf-nav__foot { padding-inline: 0.5rem; }
.tf-nav--collapsed .tf-nav__item { justify-content: center; padding-inline: 0.5rem; gap: 0; }
.tf-nav--collapsed .tf-nav__label,
.tf-nav--collapsed .tf-nav__group-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.tf-nav--collapsed .tf-nav__group + .tf-nav__group {
  padding-top: 0.9rem;
  border-top: 1px solid var(--tf-border-subtle);
}
.tf-nav--collapsed .tf-nav__foot { align-items: center; }
.tf-nav--collapsed .tf-nav__version,
.tf-nav--collapsed .tf-nav__credit { display: none; }
.tf-nav--collapsed .tf-nav__links { flex-direction: column; margin-inline-start: 0; }
`;

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

function NavRow({
  entry,
  active,
  collapsed,
  readOnly,
  unreadCount,
  onNavigate,
}: {
  entry: NavEntry;
  active: boolean;
  collapsed: boolean;
  /** Openable, but this viewer cannot save it. See `ADMIN_READ_ONLY_SECTIONS`. */
  readOnly: boolean;
  /** Only meaningful for an entry with `showUnreadBadge`; zero renders nothing. */
  unreadCount: number;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      className={`tf-nav__item${active ? ' tf-nav__item--active' : ''}`}
      href={entry.href}
      // Clicking the row you are already on produces no route change, so the
      // drawer would stay open on top of the page it just "navigated" to.
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
    >
      <span className="tf-nav__icon" aria-hidden="true">
        {entry.icon}
      </span>
      <span className="tf-nav__label">{entry.label}</span>

      {unreadCount > 0 ? (
        <>
          {/* `count` renders nothing at zero, so the badge appears only when
              there is something to report. The hidden text below is what says
              so in words, and is the only carrier while the rail is collapsed
              and the pill is the sole thing left beside the icon. */}
          <Badge count={unreadCount} overflowCount={99} size="small" aria-hidden="true" />
          <span className="tf-nav__sr">
            ({unreadCount} unread {unreadCount === 1 ? 'reply' : 'replies'})
          </span>
        </>
      ) : null}

      {readOnly ? (
        <>
          {/* The tag is decoration for the accessible name. The hidden text
              below says the same thing in words, and survives the collapse. */}
          {collapsed ? null : (
            <Tooltip title="Only the root account can save changes to this section.">
              <Tag
                color="gold"
                variant="filled"
                aria-hidden="true"
                style={{ marginInlineEnd: 0, fontSize: '0.625rem' }}
              >
                Root
              </Tag>
            </Tooltip>
          )}
          <span className="tf-nav__sr">(read-only for your account)</span>
        </>
      ) : null}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Tooltip
          placement="right"
          title={
            readOnly
              ? `${entry.label} (read-only for your account)`
              : unreadCount > 0
                ? `${entry.label} (${unreadCount} unread ${unreadCount === 1 ? 'reply' : 'replies'})`
                : entry.label
          }
        >
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

export interface SidebarProps {
  branding: BrandingSettings;
  about: AboutSettings;
  /** Desktop icons-only mode. The drawer copy is never collapsed. */
  collapsed?: boolean;
  /** Distinguishes the two mounted copies for screen readers. */
  navLabel: string;
  onNavigate?: () => void;
}

export function Sidebar({
  branding,
  about,
  collapsed = false,
  navLabel,
  onNavigate,
}: SidebarProps) {
  const { isPrivileged, isRoot, settings } = useAuth();
  const { token } = theme.useToken();
  const pathname = usePathname();
  // Both copies are in the DOM at once, so the group-label ids they point
  // `aria-labelledby` at have to be unique per instance.
  const uid = useId();

  /*
   * `ticketsEnabled` is a newer flag, so an API on an older build answers
   * /settings/public without it. Read through an optional shape and default to
   * on, the same way `about` falls back above. Linking to a desk an operator has
   * switched off would strand people on a screen that only 404s.
   */
  const ticketsEnabled =
    (settings.features as { ticketsEnabled?: boolean }).ticketsEnabled !== false;

  const supportUnread = useSupportUnread(ticketsEnabled);

  const groups = useMemo(() => {
    const base = ticketsEnabled
      ? BASE_GROUPS
      : BASE_GROUPS.map((group) =>
          group.id === 'account'
            ? { ...group, entries: group.entries.filter((entry) => entry.href !== '/support') }
            : group,
        );

    return isPrivileged ? [...base, ADMIN_GROUP] : base;
  }, [isPrivileged, ticketsEnabled]);

  const links = useMemo(
    () =>
      [
        { href: about.repositoryUrl, label: 'Source code', icon: <GithubOutlined /> },
        { href: about.documentationUrl, label: 'Documentation', icon: <ReadOutlined /> },
        { href: about.changelogUrl, label: 'Changelog', icon: <HistoryOutlined /> },
      ].filter((link) => link.href.trim() !== ''),
    [about.repositoryUrl, about.documentationUrl, about.changelogUrl],
  );

  const version = about.version.trim();
  // Administrators type it both ways; prefixing unconditionally gives "vv2.1.0".
  const versionLabel = /^v/i.test(version) ? version : `v${version}`;

  const marker = '{author}';
  const markerAt = about.creditTemplate.indexOf(marker);
  const creditBefore =
    markerAt === -1 ? about.creditTemplate : about.creditTemplate.slice(0, markerAt);
  const creditAfter = markerAt === -1 ? '' : about.creditTemplate.slice(markerAt + marker.length);

  return (
    <div
      className={`tf-nav${collapsed ? ' tf-nav--collapsed' : ''}`}
      style={
        {
          '--tf-nav-accent': token.colorPrimary,
          '--tf-nav-accent-bg': token.colorPrimaryBg,
          '--tf-nav-hover-bg': token.colorFillTertiary,
        } as React.CSSProperties
      }
    >
      <div className="tf-nav__head">
        {/* The mark stays visible when collapsed: it is the only thing tying the
            icon rail back to the site it belongs to. */}
        <Logo branding={branding} href="/dashboard" showName={false} />

        {collapsed ? null : (
          <span className="tf-nav__brand-text">
            <span className="tf-nav__title">{branding.siteName}</span>
            {about.sidebarSubtitle ? (
              <span className="tf-nav__subtitle">{about.sidebarSubtitle}</span>
            ) : null}
          </span>
        )}
      </div>

      <nav className="tf-nav__body" aria-label={navLabel}>
        {groups.map((group) => {
          const labelId = `${uid}-${group.id}`;

          return (
            <div className="tf-nav__group" key={group.id}>
              <p className="tf-nav__group-label" id={labelId}>
                {group.label}
              </p>

              <ul className="tf-nav__list" aria-labelledby={labelId}>
                {group.entries.map((entry) => (
                  <NavRow
                    key={entry.href}
                    entry={entry}
                    active={isActive(pathname, entry)}
                    collapsed={collapsed}
                    readOnly={isReadOnlyFor(entry, isRoot)}
                    unreadCount={entry.showUnreadBadge ? supportUnread : 0}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="tf-nav__foot">
        {about.showVersion && version ? (
          <span className="tf-nav__version">
            {versionLabel}
            {about.releaseChannel ? (
              <Tag variant="filled" style={{ marginInlineEnd: 0, fontSize: '0.625rem' }}>
                {about.releaseChannel}
              </Tag>
            ) : null}
          </span>
        ) : null}

        {links.length > 0 ? (
          <span className="tf-nav__links">
            {/* Keyed on the label too: nothing stops an administrator pointing
                two of these at the same URL, and the href alone would collide. */}
            {links.map((link) => (
              <Tooltip key={`${link.label}-${link.href}`} placement="top" title={link.label}>
                {isExternalHref(link.href) ? (
                  <a
                    className="tf-nav__link"
                    href={link.href}
                    aria-label={link.label}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.icon}
                  </a>
                ) : (
                  <Link className="tf-nav__link" href={link.href} aria-label={link.label}>
                    {link.icon}
                  </Link>
                )}
              </Tooltip>
            ))}
          </span>
        ) : null}

        {about.showCredits && about.creditTemplate.trim() ? (
          <p className="tf-nav__credit">
            {creditBefore}
            {/* A template with no `{author}` is rendered verbatim. The setting
                is documented as literal text, so this is an editorial choice. */}
            {markerAt === -1 ? null : !about.authorUrl ? (
              about.authorName
            ) : isExternalHref(about.authorUrl) ? (
              <a href={about.authorUrl} target="_blank" rel="noopener noreferrer">
                {about.authorName}
              </a>
            ) : (
              <Link href={about.authorUrl}>{about.authorName}</Link>
            )}
            {creditAfter}
          </p>
        ) : null}
      </div>
    </div>
  );
}
