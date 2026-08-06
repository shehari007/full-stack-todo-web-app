'use client';

import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Steps,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DownloadOutlined,
  KeyOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { ApiError, api, saveBlob } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';

interface MfaSetupResponse {
  secret: string;
  otpauthUri: string;
  qrCode: string;
}

interface RecoveryCodesResponse {
  message: string;
  recoveryCodes: string[];
}

type EnrolStep = 'scan' | 'confirm' | 'codes';

const STEP_INDEX: Record<EnrolStep, number> = { scan: 0, confirm: 1, codes: 2 };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/* -------------------------------------------------------------------------- */
/* Recovery codes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The one and only time these values exist in readable form, because the API
 * stores hashes. Everything here exists to get them off the screen and into
 * somewhere durable before the dialog closes.
 */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const { message } = App.useApp();

  // CRLF rather than LF: the most likely place this file gets opened is Windows
  // Notepad, which renders LF-only text as one long line.
  const asText = [
    'TaskFlow recovery codes',
    `Generated ${new Date().toISOString()}`,
    'Each code works once. Store them somewhere you can reach without this device.',
    '',
    ...codes,
    '',
  ].join('\r\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      message.success('Recovery codes copied');
    } catch {
      // Clipboard access is blocked on insecure origins and in some embedded
      // browsers; the codes are still selectable on screen.
      message.error('Copying failed. Select the codes and copy them by hand');
    }
  }

  function download() {
    saveBlob(
      new Blob([asText], { type: 'text/plain;charset=utf-8' }),
      `taskflow-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`,
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="warning"
        showIcon
        message="Save these now. They are shown only once"
        description="Each code signs you in once if you lose your authenticator. We store only hashes, so nobody, including an administrator, can show them to you again."
      />

      <div
        aria-label="Your recovery codes"
        style={{
          background: 'var(--tf-surface-raised)',
          border: '1px solid var(--tf-border)',
          borderRadius: 10,
          padding: '0.9rem',
        }}
      >
        <Row gutter={[8, 8]}>
          {codes.map((code) => (
            <Col xs={24} sm={12} key={code}>
              <code
                style={{
                  display: 'block',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.95rem',
                  letterSpacing: '0.04em',
                  overflowWrap: 'anywhere',
                  userSelect: 'all',
                }}
              >
                {code}
              </code>
            </Col>
          ))}
        </Row>
      </div>

      <Space wrap>
        <Button icon={<CopyOutlined />} onClick={() => void copy()}>
          Copy codes
        </Button>
        <Button icon={<DownloadOutlined />} onClick={download}>
          Download .txt
        </Button>
      </Space>
    </Space>
  );
}

/* -------------------------------------------------------------------------- */
/* MFA panel                                                                  */
/* -------------------------------------------------------------------------- */

