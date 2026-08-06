'use client';

import { useMemo } from 'react';
import { useThemeMode } from '@/providers/ThemeProvider';

/**
 * Chart colours for the control panel.
 *
 * Deliberately *not* the CMS brand colours. An operator can set `primaryColor`
 * to anything, including two hues a deuteranope cannot tell apart, and a chart
 * whose only encoding is colour would then be unreadable, whereas a button in
 * an unfortunate colour is merely ugly. These three are a validated categorical
 * set: every pair clears the colour-vision separation floor against both the
 * light and the dark surface, in this order. Series are assigned by slot index
 * and never cycled, so adding or removing a series never repaints the others.
 *
 * Past three categories, fold the tail into "Other" (the neutral below) rather
 * than reaching for a fourth hue.
 */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70'] as const;

export interface ChartTheme {
  /** Categorical slots, in fixed order. */
  series: readonly string[];
  /** For "Other" buckets and for marks that carry no identity. */
  neutral: string;
  grid: string;
  axis: string;
  surface: string;
  border: string;
  /** Ready to spread onto a recharts `<Tooltip contentStyle>`. */
  tooltipStyle: React.CSSProperties;
  isDark: boolean;
}

/** Slot lookup that degrades to the neutral instead of wrapping around. */
export function seriesColor(theme: ChartTheme, slot: number): string {
  return theme.series[slot] ?? theme.neutral;
}

export function useChartTheme(): ChartTheme {
  const { resolved } = useThemeMode();
  const isDark = resolved === 'dark';

  return useMemo<ChartTheme>(() => {
    const surface = isDark ? '#1c2030' : '#ffffff';
    const border = isDark ? '#272b3a' : '#e5e7eb';

    return {
      series: isDark ? SERIES_DARK : SERIES_LIGHT,
      neutral: isDark ? '#6b7484' : '#9ca3af',
      // Grid and axes recede: they are scaffolding, not data.
      grid: border,
      axis: isDark ? '#9aa3b2' : '#6b7280',
      surface,
      border,
      tooltipStyle: {
        background: surface,
        border: `1px solid ${border}`,
        borderRadius: 10,
        color: isDark ? '#e8eaed' : '#111827',
        boxShadow: isDark
          ? '0 8px 32px rgb(0 0 0 / 0.45)'
          : '0 8px 32px rgb(0 0 0 / 0.10)',
        fontSize: 13,
      },
      isDark,
    };
  }, [isDark]);
}
