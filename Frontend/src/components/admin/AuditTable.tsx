'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs, { type Dayjs } from 'dayjs';
import { LockOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  DatePicker,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { swrFetcher } from '@/lib/api';
import { AUDIT_ACTIONS, type AuditListResponse } from '@/components/admin/admin-types';
import type { AdminUsersResponse } from '@/components/admin/admin-types';
import type { AuditEntry } from '@/types/api';
import {
  DEFAULT_AUDIT_QUERY,
  auditEndpoint,
  type AuditQuery,
} from '@/components/admin/admin-queries';

/** Colour by verb family, with the action text always present beside it. */
function actionColor(action: string): string {
  if (action.startsWith('user.delete') || action.includes('purge') || action.includes('bulk_delete')) {
    return 'red';
  }
  if (action.startsWith('settings.')) return 'purple';
  if (action.startsWith('auth.')) return 'blue';
  if (action.startsWith('user.')) return 'geekblue';
  return 'default';
}

interface Props {
  initial: AuditListResponse | null;
  initialQuery?: AuditQuery;
}

export function AuditTable({ initial, initialQuery = DEFAULT_AUDIT_QUERY }: Props) {
  const [query, setQuery] = useState<AuditQuery>(initialQuery);

  const endpoint = auditEndpoint(query);
  const initialEndpoint = auditEndpoint(initialQuery);

  const { data, error, isLoading, isValidating, mutate } = useSWR<AuditListResponse>(
    endpoint,
    swrFetcher,
    {
      ...(initial && endpoint === initialEndpoint ? { fallbackData: initial } : {}),
      keepPreviousData: true,
    },
  );

  /*
   * The API filters actors by id, not by username. Loading a page of accounts
   * lets the filter be a name, which is the only form an operator has when they
   * are looking at the log because something happened.
   */
  const { data: userPage } = useSWR<AdminUsersResponse>(
    '/api/admin/users?page=1&pageSize=100&sort=username&order=asc',
    swrFetcher,
  );

  const patchQuery = useCallback((patch: Partial<AuditQuery>) => {
    setQuery((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const rangeValue = useMemo<[Dayjs | null, Dayjs | null] | null>(() => {
    if (!query.from && !query.to) return null;
    return [query.from ? dayjs(query.from) : null, query.to ? dayjs(query.to) : null];
  }, [query.from, query.to]);

  const columns = useMemo<TableProps<AuditEntry>['columns']>(
    () => [
      {
        title: 'When',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 170,
        render: (value: string) => (
          <Tooltip title={dayjs(value).format('dddd D MMMM YYYY, HH:mm:ss')}>
            <span>{dayjs(value).format('D MMM YYYY, HH:mm')}</span>
          </Tooltip>
        ),
      },
      {
        title: 'Action',
        dataIndex: 'action',
        key: 'action',
        render: (action: string) => <Tag color={actionColor(action)}>{action}</Tag>,
      },
      {
        title: 'Actor',
        dataIndex: 'actorUsername',
        key: 'actorUsername',
        render: (username: string | null, row) =>
          username ? (
            <Space direction="vertical" size={0}>
              <Typography.Text>{username}</Typography.Text>
              {row.actorId === null ? (
                <Typography.Text className="tf-muted" style={{ fontSize: 11 }}>
                  account since deleted
                </Typography.Text>
              ) : null}
            </Space>
          ) : (
            <Typography.Text className="tf-muted">system</Typography.Text>
          ),
      },
      {
        title: 'Target',
        key: 'target',
        render: (_value, row) =>
          row.targetType ? (
            <Space direction="vertical" size={0}>
              <Typography.Text style={{ fontSize: 13 }}>{row.targetType}</Typography.Text>
              {row.targetId ? (
                <Typography.Text
                  className="tf-muted"
                  style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
                  copyable={{ text: row.targetId }}
                >
                  {row.targetId.length > 12 ? `${row.targetId.slice(0, 8)}...` : row.targetId}
                </Typography.Text>
              ) : null}
            </Space>
          ) : (
            <Typography.Text className="tf-muted">none</Typography.Text>
          ),
      },
      {
        title: 'IP address',
        dataIndex: 'ipAddress',
        key: 'ipAddress',
        render: (value: string | null) =>
          value ?? <Typography.Text className="tf-muted">not recorded</Typography.Text>,
      },
    ],
    [],
  );

  const rows = data?.entries ?? [];
  const pagination = data?.pagination;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Audit log
          </Typography.Title>
          <Typography.Text className="tf-muted">
            {pagination
              ? `${pagination.total.toLocaleString()} recorded event${pagination.total === 1 ? '' : 's'}`
              : 'Loading...'}
          </Typography.Text>
        </div>

        <Button icon={<ReloadOutlined />} onClick={() => void mutate()} loading={isValidating}>
          Refresh
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        icon={<LockOutlined />}
        message="Read-only, by design."
        description="The table is append-only: the API has no route that edits or deletes an entry, so an administrator covering their tracks would have to reach the database directly. Nothing on this screen changes anything."
      />

      <Space wrap size={12}>
        <Select
          value={query.action || undefined}
          onChange={(value) => patchQuery({ action: value ?? '' })}
          allowClear
          showSearch
          placeholder="Any action"
          aria-label="Filter by action"
          style={{ width: 230 }}
          options={AUDIT_ACTIONS.map((action) => ({ value: action, label: action }))}
        />

        <Select
          value={query.actorId || undefined}
          onChange={(value) => patchQuery({ actorId: value ?? '' })}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Any actor"
          aria-label="Filter by actor"
          style={{ width: 230 }}
          options={(userPage?.users ?? []).map((user) => ({
            value: user.id,
            label: `${user.username} · ${user.role}`,
          }))}
          notFoundContent="No matching accounts"
        />

        <DatePicker.RangePicker
          value={rangeValue}
          onChange={(value) => {
            const start = value?.[0];
            const end = value?.[1];
            patchQuery({
              from: start ? start.startOf('day').toISOString() : '',
              to: end ? end.endOf('day').toISOString() : '',
            });
          }}
          aria-label="Filter by date range"
          allowEmpty={[true, true]}
        />

        <Button
          onClick={() => setQuery(DEFAULT_AUDIT_QUERY)}
          disabled={!query.action && !query.actorId && !query.from && !query.to}
        >
          Clear filters
        </Button>
      </Space>

      <span role="status" aria-live="polite" className="tf-muted" style={{ fontSize: 13 }}>
        {isLoading
          ? 'Loading audit entries...'
          : pagination
            ? `Showing ${rows.length} of ${pagination.total.toLocaleString()}.`
            : ''}
      </span>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load the audit log"
          description={error instanceof Error ? error.message : 'The API did not answer.'}
        />
      ) : null}

      <Table<AuditEntry>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        size="middle"
        scroll={{ x: 'max-content' }}
        expandable={{
          // Metadata is arbitrary JSON per action, so it gets a row of its own
          // rather than a column that would be empty for half the entries.
          rowExpandable: (row) => row.metadata !== null && Object.keys(row.metadata).length > 0,
          expandedRowRender: (row) => (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Metadata
              </Typography.Text>
              <pre
                style={{
                  margin: '8px 0 0',
                  padding: '0.75rem 1rem',
                  background: 'var(--tf-surface-raised)',
                  border: '1px solid var(--tf-border)',
                  borderRadius: 8,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  overflowX: 'auto',
                  maxHeight: 320,
                }}
              >
                {JSON.stringify(row.metadata, null, 2)}
              </pre>
            </div>
          ),
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
    </Space>
  );
}
