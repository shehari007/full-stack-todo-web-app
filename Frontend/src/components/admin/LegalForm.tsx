'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  Row,
  Segmented,
  Space,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import { SettingsForm } from '@/components/admin/SettingsForm';
import { Markdown } from '@/components/legal/Markdown';
import type { LegalSettings } from '@/types/api';

type DocumentKey = 'privacy' | 'terms' | 'cookies';

const DOCUMENTS: Array<{ key: DocumentKey; label: string; route: string }> = [
  { key: 'privacy', label: 'Privacy Policy', route: '/legal/privacy' },
  { key: 'terms', label: 'Terms of Service', route: '/legal/terms' },
  { key: 'cookies', label: 'Cookie Policy', route: '/legal/cookies' },
];

/**
 * `effectiveDate` is a free-text string in the schema, not a date column.
 *
 * A picker is still the right control (nobody wants to type ISO dates), but it
 * has to tolerate whatever is already stored, including an empty string or
 * something hand-written by a previous operator, rather than crashing on it.
 */
const dateValueProps = (value: unknown) => ({
  value: typeof value === 'string' && value && dayjs(value).isValid() ? dayjs(value) : null,
});

const dateNormalize = (value: unknown) =>
  value && dayjs.isDayjs(value) ? value.format('YYYY-MM-DD') : '';

function DocumentEditor({ doc, form }: { doc: DocumentKey; form: ReturnType<typeof Form.useForm<LegalSettings>>[0] }) {
  const [pane, setPane] = useState<'edit' | 'preview' | 'split'>('split');
  const body = Form.useWatch([doc, 'body'], form) ?? '';

  const showEditor = pane !== 'preview';
  const showPreview = pane !== 'edit';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name={[doc, 'title']}
            label="Document title"
            rules={[
              { required: true, message: 'Enter a title' },
              { max: 120, message: 'At most 120 characters' },
            ]}
          >
            <Input maxLength={120} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name={[doc, 'effectiveDate']}
            label="Effective date"
            getValueProps={dateValueProps}
            normalize={dateNormalize}
            extra="Printed at the top of the published document. Leave blank to omit it."
          >
            <DatePicker style={{ width: '100%' }} format="D MMMM YYYY" aria-label="Effective date" />
          </Form.Item>
        </Col>
      </Row>

      <Segmented<'edit' | 'preview' | 'split'>
        value={pane}
        onChange={setPane}
        aria-label="Editor layout"
        options={[
          { value: 'edit', label: 'Write' },
          { value: 'split', label: 'Split' },
          { value: 'preview', label: 'Preview' },
        ]}
      />

      <Row gutter={16}>
        {showEditor ? (
          <Col xs={24} lg={showPreview ? 12 : 24}>
            <Form.Item
              name={[doc, 'body']}
              label="Body (Markdown)"
              extra="Headings, lists, bold, italic, links, inline code and pipe tables. Rendered as React elements, never as raw HTML."
              rules={[{ max: 100_000, message: 'At most 100,000 characters' }]}
            >
              <Input.TextArea
                rows={22}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
                spellCheck
              />
            </Form.Item>
          </Col>
        ) : null}

        {showPreview ? (
          <Col xs={24} lg={showEditor ? 12 : 24}>
            <Typography.Text style={{ display: 'block', marginBottom: 8 }}>Preview</Typography.Text>
            <div
              style={{
                border: '1px solid var(--tf-border)',
                borderRadius: 12,
                background: 'var(--tf-surface)',
                padding: '1rem 1.25rem',
                maxHeight: 560,
                overflowY: 'auto',
              }}
            >
              {/* The published pages use this exact renderer, so what appears
                  here is what visitors get, not an approximation of it. */}
              <div className="tf-prose">
                {body ? (
                  <Markdown source={body} />
                ) : (
                  <Typography.Text className="tf-muted">Nothing written yet.</Typography.Text>
                )}
              </div>
            </div>
          </Col>
        ) : null}
      </Row>
    </Space>
  );
}

export function LegalForm({ initialValues }: { initialValues: LegalSettings }) {
  const [form] = Form.useForm<LegalSettings>();
  const policyVersion = Form.useWatch('policyVersion', form) ?? initialValues.policyVersion;
  const bannerEnabled = Form.useWatch('cookieBannerEnabled', form);

  const versionChanged = policyVersion !== initialValues.policyVersion;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Legal
        </Typography.Title>
        <Typography.Text className="tf-muted">
          The consent banner and the three published policy documents.
        </Typography.Text>
      </div>

      <SettingsForm<LegalSettings> sectionKey="legal" initialValues={initialValues} form={form}>
        <Card size="small" title="Consent" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="policyVersion"
                label="Policy version"
                extra="Raise this whenever a document changes materially."
                rules={[
                  { required: true, message: 'Enter a version' },
                  { max: 20, message: 'At most 20 characters' },
                ]}
              >
                <Input placeholder="1.0" />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item
                name="contactEmail"
                label="Contact email"
                extra="Published on the policy pages as the address for data requests."
                rules={[{ type: 'email', message: 'Enter a valid email address' }]}
              >
                <Input type="email" />
              </Form.Item>
            </Col>
          </Row>

          <Alert
            type={versionChanged ? 'warning' : 'info'}
            showIcon
            style={{ marginBottom: 16 }}
            message={
              versionChanged
                ? `Raising the version to "${policyVersion}" will re-prompt every visitor.`
                : 'Raising the policy version re-prompts every visitor for consent.'
            }
            description={
              <>
                Stored consent records carry the version that was agreed to. When this value changes,
                every existing record stops matching, so the banner reappears for everyone (signed in
                or not) and analytics collection stops for each visitor until they answer it again.
                That is the correct behaviour after a material change, and an expensive accident
                after a typo.
              </>
            }
          />

          <Form.Item
            name="cookieBannerEnabled"
            label="Show the cookie banner"
            valuePropName="checked"
            extra="Turn off only if this installation sets no optional cookies at all."
          >
            <Switch
              checkedChildren="Shown"
              unCheckedChildren="Hidden"
              aria-label="Show the cookie banner"
            />
          </Form.Item>

          <Form.Item
            name="cookieBannerText"
            label="Banner text"
            rules={[{ max: 600, message: 'At most 600 characters' }]}
          >
            <Input.TextArea rows={4} maxLength={600} showCount disabled={bannerEnabled === false} />
          </Form.Item>

          {bannerEnabled === false ? (
            <Alert
              type="warning"
              showIcon
              message="With the banner off, nobody is asked for analytics consent."
              description="The collector refuses every event without a stored consent record, so traffic reporting will stay empty."
            />
          ) : null}
        </Card>

        <Card size="small" title="Documents">
          <Tabs
            items={DOCUMENTS.map((entry) => ({
              key: entry.key,
              label: entry.label,
              children: <DocumentEditor doc={entry.key} form={form} />,
            }))}
            // Keeps each tab's TextArea mounted so switching away and back does
            // not lose the scroll position in a 40 KB document.
            destroyOnHidden={false}
          />
        </Card>
      </SettingsForm>
    </Space>
  );
}
