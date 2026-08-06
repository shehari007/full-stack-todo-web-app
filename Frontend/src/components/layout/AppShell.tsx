'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Button, Drawer, Dropdown, Layout, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Logo } from '@/components/brand/Logo';
import { Sidebar, SIDEBAR_CSS } from '@/components/layout/Sidebar';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useAuth } from '@/providers/AuthProvider';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';
import type { BrandingSettings, User } from '@/types/api';

const { Content, Header, Sider } = Layout;

const COLLAPSE_STORAGE_KEY = 'taskflow-sider-collapsed';

/** Ant Design's `lg` breakpoint. The sider/drawer swap happens here. */
const LG_BREAKPOINT_PX = 992;

const SIDER_WIDTH = 264;
const SIDER_COLLAPSED_WIDTH = 76;
/** Fits inside a 360px viewport with enough mask left to tap. */
const DRAWER_WIDTH = 280;

/** Portal target id for `HeaderSlot`. */
export const HEADER_SLOT_ID = 'tf-header-slot';

/*
 * Layout rules that have to be media queries rather than JS.
 *
 * The obvious implementation (`Grid.useBreakpoint()` and render either the
 * Sider or the Drawer) cannot work here: `matchMedia` does not exist during the
 * server render, so the server would always emit the desktop sider and every
 * phone would paint it for a frame before hydration tore it down. Emitting both
 * and letting CSS decide keeps the server and client markup identical, so there
 * is no mismatch and no flash.
 *
 * The double class selector is deliberate: Ant Design's own `.ant-layout-sider`
 * rules are injected at runtime and would otherwise win on source order.
 */
const SHELL_CSS = `
.tf-shell .tf-shell__sider {
  display: none;
  position: sticky;
  top: 0;
  height: 100dvh;
  /* The nav's own body scrolls, so the sider must not scroll as well: two
     nested scrollers would detach the footer from the bottom of the panel. */
  overflow: hidden;
  border-inline-end: 1px solid var(--tf-border);
}
.tf-shell .tf-shell__nav-toggle,
.tf-shell .tf-shell__header-brand { display: inline-flex; }
.tf-shell .tf-shell__collapse-toggle { display: none; }

@media (min-width: ${LG_BREAKPOINT_PX}px) {
  .tf-shell .tf-shell__sider { display: block; }
  .tf-shell .tf-shell__collapse-toggle { display: inline-flex; }
  .tf-shell .tf-shell__nav-toggle,
  .tf-shell .tf-shell__header-brand { display: none; }
}

.tf-shell .tf-shell__header {
  height: 60px;
  line-height: normal;
  padding-inline: clamp(0.75rem, 3vw, 1.5rem);
}
.tf-shell__slot {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}
.tf-shell__user-label {
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 575px) {
  .tf-shell__user-label { display: none; }
}
`;

/* -------------------------------------------------------------------------- */
/* Header slot                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Lets a page render page-specific controls (a search box, a "New task" button)
 * into the shell header without the shell having to know about any page.
 *
 * A portal rather than a context value because the content is JSX owned by the
 * page: passing it up through context would re-render the whole shell on every
 * page keystroke.
 */
export function HeaderSlot({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById(HEADER_SLOT_ID));
  }, []);

  return host ? createPortal(children, host) : null;
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

