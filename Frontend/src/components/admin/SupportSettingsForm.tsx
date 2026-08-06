'use client';

import Link from 'next/link';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Result, Row, Select, Space, Switch, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { SettingsForm } from '@/components/admin/SettingsForm';
import { LoadError } from '@/components/admin/LoadError';
import type { SupportSettings } from '@/components/admin/admin-types';

export function SupportSettingsForm({
  initialValues,
  isRoot,
}: {
  /** Null when the page declined to fetch it, or when the API did not answer. */
  initialValues: SupportSettings | null;
  isRoot: boolean;
}) {
  /*
   * A refusal rather than a read-only form, unlike About, Limits and Features.
   *
   * This is UX, not enforcement: `support` is marked `rootOnly` in the settings
   * registry, so `assertMaySetSection` refuses the PUT for a delegated admin no
   * matter what this component renders. Editing `role` in devtools gets the form
   * back and a 403 when it saves. What the refusal buys is that nobody spends
   * ten minutes rewriting the contact copy before finding that out.
   */
  if (!isRoot) {
    return (
      <Result
        status="403"
        icon={<LockOutlined />}
        title="Support settings are reserved for the root account"
        subTitle="This section sets the anti-abuse thresholds on the public contact form: how often a stranger may submit it, and how much they may send. Ask the owner of this installation to make the change."
        extra={
          <Link href="/admin/support">
            <Button type="primary">Go to the support queue</Button>
          </Link>
        }
      />
    );
  }

  if (!initialValues) {
    return <LoadError what="support settings" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Support settings
        </Typography.Title>
        <Typography.Text className="tf-muted">
          The copy on the contact page, the categories both ticket forms offer, and the limits that
          keep the public form from becoming a spam funnel.
        </Typography.Text>
      </div>

      <Alert
        type="info"
        showIcon
        message="Turning the desk on and off lives elsewhere."
        description={
          <span>
            This screen configures the support desk. Whether it exists at all (the in-app tickets
            and the public contact form, which switch independently) is on the{' '}
            <Link href="/admin/features">Features</Link> screen.
          </span>
        }
      />

      <SettingsForm<SupportSettings> sectionKey="support" initialValues={initialValues}>
        <Card size="small" title="Categories" style={{ marginBottom: 16 }}>
          <Form.Item
            name="categories"
            label="Ticket categories"
            extra="Type a category and press Enter. The public contact form and the in-app composer both offer this list, so an operator maintains one set rather than two. Between 1 and 12."
            rules={[
              {
                validator: (_rule, value: string[] | undefined) =>
                  value && value.length > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('At least one category is required')),
              },
            ]}
          >
            <Select
              mode="tags"
              tokenSeparators={[',']}
              placeholder="Bug report, Feature request"
              aria-label="Ticket categories"
              maxCount={12}
              // No suggestion list: every value here is operator-authored.
              options={[]}
            />
          </Form.Item>
        </Card>

        <Card size="small" title="Contact page copy" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="contactHeading"
                label="Heading"
                rules={[{ max: 80, message: 'At most 80 characters' }]}
              >
                <Input maxLength={80} showCount placeholder="Get in touch" />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name="responseTimeNote"
                label="Response time note"
                extra="Sets the expectation before anyone writes. An unanswered promise here is worse than no promise."
                rules={[{ max: 120, message: 'At most 120 characters' }]}
              >
                <Input maxLength={120} showCount placeholder="Usually within two working days" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="contactIntro"
            label="Introduction"
            extra="Shown above the form."
            rules={[{ max: 600, message: 'At most 600 characters' }]}
          >
            <Input.TextArea rows={3} maxLength={600} showCount />
          </Form.Item>

          <Form.Item
            name="acknowledgement"
            label="Acknowledgement"
            extra="Shown after a successful submission. It is the last thing a visitor reads, and the only confirmation a guest with no account ever gets."
            rules={[{ max: 400, message: 'At most 400 characters' }]}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea rows={3} maxLength={400} showCount />
          </Form.Item>
        </Card>

        <Card size="small" title="Anti-abuse">
          <Typography.Paragraph className="tf-muted" style={{ fontSize: 13 }}>
            The public contact form is the one door into this installation that needs no account, so
            it is the one a script will find. These four numbers are what stands behind it, and they
            live here rather than in code so an installation under a spam wave can be tightened
            without a redeploy.
          </Typography.Paragraph>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="contactMaxPerHour"
                label="Submissions per hour, per sender"
                extra="Caps how many messages one address may send in an hour. Defends against a script hammering the form; set it too low and a person who sends a follow-up straight away is refused."
                rules={[
                  { type: 'number', min: 1, max: 60, message: 'Between 1 and 60' },
                ]}
              >
                <InputNumber min={1} max={60} style={{ width: '100%' }} addonAfter="per hour" />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name="contactMinFillSeconds"
                label="Minimum time on the form"
                extra="A script posts the instant the page loads; a person cannot write a message in under three seconds. Anything faster than this is refused. Zero switches the check off."
                rules={[
                  { type: 'number', min: 0, max: 60, message: 'Between 0 and 60' },
                ]}
              >
                <InputNumber min={0} max={60} style={{ width: '100%' }} addonAfter="seconds" />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name="contactMaxMessageLength"
                label="Longest message accepted"
                extra="Every message is stored in Postgres, so this is the ceiling on what one submission can cost you. It also bounds what a bot can paste in one request."
                rules={[
                  { type: 'number', min: 100, max: 20000, message: 'Between 100 and 20,000' },
                ]}
              >
                <InputNumber
                  min={100}
                  max={20000}
                  step={100}
                  style={{ width: '100%' }}
                  addonAfter="characters"
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name="contactRequiresAccount"
                label="Require an account to write in"
                valuePropName="checked"
                extra="The last resort. The contact page stays published and keeps explaining how to reach you, but only signed-in visitors may submit it, which closes guest submissions entirely during a spam wave."
                style={{ marginBottom: 0 }}
              >
                {/* Wording on the switch, so the state does not rest on the
                    knob's position alone. */}
                <Switch
                  checkedChildren="Account required"
                  unCheckedChildren="Guests welcome"
                  aria-label="Require an account to use the contact form"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </SettingsForm>
    </Space>
  );
}
