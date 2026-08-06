'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import dayjs from 'dayjs';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  LockOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
  StopOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Avatar,
  Button,
  Dropdown,
  Input,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps, TableProps } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import { swrFetcher } from '@/lib/api';
import { formatBytes } from '@/components/admin/format';
import { canAct, canCreateUser, type ActorRef, type AdminAction } from '@/components/admin/permissions';
import { UserActionModal, type UserModalAction } from '@/components/admin/UserActionModal';
import type { AdminUserRow, AdminUsersResponse, UserSortField } from '@/components/admin/admin-types';
import type { UserRole, UserStatus } from '@/types/api';
// Re-exported so existing imports keep working; defined in a non-client module
// because the server pages call them too.
import {
  DEFAULT_USERS_QUERY,
  usersEndpoint,
  type UsersQuery,
} from '@/components/admin/admin-queries';

const ROLE_TAG: Record<UserRole, { color: string; label: string }> = {
  root: { color: 'red', label: 'Root' },
  admin: { color: 'blue', label: 'Admin' },
  user: { color: 'default', label: 'User' },
};

/** The row menu, in the order an operator escalates through it. */
const ACTIONS: Array<{ key: AdminAction; label: string; icon: React.ReactNode; danger?: boolean }> = [
  { key: 'edit', label: 'Edit details', icon: <EditOutlined /> },
  { key: 'change-role', label: 'Change role', icon: <SwapOutlined /> },
  { key: 'set-quota', label: 'Set storage quota', icon: <SafetyOutlined /> },
  { key: 'reactivate', label: 'Reactivate', icon: <PlayCircleOutlined /> },
  { key: 'suspend', label: 'Suspend', icon: <StopOutlined />, danger: true },
  { key: 'reset-password', label: 'Reset password', icon: <KeyOutlined />, danger: true },
  { key: 'reset-mfa', label: 'Reset MFA', icon: <ReloadOutlined />, danger: true },
  { key: 'delete', label: 'Delete account', icon: <DeleteOutlined />, danger: true },
];

interface Props {
  actor: ActorRef;
  initial: AdminUsersResponse | null;
  initialQuery?: UsersQuery;
}

