'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import dayjs from 'dayjs';
import {
  CheckCircleOutlined,
  CloudServerOutlined,
  FileOutlined,
  SafetyOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Progress, Row, Space, Statistic, Table, Typography } from 'antd';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { swrFetcher } from '@/lib/api';
import { seriesColor, useChartTheme } from '@/components/admin/chart-theme';
import { formatBytes, formatRate } from '@/components/admin/format';
import { signupSeriesOf, type AdminOverviewResponse } from '@/components/admin/admin-types';

const ENDPOINT = '/api/admin/overview';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  hint?: string;
}

function StatCard({ title, value, icon, hint }: StatCardProps) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic
        title={
          <Space size={6}>
            <span aria-hidden>{icon}</span>
            <span>{title}</span>
          </Space>
        }
        value={value as string | number}
        valueStyle={{ fontSize: 26, fontWeight: 600 }}
      />
      {hint ? (
        <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      ) : null}
    </Card>
  );
}

export function OverviewClient({ initial }: { initial: AdminOverviewResponse | null }) {
  const chart = useChartTheme();

  /*
   * Seeded from the server render so the cards have their numbers on first
   * paint; SWR then refreshes them when the tab regains focus. `initial` is null
   * only when the API was unreachable during the render.
   */
  const { data, error, isLoading } = useSWR<AdminOverviewResponse>(ENDPOINT, swrFetcher, {
    ...(initial ? { fallbackData: initial } : {}),
    revalidateOnFocus: true,
  });

  const overview = data?.overview;

  const series = useMemo(() => {
    if (!overview) return [];
    return signupSeriesOf(overview).map((point) => ({
      ...point,
      // The axis has room for 14 of these only if they are short.
      label: dayjs(point.date).format('D MMM'),
    }));
  }, [overview]);

  const totalSignups = useMemo(
    () => series.reduce((sum, point) => sum + point.count, 0),
    [series],
  );

  if (!overview) {
    return (
      <Alert
        type="error"
        showIcon
        message="Could not load the overview"
        description={
          error instanceof Error
            ? error.message
            : 'The API did not answer. The figures below would be stale, so none are shown.'
        }
      />
    );
  }

  const completionRate =
    overview.totalTodos === 0 ? 0 : overview.completedTodos / overview.totalTodos;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Overview
          </Typography.Title>
          <Typography.Text className="tf-muted">
            Everything on this installation, counted by the database.
          </Typography.Text>
        </div>
        <Space wrap>
          <Link href="/admin/users">
            <Button icon={<TeamOutlined />}>Manage users</Button>
          </Link>
          <Link href="/admin/analytics">
            <Button type="primary">Traffic analytics</Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Total users"
            value={overview.totalUsers}
            icon={<TeamOutlined />}
            hint={`${overview.activeUsers} active, ${overview.totalUsers - overview.activeUsers} suspended`}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="New this week"
            value={overview.newUsersThisWeek}
            icon={<UserAddOutlined />}
            hint="Accounts created in the last 7 days"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Tasks"
            value={overview.totalTodos}
            icon={<UnorderedListOutlined />}
            hint={`${overview.completedTodos} done (${formatRate(completionRate)})`}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="Attachments"
            value={overview.totalAttachments}
            icon={<FileOutlined />}
            hint={`${formatBytes(overview.storageUsedBytes)} stored`}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title="Signups, last 14 days"
            extra={
              <Typography.Text className="tf-muted" style={{ fontSize: 13 }}>
                {totalSignups} in total
              </Typography.Text>
            }
            loading={isLoading && series.length === 0}
          >
            {series.length === 0 ? (
              <Typography.Text className="tf-muted">No signup data yet.</Typography.Text>
            ) : (
              <>
                {/* One series, so no legend box: the card title names it. */}
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="tf-signups" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={seriesColor(chart, 0)} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={seriesColor(chart, 0)} stopOpacity={0.02} />
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
                        allowDecimals={false}
                        tick={{ fill: chart.axis, fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                      />
                      <RechartsTooltip
                        contentStyle={chart.tooltipStyle}
                        cursor={{ stroke: chart.axis, strokeWidth: 1 }}
                        formatter={(value: unknown) => [String(value), 'Signups'] as [string, string]}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Signups"
                        stroke={seriesColor(chart, 0)}
                        strokeWidth={2}
                        fill="url(#tf-signups)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: chart.surface }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* The same numbers without the chart, for anyone who cannot use it. */}
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
                    scroll={{ x: 'max-content', y: 240 }}
                    columns={[
                      { title: 'Date', dataIndex: 'date' },
                      { title: 'Signups', dataIndex: 'count', align: 'right' },
                    ]}
                  />
                </details>
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="MFA adoption">
              <Space align="center" size={20} wrap>
                <Progress
                  type="circle"
                  size={110}
                  percent={Math.round(overview.mfaAdoptionRate * 100)}
                  strokeColor={seriesColor(chart, 0)}
                  aria-label={`Multi-factor authentication is enabled on ${formatRate(overview.mfaAdoptionRate)} of accounts`}
                />
                <div>
                  <Typography.Paragraph className="tf-muted" style={{ marginBottom: 4 }}>
                    <SafetyOutlined aria-hidden />{' '}
                    {Math.round(overview.mfaAdoptionRate * overview.totalUsers)} of{' '}
                    {overview.totalUsers} accounts have a second factor enrolled.
                  </Typography.Paragraph>
                  <Link href="/admin/features">
                    <Button size="small" icon={<CheckCircleOutlined />}>
                      Require MFA for admins
                    </Button>
                  </Link>
                </div>
              </Space>
            </Card>

            <Card title="Storage">
              <Statistic
                title="Used by attachments"
                value={formatBytes(overview.storageUsedBytes)}
                prefix={<CloudServerOutlined aria-hidden />}
                valueStyle={{ fontSize: 26, fontWeight: 600 }}
              />
              <Typography.Paragraph className="tf-muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Every stored byte, including site assets, which belong to the installation rather
                than to any one account&apos;s quota.
              </Typography.Paragraph>
              <Link href="/admin/limits">
                <Button size="small" style={{ marginTop: 12 }}>
                  Adjust storage limits
                </Button>
              </Link>
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
