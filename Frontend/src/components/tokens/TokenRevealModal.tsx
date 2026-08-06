'use client';

import { useState } from 'react';
import { Alert, App, Button, Checkbox, Modal, Space, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { saveBlob } from '@/lib/api';

/**
 * The one and only time the token exists in readable form. The API stores a
 * SHA-256 digest and nothing else, so this dialog is the last chance anybody,
 * including an administrator, has to see it.
 *
 * Deliberately modelled on the recovery-codes step in `MfaSetup`: same warning,
 * same copy/download pair, same acknowledgement gate before the dialog will
 * close. Two different "save this now, it is gone afterwards" dialogs that
 * behaved differently would train people to dismiss both.
 */
export function TokenRevealModal({
  open,
  token,
  tokenName,
  onClose,
}: {
  open: boolean;
  /** Null while no token has been minted; the dialog renders nothing. */
  token: string | null;
  tokenName: string;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [acknowledged, setAcknowledged] = useState(false);

  function close() {
    setAcknowledged(false);
    onClose();
  }

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      message.success('Token copied to your clipboard');
    } catch {
      message.error('Copying failed. Select the token and copy it by hand');
    }
  }

  function download() {
    if (!token) return;

    // CRLF rather than LF: the most likely place this file gets opened is
    // Windows Notepad, which renders LF-only text as one long line.
    const asText = [
      'TaskFlow personal access token',
      `Name: ${tokenName}`,
      `Created: ${new Date().toISOString()}`,
      'This token is read-only and can be revoked at any time from Settings → API tokens.',
      'Treat it like a password: never commit it to a repository.',
      '',
      token,
      '',
    ].join('\r\n');

    saveBlob(
      new Blob([asText], { type: 'text/plain;charset=utf-8' }),
      `taskflow-api-token-${new Date().toISOString().slice(0, 10)}.txt`,
    );
  }

  return (
    <Modal
      open={open}
      title="Copy your token now"
      width={560}
      maskClosable={false}
      // Every dismissal route is gated, not just the footer button: an Escape
      // key press or a stray click on the mask would otherwise destroy the only
      // copy of the secret.
      closable={acknowledged}
      keyboard={acknowledged}
      onCancel={close}
      destroyOnHidden
      footer={
        <Button type="primary" disabled={!acknowledged} onClick={close}>
          Done
        </Button>
      }
    >
      {token ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="This is the only time you will see this token"
            description="TaskFlow stores a one-way hash of it, so it cannot be shown again, not to you and not to an administrator. If you lose it, revoke this token and create another."
          />

          <div>
            <Typography.Text strong>{tokenName}</Typography.Text>
            <div
              aria-label="Your new API token"
              style={{
                marginTop: '0.4rem',
                background: 'var(--tf-surface-raised)',
                border: '1px solid var(--tf-border)',
                borderRadius: 10,
                padding: '0.9rem 1rem',
              }}
            >
              <code
                style={{
                  display: 'block',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '1rem',
                  lineHeight: 1.6,
                  letterSpacing: '0.02em',
                  // The token is one unbroken 50-character word, so it has to be
                  // allowed to break mid-string or it forces a 360px screen wide.
                  overflowWrap: 'anywhere',
                  userSelect: 'all',
                }}
              >
                {token}
              </code>
            </div>
          </div>

          <Space wrap>
            <Button type="primary" icon={<CopyOutlined />} onClick={() => void copy()}>
              Copy token
            </Button>
            <Button icon={<DownloadOutlined />} onClick={download}>
              Download .txt
            </Button>
          </Space>

          <Typography.Paragraph className="tf-muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
            Store it the way you would a password, in an environment variable or a
            password manager. A downloaded file in your Downloads folder is not
            somewhere to leave it.
          </Typography.Paragraph>

          <Checkbox
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          >
            I have copied this token somewhere safe
          </Checkbox>
        </Space>
      ) : null}
    </Modal>
  );
}
