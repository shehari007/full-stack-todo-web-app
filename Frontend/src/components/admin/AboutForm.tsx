'use client';

import {
  GithubOutlined,
  HistoryOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Card,
  Col,
  Form,
  Input,
  Row,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { SettingsForm } from '@/components/admin/SettingsForm';
import type { AboutSettings, BrandingSettings } from '@/types/api';

/**
 * The server's `safeUrl`: relative paths and http(s) only.
 *
 * Repeated here so a bad value is caught before the round trip. These URLs
 * become hrefs in the sidebar of every signed-in page, which is exactly where a
 * `javascript:` URL would turn an admin-editable field into stored XSS.
 */
const SAFE_URL = /^(\/|https?:\/\/)/i;

/*
 * No `required`, so an empty string skips the pattern check. The schema accepts
 * `''` for every one of these to mean "leave the icon out".
 */
const optionalUrlRules = [
  {
    pattern: SAFE_URL,
    message: 'Must be a relative path (/docs/api) or a full http(s) URL. javascript: is rejected.',
  },
  { max: 2048, message: 'At most 2048 characters' },
];

interface LinkSpec {
  name: 'repositoryUrl' | 'documentationUrl' | 'changelogUrl' | 'supportUrl';
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  /**
   * Whether `Sidebar.tsx` draws this one in the footer, and with which icon.
   *
   * The sidebar renders three links in this array's order (repository,
   * documentation, changelog) with these icons. `supportUrl` is stored and
   * validated but nothing renders it today, so the preview must not imply an
   * icon appears for it.
   */
  inSidebarFooter: boolean;
}

/** Drives both the form fields and the preview's icon row, so they cannot drift. */
const LINKS: readonly LinkSpec[] = [
  {
    name: 'repositoryUrl',
    label: 'Source repository',
    placeholder: 'https://github.com/you/your-fork',
    icon: <GithubOutlined />,
    inSidebarFooter: true,
  },
  {
    name: 'documentationUrl',
    label: 'Documentation',
    placeholder: '/docs/api',
    icon: <ReadOutlined />,
    inSidebarFooter: true,
  },
  {
    name: 'changelogUrl',
    label: 'Changelog',
    placeholder: 'https://github.com/you/your-fork/releases',
    icon: <HistoryOutlined />,
    inSidebarFooter: true,
  },
  {
    name: 'supportUrl',
    label: 'Support',
    placeholder: 'https://github.com/you/your-fork/issues',
    icon: <QuestionCircleOutlined />,
    inSidebarFooter: false,
  },
];

const AUTHOR_MARKER = '{author}';

/**
 * The sidebar footer as the current form values would render it.
 *
 * Built from plain elements at the sidebar's real width rather than from the
 * shell itself: the point is to show the values being edited, not the ones the
 * running app was rendered with.
 *
 * Every rule below mirrors `components/layout/Sidebar.tsx`: the v-prefix, the
 * three links it draws, the neutral channel tag, and substituting only the first
 * `{author}`. A preview that renders any of those differently is worse than no
 * preview, because it is believed.
 */
function SidebarPreview({
  values,
  branding,
}: {
  values: AboutSettings;
  branding: BrandingSettings;
}) {
  const { token } = theme.useToken();

  const version = values.version.trim();
  const channel = values.releaseChannel.trim();
  // Sidebar.tsx: administrators type it both ways, so the prefix is conditional.
  const versionLabel = /^v/i.test(version) ? version : `v${version}`;
  // Sidebar.tsx hides the whole row (channel tag included) when there is no
  // version string to hang it on.
  const showVersionRow = values.showVersion && version !== '';

  const activeLinks = LINKS.filter(
    (link) => link.inSidebarFooter && values[link.name].trim() !== '',
  );

  const markerAt = values.creditTemplate.indexOf(AUTHOR_MARKER);
  const creditBefore =
    markerAt === -1 ? values.creditTemplate : values.creditTemplate.slice(0, markerAt);
  const creditAfter =
    markerAt === -1 ? '' : values.creditTemplate.slice(markerAt + AUTHOR_MARKER.length);
  const showCreditRow = values.showCredits && values.creditTemplate.trim() !== '';

  const wordmark = branding.logoText.trim() || branding.siteName;

  return (
    <div
      style={{
        maxWidth: 232,
        border: '1px solid var(--tf-border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--tf-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderBottom: '1px solid var(--tf-border)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            flex: 'none',
            borderRadius: Math.max(branding.borderRadius, 6),
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: 13,
            // The same pair `Logo` uses, so a pale brand colour stays legible.
            background: branding.primaryColor,
            color: token.colorTextLightSolid,
          }}
        >
          {wordmark.charAt(0).toUpperCase() || 'T'}
        </span>
        <span style={{ minWidth: 0 }}>
          {/* The sidebar's title line is the site name, not the lettermark text. */}
          <Typography.Text strong style={{ display: 'block', lineHeight: 1.2, fontSize: 14 }}>
            {branding.siteName}
          </Typography.Text>
          {values.sidebarSubtitle.trim() !== '' ? (
            <Typography.Text className="tf-muted" style={{ fontSize: 11 }}>
              {values.sidebarSubtitle}
            </Typography.Text>
          ) : null}
        </span>
      </div>

      {/* Stands in for the nav, so the block below reads as a footer. */}
      <div aria-hidden style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
        {[64, 44, 52].map((width) => (
          <span
            key={width}
            style={{
              display: 'block',
              height: 8,
              width: `${width}%`,
              borderRadius: 4,
              background: 'var(--tf-border-subtle)',
            }}
          />
        ))}
      </div>

      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--tf-border)',
          display: 'grid',
          gap: 8,
        }}
      >
        {showVersionRow ? (
          <Space size={6} wrap>
            <Typography.Text
              className="tf-muted"
              style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
            >
              {versionLabel}
            </Typography.Text>
            {channel !== '' ? (
              // Neutral and filled, exactly as the sidebar draws it: colouring it
              // here would invent a meaning the running app does not give it.
              <Tag variant="filled" style={{ marginInlineEnd: 0, fontSize: 10 }}>
                {channel}
              </Tag>
            ) : null}
          </Space>
        ) : null}

        {activeLinks.length > 0 ? (
          <Space size={12} wrap>
            {activeLinks.map((link) => (
              // Not anchors: clicking inside a preview should not navigate away
              // from a form with unsaved changes. `tabIndex` keeps the tooltip
              // reachable without a pointer.
              <Tooltip key={link.name} title={`${link.label}: ${values[link.name]}`}>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={`${link.label}: ${values[link.name]}`}
                  style={{ color: 'var(--tf-text-muted)', fontSize: 15 }}
                >
                  {link.icon}
                </span>
              </Tooltip>
            ))}
          </Space>
        ) : null}

        {showCreditRow ? (
          <Typography.Text className="tf-muted" style={{ fontSize: 11 }}>
            {creditBefore}
            {/* A template with no `{author}` is rendered verbatim, and an empty
                author name leaves a gap. Both are exactly what the sidebar does. */}
            {markerAt === -1 ? null : (
              <span
                style={
                  values.authorUrl.trim() === ''
                    ? undefined
                    : // The sidebar's credit link is the brand accent, undecorated
                      // until hover.
                      { color: token.colorPrimary }
                }
              >
                {values.authorName}
              </span>
            )}
            {creditAfter}
          </Typography.Text>
        ) : null}

        {!showVersionRow && activeLinks.length === 0 && !showCreditRow ? (
          <Typography.Text className="tf-muted" style={{ fontSize: 11 }}>
            Nothing is shown in the sidebar footer with these settings.
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );
}

