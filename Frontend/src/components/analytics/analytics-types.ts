/**
 * Wire shapes and shared chart constants for the analytics pages.
 *
 * These mirror the server's own return types verbatim:
 * `getPersonalAnalytics`, `getInstallationAnalytics` and `getTokenUsage` in
 * `Server/src/modules/analytics/analytics.service.ts`. Kept in one file for the
 * same reason `admin-types.ts` is: a divergence should be a compile error here
 * rather than `undefined` rendered into the UI.
 *
 * When editing, read the service's exported interfaces first. Every field below
 * is named the way Postgres aliases it, which is not always the name the UI
 * would have picked.
 */
import type { TodoPriority, TodoStatus } from '@/types/api';

/* -------------------------------------------------------------------------- */
/* Personal: GET /api/analytics/me?from&to&timezone                           */
/* -------------------------------------------------------------------------- */

export interface PersonalSeriesPoint {
  /** `YYYY-MM-DD`, in the report's timezone. */
  date: string;
  created: number;
  completed: number;
}

export interface HeatmapDay {
  /** `YYYY-MM-DD`, in the report's timezone. */
  date: string;
  count: number;
}

export interface TagRow {
  tag: string;
  total: number;
  completed: number;
}

/**
 * Anchored on *now*, not on the selected range: the server computes it from the
 * current week regardless of what the picker says.
 *
 * `changePct` arrives already scaled to a percentage and rounded to one decimal
 * (`round(((this - last) / nullif(last, 0)) * 100, 1)`), so it must never be
 * multiplied by 100 again. It is null when last week was empty.
 */
export interface Throughput {
  thisWeek: number;
  lastWeek: number;
  changePct: number | null;
}

export interface Streak {
  current: number;
  longest: number;
}

export interface PersonalAnalytics {
  range: { from: string; to: string; timezone: string };
  completionSeries: PersonalSeriesPoint[];
  throughput: Throughput;
  /**
   * 0 to 1 fractions, null rather than 0 when the denominator is empty: "none of
   * the tasks I finished were late" and "I have not finished a dated task" are
   * different statements.
   */
  onTimeRate: number | null;
  overdueRate: number | null;
  avgCompletionHours: number | null;
  /** Counts only. The server does not split these by completion. */
  byPriority: Record<TodoPriority, number>;
  byStatus: Record<TodoStatus, number>;
  topTags: TagRow[];
  streak: Streak;
  heatmap: HeatmapDay[];
  /** 0 = Sunday, matching `Date.prototype.getDay()`. Null when nothing was completed. */
  busiestDayOfWeek: number | null;
  /** 0 to 23 in the report's timezone. Null when nothing was completed. */
  busiestHour: number | null;
}

export interface PersonalAnalyticsResponse {
  analytics: PersonalAnalytics;
}

/**
 * The server refuses a longer window with a 400
 * (`MAX_PERSONAL_RANGE_DAYS`), so the picker has to stop before it does.
 */
export const MAX_PERSONAL_RANGE_DAYS = 366;

/* -------------------------------------------------------------------------- */
/* Installation: GET /api/analytics/installation?from&to&granularity          */
/* -------------------------------------------------------------------------- */

export interface ActiveUserCounts {
  daily: number;
  weekly: number;
  monthly: number;
}

/**
 * One row per weekly signup cohort, *not* a cohort triangle.
 *
 * The server anchors these to the current week and looks back eight of them, and
 * `retained` means "signed in within the last 7 days", so there is no per-week
 * offset to plot against. `rate` is a 0 to 1 fraction already rounded to three
 * places, or null when the cohort is empty.
 */
export interface RetentionCohort {
  /** `YYYY-MM-DD` of the cohort's week start. */
  cohort: string;
  users: number;
  retained: number;
  rate: number | null;
}

export interface StoragePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  addedBytes: number;
  /** The running total, which deliberately starts before the window. */
  cumulativeBytes: number;
}

export interface VolumePoint {
  date: string;
  count: number;
}

/**
 * The server returns `...summary` spread into this object, so an installation
 * response carries every field of the traffic summary too.
 */
export interface InstallationAnalytics {
  range: { from: string; to: string; granularity: 'day' | 'week' };
  totals: { pageViews: number; uniqueVisitors: number; events: number };
  series: Array<{ bucket: string; pageViews: number; uniqueVisitors: number; events: number }>;
  topPaths: Array<{ path: string; views: number; visitors: number }>;
  topReferrers: Array<{ referrer: string; views: number; visitors: number }>;
  deviceBreakdown: Array<{ device: string; visitors: number; events: number }>;
  activeUsers: ActiveUserCounts;
  retention: RetentionCohort[];
  newVsReturningVisitors: { new: number; returning: number };
  storageGrowth: StoragePoint[];
  exportVolume: VolumePoint[];
  uploadVolume: Array<VolumePoint & { bytes: number }>;
}

