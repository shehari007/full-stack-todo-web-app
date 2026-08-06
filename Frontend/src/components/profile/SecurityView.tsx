'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import { Alert, App, Button, Card, Form, Input, Space, Tabs, Typography } from 'antd';
import {
  DesktopOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { MfaSetup } from '@/components/profile/MfaSetup';
import { SessionList, SESSIONS_KEY } from '@/components/profile/SessionList';
import { DangerZone } from '@/components/profile/DangerZone';
import type { SessionInfo, User } from '@/types/api';

interface PasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** Mirrors `passwordSchema` on the API so the first rejection is client-side. */
const MIN_PASSWORD_LENGTH = 12;

function ChangePassword({ username }: { username: string }) {
  const { message } = App.useApp();
  const { mutate } = useSWRConfig();
  const [form] = Form.useForm<PasswordValues>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const newPassword = Form.useWatch('newPassword', form) ?? '';

  async function submit(values: PasswordValues) {
    setBusy(true);
    setStatus('Changing your password...');
    try {
      const result = await api.post<{ message: string }>('/api/auth/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      form.resetFields();
      setStatus(result.message);
      message.success(result.message);

      // The API revokes every other session on a password change, so the list on
      // the next tab is stale the moment this succeeds.
      await mutate(SESSIONS_KEY);
    } catch (error) {
      setStatus('');
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (fields) {
          form.setFields(
            Object.entries(fields).map(([name, errors]) => ({
              name: name as keyof PasswordValues,
              errors,
            })),
          );
        }
        message.error(error.message);
      } else {
        message.error('Could not change your password');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 480 }}>
      <Typography.Paragraph className="tf-muted" style={{ marginBottom: 0 }}>
        Changing your password signs out every other device. This one stays signed in.
      </Typography.Paragraph>

      <Form<PasswordValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void submit(values)}
        disabled={busy}
      >
        {/* Hidden, but present for password managers: without a username field
            they cannot tell which saved credential this form is updating. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />

        <Form.Item
          name="currentPassword"
          label="Current password"
          rules={[{ required: true, message: 'Enter your current password' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="New password"
          rules={[
            { required: true, message: 'Choose a new password' },
            {
              min: MIN_PASSWORD_LENGTH,
              message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <div style={{ marginTop: '-0.75rem', marginBottom: '1rem' }}>
          <PasswordStrength value={newPassword} />
        </div>

        <Form.Item
          name="confirmPassword"
          label="Confirm new password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Type the new password again' },
            {
              validator: (_rule, value: string) =>
                !value || value === form.getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('The two passwords do not match')),
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" icon={<LockOutlined />} loading={busy}>
            Change password
          </Button>
        </Form.Item>
      </Form>

      <div aria-live="polite" className="tf-muted" style={{ fontSize: '0.85rem' }}>
        {status}
      </div>
    </Space>
  );
}

export function SecurityView({
  user,
  initialSessions,
}: {
  user: User;
  initialSessions: SessionInfo[];
}) {
  const { user: liveUser } = useAuth();
  const current = liveUser ?? user;

  return (
    <div className="tf-stack">
      <header className="tf-page-header">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Security
          </Typography.Title>
          <Typography.Text className="tf-muted">
            Password, two-factor authentication, signed-in devices and account deletion.
          </Typography.Text>
        </div>
        <Link href="/profile">
          <Button icon={<UserOutlined />}>Back to profile</Button>
        </Link>
      </header>

      {!current.mfaEnabled ? (
        <Alert
          type="warning"
          showIcon
          message="Two-factor authentication is off"
          description="A password on its own is one leak away from being someone else's. Setting up an authenticator app takes about a minute."
        />
      ) : null}

      <Card>
        {/* Tabs scroll horizontally rather than wrapping, which is what keeps the
            four sections reachable at 360px. */}
        <Tabs
          defaultActiveKey="password"
          items={[
            {
              key: 'password',
              label: (
                <span>
                  <LockOutlined aria-hidden /> Password
                </span>
              ),
              children: <ChangePassword username={current.username} />,
            },
            {
              key: 'mfa',
              label: (
                <span>
                  <SafetyCertificateOutlined aria-hidden /> Two-factor
                </span>
              ),
              children: <MfaSetup />,
            },
            {
              key: 'sessions',
              label: (
                <span>
                  <DesktopOutlined aria-hidden /> Devices
                </span>
              ),
              children: <SessionList initialSessions={initialSessions} />,
            },
            {
              key: 'danger',
              label: (
                <span>
                  <WarningOutlined aria-hidden /> Danger zone
                </span>
              ),
              children: <DangerZone user={current} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
