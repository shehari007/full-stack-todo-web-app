'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { App as AntApp, ConfigProvider, theme as antTheme } from 'antd';
import type { BrandingSettings } from '@/types/api';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  /** The mode actually in effect, with `system` already resolved. */
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeMode(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode must be used inside ThemeProvider');
  }
  return context;
}

export const THEME_STORAGE_KEY = 'taskflow-theme';

/**
 * Runs before first paint to apply the stored theme.
 *
 * Without this the page renders light, then flips to dark once React hydrates:
 * a white flash on every load for dark-mode users. Inlining it in <head> is the
 * only way to beat the first paint.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
    var dark = stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({
  branding,
  children,
}: {
  branding: BrandingSettings;
  children: React.ReactNode;
}) {
  /*
   * Starts at 'system' on both server and client so the markup matches during
   * hydration; the real stored value is read in the effect below. The inline
   * script above has already painted the correct colours, so this never shows.
   */
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setModeState(stored);
    }
    setSystemDark(systemPrefersDark());

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  /**
   * Ant Design tokens, seeded from the CMS branding section so an administrator
   * can restyle the whole app without touching code.
   */
  const antdTheme = useMemo(
    () => ({
      algorithm: resolved === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      token: {
        colorPrimary: branding.primaryColor,
        colorSuccess: branding.accentColor,
        colorInfo: branding.primaryColor,
        borderRadius: branding.borderRadius,
        fontFamily:
          "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      components: {
        Layout: {
          bodyBg: resolved === 'dark' ? '#0f1117' : '#f6f7f9',
          headerBg: resolved === 'dark' ? '#161923' : '#ffffff',
          siderBg: resolved === 'dark' ? '#161923' : '#ffffff',
        },
        Card: { borderRadiusLG: branding.borderRadius + 4 },
        Modal: { borderRadiusLG: branding.borderRadius + 4 },
        Button: { controlHeight: 38, fontWeight: 500 },
        Input: { controlHeight: 40 },
        Select: { controlHeight: 40 },
        Table: { headerBg: resolved === 'dark' ? '#1c2030' : '#fafafa' },
      },
    }),
    [resolved, branding.primaryColor, branding.accentColor, branding.borderRadius],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {/* AntdRegistry collects Ant Design's generated CSS during SSR so the
          server-rendered HTML is already styled. Without it the first paint is
          unstyled markup. */}
      <AntdRegistry>
        <ConfigProvider theme={antdTheme}>
          {/* Provides the App.useApp() context that message/notification/modal
              hooks require; the static antd.message API does not pick up theme
              tokens. */}
          <AntApp>{children}</AntApp>
        </ConfigProvider>
      </AntdRegistry>
    </ThemeContext.Provider>
  );
}