export function MfaSetup() {
  const { message } = App.useApp();
  const { user, settings, isPrivileged, refresh } = useAuth();

  const enabled = user?.mfaEnabled ?? false;
  /** Staff cannot opt out when the installation mandates a second factor. */
  const locked = isPrivileged && settings.features.requireMfaForPrivileged;

  const [enrolOpen, setEnrolOpen] = useState(false);
  const [step, setStep] = useState<EnrolStep>('scan');
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);

  const [confirmForm] = Form.useForm<{ code: string }>();

  async function startEnrolment() {
    setBusy(true);
    try {
      const data = await api.post<MfaSetupResponse>('/api/auth/mfa/setup');
      setSetupData(data);
      setCodes([]);
      setAcknowledged(false);
      setStep('scan');
      confirmForm.resetFields();
      setEnrolOpen(true);
    } catch (error) {
      message.error(errorMessage(error, 'Could not start setup'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment(values: { code: string }) {
    setBusy(true);
    try {
      const result = await api.post<RecoveryCodesResponse>('/api/auth/mfa/enable', {
        code: values.code.trim(),
      });
      setCodes(result.recoveryCodes);
      setStep('codes');
      // The account is already protected at this point, so the header badge and
      // the rest of the page should say so even though the dialog is still open.
      await refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        confirmForm.setFields([{ name: 'code', errors: [error.message] }]);
      }
      message.error(errorMessage(error, 'That code was not accepted'));
    } finally {
      setBusy(false);
    }
  }

  function closeEnrolment() {
    setEnrolOpen(false);
    // Dropped rather than kept around: a secret left in component state is a
    // secret sitting in a heap snapshot.
    setSetupData(null);
    setCodes([]);
    setAcknowledged(false);
    setStep('scan');
  }

  /* The codes step is a hard gate: losing it costs the user their account. */
  const codesGateOpen = step !== 'codes' || acknowledged;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space align="center" wrap>
        <SafetyCertificateOutlined aria-hidden style={{ fontSize: '1.4rem' }} />
        <Typography.Text strong>Two-factor authentication</Typography.Text>
        {enabled ? <Tag color="success">On</Tag> : <Tag>Off</Tag>}
      </Space>

      <Typography.Paragraph className="tf-muted" style={{ marginBottom: 0 }}>
        A time-based code from an authenticator app, asked for after your password. It
        is what stops a leaked password on its own from being enough.
      </Typography.Paragraph>

      <div aria-live="polite">
        {enabled ? (
          <Alert
            type="success"
            showIcon
            message="Your account asks for a code at sign-in."
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="Two-factor authentication is not set up on this account."
          />
        )}
      </div>

      {locked && enabled ? (
        <Alert
          type="info"
          showIcon
          message="Required for your role"
          description="This installation requires two-factor authentication for administrator accounts, so it cannot be switched off here. You can still replace your recovery codes."
        />
      ) : null}

      <Space wrap>
        {enabled ? (
          <>
            <Button icon={<ReloadOutlined />} onClick={() => setRegenerateOpen(true)}>
              Regenerate recovery codes
            </Button>

            <Tooltip
              title={
                locked
                  ? 'Administrator accounts must keep two-factor authentication on for this installation.'
                  : ''
              }
            >
              {/* A disabled antd Button swallows pointer events, so the tooltip
                  needs a wrapper element to hang off. */}
              <span>
                <Button danger disabled={locked} onClick={() => setDisableOpen(true)}>
                  Turn off
                </Button>
              </span>
            </Tooltip>
          </>
        ) : (
          <Button
            type="primary"
            icon={<KeyOutlined />}
            loading={busy}
            onClick={() => void startEnrolment()}
          >
            Set up two-factor authentication
          </Button>
        )}
      </Space>

      {/* ---------------------------------------------------------------- */}
      {/* Enrolment                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Modal
        open={enrolOpen}
        title="Set up two-factor authentication"
        width={520}
        maskClosable={false}
        closable={codesGateOpen}
        keyboard={codesGateOpen}
        onCancel={closeEnrolment}
        destroyOnHidden
        footer={
          step === 'scan' ? (
            <Space>
              <Button onClick={closeEnrolment}>Cancel</Button>
              <Button type="primary" onClick={() => setStep('confirm')}>
                I have scanned it
              </Button>
            </Space>
          ) : step === 'confirm' ? (
            <Space>
              <Button onClick={() => setStep('scan')}>Back</Button>
              <Button type="primary" loading={busy} onClick={() => void confirmForm.submit()}>
                Verify and turn on
              </Button>
            </Space>
          ) : (
            <Button type="primary" disabled={!acknowledged} onClick={closeEnrolment}>
              Done
            </Button>
          )
        }
      >
        <Steps
          size="small"
          current={STEP_INDEX[step]}
          items={[{ title: 'Scan' }, { title: 'Confirm' }, { title: 'Recovery codes' }]}
          style={{ marginBottom: '1.25rem' }}
        />

        {step === 'scan' && setupData ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              Scan this with Google Authenticator, 1Password, Aegis or any other TOTP app.
            </Typography.Paragraph>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              {/* A data-URI PNG from the API. next/image would route it through
                  the optimiser for no gain: it is already a few hundred bytes. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setupData.qrCode}
                alt="QR code containing your two-factor secret. If you cannot scan it, use the setup key shown below."
                width={200}
                height={200}
                style={{
                  // The code must stay high-contrast in dark mode, and the PNG
                  // itself is black-on-transparent.
                  background: '#ffffff',
                  padding: 8,
                  borderRadius: 8,
                }}
              />
            </div>

            <div>
              <Typography.Text strong>Can&rsquo;t scan it?</Typography.Text>
              <Typography.Paragraph className="tf-muted" style={{ marginBottom: '0.35rem' }}>
                Enter this setup key in your app by hand.
              </Typography.Paragraph>
              <Typography.Paragraph
                copyable={{ text: setupData.secret, tooltips: ['Copy setup key', 'Copied'] }}
                style={{
                  background: 'var(--tf-surface-raised)',
                  border: '1px solid var(--tf-border)',
                  borderRadius: 8,
                  padding: '0.6rem 0.75rem',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  letterSpacing: '0.08em',
                  overflowWrap: 'anywhere',
                  marginBottom: 0,
                }}
              >
                {setupData.secret}
              </Typography.Paragraph>
            </div>
          </Space>
        ) : null}

        {step === 'confirm' ? (
          <Form<{ code: string }>
            form={confirmForm}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => void confirmEnrolment(values)}
          >
            <Typography.Paragraph>
              Enter the six-digit code your app is showing now.
            </Typography.Paragraph>

            <Form.Item
              name="code"
              label="Verification code"
              rules={[
                { required: true, message: 'Enter the 6-digit code from your app' },
                { pattern: /^\d{6}$/, message: 'The code is six digits' },
              ]}
            >
              <Input.OTP
                length={6}
                autoFocus
                role="group"
                aria-label="Six-digit verification code"
              />
            </Form.Item>

            <Typography.Text className="tf-muted" style={{ fontSize: '0.85rem' }}>
              Codes change every 30 seconds. If it is rejected, check that your phone&rsquo;s
              clock is set automatically.
            </Typography.Text>
          </Form>
        ) : null}

        {step === 'codes' ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <RecoveryCodes codes={codes} />
            <Checkbox
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            >
              I have saved these codes somewhere safe
            </Checkbox>
          </Space>
        ) : null}
      </Modal>

      <DisableMfaModal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={() => {
          setDisableOpen(false);
          void refresh();
        }}
      />

      <RegenerateCodesModal open={regenerateOpen} onClose={() => setRegenerateOpen(false)} />
    </Space>
  );
}

/* -------------------------------------------------------------------------- */
/* Disable                                                                    */
/* -------------------------------------------------------------------------- */

interface DisableValues {
  password: string;
  code: string;
}

function DisableMfaModal({
  open,
  onClose,
  onDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onDisabled: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<DisableValues>();
  const [busy, setBusy] = useState(false);

  async function submit(values: DisableValues) {
    setBusy(true);
    try {
      await api.post<{ message: string }>('/api/auth/mfa/disable', {
        password: values.password,
        code: values.code.trim(),
      });
      message.success('Two-factor authentication turned off');
      form.resetFields();
      onDisabled();
    } catch (error) {
      message.error(errorMessage(error, 'Could not turn off two-factor authentication'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Turn off two-factor authentication"
      okText="Turn it off"
      okButtonProps={{ danger: true }}
      confirmLoading={busy}
      onOk={() => void form.submit()}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: '1rem' }}
        message="Your password alone will be enough to sign in"
        description="Your existing recovery codes stop working immediately."
      />

      <Form<DisableValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="password"
          label="Your password"
          rules={[{ required: true, message: 'Confirm your password' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="code"
          label="Authenticator or recovery code"
          extra="A six-digit code from your app, or one of your recovery codes."
          rules={[{ required: true, message: 'Enter a code to confirm' }]}
        >
          {/* 20, matching `secondFactorCode` on the API. A recovery code is
              `XXXXX-XXXXX-XXXXX`, which is 17 characters, so anything tighter
              silently truncates the only credential someone who has lost their
              authenticator still has. */}
          <Input autoComplete="one-time-code" inputMode="text" maxLength={20} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Regenerate recovery codes                                                  */
/* -------------------------------------------------------------------------- */

function RegenerateCodesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ password: string }>();
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  const showingCodes = codes.length > 0;

  function close() {
    form.resetFields();
    setCodes([]);
    setAcknowledged(false);
    onClose();
  }

  async function submit(values: { password: string }) {
    setBusy(true);
    try {
      const result = await api.post<RecoveryCodesResponse>(
        '/api/auth/mfa/recovery-codes',
        values,
      );
      setCodes(result.recoveryCodes);
      form.resetFields();
    } catch (error) {
      message.error(errorMessage(error, 'Could not generate new codes'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Regenerate recovery codes"
      maskClosable={!showingCodes}
      closable={!showingCodes || acknowledged}
      keyboard={!showingCodes || acknowledged}
      onCancel={close}
      destroyOnHidden
      footer={
        showingCodes ? (
          <Button type="primary" disabled={!acknowledged} onClick={close}>
            Done
          </Button>
        ) : (
          <Space>
            <Button onClick={close}>Cancel</Button>
            <Button type="primary" loading={busy} onClick={() => void form.submit()}>
              Generate new codes
            </Button>
          </Space>
        )
      }
    >
      {showingCodes ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <RecoveryCodes codes={codes} />
          <Checkbox
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          >
            I have saved these codes somewhere safe
          </Checkbox>
        </Space>
      ) : (
        <>
          <Typography.Paragraph>
            This replaces every existing recovery code. Any list you printed or saved
            before now stops working.
          </Typography.Paragraph>

          <Form<{ password: string }>
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={(values) => void submit(values)}
          >
            <Form.Item
              name="password"
              label="Your password"
              rules={[{ required: true, message: 'Confirm your password' }]}
            >
              <Input.Password autoComplete="current-password" autoFocus />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
