'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  CameraOutlined,
  DeleteOutlined,
  DesktopOutlined,
  MailOutlined,
  MoonOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useThemeMode, type ThemeMode } from '@/providers/ThemeProvider';
import { StorageMeter } from '@/components/profile/StorageMeter';
import type { User } from '@/types/api';

/**
 * Shape of `GET /api/profile/stats`.
 *
 * Declared here rather than in `@/types/api` because it is the only screen that
 * consumes it, and the dates arrive as ISO strings rather than the `Date`
 * objects the server's own `ProfileStats` interface describes.
 */
export interface ProfileStats {
  todos: {
    active: number;
    byStatus: { todo: number; inProgress: number; done: number };
    overdue: number;
    inTrash: number;
  };
  attachments: { count: number };
  storage: {
    usedBytes: number;
    quotaBytes: number;
    remainingBytes: number;
    percentUsed: number;
  };
  account: {
    createdAt: string;
    ageDays: number;
    lastLoginAt: string | null;
    mfaEnabled: boolean;
    activeSessions: number;
  };
}

interface ProfileFormValues {
  displayName: string;
  bio: string;
  timezone: string;
  locale: string;
  theme: ThemeMode;
}

/**
 * The languages the UI offers. Deliberately a short curated list: the API
 * accepts any well-formed BCP 47 tag, but a picker containing every tag in
 * existence is a worse experience than one containing the ones people use. The
 * account's current value is always appended, so a tag set through the API
 * never silently disappears from the field.
 */
const LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'it', label: 'Italiano (Italian)' },
  { value: 'ja', label: '日本語 (Japanese)' },
  { value: 'ko', label: '한국어 (Korean)' },
  { value: 'nl', label: 'Nederlands (Dutch)' },
  { value: 'pl', label: 'Polski (Polish)' },
  { value: 'pt', label: 'Português (Portuguese)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ru', label: 'Русский (Russian)' },
  { value: 'tr', label: 'Türkçe (Turkish)' },
  { value: 'ur', label: 'اردو (Urdu)' },
  { value: 'zh-CN', label: '简体中文 (Chinese, Simplified)' },
  { value: 'zh-TW', label: '繁體中文 (Chinese, Traditional)' },
];

function timezoneOptions(current: string): Array<{ value: string; label: string }> {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // Very old engines have no ICU timezone table. One option beats an empty
    // select that silently blocks saving anything else on the form.
    zones = [current];
  }

  if (current && !zones.includes(current)) zones = [current, ...zones];
  return zones.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));
}

function toFormValues(user: User): ProfileFormValues {
  const theme = user.theme;
  return {
    displayName: user.displayName ?? '',
    bio: user.bio ?? '',
    timezone: user.timezone,
    locale: user.locale,
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
  };
}

