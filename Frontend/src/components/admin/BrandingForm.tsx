'use client';

import { Alert, Card, Col, ColorPicker, Form, Input, Row, Slider, Space, Typography } from 'antd';
import { AssetUpload } from '@/components/admin/AssetUpload';
import { SettingsForm } from '@/components/admin/SettingsForm';
import { normalizeHex, readableTextOn } from '@/components/admin/format';
import type { BrandingSettings } from '@/types/api';

/** Ant Design's ColorPicker hands back a Color object; the schema wants `#rrggbb`. */
const colorFromEvent = (value: unknown) => normalizeHex(value);

function BrandPreview({
  values,
  logoUrl,
}: {
  values: BrandingSettings;
  logoUrl: string | null;
}) {
  const radius = values.borderRadius;
  const primary = /^#[0-9a-fA-F]{6}$/.test(values.primaryColor) ? values.primaryColor : '#4f46e5';
  const accent = /^#[0-9a-fA-F]{6}$/.test(values.accentColor) ? values.accentColor : '#10b981';

  return (
    <div
      style={{
        border: '1px solid var(--tf-border)',
        borderRadius: radius + 6,
        overflow: 'hidden',
        background: 'var(--tf-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--tf-border)',
        }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- raw bytes from our own API
          <img src={logoUrl} alt="" className="tf-brand__mark" style={{ borderRadius: radius }} />
        ) : (
          <span
            aria-hidden
            style={{
              width: 30,
              height: 30,
              borderRadius: radius,
              background: primary,
              // Computed from the chosen colour rather than fixed: white on a
              // pale brand colour is unreadable, and the operator picks the colour.
              color: readableTextOn(primary),
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 14,
              flex: 'none',
            }}
          >
            {(values.logoText || values.siteName || '?').slice(0, 1).toUpperCase()}
          </span>
        )}

        <span style={{ minWidth: 0 }}>
          <Typography.Text strong style={{ display: 'block', lineHeight: 1.2 }}>
            {values.logoText || values.siteName || 'TaskFlow'}
          </Typography.Text>
          <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
            {values.tagline}
          </Typography.Text>
        </span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {/* Rendered as plain elements rather than antd Buttons: the point is to
            show the *submitted* colours, not the colours the live theme is
            currently using. */}
        <span
          style={{
            padding: '8px 18px',
            borderRadius: radius,
            background: primary,
            color: readableTextOn(primary),
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Primary action
        </span>
        <span
          style={{
            padding: '8px 18px',
            borderRadius: radius,
            background: accent,
            color: readableTextOn(accent),
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Accent
        </span>
        <span
          style={{
            padding: '8px 18px',
            borderRadius: radius,
            border: `1px solid ${primary}`,
            color: primary,
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Secondary
        </span>
      </div>
    </div>
  );
}

export function BrandingForm({
  initialValues,
  isRoot,
}: {
  initialValues: BrandingSettings;
  isRoot: boolean;
}) {
  const [form] = Form.useForm<BrandingSettings>();

  // The preview needs to move as the operator types, which means watching the
  // live store rather than the last-saved values.
  const watched = Form.useWatch([], form);
  const values: BrandingSettings = { ...initialValues, ...(watched ?? {}) };

  const logoId = values.logoAttachmentId;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Branding
        </Typography.Title>
        <Typography.Text className="tf-muted">
          The name, colours and images every visitor sees. Colours feed the Ant Design theme, so
          they restyle the whole app without a deploy.
        </Typography.Text>
      </div>

      <SettingsForm<BrandingSettings> sectionKey="branding" initialValues={initialValues} form={form}>
        <Row gutter={[24, 0]}>
          <Col xs={24} lg={14}>
            <Card size="small" title="Identity" style={{ marginBottom: 16 }}>
              <Form.Item
                name="siteName"
                label="Site name"
                rules={[
                  { required: true, message: 'Enter a site name' },
                  { max: 60, message: 'At most 60 characters' },
                ]}
              >
                <Input maxLength={60} showCount />
              </Form.Item>

              <Form.Item
                name="tagline"
                label="Tagline"
                extra="Used on the landing page and as the default social description."
                rules={[{ max: 160, message: 'At most 160 characters' }]}
              >
                <Input maxLength={160} showCount />
              </Form.Item>

              <Form.Item
                name="logoText"
                label="Logo text"
                extra="Shown when no logo image is set, and as the letterhead mark on PDF exports."
                rules={[{ max: 24, message: 'At most 24 characters' }]}
              >
                <Input maxLength={24} showCount />
              </Form.Item>
            </Card>

            <Card size="small" title="Theme" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="primaryColor"
                    label="Primary colour"
                    getValueFromEvent={colorFromEvent}
                    extra="Buttons, links and focus rings."
                    rules={[
                      {
                        pattern: /^#[0-9a-fA-F]{6}$/,
                        message: 'Must be a 6-digit hex colour such as #4f46e5',
                      },
                    ]}
                  >
                    <ColorPicker
                      format="hex"
                      disabledAlpha
                      showText
                      aria-label="Primary colour"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="accentColor"
                    label="Accent colour"
                    getValueFromEvent={colorFromEvent}
                    extra="Success states and positive confirmations."
                    rules={[
                      {
                        pattern: /^#[0-9a-fA-F]{6}$/,
                        message: 'Must be a 6-digit hex colour such as #10b981',
                      },
                    ]}
                  >
                    <ColorPicker format="hex" disabledAlpha showText aria-label="Accent colour" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="borderRadius"
                label={`Corner rounding: ${values.borderRadius}px`}
                extra="0 is square; 24 is fully rounded. Applied across every card, input and button."
              >
                <Slider
                  min={0}
                  max={24}
                  step={1}
                  marks={{ 0: '0', 8: '8', 16: '16', 24: '24' }}
                  // The visible label above carries the number, so the handle
                  // does not need to announce it twice.
                  aria-label="Corner rounding in pixels"
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card size="small" title="Live preview" style={{ marginBottom: 16 }}>
              <BrandPreview
                values={values}
                logoUrl={logoId ? `/api/attachments/${logoId}` : null}
              />
              <Typography.Paragraph className="tf-muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                Shows the values in the form, not the ones currently live. Save to apply them.
              </Typography.Paragraph>
            </Card>

            <Card size="small" title="Images">
              {!isRoot ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="Uploading a site asset is reserved for the root account."
                  description="You can still clear an image and save the rest of this section."
                />
              ) : null}

              <Form.Item name="logoAttachmentId" label={null} style={{ marginBottom: 20 }}>
                <AssetUpload
                  label="Logo"
                  hint="PNG, SVG or WebP. Shown in the header and on exports."
                  disabled={!isRoot}
                  disabledReason="Root only."
                />
              </Form.Item>

              <Form.Item name="logoDarkAttachmentId" label={null} style={{ marginBottom: 20 }}>
                <AssetUpload
                  label="Dark-mode logo"
                  hint="Optional. Used when the visitor's theme resolves to dark."
                  disabled={!isRoot}
                  disabledReason="Root only."
                />
              </Form.Item>

              <Form.Item name="faviconAttachmentId" label={null} style={{ marginBottom: 20 }}>
                <AssetUpload
                  label="Favicon"
                  hint="32×32 or 48×48 PNG or ICO."
                  previewHeight={56}
                  disabled={!isRoot}
                  disabledReason="Root only."
                />
              </Form.Item>

              <Form.Item name="ogImageAttachmentId" label={null} style={{ marginBottom: 0 }}>
                <AssetUpload
                  label="Social share image"
                  hint="1200×630 for Open Graph and Twitter cards."
                  previewHeight={110}
                  transparent={false}
                  disabled={!isRoot}
                  disabledReason="Root only."
                />
              </Form.Item>
            </Card>
          </Col>
        </Row>
      </SettingsForm>
    </Space>
  );
}
