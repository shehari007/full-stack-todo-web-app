'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Alert, App, Button, Card, Empty, Modal, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableProps } from 'antd';
import {
  ApiOutlined,
  BarChartOutlined,
  BookOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { CreateTokenModal } from '@/components/tokens/CreateTokenModal';
import { TokenRevealModal } from '@/components/tokens/TokenRevealModal';
import { SCOPE_INFO, TOKEN_SCOPES, isKnownScope } from '@/components/tokens/token-scopes';
import type { ApiTokenSummary, ApiTokenUsagePoint, TokenScope } from '@/types/api';

dayjs.extend(relativeTime);

export const TOKENS_KEY = '/api/tokens';

/**
 * `GET /api/tokens`.
 *
 * `availableScopes` is the server's own scope list, shipped with the tokens so
 * the create form offers what this build understands rather than a copy that
 * can drift. Optional because an older API will not send it.
 */
export interface TokensResponse {
  tokens: ApiTokenSummary[];
  availableScopes?: string[];
}

/** How close to expiry a token has to be before the row starts warning about it. */
const EXPIRY_WARNING_DAYS = 7;

const MONOSPACE = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

type TokenState = 'active' | 'expiring' | 'expired' | 'revoked';

function tokenState(token: ApiTokenSummary): TokenState {
  if (token.revokedAt) return 'revoked';
  if (!token.expiresAt) return 'active';

  const expiry = dayjs(token.expiresAt);
  if (expiry.isBefore(dayjs())) return 'expired';
  return expiry.isBefore(dayjs().add(EXPIRY_WARNING_DAYS, 'day')) ? 'expiring' : 'active';
}

/** Revoked and expired tokens are history, not tools, so nothing may be done to them. */
function isUsable(token: ApiTokenSummary): boolean {
  const state = tokenState(token);
  return state === 'active' || state === 'expiring';
}

/* -------------------------------------------------------------------------- */
/* Usage detail                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The per-day rollup behind the 30-day figure in the table.
 *
 * Fetched on open rather than with the list: it is one query per token, and most
 * visits to this page are to create or revoke something, not to audit traffic.
 */
function UsageModal({ token, onClose }: { token: ApiTokenSummary | null; onClose: () => void }) {
  const { data, error, isLoading } = useSWR<{ usage: ApiTokenUsagePoint[] }>(
    token ? `${TOKENS_KEY}/${token.id}/usage` : null,
    swrFetcher,
  );

  const rows = useMemo(
    () => [...(data?.usage ?? [])].sort((a, b) => b.day.localeCompare(a.day)),
    [data],
  );

  const total = rows.reduce((sum, row) => sum + row.requestCount, 0);

  return (
    <Modal
      open={token !== null}
      title={token ? `Usage: ${token.name}` : 'Usage'}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      destroyOnHidden
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load usage"
          description={error instanceof ApiError ? error.message : undefined}
        />
      ) : (
        <>
          <Typography.Paragraph className="tf-muted">
            Requests counted per calendar day, in UTC. {total.toLocaleString()} in the
            last 30 days.
          </Typography.Paragraph>

          <Table<ApiTokenUsagePoint>
            rowKey="day"
            size="small"
            loading={isLoading}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 'max-content', y: 320 }}
            locale={{ emptyText: <Empty description="This token has not been used yet" /> }}
            columns={[
              {
                title: 'Day',
                dataIndex: 'day',
                key: 'day',
                render: (day: string) => dayjs(day).format('D MMM YYYY'),
              },
              {
                title: 'Requests',
                dataIndex: 'requestCount',
                key: 'requestCount',
                align: 'right',
                render: (count: number) => count.toLocaleString(),
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function NoTokens({ onCreate }: { onCreate: () => void }) {
  return (
    <Empty
      image={<ApiOutlined aria-hidden style={{ fontSize: '2.75rem', color: 'var(--tf-text-subtle)' }} />}
      styles={{ image: { height: 'auto', marginBottom: '0.75rem' } }}
      description={
        <Space direction="vertical" size={6} style={{ maxWidth: '46ch', margin: '0 auto' }}>
          <Typography.Text strong>No API tokens yet</Typography.Text>
          <Typography.Text className="tf-muted">
            A token lets something outside TaskFlow read your own tasks: a widget on
            your website, a status page, a script. It is read-only, it only ever sees
            your data, and you can revoke it at any moment.
          </Typography.Text>
        </Space>
      }
    >
      <Space wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          Create your first token
        </Button>
        <Link href="/docs/api">
          <Button icon={<BookOutlined />}>Read the API docs</Button>
        </Link>
      </Space>
    </Empty>
  );
}

/* -------------------------------------------------------------------------- */
/* Tokens page                                                                */
/* -------------------------------------------------------------------------- */

export function TokensView({ initial }: { initial: TokensResponse | null }) {
  const { message, modal } = App.useApp();

  const { data, error, isLoading, isValidating, mutate } = useSWR<TokensResponse>(
    TOKENS_KEY,
    swrFetcher,
    // Null means the server render could not reach the API. Seeding an empty
    // array there would show "no tokens yet" to somebody who has several.
    initial ? { fallbackData: initial } : undefined,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [usageFor, setUsageFor] = useState<ApiTokenSummary | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  /** Plaintext lives here for the life of the reveal dialog and nowhere else. */
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);

  const tokens = data?.tokens ?? [];

  /*
   * What the create form may offer. The server's list wins; the local constant
   * is only a fallback for an API that predates the field, or one whose list is
   * entirely unknown to this build, which would otherwise leave the form with
   * no checkboxes at all.
   */
  const availableScopes = useMemo<readonly TokenScope[]>(() => {
    const fromApi = data?.availableScopes?.filter(isKnownScope) ?? [];
    return fromApi.length > 0 ? fromApi : TOKEN_SCOPES;
  }, [data?.availableScopes]);

  function confirmRevoke(token: ApiTokenSummary) {
    modal.confirm({
      title: `Revoke "${token.name}"?`,
      content:
        'Anything using this token stops working immediately. This cannot be undone: you would need to create a new token and update wherever it is used.',
      okText: 'Revoke token',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevoking(token.id);
        try {
          await api.delete(`${TOKENS_KEY}/${token.id}`);
          message.success(`"${token.name}" has been revoked`);
          await mutate();
        } catch (revokeError) {
          message.error(
            revokeError instanceof ApiError ? revokeError.message : 'Could not revoke that token',
          );
        } finally {
          setRevoking(null);
        }
      },
    });
  }

  const columns = useMemo<TableProps<ApiTokenSummary>['columns']>(
    () => [
      {
        title: 'Name',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left',
        render: (name: string, row) => {
          const state = tokenState(row);

          return (
            <Space direction="vertical" size={2}>
              <Typography.Text
                strong
                delete={state === 'revoked'}
                type={state === 'revoked' ? 'secondary' : undefined}
              >
                {name}
              </Typography.Text>
              <Space size={4} wrap>
                {state === 'revoked' ? <Tag>Revoked</Tag> : null}
                {state === 'expired' ? <Tag color="error">Expired</Tag> : null}
                <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                  Created {dayjs(row.createdAt).format('D MMM YYYY')}
                </Typography.Text>
              </Space>
            </Space>
          );
        },
      },
      {
        title: 'Token',
        dataIndex: 'tokenPrefix',
        key: 'tokenPrefix',
        render: (prefix: string) => (
          <Tooltip title="The first characters only. The rest was shown once, at creation.">
            <span style={{ fontFamily: MONOSPACE, fontSize: 13, whiteSpace: 'nowrap' }}>
              {prefix}
              <span className="tf-muted">...</span>
            </span>
          </Tooltip>
        ),
      },
      {
        title: 'Scopes',
        dataIndex: 'scopes',
        key: 'scopes',
        render: (scopes: TokenScope[]) => (
          <Space size={4} wrap>
            {scopes.length === 0 ? (
              <Typography.Text className="tf-muted">None</Typography.Text>
            ) : (
              scopes.map((scope) => (
                <Tooltip key={scope} title={SCOPE_INFO[scope]?.grants ?? scope}>
                  <Tag style={{ fontFamily: MONOSPACE, fontSize: 12, marginInlineEnd: 0 }}>
                    {scope}
                  </Tag>
                </Tooltip>
              ))
            )}
          </Space>
        ),
      },
      {
        title: 'Last used',
        dataIndex: 'lastUsedAt',
        key: 'lastUsedAt',
        render: (lastUsedAt: string | null, row) =>
          lastUsedAt ? (
            <Tooltip
              title={`${dayjs(lastUsedAt).format('D MMM YYYY, HH:mm')}${
                row.lastUsedIp ? ` from ${row.lastUsedIp}` : ''
              }`}
            >
              {/* The relative string differs between the server render and the
                  client, which is a hydration warning over a few seconds. */}
              <span suppressHydrationWarning>{dayjs(lastUsedAt).fromNow()}</span>
            </Tooltip>
          ) : (
            <Typography.Text className="tf-muted">Never</Typography.Text>
          ),
      },
      {
        title: 'Requests (30 days)',
        dataIndex: 'requestCount30d',
        key: 'requestCount30d',
        align: 'right',
        render: (count: number, row) => (
          <Button
            type="link"
            size="small"
            icon={<BarChartOutlined />}
            onClick={() => setUsageFor(row)}
            aria-label={`Show daily usage for ${row.name}`}
          >
            {count.toLocaleString()}
          </Button>
        ),
      },
      {
        title: 'Expires',
        dataIndex: 'expiresAt',
        key: 'expiresAt',
        render: (expiresAt: string | null, row) => {
          const state = tokenState(row);

          if (!expiresAt) {
            return (
              <Tooltip title="This token works until you revoke it.">
                <Typography.Text className="tf-muted">Never</Typography.Text>
              </Tooltip>
            );
          }

          if (state === 'expired') {
            return (
              <Typography.Text className="tf-muted">
                {dayjs(expiresAt).format('D MMM YYYY')}
              </Typography.Text>
            );
          }

          if (state === 'expiring') {
            return (
              <Tooltip title={dayjs(expiresAt).format('D MMM YYYY, HH:mm')}>
                <Tag color="warning" icon={<WarningOutlined />}>
                  <span suppressHydrationWarning>Expires {dayjs(expiresAt).fromNow()}</span>
                </Tag>
              </Tooltip>
            );
          }

          return (
            <Tooltip title={dayjs(expiresAt).format('D MMM YYYY, HH:mm')}>
              <span>{dayjs(expiresAt).format('D MMM YYYY')}</span>
            </Tooltip>
          );
        },
      },
      {
        title: 'Actions',
        key: 'actions',
        fixed: 'right',
        align: 'right',
        render: (_value, row) =>
          isUsable(row) ? (
            <Button
              danger
              size="small"
              loading={revoking === row.id}
              onClick={() => confirmRevoke(row)}
              aria-label={`Revoke the token named ${row.name}`}
            >
              Revoke
            </Button>
          ) : (
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              {row.revokedAt ? `Revoked ${dayjs(row.revokedAt).format('D MMM YYYY')}` : 'Inactive'}
            </Typography.Text>
          ),
      },
    ],
    /*
     * `confirmRevoke` is recreated every render but only closes over values that
     * are stable for the life of the page (the antd App context and SWR's
     * `mutate`), so capturing an older instance changes nothing. `revoking` is
     * the one value the columns actually have to react to.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revoking],
  );

  const showEmptyState = !isLoading && !error && tokens.length === 0;

  return (
    <div className="tf-stack">
      <header className="tf-page-header">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            API tokens
          </Typography.Title>
          <Typography.Text className="tf-muted">
            Read-only keys that let your own website or scripts fetch your tasks.
          </Typography.Text>
        </div>

        <Space wrap>
          <Link href="/docs/api">
            <Button icon={<BookOutlined />}>API docs</Button>
          </Link>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New token
          </Button>
        </Space>
      </header>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load your tokens"
          description={error instanceof ApiError ? error.message : 'The API did not answer.'}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void mutate()}>
              Retry
            </Button>
          }
        />
      ) : null}

      <Card>
        {showEmptyState ? (
          <NoTokens onCreate={() => setCreateOpen(true)} />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
              <Typography.Text className="tf-muted">
                A token can only read, never write. Revoke anything you no longer
                recognise; nothing else about your account changes.
              </Typography.Text>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void mutate()}
                loading={isValidating}
              >
                Refresh
              </Button>
            </Space>

            <Table<ApiTokenSummary>
              rowKey="id"
              columns={columns}
              dataSource={tokens}
              loading={isLoading}
              size="middle"
              pagination={false}
              // Seven columns do not fit a 360px screen; without this the page
              // itself scrolls sideways instead of the table.
              scroll={{ x: 'max-content' }}
            />
          </Space>
        )}
      </Card>

      <CreateTokenModal
        open={createOpen}
        availableScopes={availableScopes}
        onClose={() => setCreateOpen(false)}
        onCreated={(token, name) => {
          setCreateOpen(false);
          setRevealed({ token, name });
          void mutate();
        }}
      />

      <TokenRevealModal
        open={revealed !== null}
        token={revealed?.token ?? null}
        tokenName={revealed?.name ?? ''}
        // Dropped rather than kept: a secret left in component state is a secret
        // sitting in a heap snapshot.
        onClose={() => setRevealed(null)}
      />

      <UsageModal token={usageFor} onClose={() => setUsageFor(null)} />
    </div>
  );
}
