'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Collapse, Drawer, Dropdown } from 'antd';
import {
  ApiOutlined,
  AuditOutlined,
  CheckSquareOutlined,
  ControlOutlined,
  DownOutlined,
  FilePdfOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  GithubOutlined,
  MailOutlined,
  MenuOutlined,
  PaperClipOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useAuth } from '@/providers/AuthProvider';
import type { PublicSettings } from '@/types/api';

/* -------------------------------------------------------------------------- */
/* Navigation model                                                           */
/* -------------------------------------------------------------------------- */

interface MenuEntry {
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  /**
   * The destination is behind the session wall.
   *
   * Rows carrying this are dropped for a signed-out reader rather than rendered
   * and left to bounce: `(app)/layout.tsx` redirects to a bare `/login` that
   * keeps no record of what was asked for, so the reader lands on a sign-in form
   * with no way back to the page they clicked.
   */
  requiresAuth?: boolean;
}

interface MenuGroup {
  id: string;
  label: string;
  entries: readonly MenuEntry[];
}

/**
 * Anchors are absolute rather than bare fragments so the same header works on
 * the legal pages, where `#feature-tasks` would scroll to nothing.
 *
 * The ids are set on the feature cards in `app/page.tsx`.
 */
const PRODUCT_GROUP: MenuGroup = {
  id: 'product',
  label: 'Product',
  entries: [
    {
      label: 'Task management',
      description: 'Priorities, due dates, tags and ordering you control.',
      href: '/#feature-tasks',
      icon: <CheckSquareOutlined />,
    },
    {
      label: 'File attachments',
      description: 'Documents stored in your own database, beside the task.',
      href: '/#feature-attachments',
      icon: <PaperClipOutlined />,
    },
    {
      label: 'Professional exports',
      description: 'Typeset PDF reports, plus CSV, XLSX and calendar files.',
      href: '/#feature-exports',
      icon: <FilePdfOutlined />,
    },
    {
      label: 'Multi-factor security',
      description: 'TOTP, recovery codes and one-tap session revocation.',
      href: '/#feature-security',
      icon: <SafetyCertificateOutlined />,
    },
    {
      label: 'Admin console',
      description: 'Branding, policy, flags and quotas without a redeploy.',
      href: '/#feature-admin',
      icon: <ControlOutlined />,
    },
  ],
};

const COMPANY_GROUP: MenuGroup = {
  id: 'policies',
  label: 'Policies',
  entries: [
    {
      label: 'Contact',
      description: 'Questions, bug reports and support requests.',
      href: '/contact',
      icon: <MailOutlined />,
    },
    {
      label: 'Privacy',
      description: 'What is collected, why, and for how long it is kept.',
      href: '/legal/privacy',
      icon: <FileProtectOutlined />,
    },
    {
      label: 'Terms',
      description: 'The agreement covering your use of the service.',
      href: '/legal/terms',
      icon: <FileTextOutlined />,
    },
    {
      label: 'Cookies',
      description: 'Which cookies are set and how to change your consent.',
      href: '/legal/cookies',
      icon: <AuditOutlined />,
    },
  ],
};

/** Links that carry no sub-navigation and so would make a one-item menu. */
const PLAIN_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'How it works', href: '/#how-it-works' },
];

/** Ant Design's `lg` breakpoint, the same swap point the app shell uses. */
const LG_BREAKPOINT_PX = 992;

/**
 * The bundled API reference, which lives inside the `(app)` route group and so
 * requires a session. An operator who points `about.documentationUrl` somewhere
 * else is publishing their own docs, and those are assumed to be reachable.
 */
const IN_APP_DOCS_PATH = '/docs/api';

/**
 * Same predicate as `PublicFooter` and `Sidebar`.
 *
 * Protocol-relative on purpose: `//host` passes the settings schema's URL check
 * because it starts with `/`, but it is not ours, so it must never be handed to
 * `next/link` as an internal route.
 */
function isExternal(href: string): boolean {
  return /^(https?:)?\/\/|^mailto:|^tel:/i.test(href);
}

