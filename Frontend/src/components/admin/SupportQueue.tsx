'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  CustomerServiceOutlined,
  FlagOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  MoreOutlined,
  ReloadOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { ApiError, api, swrFetcher } from '@/lib/api';
import {
  TICKET_PRIORITY_META,
  TICKET_STATUSES,
  TICKET_STATUS_META,
  lastActivityAt,
  ticketDetailPath,
  ticketReference,
  type TicketPriority,
  type TicketSource,
  type TicketStatus,
} from '@/components/support/ticket-meta';
import {
  SUPPORT_STATS_KEY,
  staffStatusLabel,
  type AdminUsersResponse,
  type StaffTicketRow,
  type SupportQueueResponse,
  type SupportStatsResponse,
} from '@/components/admin/admin-types';
import {
  DEFAULT_SUPPORT_QUEUE_QUERY,
  UNASSIGNED,
  countActiveQueueFilters,
  supportQueueEndpoint,
  type SupportQueueQuery,
} from '@/components/admin/admin-queries';

dayjs.extend(relativeTime);

/**
 * The queue offers every priority, unlike the requester's composer.
 *
 * Read off the shared record rather than restated, so adding a priority to
 * `TICKET_PRIORITY_META` puts it in the filter and both menus at once.
 */
const TICKET_PRIORITIES = Object.keys(TICKET_PRIORITY_META) as TicketPriority[];

/** `listTicketsQuerySchema` caps `q` at 200 characters; past that it is a 422. */
const MAX_SEARCH_LENGTH = 200;

const SOURCE_LABEL: Record<TicketSource, string> = {
  app: 'In-app',
  contact: 'Contact form',
};

/**
 * One page of accounts, reused as the assignee list.
 *
 * There is no "list the staff" endpoint, and this one already exists and is
 * already readable by everyone who can open this screen. A hundred rows covers
 * any installation whose administrators would fit on a rota.
 */
const STAFF_KEY = '/api/admin/users?page=1&pageSize=100&sort=username&order=asc';

interface RequesterLabel {
  name: string;
  secondary: string | null;
  isGuest: boolean;
}

function requesterOf(row: StaffTicketRow): RequesterLabel {
  if (row.requester) {
    return {
      name: row.requester.username,
      secondary: row.requester.displayName,
      isGuest: false,
    };
  }

  // A contact-form submission carries whatever the visitor typed. Either field
  // may be blank, and a row with neither still has to render as something.
  return {
    name: row.guestName?.trim() || row.guestEmail?.trim() || 'Anonymous',
    secondary: row.guestName?.trim() ? row.guestEmail : null,
    isGuest: true,
  };
}

interface Props {
  actor: { id: string; username: string };
  initial: SupportQueueResponse | null;
  initialQuery?: SupportQueueQuery;
  /** From the `support` settings section, so the filter matches the composer. */
  categories: string[];
}

