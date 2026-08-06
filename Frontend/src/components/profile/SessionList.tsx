'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Alert, App, Button, Empty, List, Space, Tag, Tooltip, Typography } from 'antd';
import {
  DesktopOutlined,
  GlobalOutlined,
  LogoutOutlined,
  MobileOutlined,
  ReloadOutlined,
  TabletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import type { SessionInfo } from '@/types/api';

dayjs.extend(relativeTime);

export const SESSIONS_KEY = '/api/auth/sessions';

type DeviceKind = 'desktop' | 'mobile' | 'tablet';

/**
 * Browser matchers, in the order they must be tried.
 *
 * Order is the whole trick: Edge and Opera both put `Chrome` in their strings,
 * and every browser on iOS is obliged to say `Safari`. First match wins, so the
 * impersonators are listed before the browsers they impersonate.
 */
const BROWSERS: Array<[RegExp, string]> = [
  [/edga?\/|edgios\/|edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox\/|fxios\//i, 'Firefox'],
  [/crios\//i, 'Chrome'],
  [/chrome\//i, 'Chrome'],
  [/safari\//i, 'Safari'],
];

/** Android reports `Linux; Android`, so it has to be tested before Linux. */
const PLATFORMS: Array<[RegExp, string, DeviceKind]> = [
  [/windows nt/i, 'Windows', 'desktop'],
  [/iphone/i, 'iPhone', 'mobile'],
  [/ipad/i, 'iPad', 'tablet'],
  [/android/i, 'Android', 'mobile'],
  [/mac os x|macintosh/i, 'macOS', 'desktop'],
  [/cros/i, 'ChromeOS', 'desktop'],
  [/linux|x11/i, 'Linux', 'desktop'],
];

export function describeUserAgent(userAgent: string | null): {
  label: string;
  device: DeviceKind;
} {
  if (!userAgent) return { label: 'Unknown device', device: 'desktop' };

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent));

  const device: DeviceKind = platform?.[2] ?? 'desktop';
  const platformName = platform?.[1] ?? null;

  if (browser && platformName) return { label: `${browser} on ${platformName}`, device };
  if (browser) return { label: browser, device };
  if (platformName) return { label: platformName, device };

  return { label: 'Unknown device', device };
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  const style = { fontSize: '1.35rem', color: 'var(--tf-text-muted)' };
  if (kind === 'mobile') return <MobileOutlined aria-hidden style={style} />;
  if (kind === 'tablet') return <TabletOutlined aria-hidden style={style} />;
  return <DesktopOutlined aria-hidden style={style} />;
}

/**
 * Relative timestamps differ between the server render and the client, and the
 * server has no idea what timezone the reader is in. Suppressing the mismatch
 * keeps the server's text until the next render rather than logging a hydration
 * error over a difference of a few seconds.
 */
function When({ iso, prefix }: { iso: string | null; prefix: string }) {
  if (!iso) return <span className="tf-muted">{prefix} never</span>;

  return (
    <Tooltip title={dayjs(iso).format('D MMM YYYY, HH:mm')}>
      <span className="tf-muted" suppressHydrationWarning>
        {prefix} {dayjs(iso).fromNow()}
      </span>
    </Tooltip>
  );
}

export function SessionList({ initialSessions }: { initialSessions: SessionInfo[] }) {
  const { message, modal } = App.useApp();
  const { logout } = useAuth();

  const { data, error, isLoading, mutate } = useSWR<{ sessions: SessionInfo[] }>(
    SESSIONS_KEY,
    swrFetcher,
    { fallbackData: { sessions: initialSessions } },
  );

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const sessions = data?.sessions ?? [];

  async function revoke(session: SessionInfo) {
    setPendingId(session.id);
    try {
      await api.delete(`/api/auth/sessions/${session.id}`);

      if (session.current) {
        // The API has already cleared this browser's cookies, so there is
        // nothing left to render here.
        message.success('Signed out');
        await logout();
        return;
      }

      message.success('That device has been signed out');
      await mutate();
    } catch (error_) {
      message.error(
        error_ instanceof ApiError ? error_.message : 'Could not sign that device out',
      );
    } finally {
      setPendingId(null);
    }
  }

  function confirmRevokeAll() {
    modal.confirm({
      title: 'Sign out everywhere?',
      content:
        'Every device, including this one, will be signed out. You will need to sign in again.',
      okText: 'Sign out everywhere',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevokingAll(true);
        try {
          await api.post('/api/auth/sessions/revoke-all');
          message.success('All sessions signed out');
          await logout();
        } catch (error_) {
          message.error(
            error_ instanceof ApiError ? error_.message : 'Could not sign out everywhere',
          );
        } finally {
          setRevokingAll(false);
        }
      },
    });
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Paragraph className="tf-muted" style={{ marginBottom: 0 }}>
        Every browser and device currently signed in to your account. Anything you do
        not recognise should be signed out, and your password changed.
      </Typography.Paragraph>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load your sessions"
          description={error instanceof ApiError ? error.message : undefined}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void mutate()}>
              Retry
            </Button>
          }
        />
      ) : null}

      <div aria-live="polite">
        <List
          loading={isLoading && sessions.length === 0}
          locale={{ emptyText: <Empty description="No active sessions" /> }}
          dataSource={sessions}
          rowKey={(session) => session.id}
          renderItem={(session) => {
            const { label, device } = describeUserAgent(session.userAgent);

            return (
              <List.Item>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '0.75rem',
                    width: '100%',
                  }}
                >
                  <DeviceIcon kind={device} />

                  {/* min-width:0 lets a long user agent ellipsis instead of
                      forcing the row wider than a 360px viewport. */}
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <Space size={6} wrap>
                      <Typography.Text strong>{label}</Typography.Text>
                      {session.current ? <Tag color="processing">This device</Tag> : null}
                    </Space>

                    <div
                      className="tf-task__meta"
                      style={{ marginTop: '0.15rem', columnGap: '0.75rem' }}
                    >
                      <span>
                        <GlobalOutlined aria-hidden />{' '}
                        {session.ipAddress ?? 'IP address unknown'}
                      </span>
                      <When iso={session.lastUsedAt} prefix="Last used" />
                      <When iso={session.createdAt} prefix="Signed in" />
                    </div>
                  </div>

                  <Button
                    danger
                    loading={pendingId === session.id}
                    onClick={() => void revoke(session)}
                    aria-label={
                      session.current
                        ? 'Sign out of this device'
                        : `Sign out ${label}, last used ${
                            session.lastUsedAt ? dayjs(session.lastUsedAt).fromNow() : 'never'
                          }`
                    }
                  >
                    {session.current ? 'Sign out' : 'Revoke'}
                  </Button>
                </div>
              </List.Item>
            );
          }}
        />
      </div>

      <Space wrap>
        <Button icon={<ReloadOutlined />} onClick={() => void mutate()}>
          Refresh
        </Button>
        <Button
          danger
          icon={<LogoutOutlined />}
          loading={revokingAll}
          onClick={confirmRevokeAll}
          disabled={sessions.length === 0}
        >
          Sign out everywhere
        </Button>
      </Space>
    </Space>
  );
}
