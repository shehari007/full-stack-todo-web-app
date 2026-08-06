'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Grid,
  Input,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  CustomerServiceOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ApiError, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { NewTicketModal } from '@/components/support/NewTicketModal';
import {
  DEFAULT_TICKET_FILTERS,
  TICKET_PRIORITY_META,
  TICKET_STATUSES,
  TICKET_STATUS_META,
  UNREAD_COUNT_KEY,
  countActiveTicketFilters,
  lastActivityAt,
  parseTicketFilters,
  serialiseTicketFilters,
  ticketListPath,
  ticketReference,
  type Ticket,
  type TicketFilterState,
  type TicketListResponse,
} from '@/components/support/ticket-meta';

dayjs.extend(relativeTime);

const ABSOLUTE_FORMAT = 'D MMM YYYY, HH:mm';

/** Visible to a screen reader only. Inline because there is no global utility. */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

interface TicketListProps {
  initialData: TicketListResponse | null;
  initialFilters: TicketFilterState;
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

function NoTickets({ onCreate }: { onCreate: () => void }) {
  return (
    <Empty
      image={
        <CustomerServiceOutlined
          aria-hidden
          style={{ fontSize: '2.75rem', color: 'var(--tf-text-subtle)' }}
        />
      }
      styles={{ image: { height: 'auto', marginBottom: '0.75rem' } }}
      description={
        <Space direction="vertical" size={6} style={{ maxWidth: '46ch', margin: '0 auto' }}>
          <Typography.Text strong>No tickets yet</Typography.Text>
          <Typography.Text className="tf-muted">
            This is where you reach the people who run TaskFlow. Report something that
            is broken, ask how a feature is meant to work, or suggest one that is
            missing. Every ticket keeps its own thread, so the whole conversation stays
            in one place and you can pick it back up whenever you like.
          </Typography.Text>
        </Space>
      }
    >
      <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
        New ticket
      </Button>
    </Empty>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <Empty
      description={
        <Space direction="vertical" size={6}>
          <Typography.Text strong>Nothing matches those filters</Typography.Text>
          <Typography.Text className="tf-muted">
            Try a different status, or clear the search.
          </Typography.Text>
        </Space>
      }
    >
      <Button onClick={onClear}>Clear filters</Button>
    </Empty>
  );
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

export function TicketList({ initialData, initialFilters }: TicketListProps) {
  const { message } = App.useApp();
  const { settings } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const screens = Grid.useBreakpoint();
  const { mutate: globalMutate } = useSWRConfig();

  /*
   * The URL is the single source of truth for the filters, so the back button, a
   * reload and a pasted link can never disagree with what is on screen.
   */
  const filters = useMemo<TicketFilterState>(
    () => parseTicketFilters(searchParams),
    [searchParams],
  );

  const listPath = ticketListPath(filters);
  const initialPath = useRef(ticketListPath(initialFilters));

  const { data, error, isLoading, isValidating, mutate } = useSWR<TicketListResponse>(
    listPath,
    swrFetcher,
    {
      // Only the exact page the server rendered may seed the cache; any other
      // filter set has to be fetched.
      fallbackData: listPath === initialPath.current && initialData ? initialData : undefined,
      keepPreviousData: true,
    },
  );

  const [createOpen, setCreateOpen] = useState(false);
  // Mirrors the search box between keystrokes; the URL is only written on submit
  // so typing does not leave one history entry per character.
  const [searchDraft, setSearchDraft] = useState(filters.q);

  // Re-sync when the URL changes underneath us: "Clear" and the back button
  // both have to empty the box.
  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  const tickets = data?.tickets ?? [];
  const total = data?.pagination.total ?? 0;
  const activeFilterCount = countActiveTicketFilters(filters);

  /**
   * `support` is a newer public settings section, so an API on an older build
   * answers `/settings/public` without it. Read through an optional shape rather
   * than widening `PublicSettings`, and let the composer fall back to its own
   * list. A missing category list must not be what stops somebody reporting a
   * bug.
   */
  const categories = (settings as { support?: { categories?: string[] } }).support?.categories;

  /**
   * Write the filters to the address bar without a router navigation.
   *
   * `router.push` would re-run the server component and refetch the page SWR is
   * already loading: two requests for one filter change.
   */
  const applyFilters = useCallback(
    (patch: Partial<TicketFilterState>, history: 'replace' | 'push' = 'replace') => {
      const next: TicketFilterState = { ...filters, ...patch };

      // Narrowing the list invalidates the page number: page 3 of the old result
      // set is usually past the end of the new one.
      if (patch.page === undefined) next.page = 1;

      const search = serialiseTicketFilters(next);
      const url = search ? `${pathname}?${search}` : pathname;

      if (history === 'push') {
        window.history.pushState(null, '', url);
      } else {
        window.history.replaceState(null, '', url);
      }
    },
    [filters, pathname],
  );

  const clearFilters = useCallback(() => {
    setSearchDraft('');
    applyFilters({ ...DEFAULT_TICKET_FILTERS, pageSize: filters.pageSize });
  }, [applyFilters, filters.pageSize]);

  const columns = useMemo<TableProps<Ticket>['columns']>(
    () => [
      {
        title: 'Ticket',
        dataIndex: 'subject',
        key: 'subject',
        fixed: 'left',
        render: (subject: string, row) => (
          <Space direction="vertical" size={2} style={{ maxWidth: '38ch' }}>
            <Space size={6} wrap>
              <Typography.Text className="tf-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {ticketReference(row.number)}
              </Typography.Text>

              {row.unread ? (
                <>
                  {/*
                    The word is the indicator; the colour only reinforces it. A
                    tinted row or a bare dot would say nothing to anyone who
                    cannot see the difference.
                  */}
                  <Tag color="processing" variant="filled" style={{ marginInlineEnd: 0 }}>
                    New reply
                  </Tag>
                  <span style={SR_ONLY}>This ticket has an unread reply.</span>
                </>
              ) : null}
            </Space>

            <Link href={`/support/${row.id}`}>
              <Typography.Text
                strong={row.unread}
                style={{ overflowWrap: 'anywhere' }}
              >
                {subject}
              </Typography.Text>
            </Link>
          </Space>
        ),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (_status, row) => {
          const meta = TICKET_STATUS_META[row.status];
          const Icon = meta.icon;

          return (
            <Tooltip title={meta.hint}>
              <Tag color={meta.color} icon={<Icon />} style={{ marginInlineEnd: 0 }}>
                {meta.label}
              </Tag>
            </Tooltip>
          );
        },
      },
      {
        title: 'Priority',
        dataIndex: 'priority',
        key: 'priority',
        render: (_priority, row) => {
          const meta = TICKET_PRIORITY_META[row.priority];
          const Icon = meta.icon;

          return (
            <Tag color={meta.color} icon={<Icon />} style={{ marginInlineEnd: 0 }}>
              {meta.label}
            </Tag>
          );
        },
      },
      {
        title: 'Category',
        dataIndex: 'category',
        key: 'category',
        render: (category: string) => (
          <Typography.Text className="tf-muted" style={{ overflowWrap: 'anywhere' }}>
            {category}
          </Typography.Text>
        ),
      },
      {
        title: 'Last activity',
        key: 'lastActivity',
        render: (_value, row) => {
          const when = lastActivityAt(row);

          return (
            <Tooltip title={dayjs(when).format(ABSOLUTE_FORMAT)}>
              {/* The relative string is computed from "now", so the server render
                  and the hydration a moment later legitimately differ. */}
              <span suppressHydrationWarning style={{ whiteSpace: 'nowrap' }}>
                {dayjs(when).fromNow()}
              </span>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  const isCompact = !screens.md;
  const showFirstRunEmpty = !isLoading && !error && total === 0 && activeFilterCount === 0;
  const showNoMatches = !isLoading && !error && total === 0 && activeFilterCount > 0;

  const rangeStart = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const rangeEnd = Math.min(filters.page * filters.pageSize, total);
  const status = isLoading
    ? 'Loading your tickets...'
    : total === 0
      ? 'No tickets to show'
      : `Showing ${rangeStart} to ${rangeEnd} of ${total} ${total === 1 ? 'ticket' : 'tickets'}`;

  return (
    <div className="tf-stack" style={{ gap: '1.25rem' }}>
      <header className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={1} style={{ fontSize: '1.65rem', margin: 0 }}>
            Support
          </Typography.Title>
          <p className="tf-muted" style={{ margin: '0.2rem 0 0' }} aria-live="polite">
            {status}
          </p>
        </div>

        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          New ticket
        </Button>
      </header>

      <Card styles={{ body: { padding: '0.85rem' } }}>
        <Space wrap size={8} style={{ width: '100%' }}>
          <Input
            allowClear
            prefix={<SearchOutlined aria-hidden="true" />}
            placeholder="Search your tickets"
            aria-label="Search your tickets"
            value={searchDraft}
            style={{ width: isCompact ? '100%' : 260 }}
            onChange={(event) => {
              const value = event.target.value;
              setSearchDraft(value);
              // Emptying the box (with the × or the backspace key) takes effect
              // at once. Only a non-empty term waits for Enter, so the list never
              // stays filtered by a search that is no longer on screen.
              if (value === '') applyFilters({ q: '' });
            }}
            onPressEnter={() => applyFilters({ q: searchDraft.trim() })}
          />

          <Select
            allowClear
            placeholder="Any status"
            aria-label="Filter by status"
            value={filters.status}
            style={{ minWidth: 180 }}
            onChange={(value) => applyFilters({ status: value ?? null })}
            options={TICKET_STATUSES.map((entry) => ({
              value: entry,
              label: TICKET_STATUS_META[entry].label,
            }))}
          />

          {activeFilterCount > 0 ? <Button onClick={clearFilters}>Clear</Button> : null}

          <Button
            icon={<ReloadOutlined />}
            loading={isValidating && !isLoading}
            onClick={() => void mutate()}
          >
            Refresh
          </Button>
        </Space>
      </Card>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load your tickets"
          description={error instanceof ApiError ? error.message : 'The API did not answer.'}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void mutate()}>
              Retry
            </Button>
          }
        />
      ) : null}

      <Card>
        {showFirstRunEmpty ? (
          <NoTickets onCreate={() => setCreateOpen(true)} />
        ) : showNoMatches ? (
          <NoMatches onClear={clearFilters} />
        ) : (
          <Table<Ticket>
            rowKey="id"
            columns={columns}
            dataSource={tickets}
            loading={isLoading}
            size="middle"
            pagination={false}
            // Five columns do not fit a 360px screen; without this the page
            // itself scrolls sideways instead of the table.
            scroll={{ x: 'max-content' }}
          />
        )}
      </Card>

      {total > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            current={filters.page}
            pageSize={filters.pageSize}
            total={total}
            // The numbered variant overflows 360px as soon as the count reaches
            // double digits.
            simple={isCompact}
            size={isCompact ? 'small' : undefined}
            showSizeChanger={!isCompact}
            onChange={(page, pageSize) => applyFilters({ page, pageSize }, 'push')}
          />
        </div>
      ) : null}

      <NewTicketModal
        open={createOpen}
        categories={categories}
        onClose={() => setCreateOpen(false)}
        onCreated={(ticket) => {
          setCreateOpen(false);
          message.success(`Ticket ${ticketReference(ticket.number)} opened`);
          // The badge counts unread replies, not tickets, but the new row still
          // has to appear in a list the server rendered before it existed.
          void globalMutate(UNREAD_COUNT_KEY);
          router.push(`/support/${ticket.id}`);
        }}
      />
    </div>
  );
}
