'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs, { type Dayjs } from 'dayjs';
import {
  CloudServerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  InputNumber,
  Row,
  Segmented,
  Space,
  Statistic,
  Switch,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiError, api, apiDownload, saveBlob, swrFetcher } from '@/lib/api';
import { seriesColor, useChartTheme } from '@/components/admin/chart-theme';
import { formatBytes, formatRate } from '@/components/admin/format';
import { SettingsForm } from '@/components/admin/SettingsForm';
import type {
  AdminAnalyticsSummary,
  AnalyticsPurgeResponse,
  AnalyticsSummaryResponse,
} from '@/components/admin/admin-types';
import type { InstallationAnalyticsResponse } from '@/components/analytics/analytics-types';
import type { AnalyticsSettings } from '@/types/api';

type Granularity = 'day' | 'week';

function summaryEndpoint(from: string, to: string, granularity: Granularity): string {
  const params = new URLSearchParams({ from, to, granularity });
  return `/api/analytics/summary?${params.toString()}`;
}

/**
 * Devices past the third fold into "Other".
 *
 * Three categorical hues is the largest set that stays distinguishable to every
 * kind of colour vision when every slice touches every other one, which is what
 * a pie does. A fourth hue would look fine to most readers and be unreadable to
 * some. The neutral bucket is the honest alternative.
 */
const MAX_PIE_SLICES = 3;

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  bot: 'Bot',
  unknown: 'Unknown',
};

function installationEndpoint(from: string, to: string, granularity: Granularity): string {
  const params = new URLSearchParams({ from, to, granularity });
  return `/api/analytics/installation?${params.toString()}`;
}

interface Props {
  initialSummary: AnalyticsSummaryResponse | null;
  initialSettings: AnalyticsSettings | null;
  /**
   * Null when the API is unreachable or the endpoint is not deployed yet. The
   * installation panels fall back to their own empty states.
   */
  initialInstallation: InstallationAnalyticsResponse | null;
  /** Computed on the server so the first client key matches what was fetched. */
  defaultFrom: string;
  defaultTo: string;
  isRoot: boolean;
}

