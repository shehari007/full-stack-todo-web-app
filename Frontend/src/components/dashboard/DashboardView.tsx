'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import dayjs, { type Dayjs } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezonePlugin from 'dayjs/plugin/timezone';
import utcPlugin from 'dayjs/plugin/utc';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Skeleton,
  Statistic,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  FireOutlined,
  PlusOutlined,
  ReloadOutlined,
  RiseOutlined,
  SyncOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiError, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useThemeMode } from '@/providers/ThemeProvider';
import type { Todo, TodoPriority, TodoStats, User } from '@/types/api';

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);
dayjs.extend(relativeTime);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `timezone` comes from the user's profile and is only validated on write, so an
 * old or hand-edited row can still carry a name this build of the tz database
 * does not know, and `.tz()` throws on those. Falling back to the browser's zone
 * is better than a blank dashboard.
 */
function zoned(iso: string, timezone: string): Dayjs {
  try {
    return dayjs(iso).tz(timezone);
  } catch {
    return dayjs(iso);
  }
}

const PRIORITY_LABEL: Record<TodoPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Most severe first, so the chart reads top-down as a severity ladder. */
const PRIORITY_ORDER: TodoPriority[] = ['urgent', 'high', 'medium', 'low'];

const PRIORITY_TAG_COLOR: Record<TodoPriority, string> = {
  urgent: 'red',
  high: 'volcano',
  medium: 'gold',
  low: 'default',
};

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Visually hidden but read aloud, for the chart's table equivalent. */
const SR_ONLY: React.CSSProperties = {
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

interface TodoListResponse {
  todos: Todo[];
}

/* -------------------------------------------------------------------------- */
/* Link-shaped button                                                         */
/* -------------------------------------------------------------------------- */

/**
 * An Ant Design button that is a real anchor.
 *
 * Wrapping `<Button>` in next/link nests a button inside an anchor, which is
 * invalid and breaks keyboard activation; giving Button an `href` renders a
 * plain `<a>` but costs a full page load. Intercepting the plain left-click is
 * what keeps middle-click, ⌘-click and "copy link address" working while normal
 * clicks stay client-side transitions.
 */
function LinkButton({
  href,
  children,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Button>, 'href' | 'onClick' | 'children'>) {
  const router = useRouter();

  return (
    <Button
      {...rest}
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      {children}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat card                                                                  */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  icon,
  tone,
  note,
  emphasised,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: string;
  note?: React.ReactNode;
  emphasised?: boolean;
}) {
  const { token } = theme.useToken();

  return (
    <Card
      variant="outlined"
      styles={{ body: { padding: '1rem 1.15rem' } }}
      style={emphasised ? { borderColor: tone ?? token.colorError } : undefined}
    >
      <Statistic
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden="true" style={{ color: tone ?? token.colorTextTertiary }}>
              {icon}
            </span>
            {label}
          </span>
        }
        value={value}
        valueStyle={{ color: tone, fontWeight: 600 }}
      />
      {note ? (
        <div style={{ marginTop: 6, fontSize: '0.8125rem', color: token.colorTextSecondary }}>
          {note}
        </div>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Compact task list                                                          */
/* -------------------------------------------------------------------------- */

function TaskRow({ todo, now, timezone }: { todo: Todo; now: Dayjs; timezone: string }) {
  const { token } = theme.useToken();
  const due = todo.dueAt ? zoned(todo.dueAt, timezone) : null;
  const isOverdue = due !== null && todo.status !== 'done' && due.isBefore(now);

  return (
    <li className={`tf-task${todo.status === 'done' ? ' tf-task--done' : ''}`}>
      <span
        aria-hidden="true"
        style={{ marginTop: 2, color: isOverdue ? token.colorError : token.colorTextTertiary }}
      >
        {isOverdue ? <ExclamationCircleFilled /> : <ClockCircleOutlined />}
      </span>

      <div className="tf-task__body">
        <p className="tf-task__title">{todo.title}</p>
        <p className="tf-task__meta">
          <Tag color={PRIORITY_TAG_COLOR[todo.priority]} style={{ marginInlineEnd: 0 }}>
            {PRIORITY_LABEL[todo.priority]}
          </Tag>
          {due ? (
            <span style={isOverdue ? { color: token.colorError, fontWeight: 600 } : undefined}>
              {/* The word carries the state; the colour only reinforces it. */}
              {isOverdue ? 'Overdue, was due ' : 'Due '}
              <time dateTime={todo.dueAt ?? undefined}>{due.from(now)}</time>
            </span>
          ) : (
            <span>No due date</span>
          )}
        </p>
      </div>
    </li>
  );
}

function TaskListCard({
  title,
  icon,
  todos,
  total,
  approximate,
  now,
  timezone,
  href,
  linkLabel,
  emptyText,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  todos: Todo[];
  total: number;
  /** `total` is a lower bound rather than the real figure, rendered as "n+". */
  approximate?: boolean;
  now: Dayjs;
  timezone: string;
  href: string;
  linkLabel: string;
  emptyText: string;
  loading: boolean;
}) {
  const shown = todos.slice(0, 5);
  const hidden = Math.max(0, total - shown.length);

  return (
    <Card
      variant="outlined"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true">{icon}</span>
          {title}
          <Tag style={{ marginInlineStart: 4 }}>{approximate ? `${total}+` : total}</Tag>
        </span>
      }
      styles={{ body: { padding: '0.85rem' } }}
      style={{ height: '100%' }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      ) : shown.length === 0 ? (
        <Typography.Text type="secondary">{emptyText}</Typography.Text>
      ) : (
        <ul className="tf-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {shown.map((todo) => (
            <TaskRow key={todo.id} todo={todo} now={now} timezone={timezone} />
          ))}
        </ul>
      )}

      <div style={{ marginTop: '0.85rem' }}>
        <LinkButton href={href} type="link" style={{ paddingInline: 0 }}>
          {hidden > 0 ? `${linkLabel} (${hidden} more)` : linkLabel} <ArrowRightOutlined />
        </LinkButton>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Priority chart                                                             */
/* -------------------------------------------------------------------------- */

function PriorityBreakdown({ stats, mounted }: { stats: TodoStats; mounted: boolean }) {
  const { token } = theme.useToken();
  const { resolved } = useThemeMode();

  const data = PRIORITY_ORDER.map((priority) => ({
    priority,
    label: PRIORITY_LABEL[priority],
    count: stats.byPriority[priority],
  }));

  /*
   * One hue for every bar. Priority is already carried by the axis labels and by
   * the top-down severity order, so tinting each bar by its own value would burn
   * the colour channel restating the bar length, and a four-step ramp built
   * from the brand colour cannot hold its lightness gaps in both themes.
   *
   * Ant Design's dark `colorPrimary` sits close to the dark surface; the hover
   * step is the one that clears the contrast floor there.
   */
  const barColor = resolved === 'dark' ? token.colorPrimaryHover : token.colorPrimary;

  return (
    <>
      {/*
        Hidden from assistive technology in favour of the table below: an SVG of
        <rect>s conveys nothing, and the table is the same data without the
        pointer dependency.
      */}
      <div style={{ height: 190 }} aria-hidden="true">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
              barCategoryGap="30%"
            >
              <CartesianGrid horizontal={false} stroke={token.colorBorderSecondary} />
              {/* Every bar is directly labelled, so a numeric axis would only repeat it. */}
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={72}
                axisLine={false}
                tickLine={false}
                tick={{ fill: token.colorTextSecondary, fontSize: 12 }}
              />
              <RechartsTooltip
                cursor={{ fill: token.colorFillTertiary }}
                contentStyle={{
                  background: token.colorBgElevated,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                  color: token.colorText,
                }}
                labelStyle={{ color: token.colorText }}
                itemStyle={{ color: token.colorTextSecondary }}
              />
              <Bar
                dataKey="count"
                name="Tasks"
                fill={barColor}
                barSize={16}
                radius={[0, 4, 4, 0]}
              >
                <LabelList
                  dataKey="count"
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
        <caption>Tasks by priority</caption>
        <thead>
          <tr>
            <th scope="col">Priority</th>
            <th scope="col">Tasks</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.priority}>
              <th scope="row">{row.label}</th>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export function DashboardView({
  initialUser,
  initialStats,
  initialRecent,
  initialAgenda,
  statsKey,
  recentKey,
  agendaKey,
  agendaPageSize,
  nowIso,
}: {
  initialUser: User;
  initialStats: TodoStats | null;
  initialRecent: Todo[] | null;
  initialAgenda: Todo[] | null;
  statsKey: string;
  recentKey: string;
  agendaKey: string;
  /** How many rows `agendaKey` asks for. See `agendaSaturated` below. */
  agendaPageSize: number;
  nowIso: string;
}) {
  const { message } = App.useApp();
  const { user: liveUser } = useAuth();
  const { token } = theme.useToken();

  const user = liveUser ?? initialUser;
  const timezone = user.timezone || 'UTC';

  /*
   * Seeded from the server's clock so the first client render produces the same
   * greeting and the same overdue split, then replaced with the browser's clock
   * once mounted. `mounted` also gates the chart: ResponsiveContainer measures
   * its parent, and there is nothing to measure during SSR.
   */
  const [clockIso, setClockIso] = useState(nowIso);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setClockIso(new Date().toISOString());
    setMounted(true);
  }, []);

  const now = useMemo(() => zoned(clockIso, timezone), [clockIso, timezone]);

  const statsQuery = useSWR<{ stats: TodoStats }>(statsKey, swrFetcher, {
    fallbackData: initialStats ? { stats: initialStats } : undefined,
    keepPreviousData: true,
  });
  const recentQuery = useSWR<TodoListResponse>(recentKey, swrFetcher, {
    fallbackData: initialRecent ? { todos: initialRecent } : undefined,
    keepPreviousData: true,
  });
  const agendaQuery = useSWR<TodoListResponse>(agendaKey, swrFetcher, {
    fallbackData: initialAgenda ? { todos: initialAgenda } : undefined,
    keepPreviousData: true,
  });

  /*
   * Only a refresh the user asked for is allowed to show a busy state. SWR also
   * revalidates on mount and on focus, and reporting those would dim the cards
   * seconds after every page load for data that is almost always unchanged.
   */
  const [busy, setBusy] = useState(false);

  const { mutate: mutateStats } = statsQuery;
  const { mutate: mutateRecent } = recentQuery;
  const { mutate: mutateAgenda } = agendaQuery;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all([mutateStats(), mutateRecent(), mutateAgenda()]);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not refresh the dashboard.');
    } finally {
      setBusy(false);
    }
  }, [mutateStats, mutateRecent, mutateAgenda, message]);

  const failure = statsQuery.error ?? recentQuery.error ?? agendaQuery.error;
  const failureMessage =
    failure instanceof ApiError
      ? failure.message
      : failure
        ? 'Could not reach the API. The figures below may be out of date.'
        : null;

  const stats = statsQuery.data?.stats ?? null;
  const agenda = agendaQuery.data?.todos ?? [];
  const recent = recentQuery.data?.todos ?? [];

  const dayStart = now.startOf('day');
  const dayEnd = now.endOf('day');

  const overdueTasks = agenda.filter(
    (todo) => todo.dueAt !== null && todo.status !== 'done' && zoned(todo.dueAt, timezone).isBefore(now),
  );

  const dueTodayTasks = agenda.filter((todo) => {
    if (todo.dueAt === null || todo.status === 'done') return false;
    const due = zoned(todo.dueAt, timezone);
    return !due.isBefore(dayStart) && !due.isAfter(dayEnd);
  });

  const name = user.displayName?.trim() || user.username;
  const greeting = `${greetingFor(now.hour())}, ${name}`;

  const overdueHref = '/tasks?overdue=true&includeCompleted=false';
  const dueTodayHref = `/tasks?includeCompleted=false&dueFrom=${encodeURIComponent(
    dayStart.toISOString(),
  )}&dueTo=${encodeURIComponent(dayEnd.toISOString())}`;

  const completionPercent = stats ? Math.round(stats.completionRate * 100) : 0;

  return (
    <div className="tf-container" style={{ paddingInline: 0 }}>
      <header className="tf-page-header">
        <div>
          <Typography.Title level={2} style={{ margin: 0, fontSize: 'clamp(1.4rem, 4vw, 1.9rem)' }}>
            {greeting}
          </Typography.Title>
          <Typography.Text type="secondary">
            <CalendarOutlined aria-hidden="true" style={{ marginInlineEnd: 6 }} />
            <time dateTime={now.format('YYYY-MM-DD')}>{now.format('dddd, D MMMM YYYY')}</time>
            <span className="tf-muted"> · {timezone}</span>
          </Typography.Text>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* role="status" is already an aria-live="polite" region. */}
          <span role="status" style={SR_ONLY}>
            {busy ? 'Refreshing dashboard' : ''}
          </span>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={busy}>
            Refresh
          </Button>
          <LinkButton href="/tasks?new=1" type="primary" icon={<PlusOutlined />}>
            New task
          </LinkButton>
        </div>
      </header>

      {failureMessage ? (
        <Alert
          type="warning"
          showIcon
          closable
          message={failureMessage}
          style={{ marginBottom: '1rem' }}
        />
      ) : null}

      {stats === null ? (
        <Card variant="outlined">
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : stats.total === 0 ? (
        <Card variant="outlined" style={{ paddingBlock: '2rem' }}>
          <Empty
            description={
              <span>
                <strong style={{ display: 'block', marginBottom: 4 }}>Nothing here yet</strong>
                <Typography.Text type="secondary">
                  Tasks you add will show up here with their progress and due dates.
                </Typography.Text>
              </span>
            }
          >
            <LinkButton href="/tasks?new=1" type="primary" icon={<PlusOutlined />}>
              Create your first task
            </LinkButton>
          </Empty>
        </Card>
      ) : (
        <div className="tf-stack" style={{ gap: '1rem' }}>
          <div className="tf-grid">
            <StatCard
              label="Total"
              value={stats.total}
              icon={<UnorderedListOutlined />}
              note={`${stats.byStatus.todo} not started`}
            />
            <StatCard
              label="Completed"
              value={stats.byStatus.done}
              icon={<CheckCircleOutlined />}
              tone={token.colorSuccess}
              note={
                <>
                  <RiseOutlined aria-hidden="true" /> {stats.completedThisWeek} finished this week
                </>
              }
            />
            <StatCard
              label="In progress"
              value={stats.byStatus.in_progress}
              icon={<SyncOutlined />}
              tone={token.colorInfo}
              note={`${dueTodayTasks.length} due today`}
            />
            {/*
              Overdue is the one card that has to survive being read in
              greyscale, so it carries a filled warning glyph, a coloured border
              and the words "past their due date", not just red text.
            */}
            <StatCard
              label="Overdue"
              value={stats.overdue}
              icon={<ExclamationCircleFilled />}
              tone={stats.overdue > 0 ? token.colorError : undefined}
              emphasised={stats.overdue > 0}
              note={stats.overdue > 0 ? 'Past their due date' : 'Nothing past due'}
            />
          </div>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={10}>
              <Card variant="outlined" title="Completion" style={{ height: '100%' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: '1.25rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    role="img"
                    aria-label={`Completion rate ${completionPercent} percent: ${stats.byStatus.done} of ${stats.total} tasks done.`}
                  >
                    <Progress
                      type="dashboard"
                      percent={completionPercent}
                      size={138}
                      strokeColor={token.colorPrimary}
                    />
                  </div>

                  <div className="tf-stack" style={{ gap: '0.35rem', minWidth: 0 }}>
                    <Typography.Text strong>
                      {stats.byStatus.done} of {stats.total} done
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {stats.byStatus.in_progress} in progress · {stats.byStatus.todo} to do
                    </Typography.Text>
                    <Typography.Text>
                      <FireOutlined aria-hidden="true" style={{ color: token.colorWarning }} />{' '}
                      {stats.currentStreak === 0
                        ? 'No streak yet'
                        : `${stats.currentStreak}-day streak`}
                    </Typography.Text>
                  </div>
                </div>
              </Card>
            </Col>

            <Col xs={24} lg={14}>
              <Card
                variant="outlined"
                title="Tasks by priority"
                style={{ height: '100%' }}
                // Holding the previous render at reduced opacity avoids the
                // skeleton flash a refetch would otherwise cause.
                styles={{ body: { opacity: busy ? 0.6 : 1, transition: 'opacity 150ms ease' } }}
              >
                <PriorityBreakdown stats={stats} mounted={mounted} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={8}>
              <TaskListCard
                title="Overdue"
                icon={<ExclamationCircleFilled style={{ color: token.colorError }} />}
                todos={overdueTasks}
                total={stats.overdue}
                now={now}
                timezone={timezone}
                href={overdueHref}
                linkLabel="View overdue tasks"
                emptyText="Nothing is past its due date."
                loading={agendaQuery.isLoading}
              />
            </Col>

            <Col xs={24} md={12} xl={8}>
              <TaskListCard
                title="Due today"
                icon={<CalendarOutlined />}
                todos={dueTodayTasks}
                /*
                 * Counted from the list rather than from `stats.dueToday`: the
                 * API's figure includes tasks already ticked off today, which
                 * would put a number on the card that the rows below it cannot
                 * account for.
                 */
                total={dueTodayTasks.length}
                now={now}
                timezone={timezone}
                href={dueTodayHref}
                linkLabel="View today's tasks"
                emptyText="Nothing due today."
                loading={agendaQuery.isLoading}
              />
            </Col>

            <Col xs={24} xl={8}>
              <TaskListCard
                title="Recently added"
                icon={<ClockCircleOutlined />}
                todos={recent}
                total={recent.length}
                now={now}
                timezone={timezone}
                href="/tasks?sort=created&order=desc"
                linkLabel="View all tasks"
                emptyText="No tasks yet."
                loading={recentQuery.isLoading}
              />
            </Col>
          </Row>
        </div>
      )}
    </div>
  );
}
