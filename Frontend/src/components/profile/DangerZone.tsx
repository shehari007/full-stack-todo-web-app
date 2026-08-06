'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Form, Input, Modal, Space, Typography } from 'antd';
import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { ApiError, api, apiDownload, saveBlob } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import type { User } from '@/types/api';

interface DeleteValues {
  password: string;
  confirmUsername: string;
}

export function DangerZone({ user }: { user: User }) {
  const { message } = App.useApp();
  const { setUser } = useAuth();
  const router = useRouter();

  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function exportData() {
    setExporting(true);
    setStatus('Preparing your export...');
    try {
      const { blob, filename } = await apiDownload('/api/profile/export');
      saveBlob(blob, filename);
      setStatus('Export downloaded.');
      message.success('Your data has been downloaded');
    } catch (error) {
      setStatus('Export failed.');
      message.error(error instanceof ApiError ? error.message : 'Could not build your export');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <section>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Export my data
        </Typography.Title>
        <Typography.Paragraph className="tf-muted">
          A JSON file containing your profile, every task you have (including anything
          in the trash), the details of your uploaded files, your sessions and your
          cookie-consent history. File contents themselves are not included; each entry
          carries the id you can download it by.
        </Typography.Paragraph>

        <Button
          icon={<DownloadOutlined />}
          loading={exporting}
          onClick={() => void exportData()}
        >
          Download my data
        </Button>

        <div aria-live="polite" className="tf-muted" style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>
          {status}
        </div>
      </section>

      <section>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Delete my account
        </Typography.Title>

        <Alert
          type="error"
          showIcon
          style={{ marginBottom: '0.85rem' }}
          message="This cannot be undone"
          description={
            <>
              Deleting <strong>@{user.username}</strong> permanently removes:
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                <li>your profile, preferences and password</li>
                <li>every task, including those in the trash</li>
                <li>every file you have uploaded, including your profile photo</li>
                <li>every signed-in session, on every device</li>
                <li>your cookie-consent records</li>
              </ul>
              <div style={{ marginTop: '0.5rem' }}>
                Security audit entries are kept, because an installation has to be able
                to account for what happened on it. Your account id is removed from
                them and only the username remains.
              </div>
            </>
          }
        />

        <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </section>

      <DeleteAccountModal
        open={deleteOpen}
        username={user.username}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          setUser(null);
          // The API has already cleared the cookies; refresh() would only
          // re-render a page this account no longer has access to.
          router.replace('/');
        }}
      />
    </Space>
  );
}

function DeleteAccountModal({
  open,
  username,
  onClose,
  onDeleted,
}: {
  open: boolean;
  username: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<DeleteValues>();
  const [busy, setBusy] = useState(false);

  const typed = Form.useWatch('confirmUsername', form) ?? '';
  const password = Form.useWatch('password', form) ?? '';

  /*
   * Both confirmations are checked here purely so the button can stay disabled
   * until they are right; the API verifies the password and the username again
   * and is the only thing standing between a request and a deleted account.
   */
  const canDelete = typed === username && password.length > 0;

  async function submit(values: DeleteValues) {
    setBusy(true);
    try {
      await api.delete('/api/profile', values);
      message.success('Your account has been deleted');
      form.resetFields();
      onDeleted();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not delete your account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Delete your account"
      okText="Delete my account permanently"
      okButtonProps={{ danger: true, disabled: !canDelete }}
      confirmLoading={busy}
      onOk={() => void form.submit()}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Typography.Paragraph>
        Everything belonging to <strong>@{username}</strong> is erased immediately. There
        is no recovery period and no backup we can restore from, so download your data
        first if you want to keep it.
      </Typography.Paragraph>

      <Form<DeleteValues>
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
          name="confirmUsername"
          label={`Type ${username} to confirm`}
          rules={[
            { required: true, message: 'Type your username to confirm' },
            {
              validator: (_rule, value: string) =>
                !value || value === username
                  ? Promise.resolve()
                  : Promise.reject(new Error('That does not match your username')),
            },
          ]}
        >
          <Input
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={username}
            aria-describedby="delete-confirm-hint"
          />
        </Form.Item>

        <div id="delete-confirm-hint" className="tf-muted" style={{ fontSize: '0.85rem' }} aria-live="polite">
          {canDelete
            ? 'Confirmed. The delete button is now enabled.'
            : 'The delete button stays disabled until both fields are filled in correctly.'}
        </div>
      </Form>
    </Modal>
  );
}