/**
 * An anchor into the marketing page.
 *
 * The header also runs on `/legal/*` and `/contact`, which stay public when
 * `publicLandingEnabled` is off, and with it off, `/` redirects to `/login`.
 * Every one of these would then be a nav row that signs the reader out of what
 * they were reading and onto a form, so they are dropped instead.
 */
function isLandingAnchor(href: string): boolean {
  return href.startsWith('/#');
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The desktop/mobile swap is a media query rather than antd's `useBreakpoint`.
 * That hook reports nothing until after mount, so a desktop visitor would see
 * the hamburger version painted first and watch it rearrange on hydration.
 *
 * Drawer and dropdown rules are unscoped: both render into a portal at the end
 * of the document, outside the `.tf-ph` subtree.
 */
const CSS = `
.tf-shell__header.tf-ph {
  background: color-mix(in srgb, var(--tf-surface) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  /* A rule across a page that has not been scrolled reads as a seam in the
     design rather than as an edge; it only means something once there is
     content passing underneath. */
  border-bottom-color: transparent;
  transition: border-color 180ms ease;
}
.tf-shell__header.tf-ph--scrolled { border-bottom-color: var(--tf-border); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tf-shell__header.tf-ph { background: var(--tf-surface); }
}

.tf-ph__inner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  max-width: 1200px;
  min-height: 68px;
  margin-inline: auto;
}

.tf-ph__nav {
  display: none;
  min-width: 0;
  margin-inline-start: clamp(0.5rem, 2vw, 1.5rem);
}
.tf-ph__nav ul {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* One rule for the trigger buttons and the plain links so a <button> and an <a>
   sitting next to each other are indistinguishable. */
.tf-ph__trigger,
.tf-ph__link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.7rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--tf-text-muted);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: color 140ms ease, background-color 140ms ease;
}
.tf-ph__trigger:hover,
.tf-ph__trigger:focus-visible,
.tf-ph__link:hover,
.tf-ph__link:focus-visible,
.tf-ph__trigger[aria-expanded='true'] {
  color: var(--tf-text);
  background: var(--tf-border-subtle);
}
.tf-ph__chevron { font-size: 0.625rem; transition: transform 160ms ease; }
.tf-ph__trigger[aria-expanded='true'] .tf-ph__chevron { transform: rotate(180deg); }

.tf-ph__actions { display: flex; align-items: center; gap: 0.4rem; margin-left: auto; }
.tf-ph__cta { display: none; align-items: center; gap: 0.4rem; }
/* Two classes deep so this wins over .ant-btn regardless of which stylesheet
   the runtime injects last. */
.tf-ph .tf-ph__burger { display: inline-flex; }

@media (min-width: ${LG_BREAKPOINT_PX}px) {
  .tf-ph__nav,
  .tf-ph__cta { display: flex; }
  .tf-ph .tf-ph__burger { display: none; }
}

/* The dropdown surface is ours: antd only paints a background for its own
   Menu, and this popup renders custom content instead. */
.tf-ph__panel {
  width: min(360px, calc(100vw - 2rem));
  padding: 0.35rem;
  border: 1px solid var(--tf-border);
  border-radius: 14px;
  background: var(--tf-surface-raised);
  box-shadow: var(--tf-shadow-lg);
}

.tf-ph__row {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.55rem 0.6rem;
  border-radius: 10px;
  color: var(--tf-text);
  text-decoration: none;
  transition: background-color 140ms ease;
}
.tf-ph__row:hover,
.tf-ph__row:focus-visible { background: var(--tf-border-subtle); color: var(--tf-text); }
.tf-ph__row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--tf-border-subtle);
  background: color-mix(in srgb, var(--ant-color-primary, #4f46e5) 12%, transparent);
  font-size: 1rem;
}
.tf-ph__row-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.tf-ph__row-label { font-size: 0.9375rem; font-weight: 600; line-height: 1.35; }
.tf-ph__row-desc { font-size: 0.8125rem; line-height: 1.45; color: var(--tf-text-muted); }

.tf-ph__drawer-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.tf-ph__drawer-links { display: flex; flex-direction: column; margin-bottom: 0.25rem; }
.tf-ph__drawer-links a {
  padding: 0.7rem 0.6rem;
  border-radius: 8px;
  color: var(--tf-text);
  font-size: 0.9375rem;
  font-weight: 600;
  text-decoration: none;
}
.tf-ph__drawer-links a:hover,
.tf-ph__drawer-links a:focus-visible { background: var(--tf-border-subtle); }
.tf-ph__drawer-cta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  /* Pins the sign-up pair to the bottom of a short menu and lets it be pushed
     down by a long one, rather than floating in the middle of either. */
  margin-top: auto;
  padding-top: 1.25rem;
  border-top: 1px solid var(--tf-border);
}
`;

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

function MenuRow({
  entry,
  asMenuItem,
  onNavigate,
}: {
  entry: MenuEntry;
  /** Desktop only: inside `role="menu"`, arrow keys move focus, so Tab must not. */
  asMenuItem: boolean;
  onNavigate: () => void;
}) {
  const shared: {
    className: string;
    onClick: () => void;
    role?: 'menuitem';
    tabIndex?: number;
  } = { className: 'tf-ph__row', onClick: onNavigate };

  if (asMenuItem) {
    shared.role = 'menuitem';
    shared.tabIndex = -1;
  }

  const body = (
    <>
      <span className="tf-ph__row-icon" aria-hidden="true">
        {entry.icon}
      </span>
      <span className="tf-ph__row-text">
        <span className="tf-ph__row-label">{entry.label}</span>
        <span className="tf-ph__row-desc">{entry.description}</span>
      </span>
    </>
  );

  if (isExternal(entry.href)) {
    return (
      <a
        {...shared}
        href={entry.href}
        target="_blank"
        // noreferrer as well as noopener: without it the target page learns
        // which of our pages sent the visitor.
        rel="noopener noreferrer"
      >
        {body}
      </a>
    );
  }

  return (
    <Link {...shared} href={entry.href}>
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Desktop menu                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A menu button that opens on hover *and* on activation.
 *
 * Hover alone is not a control: it does not exist for keyboard users and it is
 * a tap-then-guess on touch. The click path is what makes the button real, and
 * the hover path is the convenience on top of it.
 */
function DesktopMenu({ group }: { group: MenuGroup }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /* Set only on the keyboard path. Pulling focus into a panel that merely
     opened under the pointer would yank the caret away mid-page. */
  const focusOnOpen = useRef(false);

  const uid = useId();
  const panelId = `${uid}-panel`;
  const triggerId = `${uid}-trigger`;

  const moveFocus = useCallback((target: 1 | -1 | 'first' | 'last') => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (target === 'first') next = 0;
    else if (target === 'last') next = items.length - 1;
    else if (current === -1) next = target === 1 ? 0 : items.length - 1;
    else next = (current + target + items.length) % items.length;

    items[next]?.focus();
  }, []);

  /**
   * The one place the open state changes.
   *
   * Every close clears `focusOnOpen`. Without that the flag survives a close
   * that happened before the focus effect could consume it (pressing Enter on
   * an already-open menu is the ordinary way to produce one), and the next open
   * inherits it. That next open is usually a hover, so the pointer would drag
   * focus into the panel: exactly what the flag exists to prevent.
   */
  const applyOpen = useCallback((next: boolean) => {
    if (!next) focusOnOpen.current = false;
    setOpen(next);
  }, []);

  const close = useCallback(
    (restoreFocus: boolean) => {
      applyOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [applyOpen],
  );

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;

    // A frame late: the popup is in the DOM on this commit but antd positions
    // it afterwards, and focusing an unplaced element scrolls the page to it.
    const frame = requestAnimationFrame(() => moveFocus('first'));
    return () => cancelAnimationFrame(frame);
  }, [open, moveFocus]);

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open) {
        moveFocus('first');
      } else {
        focusOnOpen.current = true;
        applyOpen(true);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      // Focus is already on the trigger, so there is nothing to restore.
      close(false);
    }
  };

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus('first');
        break;
      case 'End':
        event.preventDefault();
        moveFocus('last');
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        /* The panel is portalled to the end of the document, so letting Tab
           run would jump past the whole page. Closing back onto the trigger
           puts the caret where the reader left the header. */
        event.preventDefault();
        close(true);
        break;
      default:
        break;
    }
  };

  return (
    <Dropdown
      open={open}
      onOpenChange={applyOpen}
      trigger={['hover', 'click']}
      placement="bottomLeft"
      // Remount per open, so the "focus the first item" effect fires every time
      // rather than only on the first.
      destroyOnHidden
      popupRender={() => (
        <div
          ref={panelRef}
          id={panelId}
          className="tf-ph__panel"
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onPanelKeyDown}
        >
          {group.entries.map((entry) => (
            <MenuRow
              key={entry.href}
              entry={entry}
              asMenuItem
              onNavigate={() => close(false)}
            />
          ))}
        </div>
      )}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="tf-ph__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        /* Dropdown's own handler does the toggling. This one only records how
           it was toggled: a click synthesised by Enter or Space carries
           `detail === 0`, which is the only signal separating the two paths.
           `!open` because a click on an open menu closes it, and a close has no
           panel to move focus into. */
        onClick={(event) => {
          focusOnOpen.current = event.detail === 0 && !open;
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {group.label}
        <DownOutlined className="tf-ph__chevron" aria-hidden="true" />
      </button>
    </Dropdown>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

export function PublicHeader({ settings }: { settings: PublicSettings }) {
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const { branding, footer, about, features } = settings;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    // Read once up front: a reload restores the previous scroll position, and
    // the listener would not fire until the reader moved again.
    onScroll();
    // Passive: this only sets state, never calls preventDefault, and telling
    // the browser so keeps it off the scrolling critical path.
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${LG_BREAKPOINT_PX}px)`);
    // Rotating a phone into landscape hides the hamburger. Without this the
    // drawer would stay open with no visible control left to close it.
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  /* The repository lives in two settings sections and administrators fill in
     whichever screen they happen to open, so the menu accepts either. */
  const repositoryUrl = useMemo(() => {
    const social = footer.social.find(
      (entry) => entry.platform.trim().toLowerCase() === 'github',
    );
    return (social?.href ?? '').trim() || about.repositoryUrl.trim();
  }, [footer.social, about.repositoryUrl]);

  const developersGroup = useMemo<MenuGroup>(() => {
    const documentationHref = about.documentationUrl.trim() || IN_APP_DOCS_PATH;

    const entries: MenuEntry[] = [
      {
        label: 'API documentation',
        description: 'Every endpoint, with request and response shapes.',
        href: documentationHref,
        icon: <ReadOutlined />,
        requiresAuth: documentationHref === IN_APP_DOCS_PATH,
      },
      {
        label: 'Personal access tokens',
        description: 'Read-only, scoped and revocable at any time.',
        href: '/settings/tokens',
        icon: <ApiOutlined />,
        requiresAuth: true,
      },
    ];

    // Dropped rather than rendered dead: an administrator who cleared both URL
    // settings meant for the link not to be there.
    if (repositoryUrl) {
      entries.push({
        label: 'GitHub repository',
        description: 'Read the source, file an issue, send a patch.',
        href: repositoryUrl,
        icon: <GithubOutlined />,
      });
    }

    return { id: 'developers', label: 'Developers', entries };
  }, [about.documentationUrl, repositoryUrl]);

  const landingEnabled = features.publicLandingEnabled;

  /**
   * The same rule the repository row already follows, applied to every row: one
   * that cannot be reached is dropped rather than rendered dead.
   *
   * A group left with nothing in it is dropped with it: an empty `role="menu"`
   * panel opens on hover as a small blank box and announces as a menu with no
   * items, which is worse than the missing menu it is standing in for.
   */
  const isReachable = useCallback(
    (entry: { href: string; requiresAuth?: boolean }) =>
      (isAuthenticated || !entry.requiresAuth) && (landingEnabled || !isLandingAnchor(entry.href)),
    [isAuthenticated, landingEnabled],
  );

  const groups = useMemo<readonly MenuGroup[]>(
    () =>
      [PRODUCT_GROUP, developersGroup, COMPANY_GROUP]
        .map((group) => ({ ...group, entries: group.entries.filter(isReachable) }))
        .filter((group) => group.entries.length > 0),
    [developersGroup, isReachable],
  );

  const plainLinks = useMemo(() => PLAIN_LINKS.filter(isReachable), [isReachable]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /*
   * antd Button with `href` renders a real anchor. Wrapping a <Button> in a
   * next/link would nest a <button> inside an <a>, which is invalid and breaks
   * keyboard activation in Safari.
   */
  const renderActions = (block: boolean) =>
    isAuthenticated ? (
      <Button type="primary" href="/dashboard" block={block} onClick={closeMenu}>
        Open app
      </Button>
    ) : (
      <>
        <Button
          type={block ? 'default' : 'text'}
          href="/login"
          block={block}
          onClick={closeMenu}
        >
          Sign in
        </Button>
        {features.registrationEnabled ? (
          <Button type="primary" href="/register" block={block} onClick={closeMenu}>
            Get started
          </Button>
        ) : null}
      </>
    );

  return (
    <>
      <style href="tf-public-header" precedence="medium">
        {CSS}
      </style>

      <header className={`tf-shell__header tf-ph${scrolled ? ' tf-ph--scrolled' : ''}`}>
        <div className="tf-ph__inner">
          <Logo branding={branding} />

          <nav className="tf-ph__nav" aria-label="Primary">
            <ul>
              {groups.map((group) => (
                <li key={group.id}>
                  <DesktopMenu group={group} />
                </li>
              ))}
              {plainLinks.map((link) => (
                <li key={link.href}>
                  <Link className="tf-ph__link" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="tf-ph__actions">
            <ThemeToggle />
            <div className="tf-ph__cta">{renderActions(false)}</div>
            <Button
              className="tf-ph__burger"
              type="text"
              shape="circle"
              icon={<MenuOutlined />}
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            />
          </div>
        </div>
      </header>

      {/* The title logo is deliberately not a link: it sits beside the close
          button, and two adjacent controls doing different things read as one
          target on a touch screen.

          Focus is trapped for the duration by antd's own drawer, which locks it
          to the panel whenever the mask is on, which it is by default. */}
      <Drawer
        open={menuOpen}
        onClose={closeMenu}
        placement="right"
        // Leaves a strip of mask to tap on a 360px screen, which is the only
        // way out for someone who never found the close button.
        width="min(88vw, 340px)"
        title={<Logo branding={branding} href={null} />}
        // A column so the menu can fill the panel and hold the calls to action
        // against the bottom edge; the body is the only element with a height.
        styles={{ body: { display: 'flex', flexDirection: 'column', paddingTop: '0.75rem' } }}
      >
        <div className="tf-ph__drawer-body">
          {plainLinks.length > 0 ? (
            <nav className="tf-ph__drawer-links" aria-label="Site">
              {plainLinks.map((link) => (
                <Link key={link.href} href={link.href} onClick={closeMenu}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {/* Accordion: only one section at a time, so the sign-up buttons stay
              within reach instead of being pushed off three screens down. */}
          <Collapse
            accordion
            ghost
            expandIconPlacement="end"
            styles={{
              header: { paddingInline: '0.6rem' },
              body: { paddingInline: 0, paddingBlock: 0 },
            }}
            items={groups.map((group) => ({
              key: group.id,
              label: <span style={{ fontWeight: 600 }}>{group.label}</span>,
              children: group.entries.map((entry) => (
                <MenuRow
                  key={entry.href}
                  entry={entry}
                  asMenuItem={false}
                  onNavigate={closeMenu}
                />
              )),
            }))}
          />

          <div className="tf-ph__drawer-cta">{renderActions(true)}</div>
        </div>
      </Drawer>
    </>
  );
}