export function SupportQueue({
  actor,
  initial,
  initialQuery = DEFAULT_SUPPORT_QUEUE_QUERY,
  categories,
}: Props) {
  const { message } = App.useApp();
  const router = useRouter();

  const [query, setQuery] = useState<SupportQueueQuery>(initialQuery);
  const [searchDraft, setSearchDraft] = useState(initialQuery.q);
  const [busyId, setBusyId] = useState<string | null>(null);

  const endpoint = supportQueueEndpoint(query);
  const initialEndpoint = supportQueueEndpoint(initialQuery);

  const { data, error, isLoading, isValidating, mutate } = useSWR<SupportQueueResponse>(
    endpoint,
    swrFetcher,
    {
      // The server render only answers for the first page; seeding any other key
      // with those rows would show the wrong tickets under the wrong filter.
      ...(initial && endpoint === initialEndpoint ? { fallbackData: initial } : {}),
      keepPreviousData: true,
    },
  );

  /*
   * The headline figures. A separate endpoint rather than a key on the list
   * response: these count the whole installation, so they do not change when a
   * filter narrows the page below them.
   */
  const { data: stats, mutate: mutateStats } = useSWR<SupportStatsResponse>(
    SUPPORT_STATS_KEY,
    swrFetcher,
  );

  const { data: staffPage } = useSWR<AdminUsersResponse>(STAFF_KEY, swrFetcher);

  const staff = useMemo(
    () => (staffPage?.users ?? []).filter((user) => user.role !== 'user'),
    [staffPage],
  );

  const rows = data?.tickets ?? [];
  const pagination = data?.pagination;
  const counts = stats?.counts ?? null;
  const activeFilters = countActiveQueueFilters(query);

  const patchQuery = useCallback((patch: Partial<SupportQueueQuery>) => {
    // Any filter change invalidates the page number: page 4 of a 3-page result
    // set comes back empty.
    setQuery((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([mutate(), mutateStats()]);
  }, [mutate, mutateStats]);

  /**
   * One PATCH, then re-read both the page and the counts it just changed.
   *
   * The counts have to be re-read as well as the rows: resolving a ticket moves
   * it out of `open` and into `resolvedToday`, so refreshing only the table
   * leaves the cards above it contradicting the list below.
   */
  const applyPatch = useCallback(
    async (row: StaffTicketRow, patch: Record<string, unknown>, done: string) => {
      setBusyId(row.id);

      try {
        await api.patch(ticketDetailPath(row.id), patch);
        message.success(`${ticketReference(row.number)} ${done}`);
        await refreshAll();
      } catch (caught) {
        message.error(
          caught instanceof ApiError ? caught.message : 'Could not reach the server.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [message, refreshAll],
  );

  const handleAction = useCallback(
    (row: StaffTicketRow, key: string) => {
      if (key === 'open') {
        router.push(`/admin/support/${row.id}`);
        return;
      }

      if (key === 'assign-me') {
        void applyPatch(row, { assignedToId: actor.id }, 'is now assigned to you.');
        return;
      }

      const [kind, value] = key.split(':');

      if (kind === 'status' && value) {
        void applyPatch(
          row,
          { status: value },
          `is now ${staffStatusLabel(value as TicketStatus).toLowerCase()}.`,
        );
        return;
      }

      if (kind === 'priority' && value) {
        void applyPatch(
          row,
          { priority: value },
          `is now ${TICKET_PRIORITY_META[value as TicketPriority].label.toLowerCase()} priority.`,
        );
      }
    },
    [actor.id, applyPatch, router],
  );

  const columns = useMemo<TableProps<StaffTicketRow>['columns']>(
    () => [
      {
        title: 'Ticket',
        dataIndex: 'number',
        key: 'number',
        fixed: 'left',
        render: (_value, row) => (
          <Space size={6}>
            <Link
              href={`/admin/support/${row.id}`}
              style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
            >
              {ticketReference(row.number)}
            </Link>
            {/* A word, not a coloured dot: "nobody here has looked at this yet"
                has to survive being read out or seen in greyscale. `unread` is
                already resolved for the caller by the API. For anyone who can
                open this screen it is the queue's flag, not the requester's. */}
            {row.unread ? <Tag color="blue">New</Tag> : null}
          </Space>
        ),
      },
      {
        title: 'Subject',
        dataIndex: 'subject',
        key: 'subject',
        render: (subject: string, row) => (
          <Tooltip title={subject}>
            <Link
              href={`/admin/support/${row.id}`}
              style={{
                display: 'inline-block',
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom',
              }}
            >
              {subject}
            </Link>
          </Tooltip>
        ),
      },
      {
        title: 'Requester',
        key: 'requester',
        render: (_value, row) => {
          const who = requesterOf(row);

          return (
            <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
              <Space size={6} wrap>
                <Typography.Text>{who.name}</Typography.Text>
                {/* The distinction that matters when replying: there is no
                    account behind this person, only the address they typed. */}
                {who.isGuest ? <Tag>Guest</Tag> : null}
              </Space>
              {who.secondary ? (
                <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                  {who.secondary}
                </Typography.Text>
              ) : null}
              {row.source === 'contact' ? (
                <Typography.Text className="tf-muted" style={{ fontSize: 11 }}>
                  via the contact form
                </Typography.Text>
              ) : null}
            </Space>
          );
        },
      },
      {
        title: 'Category',
        dataIndex: 'category',
        key: 'category',
        render: (category: string) => <Tag>{category}</Tag>,
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (status: TicketStatus) => {
          const meta = TICKET_STATUS_META[status];
          const Icon = meta.icon;

          return (
            <Tooltip title={meta.hint}>
              <Tag color={meta.color} icon={<Icon />}>
                {staffStatusLabel(status)}
              </Tag>
            </Tooltip>
          );
        },
      },
      {
        title: 'Priority',
        dataIndex: 'priority',
        key: 'priority',
        render: (priority: TicketPriority) => {
          const meta = TICKET_PRIORITY_META[priority];
          const Icon = meta.icon;

          return (
            <Tag color={meta.color} icon={<Icon />}>
              {meta.label}
            </Tag>
          );
        },
      },
      {
        title: 'Assignee',
        key: 'assignee',
        render: (_value, row) =>
          row.assignee ? (
            <Space size={6}>
              <Typography.Text>{row.assignee.username}</Typography.Text>
              {row.assignee.id === actor.id ? <Tag color="blue">You</Tag> : null}
            </Space>
          ) : (
            <Typography.Text className="tf-muted">Unassigned</Typography.Text>
          ),
      },
      {
        title: 'Last activity',
        key: 'lastActivity',
        render: (_value, row) => {
          const when = lastActivityAt(row);

          return (
            <Tooltip title={dayjs(when).format('dddd D MMMM YYYY, HH:mm')}>
              <Space direction="vertical" size={0}>
                {/* Server and client disagree on "3 minutes ago" by a few
                    seconds; suppressing keeps the server's text rather than
                    logging a hydration error over it. */}
                <span suppressHydrationWarning>{dayjs(when).fromNow()}</span>
                {row.lastReplyByStaff ? null : (
                  <Typography.Text className="tf-muted" style={{ fontSize: 11 }}>
                    awaiting a reply
                  </Typography.Text>
                )}
              </Space>
            </Tooltip>
          );
        },
      },
      {
        title: 'Actions',
        key: 'actions',
        fixed: 'right',
        align: 'right',
        render: (_value, row) => {
          const items: MenuProps['items'] = [
            { key: 'open', icon: <FolderOpenOutlined />, label: 'Open thread' },
            {
              key: 'assign-me',
              icon: <UserSwitchOutlined />,
              label: 'Assign to me',
              disabled: row.assignee?.id === actor.id,
            },
            { type: 'divider' },
            {
              key: 'status',
              icon: <CheckCircleOutlined />,
              label: 'Change status',
              children: TICKET_STATUSES.map((status) => ({
                key: `status:${status}`,
                label: staffStatusLabel(status),
                disabled: row.status === status,
              })),
            },
            {
              key: 'priority',
              icon: <FlagOutlined />,
              label: 'Change priority',
              children: TICKET_PRIORITIES.map((priority) => ({
                key: `priority:${priority}`,
                label: TICKET_PRIORITY_META[priority].label,
                disabled: row.priority === priority,
              })),
            },
          ];

          return (
            <Dropdown
              trigger={['click']}
              menu={{ items, onClick: ({ key }) => handleAction(row, key) }}
            >
              <Button
                type="text"
                icon={<MoreOutlined />}
                loading={busyId === row.id}
                aria-label={`Actions for ticket ${ticketReference(row.number)}`}
              />
            </Dropdown>
          );
        },
      },
    ],
    [actor.id, busyId, handleAction],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Support queue
          </Typography.Title>
          <Typography.Text className="tf-muted">
            Every conversation on this installation, from the app and from the public contact form.
          </Typography.Text>
        </div>

        <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()} loading={isValidating}>
          Refresh
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title={
                <Space size={6}>
                  <InboxOutlined aria-hidden />
                  <span>Open</span>
                </Space>
              }
              // A placeholder while the figure is still in flight, never a zero:
              // "0 open tickets" is a claim, and it is the wrong one.
              value={counts ? counts.open : '...'}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              Not yet resolved or closed.
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title={
                <Space size={6}>
                  <BellOutlined aria-hidden />
                  <span>Awaiting reply</span>
                </Space>
              }
              value={counts ? counts.awaitingReply : '...'}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Space size={8} wrap>
              <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                Nobody here has answered yet.
              </Typography.Text>
              {/* The same predicate the card is counted with, so the rows this
                  reveals are exactly the ones in the figure above it. */}
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto' }}
                onClick={() => patchQuery({ unanswered: true })}
              >
                Show these
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic
              title={
                <Space size={6}>
                  <CheckCircleOutlined aria-hidden />
                  <span>Resolved today</span>
                </Space>
              }
              value={counts ? counts.resolvedToday : '...'}
              valueStyle={{ fontSize: 26, fontWeight: 600 }}
            />
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              Settled since midnight.
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap size={12} style={{ width: '100%' }}>
            {/* The one filter this screen exists for, so it is a button rather
                than the sixth entry in a row of dropdowns. `aria-pressed` is
                what carries its on/off state where the fill cannot. */}
            <Button
              type={query.unanswered ? 'primary' : 'default'}
              icon={<BellOutlined />}
              aria-pressed={query.unanswered}
              onClick={() => patchQuery({ unanswered: !query.unanswered })}
            >
              {query.unanswered ? 'Showing unanswered only' : 'Unanswered'}
            </Button>

            <Input.Search
              allowClear
              // Says what the API searches. `listFilters()` matches the subject
              // and the ticket number and deliberately never message bodies.
              // Searching those would mean repeating the `is_internal` predicate
              // inside the search, where getting it wrong leaks a staff note.
              placeholder="Search by subject or #number"
              aria-label="Search tickets by subject or number"
              maxLength={MAX_SEARCH_LENGTH}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              // On submit rather than per keystroke: each one is a paginated
              // query with a text search behind it.
              onSearch={(value) => patchQuery({ q: value.trim() })}
              style={{ width: 'min(320px, 100%)' }}
            />
          </Space>

          <Space wrap size={12} style={{ width: '100%' }}>
            <Select<TicketStatus | ''>
              value={query.status}
              onChange={(value) => patchQuery({ status: value })}
              style={{ width: 'min(190px, 100%)' }}
              aria-label="Filter by status"
              options={[
                { value: '', label: 'Any status' },
                ...TICKET_STATUSES.map((status) => ({
                  value: status,
                  label: staffStatusLabel(status),
                })),
              ]}
            />

            <Select<TicketPriority | ''>
              value={query.priority}
              onChange={(value) => patchQuery({ priority: value })}
              style={{ width: 'min(170px, 100%)' }}
              aria-label="Filter by priority"
              options={[
                { value: '', label: 'Any priority' },
                ...TICKET_PRIORITIES.map((priority) => ({
                  value: priority,
                  label: TICKET_PRIORITY_META[priority].label,
                })),
              ]}
            />

            <Select<string>
              value={query.category}
              onChange={(value) => patchQuery({ category: value })}
              style={{ width: 'min(200px, 100%)' }}
              aria-label="Filter by category"
              options={[
                { value: '', label: 'Any category' },
                ...categories.map((category) => ({ value: category, label: category })),
              ]}
            />

            <Select<string>
              value={query.assignedToId}
              onChange={(value) => patchQuery({ assignedToId: value })}
              style={{ width: 'min(210px, 100%)' }}
              aria-label="Filter by assignee"
              showSearch
              optionFilterProp="label"
              options={[
                { value: '', label: 'Anyone' },
                { value: UNASSIGNED, label: 'Unassigned' },
                ...staff.map((user) => ({
                  value: user.id,
                  label: user.id === actor.id ? `${user.username} (you)` : user.username,
                })),
              ]}
            />

            <Select<TicketSource | ''>
              value={query.source}
              onChange={(value) => patchQuery({ source: value })}
              style={{ width: 'min(170px, 100%)' }}
              aria-label="Filter by where the ticket came from"
              // Same two words the thread header uses for the same value, so a
              // ticket does not change what it is called between screens.
              options={[
                { value: '', label: 'Any source' },
                { value: 'app', label: SOURCE_LABEL.app },
                { value: 'contact', label: SOURCE_LABEL.contact },
              ]}
            />

            <Button
              onClick={() => {
                setQuery(DEFAULT_SUPPORT_QUEUE_QUERY);
                setSearchDraft('');
              }}
              disabled={activeFilters === 0}
            >
              Clear filters
            </Button>
          </Space>
        </Space>
      </Card>

      <span role="status" aria-live="polite" className="tf-muted" style={{ fontSize: 13 }}>
        {isLoading
          ? 'Loading tickets...'
          : pagination
            ? `Showing ${rows.length} of ${pagination.total.toLocaleString()}.`
            : ''}
      </span>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load the queue"
          description={error instanceof Error ? error.message : 'The API did not answer.'}
        />
      ) : null}

      <Table<StaffTicketRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        size="middle"
        // Nine columns force a horizontal scroll on the page itself without
        // this, which breaks the layout at 360px.
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: query.unanswered
            ? 'Nothing is waiting on a reply. The queue is clear.'
            : activeFilters > 0
              ? 'No tickets match these filters.'
              : 'Nothing has been raised yet.',
        }}
        onChange={(nextPagination) =>
          setQuery((current) => ({
            ...current,
            page: nextPagination.current ?? 1,
            pageSize: nextPagination.pageSize ?? current.pageSize,
          }))
        }
        pagination={{
          current: pagination?.page ?? query.page,
          pageSize: pagination?.pageSize ?? query.pageSize,
          total: pagination?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100],
          showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
        }}
      />

      <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
        <CustomerServiceOutlined aria-hidden /> Replies and internal notes are written inside a
        thread. Open one to answer it.
      </Typography.Text>
    </Space>
  );
}