export interface InstallationAnalyticsResponse {
  installation: InstallationAnalytics;
}

/* -------------------------------------------------------------------------- */
/* Tokens: GET /api/analytics/tokens?days                                     */
/* -------------------------------------------------------------------------- */

/** A point on one token's daily series. */
export interface TokenUsagePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  requests: number;
}

export interface TokenUsageRow {
  id: string;
  name: string;
  tokenPrefix: string;
  /** Serialised to an ISO string over the wire, whatever the server's type says. */
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Requests inside the window, not the token's lifetime total. */
  requests: number;
  series: TokenUsagePoint[];
}

export interface TokenUsageResponse {
  usage: {
    range: { from: string; to: string; days: number };
    tokens: TokenUsageRow[];
  };
}

/* -------------------------------------------------------------------------- */
/* Shared chart vocabulary                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fixed categorical slots, shared by every chart on these pages.
 *
 * The point is that "completed" is the same blue in the personal area chart, the
 * tag bars and the heatmap. Assigning by slot rather than by position in the
 * current dataset is what stops a filter that drops a series from repainting the
 * ones that remain.
 */
export const SLOT_COMPLETED = 0;
export const SLOT_CREATED = 1;

/**
 * Visually hidden but still announced.
 *
 * Duplicated from `DashboardView`, which declares the same object privately.
 * Worth lifting into `globals.css` as a utility class when someone next touches
 * both files; not worth editing an unrelated component for now.
 */
export const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
};

/**
 * Opacity steps for the heatmap's intensity scale.
 *
 * Three data levels rather than the four a contribution graph usually shows.
 * Four steps between the floor and full opacity put two adjacent classes closer
 * together than the perceptual-gap floor in dark mode, where the hue has less
 * lightness range to work with above the surface, so one of the four would have
 * been decorative. The floor is 0.52 rather than something fainter because below
 * it the lightest class stops being distinguishable from the card behind it.
 */
export const HEAT_ALPHAS = [0.52, 0.76, 1] as const;

/**
 * Priority is an *ordered* scale, so it gets a single-hue ramp rather than four
 * categorical hues. Colouring ordered classes with unrelated hues throws away
 * the ordering the reader is trying to see, and a fourth categorical hue would
 * not survive the colour-vision check against the other three anyway.
 *
 * Light mode runs light→dark with severity; dark mode runs dark→light, because
 * on a dark surface it is lightness *above* the background that reads as
 * intensity. Both directions were checked for monotonic lightness, per-step
 * separation and contrast against their own surface.
 */
const PRIORITY_RAMP_LIGHT = ['#8ab8ea', '#5896de', '#2a78d6', '#15406f'] as const;
const PRIORITY_RAMP_DARK = ['#2f5a94', '#356fbb', '#3987e5', '#8dbcf2'] as const;

/** Least to most severe: the ramp index order. */
export const PRIORITY_SCALE: readonly TodoPriority[] = ['low', 'medium', 'high', 'urgent'];

export const PRIORITY_LABEL: Record<TodoPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function priorityColor(priority: TodoPriority, isDark: boolean): string {
  const ramp = isDark ? PRIORITY_RAMP_DARK : PRIORITY_RAMP_LIGHT;
  const index = PRIORITY_SCALE.indexOf(priority);
  return ramp[index] ?? ramp[ramp.length - 1] ?? '#2a78d6';
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A duration in words, from the hours the server reports.
 *
 * Deliberately coarse: "2.4 days" is as much precision as an average over a
 * handful of tasks can honestly claim, and "2 days 9 hours 43 minutes" invites
 * the reader to trust a figure that moves by hours when one more task lands.
 */
export function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return 'N/A';

  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

/** `0.734` -> `73%`. Whole percentages; these are rates, not measurements. */
export function formatPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return 'N/A';
  return `${Math.round(rate * 100)}%`;
}

/**
 * The server's `changePct`, which is *already* a percentage.
 *
 * Formatting it rather than recomputing one from `thisWeek`/`lastWeek` keeps the
 * card agreeing with the API, and keeps the "no baseline" case where the server
 * put it: null, because going from 0 to 5 is not "+500%", it is not a percentage
 * at all, and rendering one there is the most common way a week-on-week
 * indicator ends up lying.
 */
export function formatChangePct(changePct: number): string {
  const rounded = Math.round(changePct * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function weekdayName(day: number | null | undefined): string | null {
  if (day === null || day === undefined) return null;
  return WEEKDAY_NAMES[day] ?? null;
}

/** `14` -> `2 PM`. */
export function hourLabel(hour: number | null | undefined): string | null {
  if (hour === null || hour === undefined || hour < 0 || hour > 23) return null;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}
