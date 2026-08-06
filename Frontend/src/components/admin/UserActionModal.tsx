'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { ApiError, api } from '@/lib/api';
import { applyFieldErrors } from '@/components/admin/form-errors';
import { BYTES_PER_MB, bytesToMb, formatBytes, mbToBytes } from '@/components/admin/format';
import type { AdminUserRow } from '@/components/admin/admin-types';
import type { AdminAction } from '@/components/admin/permissions';
import type { UserRole } from '@/types/api';

export type UserModalAction = AdminAction | 'create';

interface Props {
  action: UserModalAction | null;
  target: AdminUserRow | null;
  onClose: () => void;
  /** Called after the API confirms; the table revalidates from here. */
  onDone: () => void;
}

interface FormShape {
  displayName?: string;
  email?: string;
  username?: string;
  password?: string;
  newPassword?: string;
  role?: UserRole;
  reason?: string;
  quotaMb?: number | null;
  useRoleDefault?: boolean;
}

const TITLES: Record<UserModalAction, string> = {
  create: 'Create an account',
  edit: 'Edit account',
  'change-role': 'Change role',
  suspend: 'Suspend account',
  reactivate: 'Reactivate account',
  'set-quota': 'Storage quota',
  'reset-password': 'Reset password',
  'reset-mfa': 'Reset multi-factor authentication',
  delete: 'Delete account',
};

const OK_TEXT: Record<UserModalAction, string> = {
  create: 'Create account',
  edit: 'Save changes',
  'change-role': 'Change role',
  suspend: 'Suspend',
  reactivate: 'Reactivate',
  'set-quota': 'Save quota',
  'reset-password': 'Reset password',
  'reset-mfa': 'Reset MFA',
  delete: 'Delete permanently',
};

const DESTRUCTIVE: ReadonlySet<UserModalAction> = new Set<UserModalAction>([
  'suspend',
  'delete',
  'reset-password',
  'reset-mfa',
]);

/**
 * Every user-management operation, in one dialog.
 *
 * They share a shape (confirm something about one account, POST it, tell the
 * table to reload), and nine near-identical modal components would be nine
 * places to forget the 422 handling.
 */