function initialsOf(user: User): string {
  const source = user.displayName?.trim() || user.username;
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * The frame for every signed-in screen, the control panel included.
 *
 * There is one shell rather than an app shell and an admin shell: the control
 * panel is a group of rows in the same sidebar, so moving between "my tasks" and
 * "everyone's users" never changes the width, the header or where anything is.
 */
export function AppShell({
  user: initialUser,
  branding,
  children,
}: {
  user: User;
  branding: BrandingSettings;
  children: React.ReactNode;
}) {
  const { user: liveUser, settings, logout } = useAuth();
  const { token } = theme.useToken();
  const pathname = usePathname();
  const router = useRouter();

  // The provider value is authoritative once the profile page edits it; the
  // server-rendered prop is what makes the first paint correct.
  const user = liveUser ?? initialUser;

  // `about` is a newer public section, so an API still running an older build
  // answers /settings/public without it. Falling back beats the whole shell
  // failing to render on a partial deploy.
  const about = settings.about ?? FALLBACK_SETTINGS.about;

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // localStorage is not available during the server render, so the stored value
  // is applied after mount rather than as the initial state.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Covers route changes the drawer's own links did not cause, such as a
  // redirect or the back button.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const userMenu: MenuProps['items'] = [
    {
      key: 'identity',
      type: 'group',
      label: (
        <span style={{ display: 'block', paddingBlock: '0.25rem', lineHeight: 1.3 }}>
          <strong style={{ display: 'block', color: token.colorText }}>
            {user.displayName?.trim() || user.username}
          </strong>
          <Typography.Text type="secondary" style={{ fontSize: '0.8125rem' }}>
            {user.email}
          </Typography.Text>
        </span>
      ),
    },
    { type: 'divider' },
    { key: '/profile', icon: <UserOutlined />, label: 'Profile' },
    { key: '/settings/tokens', icon: <ApiOutlined />, label: 'API tokens' },
    { key: '/settings/security', icon: <SafetyCertificateOutlined />, label: 'Security' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', danger: true },
  ];

  const onUserMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'logout') {
      void logout();
      return;
    }
    // Menu items are buttons rather than anchors, so the route change has to be
    // pushed by hand; `router.push` keeps it a client transition.
    router.push(key);
  };

  const avatarSrc = user.avatarId ? `/api/attachments/${user.avatarId}` : undefined;

  return (
    <Layout className="tf-shell" hasSider>
      {/*
        `href` + `precedence` so React hoists this into <head> and de-duplicates
        it, the same way every other styled component here does. Every rule that
        competes with Ant Design's runtime styles is already written as a double
        class selector, so winning on specificity rather than on source order is
        what keeps them applying from the head.
      */}
      <style href="tf-app-shell" precedence="medium">
        {SHELL_CSS + SIDEBAR_CSS}
      </style>

      <Sider
        className="tf-shell__sider"
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={SIDER_WIDTH}
        collapsedWidth={SIDER_COLLAPSED_WIDTH}
      >
        <Sidebar branding={branding} about={about} collapsed={collapsed} navLabel="Main" />
      </Sider>

      <Drawer
        placement="left"
        width={DRAWER_WIDTH}
        open={drawerOpen}
        onClose={closeDrawer}
        styles={{
          header: { padding: '0.5rem 0.75rem', borderBottom: 'none' },
          // The nav supplies its own header, footer and internal scroller.
          body: { padding: 0, overflow: 'hidden' },
        }}
        // Without this the panel does not exist until the first open, and the
        // toggle's `aria-controls` would point at nothing.
        forceRender
      >
        {/*
          Labelled apart from the sider's landmark: `forceRender` keeps both in
          the DOM, and two landmarks named "Main" is ambiguous even though only
          one is ever displayed.
        */}
        <div id="tf-mobile-nav" style={{ height: '100%' }}>
          <Sidebar
            branding={branding}
            about={about}
            navLabel="Main (mobile)"
            onNavigate={closeDrawer}
          />
        </div>
      </Drawer>

      <Layout style={{ minWidth: 0 }}>
        <Header className="tf-shell__header tf-shell__header--app">
          <Button
            className="tf-shell__nav-toggle"
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="tf-mobile-nav"
          />

          <Button
            className="tf-shell__collapse-toggle"
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          />

          <span className="tf-shell__header-brand">
            <Logo branding={branding} href="/dashboard" showName={false} />
          </span>

          <div className="tf-shell__slot" id={HEADER_SLOT_ID} />

          <ThemeToggle />

          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{ items: userMenu, onClick: onUserMenuClick }}
          >
            <Button
              type="text"
              style={{ height: 40, paddingInline: 6, display: 'inline-flex', gap: 8 }}
              aria-label={`Account menu for ${user.displayName?.trim() || user.username}`}
            >
              <Avatar size={28} src={avatarSrc} alt="">
                {avatarSrc ? null : initialsOf(user)}
              </Avatar>
              <span className="tf-shell__user-label">
                {user.displayName?.trim() || user.username}
              </span>
            </Button>
          </Dropdown>
        </Header>

        <Content className="tf-shell__content" id="main">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
