'use client';

import { Button, Dropdown, type MenuProps } from 'antd';
import { CheckOutlined, DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useThemeMode, type ThemeMode } from '@/providers/ThemeProvider';

const MODE_META: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  light: { label: 'Light', icon: <SunOutlined /> },
  dark: { label: 'Dark', icon: <MoonOutlined /> },
  system: { label: 'Match system', icon: <DesktopOutlined /> },
};

/* A Record keyed by ThemeMode rather than an array, so the lookups below are
   total and need no undefined guard under noUncheckedIndexedAccess. */
const MODE_ORDER: ThemeMode[] = ['light', 'dark', 'system'];

export function ThemeToggle() {
  const { mode, resolved, setMode } = useThemeMode();

  const items: MenuProps['items'] = MODE_ORDER.map((value) => ({
    key: value,
    icon: MODE_META[value].icon,
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {MODE_META[value].label}
        {/* A tick as well as the selected-row tint: the tint alone is colour
            carrying meaning, which fails for anyone who cannot see it. */}
        {value === mode ? <CheckOutlined aria-hidden="true" /> : null}
      </span>
    ),
  }));

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items,
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => setMode(key as ThemeMode),
      }}
    >
      <Button
        type="text"
        shape="circle"
        // The icon reports what is on screen right now; the label reports which
        // setting produced it, because "Match system" and "Dark" look identical.
        icon={resolved === 'dark' ? <MoonOutlined /> : <SunOutlined />}
        aria-label={`Change theme (currently ${MODE_META[mode].label})`}
        aria-haspopup="menu"
      />
    </Dropdown>
  );
}
