'use client';

import { useCallback } from 'react';
import { App, Alert, Card, Form, Input, Space, Switch, Tag, Typography } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { SettingsForm } from '@/components/admin/SettingsForm';
import type { FeatureSettings } from '@/types/api';

interface FlagSpec {
  name: keyof FeatureSettings;
  label: string;
  description: string;
  /** What turning it OFF actually does: the part people get wrong. */
  offConsequence: string;
}

const FLAGS: readonly FlagSpec[] = [
  {
    name: 'registrationEnabled',
    label: 'Open registration',
    description: 'Anyone can create an account from the sign-up page.',
    offConsequence: 'The sign-up page stops accepting new accounts. Root can still create them by hand from the Users screen.',
  },
  {
    name: 'requireMfaForPrivileged',
    label: 'Require MFA for root and admin',
    description: 'Privileged accounts must enrol a second factor before they can use the app.',
    offConsequence: 'Administrators can operate with a password alone.',
  },
  {
    name: 'attachmentsEnabled',
    label: 'File attachments',
    description: 'Users can attach files to their tasks.',
    offConsequence: 'New uploads are refused. Files already stored stay where they are and remain downloadable.',
  },
  {
    name: 'analyticsEnabled',
    label: 'Traffic analytics',
    description: 'Collect anonymous page views from visitors who have consented.',
    offConsequence: 'The collector declines every event. Existing data is kept and still reported.',
  },
  {
    name: 'exportsEnabled',
    label: 'Data exports',
    description: 'Users can export their tasks and download their data.',
    offConsequence: 'Export endpoints refuse. Note that data portability may be a legal obligation where you operate.',
  },
  {
    name: 'publicLandingEnabled',
    label: 'Public landing page',
    description: 'Signed-out visitors see the marketing page at the site root.',
    offConsequence: 'The root URL sends signed-out visitors straight to the sign-in page.',
  },
];

export function FeaturesForm({
  initialValues,
  isRoot,
}: {
  initialValues: FeatureSettings;
  isRoot: boolean;
}) {
  const [form] = Form.useForm<FeatureSettings>();
  const { modal } = App.useApp();

  const watched = Form.useWatch([], form);
  const values: FeatureSettings = { ...initialValues, ...(watched ?? {}) };

  /**
   * Maintenance mode is the one flag that can lock the person setting it out of
   * the app, so it gets a second, explicit confirmation at save time rather than
   * only at toggle time. The toggle may have been flipped ten minutes and three
   * other edits ago.
   */
  const confirmMaintenance = useCallback(
    (next: FeatureSettings) =>
      new Promise<boolean>((resolve) => {
        const turningOn = next.maintenanceMode && !initialValues.maintenanceMode;
        if (!turningOn) {
          resolve(true);
          return;
        }

        modal.confirm({
          title: 'Put the whole installation into maintenance mode?',
          icon: <ExclamationCircleFilled />,
          width: 560,
          okText: 'Yes, lock everyone out',
          okButtonProps: { danger: true },
          cancelText: 'Cancel',
          content: (
            <Space direction="vertical" size={10}>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                Every request from every account except <Tag color="red">root</Tag> is answered with
                a 503 and the maintenance message. That includes other administrators: an admin who
                turns this on cannot turn it back off.
              </Typography.Paragraph>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                Signed-in users are not signed out; they simply cannot do anything until this is
                turned back off from a root account.
              </Typography.Paragraph>
            </Space>
          ),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [initialValues.maintenanceMode, modal],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Features
        </Typography.Title>
        <Typography.Text className="tf-muted">
          Installation-wide switches. Every one of these takes effect on the next request. There is
          no deploy and no cache to wait for.
        </Typography.Text>
      </div>

      <SettingsForm<FeatureSettings>
        sectionKey="features"
        initialValues={initialValues}
        form={form}
        beforeSave={confirmMaintenance}
        readOnly={!isRoot}
        readOnlyNotice={
          <Alert
            type="info"
            showIcon
            message="Read-only for your account."
            description="These switches reach every account on the installation, including yours (maintenance mode can only be undone by root), so this panel reserves them for the root account."
          />
        }
      >
        <Card size="small" title="Capabilities" style={{ marginBottom: 16 }}>
          {FLAGS.map((flag, index) => (
            <div
              key={flag.name}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem 1.25rem',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                paddingBlock: 14,
                borderTop: index === 0 ? undefined : '1px solid var(--tf-border-subtle)',
              }}
            >
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <Typography.Text strong>{flag.label}</Typography.Text>
                <Typography.Paragraph className="tf-muted" style={{ marginBottom: 2, fontSize: 13 }}>
                  {flag.description}
                </Typography.Paragraph>
                <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                  Off: {flag.offConsequence}
                </Typography.Text>
              </div>

              <Form.Item name={flag.name} valuePropName="checked" style={{ marginBottom: 0 }}>
                {/* Wording on the switch itself, so the state does not rest on
                    the knob's position alone. */}
                <Switch checkedChildren="On" unCheckedChildren="Off" aria-label={flag.label} />
              </Form.Item>
            </div>
          ))}
        </Card>

        <Card
          size="small"
          title={
            <Space size={8}>
              <span>Maintenance mode</span>
              {values.maintenanceMode ? (
                <Tag color="error" icon={<ExclamationCircleFilled />}>
                  Active
                </Tag>
              ) : null}
            </Space>
          }
        >
          <Alert
            type={values.maintenanceMode ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 16 }}
            message={
              values.maintenanceMode
                ? 'Everyone except root is currently locked out.'
                : 'Turning this on locks out everyone except root.'
            }
            description="The API serves a 503 with the message below to every request that is not from a root account. Other administrators are locked out too, and cannot turn it back off."
          />

          <Form.Item
            name="maintenanceMode"
            label="Maintenance mode"
            valuePropName="checked"
            style={{ marginBottom: 16 }}
          >
            <Switch
              checkedChildren="Locked"
              unCheckedChildren="Open"
              aria-label="Maintenance mode"
            />
          </Form.Item>

          <Form.Item
            name="maintenanceMessage"
            label="Message shown while locked"
            rules={[{ max: 400, message: 'At most 400 characters' }]}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea rows={3} maxLength={400} showCount />
          </Form.Item>
        </Card>
      </SettingsForm>
    </Space>
  );
}
