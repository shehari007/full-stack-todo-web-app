'use client';

import { Alert, Card, Col, Form, Input, Row, Select, Space, Switch, Typography, theme } from 'antd';
import { SettingsForm } from '@/components/admin/SettingsForm';
import type { SeoSettings } from '@/types/api';

/**
 * Where search engines stop reading. Nothing enforces these. They are the
 * widths Google truncates a result at, which is the only reason to care.
 */
const TITLE_SWEET_SPOT = { min: 30, max: 60 };
const DESCRIPTION_SWEET_SPOT = { min: 70, max: 160 };

function LengthAdvice({
  value,
  range,
  noun,
}: {
  value: string;
  range: { min: number; max: number };
  noun: string;
}) {
  const length = value.length;

  const advice =
    length === 0
      ? `Empty, so search engines will invent a ${noun} from the page.`
      : length < range.min
        ? `${length} characters, shorter than the ${range.min} to ${range.max} that reads well in a result.`
        : length > range.max
          ? `${length} characters, likely truncated after about ${range.max}.`
          : `${length} characters, within the ${range.min} to ${range.max} that fits a search result.`;

  // Wording carries the verdict, not a colour; the counter is only the number.
  return (
    <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
      {advice}
    </Typography.Text>
  );
}

function SerpPreview({ values }: { values: SeoSettings }) {
  const { token } = theme.useToken();

  const host = values.canonicalBaseUrl
    ? values.canonicalBaseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    : 'example.com';

  const title =
    values.defaultTitle.length > 60
      ? `${values.defaultTitle.slice(0, 60)}...`
      : values.defaultTitle;

  const description =
    values.defaultDescription.length > 160
      ? `${values.defaultDescription.slice(0, 160)}...`
      : values.defaultDescription;

  return (
    <div
      style={{
        maxWidth: 600,
        padding: 16,
        border: '1px solid var(--tf-border)',
        borderRadius: token.borderRadiusLG,
        background: 'var(--tf-surface)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--tf-text-muted)', marginBottom: 2 }}>
        {host} › home
      </div>
      <div
        style={{
          fontSize: 19,
          lineHeight: 1.3,
          color: token.colorLink,
          marginBottom: 4,
          overflowWrap: 'anywhere',
        }}
      >
        {title || 'Your page title'}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--tf-text-muted)' }}>
        {description || 'Your description appears here, truncated at roughly 160 characters.'}
      </div>
    </div>
  );
}

