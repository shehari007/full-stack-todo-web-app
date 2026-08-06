'use client';

import { useEffect, useMemo, useState } from 'react';
import { Typography } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { seriesColor, useChartTheme } from '@/components/admin/chart-theme';
import { SLOT_COMPLETED, SR_ONLY, type TokenUsagePoint } from './analytics-types';

/**
 * Daily request counts for a single API token.
 *
 * Sized for a table row or a card footer rather than a dashboard panel, so it
 * renders no legend and no title: whatever lists the tokens already names which
 * one this is, and repeating it here would be the larger half of the component.
 */

interface Props {
  /** One token's `series` from `GET /api/analytics/tokens`. */
  usage: TokenUsagePoint[];
  /** Plot height. The x-axis band is added on top, so the card never crops it. */
  height?: number;
}

const DEFAULT_HEIGHT = 120;
const AXIS_BAND_PX = 24;

export function TokenUsageChart({ usage, height = DEFAULT_HEIGHT }: Props) {
  const chart = useChartTheme();

  // ResponsiveContainer measures its parent, which is 0x0 during the server
  // render; mounting first is what stops it warning and painting at zero width.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const data = useMemo(
    () =>
      usage.map((point) => ({
        ...point,
        // `YYYY-MM-DD` parses as UTC midnight, which renders as the previous day
        // for anyone west of Greenwich, so the parts are read off the key
        // directly rather than round-tripped through a Date.
        label: new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
        }),
      })),
    [usage],
  );

  const total = useMemo(() => data.reduce((sum, point) => sum + point.requests, 0), [data]);

  if (data.length === 0 || total === 0) {
    return (
      <Typography.Text className="tf-muted" style={{ fontSize: 13 }}>
        No requests recorded yet.
      </Typography.Text>
    );
  }

  return (
    <>
      {/*
        The SVG is hidden from assistive technology in favour of the table: a row
        of <rect>s conveys nothing, and the table is the same numbers without a
        pointer.
      */}
      <div style={{ width: '100%', height: height + AXIS_BAND_PX }} aria-hidden="true">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: chart.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: chart.grid }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: chart.axis, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <RechartsTooltip
                contentStyle={chart.tooltipStyle}
                cursor={{ fill: chart.grid, fillOpacity: 0.5 }}
                formatter={(value: unknown) => {
                  const count = Number(value);
                  return [`${count} request${count === 1 ? '' : 's'}`, ''] as [string, string];
                }}
              />
              {/* One series, so no legend: the surrounding row names the token. */}
              <Bar
                dataKey="requests"
                name="Requests"
                fill={seriesColor(chart, SLOT_COMPLETED)}
                maxBarSize={18}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>

      <table style={SR_ONLY}>
        <caption>Requests per day for this token</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Requests</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.label}</th>
              <td>{point.requests}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
