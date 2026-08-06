'use client';

import { useMemo } from 'react';
import { Table, Typography } from 'antd';
import { useChartTheme, seriesColor } from '@/components/admin/chart-theme';
import { HEAT_ALPHAS, SLOT_COMPLETED, SR_ONLY, type HeatmapDay } from './analytics-types';

/**
 * A contribution-style calendar of daily completions.
 *
 * Built from divs rather than a charting library: the mark is a fixed-size
 * square on a fixed calendar grid, so there is no scale to compute and nothing
 * for a chart library to do except make the cells harder to label.
 */

const CELL_PX = 12;
const GAP_PX = 3;
const DAYS_PER_WEEK = 7;

/** Sunday-first, matching `Date.prototype.getDay()`. */
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/* Rows carrying a label. Labelling all seven at 12px would overlap. */
const LABELLED_ROWS = new Set([1, 3, 5]);

const HEATMAP_CSS = `
.tf-hm__scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
}
.tf-hm__frame {
  display: flex;
  gap: ${GAP_PX}px;
  /* Stops the flex row from shrinking its columns below the cell size when the
     card is narrower than the calendar. It scrolls instead. */
  width: max-content;
}
.tf-hm__gutter {
  display: flex;
  flex-direction: column;
  gap: ${GAP_PX}px;
  padding-top: 16px;
  flex: none;
}
.tf-hm__gutter-label {
  height: ${CELL_PX}px;
  line-height: ${CELL_PX}px;
  font-size: 9px;
  color: var(--tf-text-subtle);
  width: 12px;
  text-align: end;
}
.tf-hm__col {
  display: flex;
  flex-direction: column;
  gap: ${GAP_PX}px;
  flex: none;
}
.tf-hm__month {
  height: 16px;
  position: relative;
  width: ${CELL_PX}px;
}
.tf-hm__month > span {
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
  color: var(--tf-text-muted);
}
.tf-hm__cell {
  width: ${CELL_PX}px;
  height: ${CELL_PX}px;
  border-radius: 2px;
  flex: none;
}
.tf-hm__legend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--tf-text-muted);
}
.tf-hm__legend-swatch {
  width: ${CELL_PX}px;
  height: ${CELL_PX}px;
  border-radius: 2px;
}
`;

/** `#3987e5` + 0.52 -> `rgb(57 135 229 / 0.52)`. */
function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return hex;

  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** Midnight-local `Date` for a `YYYY-MM-DD` key, with no timezone shift. */
function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!match) return null;

  const [, year, month, day] = match;
  if (!year || !month || !day) return null;

  return new Date(Number(year), Number(month) - 1, Number(day));
}

function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

interface Cell {
  key: string;
  /** Null for the padding days that square off the first and last weeks. */
  date: Date | null;
  count: number;
}

interface Props {
  days: HeatmapDay[];
  /** Range bounds, so days with no completions still occupy a cell. */
  from: string;
  to: string;
}

