'use client';

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Tooltip, Typography } from 'antd';
import { SettingsForm } from '@/components/admin/SettingsForm';
import type { FooterSettings } from '@/types/api';

const MAX_LINKS = 12;
const MAX_SOCIAL = 8;

/** Exactly the platforms `footerSchema` accepts; anything else is a 422. */
const PLATFORMS = ['github', 'x', 'linkedin', 'discord', 'youtube', 'website'] as const;

/**
 * The server's `safeUrl`: relative paths and http(s) only.
 *
 * Repeated here so a bad value is caught before the round trip. An
 * admin-editable footer link is the classic route to stored XSS, and
 * `javascript:` in a href is exactly the thing it is guarding against.
 */
const SAFE_URL = /^(\/|https?:\/\/)/i;

const urlRules = [
  { required: true, message: 'Enter a URL' },
  {
    pattern: SAFE_URL,
    message: 'Must be a relative path (/legal/privacy) or a full http(s) URL',
  },
  { max: 2048, message: 'At most 2048 characters' },
];

/** Up/down buttons rather than drag: keyboard-operable without a second code path. */
function ReorderControls({
  index,
  count,
  onMove,
  onRemove,
  label,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  label: string;
}) {
  return (
    <Space size={4}>
      <Tooltip title="Move up">
        <Button
          size="small"
          icon={<ArrowUpOutlined />}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          aria-label={`Move ${label} ${index + 1} up`}
        />
      </Tooltip>
      <Tooltip title="Move down">
        <Button
          size="small"
          icon={<ArrowDownOutlined />}
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
          aria-label={`Move ${label} ${index + 1} down`}
        />
      </Tooltip>
      <Tooltip title="Remove">
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onRemove(index)}
          aria-label={`Remove ${label} ${index + 1}`}
        />
      </Tooltip>
    </Space>
  );
}

export function FooterForm({ initialValues }: { initialValues: FooterSettings }) {
  const [form] = Form.useForm<FooterSettings>();
  const watched = Form.useWatch([], form);
  const values: FooterSettings = { ...initialValues, ...(watched ?? {}) };

  const renderedCopyright = values.copyrightTemplate
    .replaceAll('{year}', String(new Date().getFullYear()))
    .replaceAll('{holder}', values.copyrightHolder);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Footer
        </Typography.Title>
        <Typography.Text className="tf-muted">
          The credit line, copyright and link lists at the bottom of every page.
        </Typography.Text>
      </div>

      <SettingsForm<FooterSettings> sectionKey="footer" initialValues={initialValues} form={form}>
        <Card size="small" title="Credits" style={{ marginBottom: 16 }}>
          <Form.Item
            name="creditLine"
            label="Credit line"
            rules={[{ max: 200, message: 'At most 200 characters' }]}
          >
            <Input maxLength={200} showCount />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item
                name="copyrightHolder"
                label="Copyright holder"
                rules={[{ max: 120, message: 'At most 120 characters' }]}
              >
                <Input maxLength={120} />
              </Form.Item>
            </Col>
            <Col xs={24} md={14}>
              <Form.Item
                name="copyrightTemplate"
                label="Copyright template"
                extra="{year} and {holder} are substituted when the page renders."
                rules={[{ max: 120, message: 'At most 120 characters' }]}
              >
                <Input maxLength={120} />
              </Form.Item>
            </Col>
          </Row>

          <Alert
            type="info"
            showIcon
            message="Renders as"
            description={<code>{renderedCopyright || '(nothing)'}</code>}
          />
        </Card>

        <Card
          size="small"
          title="Links"
          extra={
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              {values.links.length} of {MAX_LINKS}
            </Typography.Text>
          }
          style={{ marginBottom: 16 }}
        >
          <Form.List name="links">
            {(fields, { add, remove, move }) => (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {fields.length === 0 ? (
                  <Typography.Text className="tf-muted">No footer links.</Typography.Text>
                ) : null}

                {fields.map((field, index) => (
                  <Row key={field.key} gutter={8} align="top" wrap>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name={[field.name, 'label']}
                        label={index === 0 ? 'Label' : null}
                        rules={[
                          { required: true, message: 'Enter a label' },
                          { max: 40, message: 'At most 40 characters' },
                        ]}
                        style={{ marginBottom: 8 }}
                      >
                        <Input maxLength={40} placeholder="Privacy" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={11}>
                      <Form.Item
                        name={[field.name, 'href']}
                        label={index === 0 ? 'URL' : null}
                        rules={urlRules}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder="/legal/privacy" inputMode="url" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={5}>
                      <Form.Item label={index === 0 ? ' ' : null} style={{ marginBottom: 8 }}>
                        <ReorderControls
                          index={index}
                          count={fields.length}
                          onMove={move}
                          onRemove={remove}
                          label="link"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                ))}

                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ label: '', href: '/' })}
                  disabled={fields.length >= MAX_LINKS}
                  block
                >
                  Add a link
                </Button>
              </Space>
            )}
          </Form.List>
        </Card>

        <Card
          size="small"
          title="Social"
          extra={
            <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
              {values.social.length} of {MAX_SOCIAL}
            </Typography.Text>
          }
        >
          <Form.List name="social">
            {(fields, { add, remove, move }) => (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {fields.length === 0 ? (
                  <Typography.Text className="tf-muted">No social links.</Typography.Text>
                ) : null}

                {fields.map((field, index) => (
                  <Row key={field.key} gutter={8} align="top" wrap>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name={[field.name, 'platform']}
                        label={index === 0 ? 'Platform' : null}
                        rules={[{ required: true, message: 'Choose a platform' }]}
                        style={{ marginBottom: 8 }}
                      >
                        <Select
                          aria-label={`Platform for social link ${index + 1}`}
                          options={PLATFORMS.map((platform) => ({
                            value: platform,
                            label: platform === 'x' ? 'X (Twitter)' : platform,
                          }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={11}>
                      <Form.Item
                        name={[field.name, 'href']}
                        label={index === 0 ? 'URL' : null}
                        rules={urlRules}
                        style={{ marginBottom: 8 }}
                      >
                        <Input placeholder="https://github.com/you" inputMode="url" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={5}>
                      <Form.Item label={index === 0 ? ' ' : null} style={{ marginBottom: 8 }}>
                        <ReorderControls
                          index={index}
                          count={fields.length}
                          onMove={move}
                          onRemove={remove}
                          label="social link"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                ))}

                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ platform: 'website', href: 'https://' })}
                  disabled={fields.length >= MAX_SOCIAL}
                  block
                >
                  Add a social link
                </Button>
              </Space>
            )}
          </Form.List>
        </Card>
      </SettingsForm>
    </Space>
  );
}
