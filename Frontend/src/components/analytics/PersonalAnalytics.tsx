'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Row,
  Space,
  Statistic,
  Table,
  Typography,
  theme,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  FireOutlined,
} from '@ant-design/icons';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { swrFetcher } from '@/lib/api';
import { seriesColor, useChartTheme } from '@/components/admin/chart-theme';
import { CompletionHeatmap } from './CompletionHeatmap';
import {
  MAX_PERSONAL_RANGE_DAYS,
  PRIORITY_LABEL,
  PRIORITY_SCALE,
  SLOT_COMPLETED,
  SLOT_CREATED,
  SR_ONLY,
  formatChangePct,
  formatHours,
  formatPercent,
  hourLabel,
  priorityColor,
  weekdayName,
  type PersonalAnalytics as PersonalAnalyticsPayload,
  type PersonalAnalyticsResponse,
} from './analytics-types';

function endpointFor(from: string, to: string): string {
  const params = new URLSearchParams({ from, to });
  return `/api/analytics/me?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Key figures                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The week-on-week indicator.
 *
 * Rendered as an arrow *and* the words "vs last week", never the colour alone.
 * A green number is invisible as a signal to a reader who cannot see green, and
 * the direction is the whole content of this element.
 *
 * The percentage is the server's `changePct`, taken as given rather than
 * recomputed from the two counts. It is already scaled, already rounded, and
 * already null in the one case that matters: no baseline to compare against.
 */
function WeeklyDelta({
  changePct,
  thisWeek,
  lastWeek,
}: {
  changePct: number | null;
  thisWeek: number;
  lastWeek: number;
}) {
  const { token } = theme.useToken();

  if (changePct === null) {
    return (
      <span className="tf-muted">
        {lastWeek === 0 && thisWeek === 0
          ? 'None last week either'
          : 'Nothing completed last week'}
      </span>
    );
  }

  const rising = changePct >= 0;
  const Icon = rising ? ArrowUpOutlined : ArrowDownOutlined;

  return (
    <span style={{ color: rising ? token.colorSuccess : token.colorWarning }}>
      <Icon aria-hidden /> {`${formatChangePct(changePct)} vs last week`}
    </span>
  );
}

function FigureCard({
  title,
  value,
  icon,
  note,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic
        title={
          <Space size={6}>
            <span aria-hidden>{icon}</span>
            <span>{title}</span>
          </Space>
        }
        value={value}
        // Proportional figures: `tabular-nums` makes a large standalone number
        // look loose. It belongs in the tables, not here.
        valueStyle={{ fontSize: 26, fontWeight: 600 }}
      />
      {note ? <div style={{ fontSize: 12, marginTop: 4 }}>{note}</div> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  initial: PersonalAnalyticsResponse | null;
  /** Resolved on the server so the first SWR key matches what the page fetched. */
  defaultFrom: string;
  defaultTo: string;
}

export function PersonalAnalytics({ initial, defaultFrom, defaultTo }: Props) {
  const chart = useChartTheme();
  const { token } = theme.useToken();

  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(defaultFrom), dayjs(defaultTo)]);

  // ResponsiveContainer measures its parent, which has no size during the
  // server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const from = range[0].toISOString();
  const to = range[1].toISOString();

  const endpoint = endpointFor(from, to);
  const initialEndpoint = endpointFor(defaultFrom, defaultTo);

  const { data, error, isLoading } = useSWR<PersonalAnalyticsResponse>(endpoint, swrFetcher, {
    ...(initial && endpoint === initialEndpoint ? { fallbackData: initial } : {}),
    // Holds the previous numbers while a new range loads, rather than flashing
    // skeletons and jumping the layout.
    keepPreviousData: true,
  });

  const analytics: PersonalAnalyticsPayload | undefined = data?.analytics;

  const series = useMemo(
    () =>
      (analytics?.completionSeries ?? []).map((point) => ({
        ...point,
        label: dayjs(point.date).format('D MMM'),
      })),
    [analytics],
  );

  const seriesHasData = useMemo(
    () => series.some((point) => point.created > 0 || point.completed > 0),
    [series],
  );

  /*
   * `byPriority` arrives as a `Record<TodoPriority, number>`, so the rows are
   * built by walking `PRIORITY_SCALE` rather than the object's own keys: the
   * severity order is the whole point of a single-hue ramp, and object key
   * order is not something to hand an axis. Walking the scale also seeds every
   * level at zero, so a level the server omits still has a key. An undefined
   * dataKey makes recharts drop the segment and the legend then silently
   * disagrees with the table.
   */
  const priorityRows = useMemo(
    () =>
      PRIORITY_SCALE.map((priority) => ({
        priority,
        total: analytics?.byPriority?.[priority] ?? 0,
      })),
    [analytics],
  );

  /** One row, four stacked segments: the mix is a part-to-whole, not a ranking. */
  const priorityRow = useMemo(() => {
    const row: Record<string, number | string> = { name: 'Mix' };
    for (const entry of priorityRows) row[entry.priority] = entry.total;
    return row;
  }, [priorityRows]);

  const priorityTotal = useMemo(
    () => priorityRows.reduce((sum, entry) => sum + entry.total, 0),
    [priorityRows],
  );

  const tags = useMemo(
    () =>
      (analytics?.topTags ?? []).map((entry) => ({
        ...entry,
        // Stacking completed under the remainder makes the full bar the total,
        // so one bar answers both "how many" and "how many are done".
        remaining: Math.max(0, entry.total - entry.completed),
      })),
    [analytics],
  );

  // Flat fields, not a `busiest` object. Reading `analytics?.busiest.dayOfWeek`
  // threw on every render, because the optional chain guards `analytics` but not
  // the property after it.
  const busiestDay = weekdayName(analytics?.busiestDayOfWeek ?? null);
  const busiestHour = hourLabel(analytics?.busiestHour ?? null);

  /*
   * The calendar bounds come from the returned series, not from the picker.
   *
   * The server buckets days in the report's own timezone and emits one row per
   * day with no holes, so its first and last keys are exactly the range the data
   * covers. Passing `from`/`to` instead would render a shifted grid:
   * `toISOString()` on a local start-of-day lands on the *previous* calendar
   * date for any timezone east of UTC, so every cell would sit one column off
   * its real weekday.
   */
  const heatmap = analytics?.heatmap ?? [];
  const heatmapFrom = heatmap[0]?.date ?? range[0].format('YYYY-MM-DD');
  const heatmapTo = heatmap[heatmap.length - 1]?.date ?? range[1].format('YYYY-MM-DD');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Your analytics
          </Typography.Title>
          <Typography.Text className="tf-muted">
            How your own tasks have moved over time. Nobody else can see this.
          </Typography.Text>
        </div>
      </div>

      {/* One filter row above everything it scopes: every panel below reads the
          same slice, so there is nothing to reconcile between them. */}
      <DatePicker.RangePicker
        value={range}
        allowClear={false}
        maxDate={dayjs()}
        /*
         * The API refuses a window longer than `MAX_PERSONAL_RANGE_DAYS` with a
         * 400. It materialises one row per day, so an unbounded `from` is an
         * unbounded result set. Stopping the picker short of that turns a server
         * error into an unreachable date. Two days of slack rather than one:
         * `endOf('day')` already spends most of a day, and a DST-shifted month
         * can make `subtract(n, 'day')` an hour longer than n×24h.
         */
        minDate={dayjs()
          .subtract(MAX_PERSONAL_RANGE_DAYS - 2, 'day')
          .startOf('day')}
        onChange={(value) => {
          const start = value?.[0];
          const end = value?.[1];
          if (start && end) setRange([start.startOf('day'), end.endOf('day')]);
        }}
        aria-label="Analytics date range"
        presets={[
          { label: 'Last 30 days', value: [dayjs().subtract(30, 'day').startOf('day'), dayjs()] },
          { label: 'Last 90 days', value: [dayjs().subtract(90, 'day').startOf('day'), dayjs()] },
          { label: 'Last 6 months', value: [dayjs().subtract(6, 'month').startOf('day'), dayjs()] },
          { label: 'This year', value: [dayjs().startOf('year'), dayjs()] },
        ]}
      />

      <span role="status" aria-live="polite" className="tf-muted" style={{ fontSize: 13 }}>
        {isLoading
          ? 'Loading your analytics...'
          : analytics
            ? `Showing ${series.length} days from ${range[0].format('D MMM YYYY')} to ${range[1].format('D MMM YYYY')}.`
            : ''}
      </span>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load your analytics"
          description={error instanceof Error ? error.message : 'The API did not answer.'}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          {/* Anchored on the current week by the server, so this one card does
              not follow the picker above the way everything else does. */}
          <FigureCard
            title="Completed this week"
            value={analytics?.throughput?.thisWeek ?? 0}
            icon={<CheckCircleOutlined />}
            note={
              <WeeklyDelta
                changePct={analytics?.throughput?.changePct ?? null}
                thisWeek={analytics?.throughput?.thisWeek ?? 0}
                lastWeek={analytics?.throughput?.lastWeek ?? 0}
              />
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <FigureCard
            title="On-time rate"
            // Null and zero are different answers here, and `formatPercent`
            // keeps them apart: "N/A" means no dated task was finished.
            value={formatPercent(analytics?.onTimeRate ?? null)}
            icon={<ClockCircleOutlined />}
            note={
              <span className="tf-muted">
                Of tasks that had a due date
                {analytics?.overdueRate != null
                  ? ` · ${formatPercent(analytics.overdueRate)} of open dated tasks overdue`
                  : ''}
              </span>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <FigureCard
            title="Current streak"
            value={analytics?.streak?.current ?? 0}
            icon={<FireOutlined />}
            note={
              <span className="tf-muted">
                {(analytics?.streak?.current ?? 0) === 1 ? 'day in a row' : 'days in a row'}
                {/* Whole-history, like the streak itself: a personal best the
                    range happens to cut in half is not a personal best. */}
                {(analytics?.streak?.longest ?? 0) > 0 ? ` · best ${analytics?.streak?.longest}` : ''}
              </span>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <FigureCard
            title="Average time to complete"
            value={formatHours(analytics?.avgCompletionHours ?? null)}
            icon={<FieldTimeOutlined />}
            note={<span className="tf-muted">From created to done</span>}
          />
        </Col>
      </Row>

      <Card title="Created and completed over time">
        {!seriesHasData ? (
          <Typography.Text className="tf-muted">
            Nothing was created or completed in this range.
          </Typography.Text>
        ) : (
          <>
            <div style={{ width: '100%', height: 300 }} aria-hidden="true">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="tf-me-completed" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor={seriesColor(chart, SLOT_COMPLETED)}
                          stopOpacity={0.26}
                        />
                        <stop
                          offset="100%"
                          stopColor={seriesColor(chart, SLOT_COMPLETED)}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                      <linearGradient id="tf-me-created" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor={seriesColor(chart, SLOT_CREATED)}
                          stopOpacity={0.22}
                        />
                        <stop
                          offset="100%"
                          stopColor={seriesColor(chart, SLOT_CREATED)}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={chart.grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: chart.axis, fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: chart.grid }}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    {/* One axis: both series are task counts. A second scale would
                        let the two be made to cross wherever the eye happens to
                        land, which is a correlation the data does not contain. */}
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: chart.axis, fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                    />
                    <RechartsTooltip
                      contentStyle={chart.tooltipStyle}
                      cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                    <Area
                      type="monotone"
                      dataKey="completed"
                      name="Completed"
                      stroke={seriesColor(chart, SLOT_COMPLETED)}
                      strokeWidth={2}
                      fill="url(#tf-me-completed)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: chart.surface }}
                    />
                    <Area
                      type="monotone"
                      dataKey="created"
                      name="Created"
                      stroke={seriesColor(chart, SLOT_CREATED)}
                      strokeWidth={2}
                      fill="url(#tf-me-created)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: chart.surface }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--tf-text-muted)', fontSize: 13 }}>
                View as a table
              </summary>
              <Table
                size="small"
                style={{ marginTop: 12 }}
                rowKey="date"
                dataSource={series}
                pagination={false}
                scroll={{ x: 'max-content', y: 280 }}
                columns={[
                  { title: 'Date', dataIndex: 'date' },
                  { title: 'Created', dataIndex: 'created', align: 'right' },
                  { title: 'Completed', dataIndex: 'completed', align: 'right' },
                ]}
              />
            </details>
          </>
        )}
      </Card>

      <Card title="Daily completions">
        <CompletionHeatmap days={heatmap} from={heatmapFrom} to={heatmapTo} />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="Priority mix" style={{ height: '100%' }}>
            {priorityTotal === 0 ? (
              <Typography.Text className="tf-muted">No tasks in this range.</Typography.Text>
            ) : (
              <>
                <div style={{ width: '100%', height: 120 }} aria-hidden="true">
                  {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[priorityRow]}
                        layout="vertical"
                        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" hide />
                        <RechartsTooltip
                          contentStyle={chart.tooltipStyle}
                          cursor={false}
                          formatter={(value: unknown, name: unknown) => {
                            const count = Number(value);
                            const share =
                              priorityTotal === 0
                                ? ''
                                : ` (${Math.round((count / priorityTotal) * 100)}%)`;
                            return [`${count}${share}`, String(name)] as [string, string];
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                        {PRIORITY_SCALE.map((priority) => (
                          <Bar
                            key={priority}
                            dataKey={priority}
                            name={PRIORITY_LABEL[priority]}
                            stackId="mix"
                            fill={priorityColor(priority, chart.isDark)}
                            // A 2px gap in the surface colour, so touching
                            // segments are separated by shape as well as by step.
                            stroke={chart.surface}
                            strokeWidth={2}
                            maxBarSize={28}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  ) : null}
                </div>

                {/* No "Done" column: `byPriority` is a count per level and the
                    API does not split it by completion, so the figure that used
                    to sit there could only ever have been blank. Share is
                    derived from the same row, which is what the stacked bar
                    above encodes anyway. */}
                <Table
                  size="small"
                  rowKey="priority"
                  dataSource={priorityRows}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  columns={[
                    {
                      title: 'Priority',
                      dataIndex: 'priority',
                      render: (value: string) =>
                        PRIORITY_LABEL[value as keyof typeof PRIORITY_LABEL] ?? value,
                    },
                    { title: 'Tasks', dataIndex: 'total', align: 'right' },
                    {
                      title: 'Share',
                      key: 'share',
                      align: 'right',
                      render: (_value, row) =>
                        priorityTotal === 0
                          ? 'N/A'
                          : `${Math.round((row.total / priorityTotal) * 100)}%`,
                    },
                  ]}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card title="Top tags" style={{ height: '100%' }}>
            {tags.length === 0 ? (
              <Typography.Text className="tf-muted">
                No tagged tasks in this range.
              </Typography.Text>
            ) : (
              <>
                <div
                  style={{ width: '100%', height: Math.max(160, tags.length * 34 + 48) }}
                  aria-hidden="true"
                >
                  {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={tags}
                        layout="vertical"
                        margin={{ top: 4, right: 36, bottom: 4, left: 0 }}
                        barCategoryGap="28%"
                      >
                        <CartesianGrid horizontal={false} stroke={chart.grid} />
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="tag"
                          width={92}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: chart.axis, fontSize: 12 }}
                        />
                        <RechartsTooltip
                          contentStyle={chart.tooltipStyle}
                          cursor={{ fill: chart.grid, fillOpacity: 0.5 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 4 }} />
                        <Bar
                          dataKey="completed"
                          name="Completed"
                          stackId="tag"
                          fill={seriesColor(chart, SLOT_COMPLETED)}
                          stroke={chart.surface}
                          strokeWidth={2}
                          maxBarSize={22}
                        />
                        <Bar
                          dataKey="remaining"
                          name="Still open"
                          stackId="tag"
                          // The remainder carries no identity of its own. It is
                          // "the rest of the bar", so it takes the neutral.
                          fill={chart.neutral}
                          stroke={chart.surface}
                          strokeWidth={2}
                          maxBarSize={22}
                          radius={[0, 4, 4, 0]}
                        >
                          {/* Only the bar total is labelled; a number on every
                              segment would be unreadable at this bar height. */}
                          <LabelList
                            dataKey="total"
                            position="right"
                            fill={token.colorText}
                            fontSize={12}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : null}
                </div>

                <table style={SR_ONLY}>
                  <caption>Tasks by tag</caption>
                  <thead>
                    <tr>
                      <th scope="col">Tag</th>
                      <th scope="col">Completed</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tags.map((row) => (
                      <tr key={row.tag}>
                        <th scope="row">{row.tag}</th>
                        <td>{row.completed}</td>
                        <td>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card title="When you work" style={{ height: '100%' }}>
            {!busiestDay && !busiestHour ? (
              <Typography.Text className="tf-muted">
                Not enough completions yet to see a pattern.
              </Typography.Text>
            ) : (
              <Space direction="vertical" size={20} style={{ width: '100%' }}>
                {/* Each figure and its note are one block, so the Space gap falls
                    between the two insights rather than between a number and the
                    sentence explaining it. */}
                <div>
                  <Statistic
                    title={
                      <Space size={6}>
                        <CalendarOutlined aria-hidden />
                        <span>Busiest day</span>
                      </Space>
                    }
                    value={busiestDay ?? 'N/A'}
                    valueStyle={{ fontSize: 22, fontWeight: 600 }}
                  />
                  {/* The API reports which day is the modal one, not how many
                      landed on it, so there is no count to put here. */}
                  <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                    Where most of your completions land
                  </Typography.Text>
                </div>

                <div>
                  <Statistic
                    title={
                      <Space size={6}>
                        <ClockCircleOutlined aria-hidden />
                        <span>Busiest hour</span>
                      </Space>
                    }
                    value={busiestHour ?? 'N/A'}
                    valueStyle={{ fontSize: 22, fontWeight: 600 }}
                  />
                  {/* An hour of the day means nothing without the clock it was
                      read on, and the server tells us which one it bucketed by. */}
                  <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                    {analytics?.range?.timezone
                      ? `Local to ${analytics.range.timezone}`
                      : 'In your profile timezone'}
                  </Typography.Text>
                </div>
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