export function CompletionHeatmap({ days, from, to }: Props) {
  const chart = useChartTheme();
  const base = seriesColor(chart, SLOT_COMPLETED);

  const { weeks, total, activeDays, peak, maxCount, listed } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of days) {
      // Tolerates a server that returns an ISO timestamp rather than a date.
      counts.set(entry.date.slice(0, 10), entry.count);
    }

    const start = parseDayKey(from.slice(0, 10));
    const end = parseDayKey(to.slice(0, 10));

    if (!start || !end || end < start) {
      return {
        weeks: [] as Cell[][],
        total: 0,
        activeDays: 0,
        peak: null as { date: Date; count: number } | null,
        maxCount: 0,
        listed: [] as Array<{ key: string; label: string; count: number }>,
      };
    }

    // Square the calendar off to whole Sunday-to-Saturday columns so every row
    // is one weekday all the way across.
    const gridStart = addDays(start, -start.getDay());
    const gridEnd = addDays(end, 6 - end.getDay());

    const built: Cell[][] = [];
    const flat: Array<{ key: string; label: string; count: number }> = [];

    let runningTotal = 0;
    let runningActive = 0;
    let runningMax = 0;
    let runningPeak: { date: Date; count: number } | null = null;

    for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, DAYS_PER_WEEK)) {
      const column: Cell[] = [];

      for (let offset = 0; offset < DAYS_PER_WEEK; offset += 1) {
        const date = addDays(cursor, offset);
        const key = dayKey(date);
        const inRange = date >= start && date <= end;

        if (!inRange) {
          column.push({ key, date: null, count: 0 });
          continue;
        }

        const count = counts.get(key) ?? 0;
        column.push({ key, date, count });

        runningTotal += count;
        if (count > 0) runningActive += 1;
        if (count > runningMax) {
          runningMax = count;
          runningPeak = { date, count };
        }

        flat.push({
          key,
          label: date.toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          count,
        });
      }

      built.push(column);
    }

    return {
      weeks: built,
      total: runningTotal,
      activeDays: runningActive,
      peak: runningPeak,
      maxCount: runningMax,
      listed: flat,
    };
  }, [days, from, to]);

  /**
   * Three intensity classes cut on thirds of the busiest day.
   *
   * Cut against the observed maximum rather than a fixed count, because "a busy
   * day" means something different for someone closing three tasks a week and
   * someone closing thirty.
   */
  const levelOf = (count: number): number => {
    if (count <= 0) return 0;
    if (maxCount <= 0) return 0;
    const ratio = count / maxCount;
    if (ratio <= 1 / 3) return 1;
    if (ratio <= 2 / 3) return 2;
    return 3;
  };

  const colorFor = (level: number): string => {
    if (level === 0) return 'var(--tf-border-subtle)';
    return withAlpha(base, HEAT_ALPHAS[level - 1] ?? 1);
  };

  if (weeks.length === 0 || total === 0) {
    return (
      <Typography.Text className="tf-muted">
        No completions in this range yet. Finish a task and it will appear here.
      </Typography.Text>
    );
  }

  const summary =
    `${total} task${total === 1 ? '' : 's'} completed on ${activeDays} ` +
    `of ${listed.length} days in this range.` +
    (peak
      ? ` The busiest was ${peak.date.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })} with ${peak.count}.`
      : '');

  return (
    <>
      <style>{HEATMAP_CSS}</style>

      {/*
        A grid of coloured squares says nothing to a screen reader even with every
        cell labelled, because the labels only pay off for someone already
        exploring the grid. This sentence is what a reader gets for free.
      */}
      <p style={SR_ONLY}>{summary}</p>

      <div className="tf-hm__scroll">
        <div className="tf-hm__frame">
          <div className="tf-hm__gutter" aria-hidden="true">
            {WEEKDAY_INITIALS.map((initial, row) => (
              <span key={WEEKDAY_FULL[row]} className="tf-hm__gutter-label">
                {LABELLED_ROWS.has(row) ? initial : ''}
              </span>
            ))}
          </div>

          {weeks.map((column, columnIndex) => {
            const firstReal = column.find((cell) => cell.date !== null)?.date ?? null;
            const previous = weeks[columnIndex - 1];
            const previousReal = previous?.find((cell) => cell.date !== null)?.date ?? null;

            // The month label rides the first column that contains a day of that
            // month, so it sits over the week the month actually starts in.
            const showMonth =
              firstReal !== null &&
              (previousReal === null || previousReal.getMonth() !== firstReal.getMonth());

            return (
              <div className="tf-hm__col" key={column[0]?.key ?? columnIndex}>
                <span className="tf-hm__month" aria-hidden="true">
                  {showMonth && firstReal ? (
                    <span>{firstReal.toLocaleDateString(undefined, { month: 'short' })}</span>
                  ) : null}
                </span>

                {column.map((cell) => {
                  if (!cell.date) {
                    // Keeps the column square without claiming a day exists.
                    return (
                      <span
                        key={cell.key}
                        className="tf-hm__cell"
                        style={{ background: 'transparent' }}
                        aria-hidden="true"
                      />
                    );
                  }

                  const label = `${cell.date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}: ${cell.count} completed`;

                  return (
                    <span
                      key={cell.key}
                      className="tf-hm__cell"
                      // `role="img"` is what makes the label stick: an aria-label
                      // on a bare <span> is not reliably announced.
                      role="img"
                      aria-label={label}
                      title={label}
                      style={{ background: colorFor(levelOf(cell.count)) }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="tf-hm__legend">
        <span>Less</span>
        {[0, 1, 2, 3].map((level) => (
          <span
            key={level}
            className="tf-hm__legend-swatch"
            style={{ background: colorFor(level) }}
            aria-hidden="true"
          />
        ))}
        <span>More</span>
        <span style={{ marginInlineStart: 'auto' }}>Busiest day: {maxCount}</span>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--tf-text-muted)', fontSize: 13 }}>
          View as a table
        </summary>
        <Table
          size="small"
          style={{ marginTop: 12 }}
          rowKey="key"
          dataSource={listed}
          pagination={false}
          scroll={{ x: 'max-content', y: 280 }}
          columns={[
            { title: 'Date', dataIndex: 'label' },
            { title: 'Completed', dataIndex: 'count', align: 'right' },
          ]}
        />
      </details>
    </>
  );
}