export function ProfileView({
  initialUser,
  initialStats,
}: {
  initialUser: User;
  initialStats: ProfileStats | null;
}) {
  const { message } = App.useApp();
  const { user: liveUser, setUser, refresh } = useAuth();
  const { setMode } = useThemeMode();

  // The provider is seeded from the same server render, so this only falls back
  // during the first tick after a sign-out race.
  const user = liveUser ?? initialUser;

  const [form] = Form.useForm<ProfileFormValues>();
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [detectedZone, setDetectedZone] = useState<string | null>(null);

  const zones = useMemo(() => timezoneOptions(user.timezone), [user.timezone]);
  const selectedZone = Form.useWatch('timezone', form);

  const locales = useMemo(() => {
    if (LOCALE_OPTIONS.some((option) => option.value === user.locale)) return LOCALE_OPTIONS;
    return [{ value: user.locale, label: user.locale }, ...LOCALE_OPTIONS];
  }, [user.locale]);

  useEffect(() => {
    // Read after mount only: the server process has its own timezone, and
    // rendering that into the markup would be both wrong and a hydration
    // mismatch.
    try {
      setDetectedZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setDetectedZone(null);
    }
  }, []);

  const avatarSrc = user.avatarId ? `/api/attachments/${user.avatarId}` : undefined;

  async function handleSave(values: ProfileFormValues) {
    setSaving(true);
    try {
      const { user: updated } = await api.patch<{ user: User }>('/api/profile', {
        // Empty strings are folded to null server-side; sending them explicitly
        // is how a bio gets cleared, so they must not be stripped here.
        displayName: values.displayName.trim() || null,
        bio: values.bio.trim() || null,
        timezone: values.timezone,
        locale: values.locale,
        theme: values.theme,
      });

      setUser(updated);
      // Re-seeded from the response rather than left as typed, so the trimming
      // and empty-to-null folding the API did is visible immediately. The form
      // is deliberately not synced to `user` in general: an avatar upload also
      // replaces that object, and doing so would wipe an in-progress edit.
      form.setFieldsValue(toFormValues(updated));

      // Applies the saved preference to the running UI as well as the account,
      // since ThemeProvider reads from localStorage, which the API cannot write.
      setMode(values.theme);
      message.success('Profile updated');

      // Reconciles the provider with the server once more, so anything the app
      // shell derives from the account (header name, avatar) is current too.
      await refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (fields) {
          form.setFields(
            // The API keys these by field name; the cast is the assertion that
            // an unknown key would simply address a field this form does not
            // render, which antd ignores.
            Object.entries(fields).map(([name, errors]) => ({
              name: name as keyof ProfileFormValues,
              errors,
            })),
          );
        }
        message.error(error.message);
      } else {
        message.error('Could not save your profile');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(file: File) {
    setAvatarBusy(true);
    try {
      const { user: updated } = await api.upload<{ user: User }>('/api/profile/avatar', file);
      setUser(updated);
      message.success('Photo updated');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not upload that image');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarBusy(true);
    try {
      const { user: updated } = await api.delete<{ user: User }>('/api/profile/avatar');
      setUser(updated);
      message.success('Photo removed');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not remove your photo');
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="tf-stack">
      <header className="tf-page-header">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Profile
          </Typography.Title>
          <Typography.Text className="tf-muted">
            How you appear in TaskFlow, and how it formats dates for you.
          </Typography.Text>
        </div>
        <Link href="/settings/security">
          <Button icon={<SafetyCertificateOutlined />}>Security settings</Button>
        </Link>
      </header>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <div className="tf-stack">
            <Card title="Photo">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space align="center" size="middle" wrap>
                  <Avatar
                    size={72}
                    src={avatarSrc}
                    icon={<UserOutlined />}
                    alt={`Profile photo for ${user.displayName ?? user.username}`}
                  />
                  <div>
                    <Typography.Text strong>
                      {user.displayName ?? user.username}
                    </Typography.Text>
                    <div className="tf-muted">@{user.username}</div>
                  </div>
                </Space>

                <Space wrap>
                  <Upload
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    showUploadList={false}
                    // The bytes go up through the shared API client so CSRF, the
                    // 401-refresh replay and error decoding all behave as they do
                    // everywhere else; antd's own XHR would bypass every one.
                    beforeUpload={(file) => {
                      void handleAvatarUpload(file);
                      return Upload.LIST_IGNORE;
                    }}
                  >
                    <Button icon={<CameraOutlined />} loading={avatarBusy}>
                      Upload photo
                    </Button>
                  </Upload>

                  {user.avatarId ? (
                    <Button
                      icon={<DeleteOutlined />}
                      danger
                      loading={avatarBusy}
                      onClick={() => void handleAvatarRemove()}
                    >
                      Remove
                    </Button>
                  ) : null}
                </Space>

                <Typography.Text className="tf-muted" style={{ fontSize: '0.85rem' }}>
                  PNG, JPEG, WebP or GIF. Replacing a photo deletes the old one, so it
                  costs you no extra storage.
                </Typography.Text>
              </Space>
            </Card>

            <Card title="Storage">
              {/* The total comes from the live user rather than the server
                  snapshot: uploading or removing an avatar returns an updated
                  figure, and the meter should move with it. */}
              <StorageMeter
                usedBytes={user.storageUsedBytes}
                quotaBytes={initialStats?.storage.quotaBytes ?? user.storageQuotaBytes ?? null}
                attachmentCount={initialStats?.attachments.count ?? null}
              />
            </Card>

            <Card title="Account">
              <Descriptions
                column={1}
                size="small"
                items={[
                  { key: 'username', label: 'Username', children: user.username },
                  {
                    key: 'email',
                    label: 'Email',
                    children: (
                      <Space size={4} wrap>
                        <span style={{ overflowWrap: 'anywhere' }}>{user.email}</span>
                        <Button
                          type="link"
                          size="small"
                          icon={<MailOutlined />}
                          onClick={() => setEmailOpen(true)}
                        >
                          Change
                        </Button>
                      </Space>
                    ),
                  },
                  {
                    key: 'role',
                    label: 'Role',
                    children: (
                      <Tag color={user.role === 'user' ? 'default' : 'purple'}>{user.role}</Tag>
                    ),
                  },
                  {
                    key: 'created',
                    label: 'Member since',
                    children: (
                      <span suppressHydrationWarning>
                        {dayjs(user.createdAt).format('D MMM YYYY')}
                      </span>
                    ),
                  },
                  {
                    key: 'mfa',
                    label: 'Two-factor',
                    children: user.mfaEnabled ? (
                      <Tag color="success">Enabled</Tag>
                    ) : (
                      <Link href="/settings/security">Not set up</Link>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
        </Col>

        <Col xs={24} lg={15}>
          <Card title="Details">
            <Form<ProfileFormValues>
              form={form}
              layout="vertical"
              initialValues={toFormValues(initialUser)}
              onFinish={(values) => void handleSave(values)}
              requiredMark={false}
              disabled={saving}
            >
              <Form.Item
                name="displayName"
                label="Display name"
                extra="Shown instead of your username. Leave blank to use @username."
                rules={[{ max: 64, message: 'Display name must be at most 64 characters' }]}
              >
                <Input placeholder={user.username} autoComplete="name" maxLength={64} />
              </Form.Item>

              <Form.Item
                name="bio"
                label="Bio"
                rules={[{ max: 500, message: 'Bio must be at most 500 characters' }]}
              >
                <Input.TextArea
                  rows={4}
                  maxLength={500}
                  showCount
                  placeholder="A sentence or two about you."
                />
              </Form.Item>

              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item
                    name="timezone"
                    label="Time zone"
                    rules={[{ required: true, message: 'Choose a time zone' }]}
                    extra={
                      detectedZone && detectedZone !== selectedZone ? (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto' }}
                          onClick={() => form.setFieldValue('timezone', detectedZone)}
                        >
                          Use this device&rsquo;s zone ({detectedZone})
                        </Button>
                      ) : (
                        'Due dates and reminders are shown in this zone.'
                      )
                    }
                  >
                    <Select
                      showSearch
                      options={zones}
                      optionFilterProp="label"
                      placeholder="Search time zones"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} md={12}>
                  <Form.Item
                    name="locale"
                    label="Language"
                    rules={[{ required: true, message: 'Choose a language' }]}
                    extra="Controls date, time and number formatting."
                  >
                    <Select showSearch options={locales} optionFilterProp="label" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="theme" label="Theme">
                <Segmented<ThemeMode>
                  options={[
                    { value: 'light', label: 'Light', icon: <SunOutlined /> },
                    { value: 'dark', label: 'Dark', icon: <MoonOutlined /> },
                    { value: 'system', label: 'System', icon: <DesktopOutlined /> },
                  ]}
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                  Save changes
                </Button>
              </Form.Item>

              <div aria-live="polite" className="tf-muted" style={{ fontSize: '0.85rem' }}>
                {saving ? 'Saving your profile...' : ''}
              </div>
            </Form>
          </Card>
        </Col>
      </Row>

      <ChangeEmailModal
        open={emailOpen}
        currentEmail={user.email}
        onClose={() => setEmailOpen(false)}
        onChanged={(updated) => {
          setUser(updated);
          setEmailOpen(false);
        }}
      />
    </div>
  );
}

interface ChangeEmailValues {
  email: string;
  currentPassword: string;
}

function ChangeEmailModal({
  open,
  currentEmail,
  onClose,
  onChanged,
}: {
  open: boolean;
  currentEmail: string;
  onClose: () => void;
  onChanged: (user: User) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ChangeEmailValues>();
  const [busy, setBusy] = useState(false);

  async function submit(values: ChangeEmailValues) {
    setBusy(true);
    try {
      const { user } = await api.put<{ user: User }>('/api/profile/email', values);
      message.success('Email address updated');
      form.resetFields();
      onChanged(user);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (fields) {
          form.setFields(
            Object.entries(fields).map(([name, errors]) => ({
              name: name as keyof ChangeEmailValues,
              errors,
            })),
          );
        }
        message.error(error.message);
      } else {
        message.error('Could not change your email address');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Change email address"
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      okText="Change email"
      confirmLoading={busy}
      onOk={() => void form.submit()}
      destroyOnHidden
    >
      <Typography.Paragraph className="tf-muted">
        Your email address is how you recover this account, so changing it needs your
        password. It is currently <strong>{currentEmail}</strong>.
      </Typography.Paragraph>

      <Form<ChangeEmailValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="email"
          label="New email address"
          rules={[
            { required: true, message: 'Enter your new email address' },
            { type: 'email', message: 'Enter a valid email address' },
          ]}
        >
          <Input autoComplete="email" inputMode="email" />
        </Form.Item>

        <Form.Item
          name="currentPassword"
          label="Current password"
          rules={[{ required: true, message: 'Confirm your password' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