export function AboutForm({
  initialValues,
  branding,
  isRoot,
}: {
  initialValues: AboutSettings;
  branding: BrandingSettings;
  isRoot: boolean;
}) {
  const [form] = Form.useForm<AboutSettings>();

  // The preview has to move as the operator types, which means watching the live
  // store rather than the last-saved values.
  const watched = Form.useWatch([], form);
  const values: AboutSettings = { ...initialValues, ...(watched ?? {}) };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          About
        </Typography.Title>
        <Typography.Text className="tf-muted">
          The version, links and attribution shown in the sidebar of every signed-in page.
        </Typography.Text>
      </div>

      <SettingsForm<AboutSettings>
        sectionKey="about"
        initialValues={initialValues}
        form={form}
        /*
         * Read-only rather than hidden, as on Limits and Features. `about` is
         * root-only on the API (`assertMaySetSection` in `admin.routes.ts`
         * answers a delegated admin's PUT with a 403), so offering them the save
         * button would only lose their work. Showing them the values still earns
         * its place: "which version is this installation running" is exactly the
         * question an admin fielding a bug report has to answer.
         */
        readOnly={!isRoot}
        readOnlyNotice={
          <Alert
            type="info"
            showIcon
            message="Read-only for your account."
            description="The version string, the sidebar links and the credit line state who runs and maintains this installation, so the API reserves them for the root account. Ask the owner of this installation to make the change."
          />
        }
      >
        <Row gutter={[24, 0]}>
          <Col xs={24} lg={14}>
            <Card size="small" title="Version" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} sm={14}>
                  <Form.Item
                    name="version"
                    label="Version"
                    extra={'Free text: it is displayed, never parsed. The sidebar adds the "v".'}
                    rules={[{ max: 24, message: 'At most 24 characters' }]}
                  >
                    <Input maxLength={24} placeholder="2.1.0" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={10}>
                  <Form.Item
                    name="releaseChannel"
                    label="Release channel"
                    extra="stable, beta, dev, and so on. Shown beside the version, so an empty version hides it too."
                    rules={[{ max: 16, message: 'At most 16 characters' }]}
                  >
                    <Input maxLength={16} placeholder="stable" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="showVersion"
                label="Show the version in the sidebar"
                valuePropName="checked"
                extra="Off hides the whole row. The value is kept, so turning it back on restores it."
                style={{ marginBottom: 0 }}
              >
                <Switch
                  checkedChildren="Shown"
                  unCheckedChildren="Hidden"
                  aria-label="Show the version in the sidebar"
                />
              </Form.Item>
            </Card>

            <Card size="small" title="Sidebar" style={{ marginBottom: 16 }}>
              <Form.Item
                name="sidebarSubtitle"
                label="Subtitle"
                extra="The second line under the logo. Leave it empty to hide it."
                rules={[{ max: 48, message: 'At most 48 characters' }]}
                style={{ marginBottom: 0 }}
              >
                <Input maxLength={48} showCount placeholder="Task management" />
              </Form.Item>
            </Card>

            <Card size="small" title="Links" style={{ marginBottom: 16 }}>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Relative paths and http(s) URLs only"
                description="A javascript: or data: URL is rejected here and again by the API. These values become hrefs on every signed-in page. Leave a field empty to drop its icon from the sidebar."
              />

              {LINKS.map((link, index) => (
                <Form.Item
                  key={link.name}
                  name={link.name}
                  label={
                    <Space size={6}>
                      {link.icon}
                      <span>{link.label}</span>
                    </Space>
                  }
                  extra={
                    link.inSidebarFooter
                      ? undefined
                      : 'Stored and validated, but no screen renders it yet. It will not appear in the sidebar footer.'
                  }
                  rules={optionalUrlRules}
                  style={index === LINKS.length - 1 ? { marginBottom: 0 } : undefined}
                >
                  <Input placeholder={link.placeholder} inputMode="url" allowClear />
                </Form.Item>
              ))}
            </Card>

            <Card size="small" title="Credits" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="authorName"
                    label="Author"
                    rules={[{ max: 64, message: 'At most 64 characters' }]}
                  >
                    <Input maxLength={64} placeholder="Your name" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="authorUrl"
                    label="Author link"
                    extra="Empty leaves the name as plain text."
                    rules={optionalUrlRules}
                  >
                    <Input placeholder="https://github.com/you" inputMode="url" allowClear />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="creditTemplate"
                label="Credit line"
                extra="The first {author} is replaced by the name above; everything else is shown verbatim. A line with no {author} shows no name at all."
                rules={[{ max: 80, message: 'At most 80 characters' }]}
              >
                <Input maxLength={80} showCount placeholder="Built by {author}" />
              </Form.Item>

              <Form.Item
                name="showCredits"
                label="Show the credit line"
                valuePropName="checked"
                style={{ marginBottom: 0 }}
              >
                <Switch
                  checkedChildren="Shown"
                  unCheckedChildren="Hidden"
                  aria-label="Show the credit line"
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card size="small" title="Live preview" style={{ marginBottom: 16 }}>
              <SidebarPreview values={values} branding={branding} />
              <Typography.Paragraph
                className="tf-muted"
                style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}
              >
                Shows the values in the form, not the ones currently live. Save to apply them. An
                uploaded logo is drawn as its lettermark here; the sidebar hides the version and the
                credit line while it is collapsed.
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>
      </SettingsForm>
    </Space>
  );
}
