'use client';

import { Alert, Card, Col, Form, InputNumber, Row, Select, Space, Typography } from 'antd';
import { SettingsForm } from '@/components/admin/SettingsForm';
import { MegabytesInput } from '@/components/admin/MegabytesInput';
import { formatBytes } from '@/components/admin/format';
import type { LimitsSettings } from '@/types/api';

const KIB = 1024;
const MIB = 1024 * 1024;

/** The bounds in `limitsSchema`, in bytes. MegabytesInput converts them. */
const BOUNDS = {
  maxUploadBytes: { min: KIB, max: 10 * MIB },
  maxUploadBytesPrivileged: { min: KIB, max: 50 * MIB },
  // The schema sets no ceiling on a quota; 1 TiB is the cap the per-user quota
  // endpoint enforces, so matching it here keeps the two consistent.
  storage: { min: 0, max: 1024 ** 4 },
} as const;

/** Offered as suggestions only: the field accepts any type the operator types. */
const COMMON_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/x-icon',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function LimitsForm({
  initialValues,
  isRoot,
}: {
  initialValues: LimitsSettings;
  isRoot: boolean;
}) {
  const [form] = Form.useForm<LimitsSettings>();
  const watched = Form.useWatch([], form);
  const values: LimitsSettings = { ...initialValues, ...(watched ?? {}) };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Limits
        </Typography.Title>
        <Typography.Text className="tf-muted">
          The authoritative runtime ceilings. The environment variables of the same names only seed
          these on first boot, so raising a quota here needs no redeploy.
        </Typography.Text>
      </div>

      <SettingsForm<LimitsSettings>
        sectionKey="limits"
        initialValues={initialValues}
        form={form}
        readOnly={!isRoot}
        readOnlyNotice={
          <Alert
            type="info"
            showIcon
            message="Read-only for your account."
            description="Storage and upload ceilings apply to the whole installation, so this panel reserves them for the root account. Ask the owner of this installation to make the change."
          />
        }
      >
        <Card size="small" title="Uploads" style={{ marginBottom: 16 }}>
          <Typography.Paragraph className="tf-muted" style={{ fontSize: 13 }}>
            Files are stored in Postgres, so per-file ceilings stay modest. Both figures are checked
            against the file&apos;s real magic bytes, not its extension.
          </Typography.Paragraph>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="maxUploadBytes"
                label="Maximum file size for standard users"
                extra={`Stored as ${formatBytes(values.maxUploadBytes)}. Schema allows 1 KB to 10 MB.`}
                // The MB field rounds to two places, so its own `min` cannot
                // express a 1 KB floor. The bound is checked in bytes instead.
                rules={[
                  { required: true, message: 'Enter a size' },
                  {
                    type: 'number',
                    min: BOUNDS.maxUploadBytes.min,
                    message: 'Must be at least 1 KB (0.01 MB)',
                  },
                ]}
              >
                <MegabytesInput
                  min={BOUNDS.maxUploadBytes.min}
                  max={BOUNDS.maxUploadBytes.max}
                  aria-label="Maximum file size for standard users, in megabytes"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="maxUploadBytesPrivileged"
                label="Maximum file size for root and admin"
                extra={`Stored as ${formatBytes(values.maxUploadBytesPrivileged)}. Schema allows 1 KB to 50 MB.`}
                rules={[{ required: true, message: 'Enter a size' }]}
              >
                <MegabytesInput
                  min={BOUNDS.maxUploadBytesPrivileged.min}
                  max={BOUNDS.maxUploadBytesPrivileged.max}
                  aria-label="Maximum file size for privileged accounts, in megabytes"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="allowedUploadMimeTypes"
            label="Allowed MIME types"
            extra="An allowlist, not a blocklist. Checked against the file's real magic bytes, so renaming payload.html to photo.png does not get past it. Up to 40 entries."
          >
            <Select
              mode="tags"
              tokenSeparators={[',', ' ']}
              placeholder="image/png"
              aria-label="Allowed upload MIME types"
              maxCount={40}
              options={COMMON_MIME_TYPES.map((type) => ({ value: type, label: type }))}
            />
          </Form.Item>

          {values.allowedUploadMimeTypes.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="An empty allowlist rejects every upload."
              description="Attachments will fail for everyone until at least one type is listed."
            />
          ) : null}
        </Card>

        <Card size="small" title="Storage quotas" style={{ marginBottom: 16 }}>
          <Typography.Paragraph className="tf-muted" style={{ fontSize: 13 }}>
            The default allowance per account. A per-account override set from the Users screen wins
            over these; clearing that override returns the account to the figure for its role.
          </Typography.Paragraph>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="userStorageQuotaBytes"
                label="Quota for standard users"
                extra={`Stored as ${formatBytes(values.userStorageQuotaBytes)}.`}
                rules={[{ required: true, message: 'Enter a quota' }]}
              >
                <MegabytesInput
                  min={BOUNDS.storage.min}
                  max={BOUNDS.storage.max}
                  step={5}
                  aria-label="Storage quota for standard users, in megabytes"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="privilegedStorageQuotaBytes"
                label="Quota for root and admin"
                extra={`Stored as ${formatBytes(values.privilegedStorageQuotaBytes)}.`}
                rules={[{ required: true, message: 'Enter a quota' }]}
              >
                <MegabytesInput
                  min={BOUNDS.storage.min}
                  max={BOUNDS.storage.max}
                  step={5}
                  aria-label="Storage quota for privileged accounts, in megabytes"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card size="small" title="Counts">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="maxAttachmentsPerTodo"
                label="Attachments per task"
                extra="0 to 50. Setting 0 stops new attachments without disabling the feature."
                rules={[{ required: true, message: 'Enter a number' }]}
              >
                <InputNumber
                  min={0}
                  max={50}
                  style={{ width: '100%' }}
                  aria-label="Maximum attachments per task"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="maxTodosPerUser"
                label="Tasks per account"
                extra="0 to 100,000."
                rules={[{ required: true, message: 'Enter a number' }]}
              >
                <InputNumber
                  min={0}
                  max={100_000}
                  step={100}
                  style={{ width: '100%' }}
                  aria-label="Maximum tasks per account"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </SettingsForm>
    </Space>
  );
}