export function UserActionModal({ action, target, onClose, onDone }: Props) {
  const [form] = Form.useForm<FormShape>();
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);

  const useRoleDefault = Form.useWatch('useRoleDefault', form);

  useEffect(() => {
    if (!action) return;

    form.resetFields();

    if (action === 'edit' && target) {
      form.setFieldsValue({ displayName: target.displayName ?? '', email: target.email });
    }

    if (action === 'change-role' && target) {
      form.setFieldsValue({ role: target.role });
    }

    if (action === 'set-quota' && target) {
      form.setFieldsValue({
        useRoleDefault: target.storageQuotaBytes === null,
        quotaMb: target.storageQuotaBytes === null ? null : bytesToMb(target.storageQuotaBytes),
      });
    }

    if (action === 'create') {
      form.setFieldsValue({ role: 'user' });
    }
  }, [action, form, target]);

  const submit = async () => {
    if (!action) return;

    let values: FormShape;
    try {
      values = await form.validateFields();
    } catch {
      return; // Ant Design has already marked the offending fields.
    }

    setSubmitting(true);

    try {
      const id = target?.id;

      switch (action) {
        case 'create':
          await api.post('/api/admin/users', {
            username: values.username,
            email: values.email,
            password: values.password,
            ...(values.displayName ? { displayName: values.displayName } : {}),
            role: values.role,
            status: 'active',
          });
          message.success('Account created.');
          break;

        case 'edit':
          await api.patch(`/api/admin/users/${id}`, {
            // An empty box means "no display name", which the API models as null
            // rather than as an empty string.
            displayName: values.displayName?.trim() ? values.displayName.trim() : null,
            email: values.email,
          });
          message.success('Account updated.');
          break;

        case 'change-role':
          await api.put(`/api/admin/users/${id}/role`, { role: values.role });
          message.success('Role changed.');
          break;

        case 'suspend':
          await api.put(`/api/admin/users/${id}/status`, {
            status: 'suspended',
            ...(values.reason?.trim() ? { reason: values.reason.trim() } : {}),
          });
          message.success('Account suspended and every session signed out.');
          break;

        case 'reactivate':
          await api.put(`/api/admin/users/${id}/status`, { status: 'active' });
          message.success('Account reactivated.');
          break;

        case 'set-quota':
          await api.put(`/api/admin/users/${id}/quota`, {
            // null clears the override and returns the account to its role default.
            storageQuotaBytes: values.useRoleDefault ? null : mbToBytes(values.quotaMb ?? 0),
          });
          message.success('Quota saved.');
          break;

        case 'reset-password':
          await api.post(`/api/admin/users/${id}/reset-password`, {
            newPassword: values.newPassword,
          });
          message.success('Password reset. Every session for that account is signed out.');
          break;

        case 'reset-mfa':
          await api.post(`/api/admin/users/${id}/reset-mfa`);
          message.success('Multi-factor authentication cleared.');
          break;

        case 'delete':
          await api.delete(`/api/admin/users/${id}`);
          message.success('Account deleted.');
          break;
      }

      onDone();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (fields) applyFieldErrors(form, fields);
        message.error(error.message);
      } else {
        message.error('Could not reach the server.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const label = target ? `${target.username} (${target.email})` : '';

  return (
    <Modal
      open={action !== null}
      title={action ? TITLES[action] : ''}
      okText={action ? OK_TEXT[action] : 'OK'}
      okButtonProps={{ danger: action ? DESTRUCTIVE.has(action) : false, loading: submitting }}
      cancelText="Cancel"
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
      maskClosable={!submitting}
    >
      {target ? (
        <Typography.Paragraph className="tf-muted" style={{ marginBottom: 16 }}>
          {label}
        </Typography.Paragraph>
      ) : null}

      <Form<FormShape> form={form} layout="vertical" requiredMark="optional" disabled={submitting}>
        {action === 'create' ? (
          <>
            <Form.Item
              name="username"
              label="Username"
              rules={[
                { required: true, message: 'Enter a username' },
                { min: 3, max: 32, message: 'Between 3 and 32 characters' },
                {
                  pattern: /^[a-zA-Z0-9_-]+$/,
                  message: 'Letters, numbers, hyphens and underscores only',
                },
              ]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="email"
              label="Email address"
              rules={[{ required: true, type: 'email', message: 'Enter a valid email address' }]}
            >
              <Input type="email" autoComplete="off" />
            </Form.Item>
            <Form.Item name="displayName" label="Display name (optional)">
              <Input maxLength={64} autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="password"
              label="Initial password"
              extra="At least 12 characters, using at least 5 different characters."
              rules={[
                { required: true, message: 'Enter a password' },
                { min: 12, message: 'At least 12 characters' },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="role"
              label="Role"
              extra="This is the only path that creates a privileged account, so it has to be chosen deliberately."
              rules={[{ required: true, message: 'Choose a role' }]}
            >
              <Select
                options={[
                  { value: 'user', label: 'User: their own tasks only' },
                  { value: 'admin', label: 'Admin: control panel, standard accounts only' },
                  { value: 'root', label: 'Root: full control of the installation' },
                ]}
              />
            </Form.Item>
          </>
        ) : null}

        {action === 'edit' ? (
          <>
            <Form.Item name="displayName" label="Display name">
              <Input maxLength={64} allowClear />
            </Form.Item>
            <Form.Item
              name="email"
              label="Email address"
              rules={[{ required: true, type: 'email', message: 'Enter a valid email address' }]}
            >
              <Input type="email" />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              message="Role and status are changed with their own actions, so each one is confirmed on its own."
            />
          </>
        ) : null}

        {action === 'change-role' ? (
          <>
            <Form.Item
              name="role"
              label="Role"
              rules={[{ required: true, message: 'Choose a role' }]}
            >
              <Select
                options={[
                  { value: 'user', label: 'User' },
                  { value: 'admin', label: 'Admin' },
                  { value: 'root', label: 'Root' },
                ]}
              />
            </Form.Item>
            <Alert
              type="warning"
              showIcon
              message="Takes effect immediately"
              description="The role is read from the account row on every request, so existing sessions gain or lose access straight away. Demoting the last root account is refused."
            />
          </>
        ) : null}

        {action === 'suspend' ? (
          <>
            <Form.Item
              name="reason"
              label="Reason (optional)"
              extra="Recorded in the audit log, so the suspension can still be explained months from now."
            >
              <Input.TextArea rows={3} maxLength={280} showCount />
            </Form.Item>
            <Alert
              type="warning"
              showIcon
              message="Every session for this account is signed out immediately."
              description="They keep their data and can be reactivated at any time."
            />
          </>
        ) : null}

        {action === 'reactivate' ? (
          <Alert
            type="info"
            showIcon
            message="The account can sign in again straight away."
            description="They will need to sign in fresh. The sessions revoked at suspension are not restored."
          />
        ) : null}

        {action === 'set-quota' ? (
          <>
            <Form.Item
              name="useRoleDefault"
              valuePropName="checked"
              label="Use the default for this role"
              extra="Clears the per-account override and follows the figure in Limits."
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="quotaMb"
              label="Storage quota (MB)"
              // Shown in MB, submitted in bytes. See MegabytesInput for why.
              extra={
                target
                  ? `Currently using ${formatBytes(target.storageUsedBytes)}. A quota below that stops new uploads; it does not delete anything.`
                  : undefined
              }
              rules={
                useRoleDefault
                  ? []
                  : [{ required: true, message: 'Enter a quota in megabytes' }]
              }
            >
              <InputNumber
                min={0}
                max={Math.round((1024 ** 4) / BYTES_PER_MB)}
                step={1}
                style={{ width: '100%' }}
                disabled={useRoleDefault === true}
                addonAfter="MB"
                aria-label="Storage quota in megabytes"
              />
            </Form.Item>
          </>
        ) : null}

        {action === 'reset-password' ? (
          <>
            <Form.Item
              name="newPassword"
              label="New password"
              extra="At least 12 characters, using at least 5 different characters."
              rules={[
                { required: true, message: 'Enter a new password' },
                { min: 12, message: 'At least 12 characters' },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Alert
              type="warning"
              showIcon
              message="You are choosing this password on their behalf."
              description="Every session is signed out and any brute-force lockout is cleared. Send it to them over a channel you trust, and ask them to change it."
            />
          </>
        ) : null}

        {action === 'reset-mfa' ? (
          <Alert
            type="warning"
            showIcon
            message="The account drops to a single factor."
            description="Their authenticator and recovery codes stop working and every session is signed out. Only do this once you are sure who you are talking to, because it is the standard route for an account takeover."
          />
        ) : null}

        {action === 'delete' ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="error"
              showIcon
              message="This cannot be undone."
              description="The account, its tasks, its attachments and its sessions are removed for good. Audit entries survive: their actor id is cleared but the username stays as text, so the record of what the account did outlives it."
            />
            <Typography.Text>
              Suspending instead keeps everything and can be reversed.
            </Typography.Text>
          </Space>
        ) : null}
      </Form>
    </Modal>
  );
}