export function AnalyticsClient({
  initialSummary,
  initialSettings,
  initialInstallation,
  defaultFrom,
  defaultTo,
  isRoot,
}: Props) {
  const chart = useChartTheme();
  const { message, modal } = App.useApp();

  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(defaultFrom), dayjs(defaultTo)]);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [purging, setPurging] = useState(false);
  const [exporting, setExporting] = useState(false);

  const from = range[0].toISOString();
  const to = range[1].toISOString();

  const endpoint = summaryEndpoint(from, to, granularity);
  const initialEndpoint = summaryEndpoint(defaultFrom, defaultTo, 'day');

  const { data, error, isLoading, mutate } = useSWR<AnalyticsSummaryResponse>(
    endpoint,
    swrFetcher,
    {
      ...(initialSummary && endpoint === initialEndpoint
        ? { fallbackData: initialSummary }
        : {}),
      keepPreviousData: true,
    },
  );

  const summary: AdminAnalyticsSummary | undefined = data?.summary;

  const series = useMemo(
    () =>
      (summary?.series ?? []).map((point) => ({
        ...point,
        label:
          granularity === 'week'
            ? `w/c ${dayjs(point.bucket).format('D MMM')}`
            : dayjs(point.bucket).format('D MMM'),
      })),
    [granularity, summary],
  );

  const devices = useMemo(() => {
    const rows = [...(summary?.deviceBreakdown ?? [])].sort((a, b) => b.visitors - a.visitors);
    const head = rows.slice(0, MAX_PIE_SLICES);
    const tail = rows.slice(MAX_PIE_SLICES);

    const folded = tail.reduce(
      (accumulator, row) => ({
        device: 'other',
        visitors: accumulator.visitors + row.visitors,
        events: accumulator.events + row.events,
      }),
      { device: 'other', visitors: 0, events: 0 },
    );

    return tail.length > 0 ? [...head, folded] : head;
  }, [summary]);

  const totalDeviceVisitors = devices.reduce((sum, row) => sum + row.visitors, 0);

  /*
   * The range is passed on, because the endpoint accepts it.
   *
   * `getInstallationAnalytics` is built on `getSummary` and derives
   * `storageGrowth` from the resolved window, so calling it unparameterised does
   * not get "figures with their own windows". It gets the server's *default*
   * 30-day window, and the storage curve then silently disagrees with the range
   * picker driving every other panel on the page. Active users and the retention
   * cohorts genuinely do carry their own windows; those ignore this and are
   * labelled with the window they actually use.
   */
  const installEndpoint = installationEndpoint(from, to, granularity);
  const initialInstallEndpoint = installationEndpoint(defaultFrom, defaultTo, 'day');

  const { data: installationData } = useSWR<InstallationAnalyticsResponse>(
    installEndpoint,
    swrFetcher,
    {
      ...(initialInstallation && installEndpoint === initialInstallEndpoint
        ? { fallbackData: initialInstallation }
        : {}),
      keepPreviousData: true,
    },
  );

  const installation = installationData?.installation;

  /**
   * One point per signup week.
   *
   * The server reports a single figure per cohort (how many of the people who
   * joined that week have signed in during the last seven days) rather than a
   * cohort-by-week-offset matrix. A true matrix would need a record of when each
   * account was last active in every past week, and only the latest
   * `last_login_at` is stored, so it is not recoverable.
   */
  const retentionCurve = useMemo(
    () =>
      [...(installation?.retention ?? [])]
        .sort((a, b) => a.cohort.localeCompare(b.cohort))
        .map((cell) => ({
          cohort: cell.cohort,
          label: dayjs(cell.cohort).format('D MMM'),
          // Scaled to a percentage: recharts cannot label an axis on a 0 to 1
          // domain without every tick rounding to "0".
          // Null stays null rather than collapsing to 0: an empty cohort has no
          // rate, and a zero there would read as "everyone who joined that week
          // churned". recharts breaks the line at a null, which is the honest
          // mark for "nothing to plot".
          rate: cell.rate === null ? null : Math.round(cell.rate * 1000) / 10,
          retained: cell.retained,
          size: cell.users,
        })),
    [installation],
  );

  const retentionRows = useMemo(
    () =>
      [...(installation?.retention ?? [])]
        // Newest cohort first: the one an operator is actually watching.
        .sort((a, b) => b.cohort.localeCompare(a.cohort))
        .map((cell) => ({ ...cell, key: cell.cohort })),
    [installation],
  );

  const storageSeries = useMemo(
    () =>
      (installation?.storageGrowth ?? []).map((point) => ({
        ...point,
        label: dayjs(point.date).format('D MMM'),
      })),
    [installation],
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await apiDownload('/api/analytics/summary.csv', {
        from,
        to,
        granularity,
      });
      saveBlob(blob, filename);
    } catch (exportError) {
      message.error(
        exportError instanceof ApiError
          ? exportError.message
          : 'That export could not be generated. Try again.',
      );
    } finally {
      setExporting(false);
    }
  };

  const handlePurge = () => {
    modal.confirm({
      title: 'Purge analytics events past their retention window?',
      okText: 'Purge now',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      content: (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          Deletes every event older than the retention period below. The scheduled job runs the same
          operation on its own timetable, so this changes <em>when</em> data disappears, never
          whether it does. It cannot be undone.
        </Typography.Paragraph>
      ),
      onOk: async () => {
        setPurging(true);
        try {
          const { purge } = await api.post<AnalyticsPurgeResponse>('/api/analytics/purge');
          message.success(
            `Deleted ${purge.deletedCount.toLocaleString()} event${purge.deletedCount === 1 ? '' : 's'} older than ${purge.retentionDays} days.`,
          );
          await mutate();
        } catch (purgeError) {
          message.error(
            purgeError instanceof ApiError ? purgeError.message : 'Could not reach the server.',
          );
        } finally {
          setPurging(false);
        }
      },
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Analytics
          </Typography.Title>
          <Typography.Text className="tf-muted">
            First-party page views, counted only for visitors who consented.
          </Typography.Text>
        </div>

        <Space wrap>
          <Tooltip title="Downloads the traffic summary for the range selected below">
            <Button
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              Export CSV
            </Button>
          </Tooltip>

          <Tooltip title={isRoot ? undefined : 'Only the root account can purge events.'}>
            <Button danger icon={<DeleteOutlined />} disabled={!isRoot} loading={purging} onClick={handlePurge}>
              Purge old events
            </Button>
          </Tooltip>
        </Space>
      </div>

      <Space wrap size={12}>
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          maxDate={dayjs()}
          onChange={(value) => {
            const start = value?.[0];
            const end = value?.[1];
            if (start && end) setRange([start.startOf('day'), end.endOf('day')]);
          }}
          aria-label="Reporting date range"
          presets={[
            { label: 'Last 7 days', value: [dayjs().subtract(7, 'day').startOf('day'), dayjs()] },
            { label: 'Last 30 days', value: [dayjs().subtract(30, 'day').startOf('day'), dayjs()] },
            { label: 'Last 90 days', value: [dayjs().subtract(90, 'day').startOf('day'), dayjs()] },
            { label: 'This year', value: [dayjs().startOf('year'), dayjs()] },
          ]}
        />

        <Segmented<Granularity>
          value={granularity}
          onChange={setGranularity}
          aria-label="Bucket size"
          options={[
            { value: 'day', label: 'Daily' },
            { value: 'week', label: 'Weekly' },
          ]}
        />
      </Space>

      <span role="status" aria-live="polite" className="tf-muted" style={{ fontSize: 13 }}>
        {isLoading ? 'Loading traffic...' : summary ? `${series.length} buckets in range.` : ''}
      </span>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load the traffic summary"
          description={error instanceof Error ? error.message : 'The API did not answer.'}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space size={6}>
                  <EyeOutlined aria-hidden />
                  <span>Page views</span>
                </Space>
              }
              value={summary?.totals.pageViews ?? 0}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space size={6}>
                  <TeamOutlined aria-hidden />
                  <span>Unique visitors</span>
                </Space>
              }
              value={summary?.totals.uniqueVisitors ?? 0}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space size={6}>
                  <ThunderboltOutlined aria-hidden />
                  <span>All events</span>
                </Space>
              }
              value={summary?.totals.events ?? 0}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Traffic over time" loading={isLoading && series.length === 0}>
        {series.length === 0 ? (
          <Typography.Text className="tf-muted">No events in this range.</Typography.Text>
        ) : (
          <>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="tf-views" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={seriesColor(chart, 0)} stopOpacity={0.26} />
                      <stop offset="100%" stopColor={seriesColor(chart, 0)} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="tf-visitors" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={seriesColor(chart, 1)} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={seriesColor(chart, 1)} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: chart.axis, fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: chart.grid }}
                    interval="preserveStartEnd"
                    minTickGap={20}
                  />
                  {/* One axis, deliberately: views and visitors are both counts,
                      and a second scale would let any pair of lines be made to
                      cross wherever the reader's eye happens to look. */}
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
                    dataKey="pageViews"
                    name="Page views"
                    stroke={seriesColor(chart, 0)}
                    strokeWidth={2}
                    fill="url(#tf-views)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: chart.surface }}
                  />
                  <Area
                    type="monotone"
                    dataKey="uniqueVisitors"
                    name="Unique visitors"
                    stroke={seriesColor(chart, 1)}
                    strokeWidth={2}
                    fill="url(#tf-visitors)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: chart.surface }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <Typography.Paragraph className="tf-muted" style={{ fontSize: 12, marginTop: 12 }}>
              Per-bucket unique visitors are counted independently and do not add up to the total
              above: someone who visits on three days is one visitor overall and three here.
            </Typography.Paragraph>

            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--tf-text-muted)', fontSize: 13 }}>
                View as a table
              </summary>
              <Table
                size="small"
                style={{ marginTop: 12 }}
                rowKey="bucket"
                dataSource={series}
                pagination={false}
                scroll={{ x: 'max-content', y: 280 }}
                columns={[
                  { title: 'Bucket', dataIndex: 'bucket' },
                  { title: 'Page views', dataIndex: 'pageViews', align: 'right' },
                  { title: 'Unique visitors', dataIndex: 'uniqueVisitors', align: 'right' },
                  { title: 'All events', dataIndex: 'events', align: 'right' },
                ]}
              />
            </details>
          </>
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title="Devices" style={{ height: '100%' }}>
            {devices.length === 0 ? (
              <Typography.Text className="tf-muted">No device data in this range.</Typography.Text>
            ) : (
              <>
                <div style={{ width: '100%', height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={devices}
                        dataKey="visitors"
                        nameKey="device"
                        innerRadius={52}
                        outerRadius={84}
                        // A 2px gap in the surface colour so adjacent slices are
                        // separated by shape as well as by hue.
                        paddingAngle={2}
                        stroke={chart.surface}
                        strokeWidth={2}
                      >
                        {devices.map((row, index) => (
                          <Cell
                            key={row.device}
                            fill={
                              row.device === 'other' ? chart.neutral : seriesColor(chart, index)
                            }
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={chart.tooltipStyle}
                        formatter={(value: unknown, name: unknown) => {
                          const count = Number(value);
                          const key = String(name);
                          return [
                            `${count} visitor${count === 1 ? '' : 's'}`,
                            DEVICE_LABELS[key] ?? key,
                          ] as [string, string];
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 13 }}
                        formatter={(value: string) =>
                          value === 'other' ? 'Other' : (DEVICE_LABELS[value] ?? value)
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* The figures in text, because a wedge angle is not a number. */}
                <Table
                  size="small"
                  rowKey="device"
                  dataSource={devices}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  columns={[
                    {
                      title: 'Device',
                      dataIndex: 'device',
                      render: (value: string) =>
                        value === 'other' ? 'Other' : (DEVICE_LABELS[value] ?? value),
                    },
                    { title: 'Visitors', dataIndex: 'visitors', align: 'right' },
                    {
                      title: 'Share',
                      key: 'share',
                      align: 'right',
                      render: (_value, row) =>
                        totalDeviceVisitors === 0
                          ? 'n/a'
                          : `${Math.round((row.visitors / totalDeviceVisitors) * 100)}%`,
                    },
                  ]}
                />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Top pages" style={{ height: '100%' }}>
            <Table
              size="small"
              rowKey="path"
              dataSource={summary?.topPaths ?? []}
              pagination={false}
              loading={isLoading}
              scroll={{ x: 'max-content', y: 320 }}
              locale={{ emptyText: 'No page views in this range.' }}
              columns={[
                { title: 'Path', dataIndex: 'path', ellipsis: true },
                { title: 'Views', dataIndex: 'views', align: 'right', width: 84 },
                { title: 'Visitors', dataIndex: 'visitors', align: 'right', width: 96 },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Top referrers" style={{ height: '100%' }}>
            <Table
              size="small"
              rowKey="referrer"
              dataSource={summary?.topReferrers ?? []}
              pagination={false}
              loading={isLoading}
              scroll={{ x: 'max-content', y: 320 }}
              locale={{ emptyText: 'No external referrers in this range.' }}
              columns={[
                { title: 'Referrer', dataIndex: 'referrer', ellipsis: true },
                { title: 'Views', dataIndex: 'views', align: 'right', width: 84 },
                { title: 'Visitors', dataIndex: 'visitors', align: 'right', width: 96 },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <div>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          This installation
        </Typography.Title>
        <Typography.Text className="tf-muted">
          Accounts and storage, counted by the database rather than by the event stream. Storage
          growth follows the range above; the active-user counts and the retention cohorts carry
          their own windows, noted on each.
        </Typography.Text>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space size={6}>
                  <TeamOutlined aria-hidden />
                  <span>Active today</span>
                </Space>
              }
              value={installation?.activeUsers?.daily ?? 0}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              Signed in within 24 hours
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space size={6}>
                  <TeamOutlined aria-hidden />
                  <span>Active this week</span>
                </Space>
              }
              value={installation?.activeUsers?.weekly ?? 0}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              Signed in within 7 days
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title={
                <Space size={6}>
                  <TeamOutlined aria-hidden />
                  <span>Active this month</span>
                </Space>
              }
              value={installation?.activeUsers?.monthly ?? 0}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              Signed in within 30 days
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Retention by weekly cohort" style={{ height: '100%' }}>
            {retentionCurve.length === 0 ? (
              <Typography.Text className="tf-muted">
                No cohorts have completed a week yet.
              </Typography.Text>
            ) : (
              <>
                {/* One series, so no legend box: the card title names it. */}
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={retentionCurve}
                      margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                    >
                      <CartesianGrid stroke={chart.grid} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: chart.axis, fontSize: 12 }}
                        tickLine={false}
                        axisLine={{ stroke: chart.grid }}
                        interval="preserveStartEnd"
                        minTickGap={16}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: chart.axis, fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(value: number) => `${value}%`}
                      />
                      <RechartsTooltip
                        contentStyle={chart.tooltipStyle}
                        cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                        formatter={(value: unknown) =>
                          (value === null || value === undefined
                            ? ['No accounts in this cohort', '']
                            : [`${Number(value)}% still active`, '']) as [string, string]
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        name="Retained"
                        stroke={seriesColor(chart, 0)}
                        strokeWidth={2}
                        dot={{ r: 3, strokeWidth: 2, stroke: chart.surface }}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: chart.surface }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <Typography.Paragraph className="tf-muted" style={{ fontSize: 12, marginTop: 12 }}>
                  Each point is one signup week: the share of the accounts created that week who
                  have signed in within the last 7 days. Counted from last sign-in, so a long-lived
                  session that never signs in again is not counted. These figures are a floor.
                </Typography.Paragraph>

                <details>
                  <summary
                    style={{ cursor: 'pointer', color: 'var(--tf-text-muted)', fontSize: 13 }}
                  >
                    View as a table
                  </summary>
                  <Table
                    size="small"
                    style={{ marginTop: 12 }}
                    rowKey="key"
                    dataSource={retentionRows}
                    pagination={false}
                    scroll={{ x: 'max-content', y: 280 }}
                    columns={[
                      { title: 'Cohort (w/c)', dataIndex: 'cohort' },
                      // `users`, not `cohortSize`. There is also no week-offset
                      // column, because the API reports one observation per
                      // cohort rather than a cohort-by-week matrix.
                      { title: 'Accounts', dataIndex: 'users', align: 'right' },
                      { title: 'Retained', dataIndex: 'retained', align: 'right' },
                      {
                        title: 'Rate',
                        key: 'rate',
                        align: 'right',
                        // The server already sends `rate`, and it is null rather
                        // than 0 for an empty cohort; recomputing it here would
                        // discard that distinction.
                        render: (_value, row) =>
                          row.rate === null ? 'n/a' : formatRate(row.rate),
                      },
                    ]}
                  />
                </details>
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title={
              <Space size={6}>
                <CloudServerOutlined aria-hidden />
                <span>Storage growth</span>
              </Space>
            }
            style={{ height: '100%' }}
          >
            {storageSeries.length === 0 ? (
              <Typography.Text className="tf-muted">No storage history yet.</Typography.Text>
            ) : (
              <>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={storageSeries}
                      margin={{ top: 8, right: 8, bottom: 0, left: -6 }}
                    >
                      <defs>
                        <linearGradient id="tf-storage" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={seriesColor(chart, 0)} stopOpacity={0.28} />
                          <stop
                            offset="100%"
                            stopColor={seriesColor(chart, 0)}
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
                        minTickGap={16}
                      />
                      <YAxis
                        tick={{ fill: chart.axis, fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={64}
                        tickFormatter={(value: number) => formatBytes(value)}
                      />
                      <RechartsTooltip
                        contentStyle={chart.tooltipStyle}
                        cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                        formatter={(value: unknown) =>
                          [formatBytes(Number(value)), 'Stored'] as [string, string]
                        }
                      />
                      {/* The running total, not the daily delta: a growth curve
                          plotted from `addedBytes` would describe uploads. The
                          server seeds it from before the window for exactly this
                          reason, so the line never restarts at zero. */}
                      <Area
                        type="monotone"
                        dataKey="cumulativeBytes"
                        name="Stored"
                        stroke={seriesColor(chart, 0)}
                        strokeWidth={2}
                        fill="url(#tf-storage)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: chart.surface }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary
                    style={{ cursor: 'pointer', color: 'var(--tf-text-muted)', fontSize: 13 }}
                  >
                    View as a table
                  </summary>
                  <Table
                    size="small"
                    style={{ marginTop: 12 }}
                    rowKey="date"
                    dataSource={storageSeries}
                    pagination={false}
                    scroll={{ x: 'max-content', y: 280 }}
                    columns={[
                      { title: 'Date', dataIndex: 'date' },
                      {
                        title: 'Added',
                        dataIndex: 'addedBytes',
                        align: 'right',
                        render: (value: number) => formatBytes(value),
                      },
                      {
                        title: 'Stored',
                        dataIndex: 'cumulativeBytes',
                        align: 'right',
                        render: (value: number) => formatBytes(value),
                      },
                    ]}
                  />
                </details>
              </>
            )}
          </Card>
        </Col>
      </Row>

      {initialSettings ? (
        <Card title="Collection settings">
          <SettingsForm<AnalyticsSettings> sectionKey="analytics" initialValues={initialSettings}>
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item
                  name="retentionDays"
                  label="Retention (days)"
                  extra="Events older than this are deleted by the retention job. 1 to 730."
                  rules={[{ required: true, message: 'Enter a number of days' }]}
                >
                  <InputNumber
                    min={1}
                    max={730}
                    style={{ width: '100%' }}
                    aria-label="Retention in days"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="respectDoNotTrack"
                  label="Honour Do Not Track"
                  valuePropName="checked"
                  extra="Declines collection when the browser sends DNT: 1, even if consent was given."
                >
                  <Switch checkedChildren="On" unCheckedChildren="Off" aria-label="Honour Do Not Track" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="excludeAdminTraffic"
                  label="Exclude your own visits"
                  valuePropName="checked"
                  extra="Keeps root and admin page views out of these numbers."
                >
                  <Switch
                    checkedChildren="Excluded"
                    unCheckedChildren="Counted"
                    aria-label="Exclude administrator traffic"
                  />
                </Form.Item>
              </Col>
            </Row>
          </SettingsForm>
        </Card>
      ) : null}
    </Space>
  );
}