export function UsersTable({ actor, initial, initialQuery = DEFAULT_USERS_QUERY }: Props) {
  const [query, setQuery] = useState<UsersQuery>(initialQuery);
  const [searchDraft, setSearchDraft] = useState(initialQuery.search);
  const [pending, setPending] = useState<{ action: UserModalAction; target: AdminUserRow | null } | null>(
    null,
  );

  const endpoint = usersEndpoint(query);
  const initialEndpoint = usersEndpoint(initialQuery);

  const { data, error, isLoading, isValidating, mutate } = useSWR<AdminUsersResponse>(
    endpoint,
    swrFetcher,
    {
      // The server render only answers for the first page; any other key has to
      // be fetched, and seeding it with page-1 rows would show the wrong data.
      ...(initial && endpoint === initialEndpoint ? { fallbackData: initial } : {}),
      keepPreviousData: true,
    },
  );

  const rows = data?.users ?? [];
  const pagination = data?.pagination;

  const patchQuery = useCallback((patch: Partial<UsersQuery>) => {
    // Any filter change invalidates the current page number: page 4 of a
    // 3-page result set comes back empty.
    setQuery((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const handleTableChange: TableProps<AdminUserRow>['onChange'] = (nextPagination, _filters, sorter) => {
    const single = (Array.isArray(sorter) ? sorter[0] : sorter) as SorterResult<AdminUserRow> | undefined;
    const field = single?.field;

    setQuery((current) => ({
      ...current,
      page: nextPagination.current ?? 1,
      pageSize: nextPagination.pageSize ?? current.pageSize,
      // Clearing the sort returns to the default rather than to no order at all,
      // which the API would reject.
      sort: single?.order && typeof field === 'string' ? (field as UserSortField) : 'createdAt',
      order: single?.order === 'ascend' ? 'asc' : 'desc',
    }));
  };

  const columns = useMemo<TableProps<AdminUserRow>['columns']>(
    () => [
      {
        title: 'Account',
        dataIndex: 'username',
        key: 'username',
        sorter: true,
        fixed: 'left',
        render: (_value, row) => (
          <Space size={10}>
            <Avatar
              size={32}
              src={row.avatarId ? `/api/attachments/${row.avatarId}` : undefined}
              icon={<UserOutlined />}
              alt=""
            />
            <span style={{ minWidth: 0 }}>
              <Typography.Text strong style={{ display: 'block' }}>
                {row.username}
                {row.id === actor.id ? (
                  <Tag style={{ marginInlineStart: 6 }}>You</Tag>
                ) : null}
              </Typography.Text>
              <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                {row.displayName ?? 'no display name'}
              </Typography.Text>
            </span>
          </Space>
        ),
      },
      {
        title: 'Email',
        dataIndex: 'email',
        key: 'email',
        sorter: true,
        render: (value: string) => <Typography.Text copyable={{ text: value }}>{value}</Typography.Text>,
      },
      {
        title: 'Role',
        dataIndex: 'role',
        key: 'role',
        sorter: true,
        render: (role: UserRole) => {
          const tag = ROLE_TAG[role];
          return <Tag color={tag.color}>{tag.label}</Tag>;
        },
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (status: UserStatus, row) => (
          <Space direction="vertical" size={2}>
            {/* Icon plus wording, so the state is never carried by colour alone. */}
            <Tag
              color={status === 'active' ? 'success' : 'error'}
              icon={status === 'active' ? <CheckCircleOutlined /> : <MinusCircleOutlined />}
            >
              {status === 'active' ? 'Active' : 'Suspended'}
            </Tag>
            {row.lockedUntil && dayjs(row.lockedUntil).isAfter(dayjs()) ? (
              <Tag color="warning" icon={<LockOutlined />}>
                Locked until {dayjs(row.lockedUntil).format('HH:mm')}
              </Tag>
            ) : null}
          </Space>
        ),
      },
      {
        title: 'MFA',
        dataIndex: 'mfaEnabled',
        key: 'mfaEnabled',
        render: (enabled: boolean) =>
          enabled ? (
            <Space size={4}>
              <SafetyOutlined aria-hidden />
              <span>Enrolled</span>
            </Space>
          ) : (
            <Typography.Text className="tf-muted">Not enrolled</Typography.Text>
          ),
      },
      {
        title: 'Storage',
        dataIndex: 'storageUsedBytes',
        key: 'storageUsedBytes',
        sorter: true,
        render: (used: number, row) => {
          const quota = row.storageQuotaBytes;
          const percent = quota && quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

          return (
            <span style={{ display: 'inline-block', minWidth: 140 }}>
              <Typography.Text style={{ fontSize: 13 }}>
                {formatBytes(used)}
                <span className="tf-muted"> / {quota === null ? 'role default' : formatBytes(quota)}</span>
              </Typography.Text>
              {quota !== null && quota > 0 ? (
                <Progress
                  percent={percent}
                  size="small"
                  showInfo={false}
                  status={percent >= 90 ? 'exception' : 'normal'}
                  aria-label={`${percent}% of quota used`}
                />
              ) : null}
            </span>
          );
        },
      },
      {
        title: 'Last sign-in',
        dataIndex: 'lastLoginAt',
        key: 'lastLoginAt',
        sorter: true,
        render: (value: string | null) =>
          value ? (
            <Tooltip title={dayjs(value).format('D MMM YYYY, HH:mm')}>
              <span>{dayjs(value).format('D MMM YYYY')}</span>
            </Tooltip>
          ) : (
            <Typography.Text className="tf-muted">Never</Typography.Text>
          ),
      },
      {
        title: 'Created',
        dataIndex: 'createdAt',
        key: 'createdAt',
        sorter: true,
        defaultSortOrder: 'descend',
        render: (value: string) => dayjs(value).format('D MMM YYYY'),
      },
      {
        title: 'Actions',
        key: 'actions',
        fixed: 'right',
        align: 'right',
        render: (_value, row) => {
          /*
           * Every entry is gated by the same helper the server's guard is
           * mirrored from (see permissions.ts). Refused actions stay in the menu
           * but disabled with the reason attached: hiding them would leave an
           * admin wondering whether the feature exists at all, and the tooltip
           * is the only place the "only root manages admins" rule is ever
           * explained to them.
           */
          const items: MenuProps['items'] = ACTIONS.map((entry) => {
            const permission = canAct(actor, row, entry.key);

            return {
              key: entry.key,
              icon: entry.icon,
              danger: entry.danger === true && permission.allowed,
              disabled: !permission.allowed,
              label: permission.allowed ? (
                entry.label
              ) : (
                <Tooltip title={permission.reason} placement="left">
                  <span>{entry.label}</span>
                </Tooltip>
              ),
            };
          });

          return (
            <Dropdown
              trigger={['click']}
              menu={{
                items,
                onClick: ({ key }) => setPending({ action: key as AdminAction, target: row }),
              }}
            >
              <Button
                type="text"
                icon={<MoreOutlined />}
                aria-label={`Actions for ${row.username}`}
              />
            </Dropdown>
          );
        },
      },
    ],
    [actor],
  );

  const createPermission = canCreateUser(actor);

  return (
    <>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="tf-page-header" style={{ marginBottom: 0 }}>
          <div>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Users
            </Typography.Title>
            <Typography.Text className="tf-muted">
              {pagination
                ? `${pagination.total} account${pagination.total === 1 ? '' : 's'}`
                : 'Loading accounts...'}
            </Typography.Text>
          </div>

          <Tooltip title={createPermission.reason}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!createPermission.allowed}
              onClick={() => setPending({ action: 'create', target: null })}
            >
              New account
            </Button>
          </Tooltip>
        </div>

        <Space wrap size={12} style={{ width: '100%' }}>
          <Input.Search
            allowClear
            placeholder="Search username, email or display name"
            aria-label="Search accounts"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            // Searching on submit rather than per keystroke: each one is a
            // paginated query with an ILIKE across three columns.
            onSearch={(value) => patchQuery({ search: value.trim() })}
            style={{ width: 'min(340px, 100%)' }}
          />

          <Select<UserRole | ''>
            value={query.role}
            onChange={(value) => patchQuery({ role: value })}
            style={{ width: 150 }}
            aria-label="Filter by role"
            options={[
              { value: '', label: 'Any role' },
              { value: 'root', label: 'Root' },
              { value: 'admin', label: 'Admin' },
              { value: 'user', label: 'User' },
            ]}
          />

          <Select<UserStatus | ''>
            value={query.status}
            onChange={(value) => patchQuery({ status: value })}
            style={{ width: 160 }}
            aria-label="Filter by status"
            options={[
              { value: '', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />

          <Button icon={<ReloadOutlined />} onClick={() => void mutate()} loading={isValidating}>
            Refresh
          </Button>
        </Space>

        <span role="status" aria-live="polite" className="tf-muted" style={{ fontSize: 13 }}>
          {isLoading
            ? 'Loading accounts...'
            : pagination
              ? `Showing ${rows.length} of ${pagination.total}.`
              : ''}
        </span>

        {error ? (
          <Alert
            type="error"
            showIcon
            message="Could not load accounts"
            description={error instanceof Error ? error.message : 'The API did not answer.'}
          />
        ) : null}

        <Table<AdminUserRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={isLoading}
          onChange={handleTableChange}
          // Without this the eight columns force a horizontal scroll on the page
          // itself, which breaks the layout on a 360px screen.
          scroll={{ x: 'max-content' }}
          size="middle"
          pagination={{
            current: pagination?.page ?? query.page,
            pageSize: pagination?.pageSize ?? query.pageSize,
            total: pagination?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 25, 50, 100],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
          }}
        />
      </Space>

      <UserActionModal
        action={pending?.action ?? null}
        target={pending?.target ?? null}
        onClose={() => setPending(null)}
        onDone={() => void mutate()}
      />
    </>
  );
}