export function SeoForm({ initialValues }: { initialValues: SeoSettings }) {
  const [form] = Form.useForm<SeoSettings>();
  const watched = Form.useWatch([], form);
  const values: SeoSettings = { ...initialValues, ...(watched ?? {}) };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          SEO
        </Typography.Title>
        <Typography.Text className="tf-muted">
          Titles, descriptions and structured data. The root layout builds every page&apos;s
          metadata from this section at request time.
        </Typography.Text>
      </div>

      <SettingsForm<SeoSettings> sectionKey="seo" initialValues={initialValues} form={form}>
        <Row gutter={[24, 0]}>
          <Col xs={24} lg={14}>
            <Card size="small" title="Titles and description" style={{ marginBottom: 16 }}>
              <Form.Item
                name="titleTemplate"
                label="Title template"
                extra="%s is replaced by the page's own title. Next.js consumes this string directly."
                rules={[
                  { required: true, message: 'Enter a title template' },
                  { max: 120, message: 'At most 120 characters' },
                ]}
              >
                <Input maxLength={120} placeholder="%s · TaskFlow" />
              </Form.Item>

              <Form.Item
                name="defaultTitle"
                label="Default title"
                extra={<LengthAdvice value={values.defaultTitle} range={TITLE_SWEET_SPOT} noun="title" />}
                rules={[
                  { required: true, message: 'Enter a default title' },
                  { max: 120, message: 'At most 120 characters' },
                ]}
              >
                <Input maxLength={120} showCount />
              </Form.Item>

              <Form.Item
                name="defaultDescription"
                label="Default description"
                extra={
                  <LengthAdvice
                    value={values.defaultDescription}
                    range={DESCRIPTION_SWEET_SPOT}
                    noun="description"
                  />
                }
                rules={[{ max: 320, message: 'At most 320 characters' }]}
              >
                <Input.TextArea rows={3} maxLength={320} showCount />
              </Form.Item>

              <Form.Item
                name="keywords"
                label="Keywords"
                extra="Type a phrase and press Enter. Up to 24; most engines ignore them, but they are still emitted."
              >
                <Select
                  mode="tags"
                  tokenSeparators={[',']}
                  placeholder="task manager, todo app"
                  aria-label="Keywords"
                  maxCount={24}
                  // No suggestion list: every value here is operator-authored.
                  options={[]}
                />
              </Form.Item>
            </Card>

            <Card size="small" title="Indexing" style={{ marginBottom: 16 }}>
              <Form.Item
                name="indexingEnabled"
                label="Allow search engines to index this site"
                valuePropName="checked"
                extra="Turn off for a staging deploy so a preview never competes with production."
              >
                <Switch
                  checkedChildren="Indexed"
                  unCheckedChildren="Hidden"
                  aria-label="Allow search engines to index this site"
                />
              </Form.Item>

              {values.indexingEnabled === false ? (
                <Alert
                  type="warning"
                  showIcon
                  message="This site is hidden from search engines."
                  description="Every page serves noindex, nofollow, nocache and robots.txt disallows everything. Existing results will drop out over the following days, and putting this back will not bring them straight back."
                />
              ) : null}

              <Form.Item
                name="canonicalBaseUrl"
                label="Canonical base URL"
                extra="The public origin, e.g. https://tasks.example.com. Leave blank to use NEXT_PUBLIC_SITE_URL."
                rules={[{ type: 'url', message: 'Enter a full URL including https://' }]}
                style={{ marginTop: 16 }}
              >
                <Input placeholder="https://tasks.example.com" inputMode="url" />
              </Form.Item>

              <Form.Item
                name="twitterHandle"
                label="X / Twitter handle"
                extra="Attributed on social cards. Include the @."
                rules={[{ max: 32, message: 'At most 32 characters' }]}
              >
                <Input placeholder="@taskflow" maxLength={32} />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card size="small" title="Search result preview" style={{ marginBottom: 16 }}>
              <SerpPreview values={values} />
              <Typography.Paragraph
                className="tf-muted"
                style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}
              >
                An approximation. Search engines rewrite titles and descriptions whenever they think
                the page answers a query better than the text supplied.
              </Typography.Paragraph>
            </Card>

            <Card size="small" title="Organisation" style={{ marginBottom: 16 }}>
              <Typography.Paragraph className="tf-muted" style={{ fontSize: 12 }}>
                Emitted as JSON-LD on every page and printed on PDF exports.
              </Typography.Paragraph>

              <Form.Item
                name={['organization', 'name']}
                label="Name"
                rules={[{ max: 120, message: 'At most 120 characters' }]}
              >
                <Input maxLength={120} />
              </Form.Item>
              <Form.Item
                name={['organization', 'legalName']}
                label="Legal name"
                rules={[{ max: 160, message: 'At most 160 characters' }]}
              >
                <Input maxLength={160} />
              </Form.Item>
              <Form.Item
                name={['organization', 'email']}
                label="Contact email"
                rules={[{ type: 'email', message: 'Enter a valid email address' }]}
              >
                <Input type="email" />
              </Form.Item>
              <Form.Item
                name={['organization', 'phone']}
                label="Phone"
                rules={[{ max: 40, message: 'At most 40 characters' }]}
              >
                <Input maxLength={40} inputMode="tel" />
              </Form.Item>
              <Form.Item
                name={['organization', 'addressLine']}
                label="Address"
                rules={[{ max: 200, message: 'At most 200 characters' }]}
              >
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item
                name={['organization', 'website']}
                label="Website"
                rules={[{ type: 'url', message: 'Enter a full URL including https://' }]}
                style={{ marginBottom: 0 }}
              >
                <Input placeholder="https://example.com" inputMode="url" />
              </Form.Item>
            </Card>

            <Card size="small" title="Verification tokens">
              <Typography.Paragraph className="tf-muted" style={{ fontSize: 12 }}>
                Rendered as meta tags. An empty value is omitted rather than emitted blank.
              </Typography.Paragraph>

              <Form.Item
                name={['verification', 'google']}
                label="Google Search Console"
                rules={[{ max: 128, message: 'At most 128 characters' }]}
              >
                <Input autoComplete="off" spellCheck={false} />
              </Form.Item>
              <Form.Item
                name={['verification', 'bing']}
                label="Bing Webmaster Tools"
                rules={[{ max: 128, message: 'At most 128 characters' }]}
                style={{ marginBottom: 0 }}
              >
                <Input autoComplete="off" spellCheck={false} />
              </Form.Item>
            </Card>
          </Col>
        </Row>
      </SettingsForm>
    </Space>
  );
}
