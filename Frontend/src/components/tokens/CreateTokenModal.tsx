'use client';

import { useState } from 'react';
import { Alert, App, Checkbox, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { ApiError, api } from '@/lib/api';
import { SCOPE_INFO } from '@/components/tokens/token-scopes';
import type { ApiTokenSummary, TokenScope } from '@/types/api';

/** Matches `createTokenSchema.name` in `Server/src/modules/tokens/tokens.schemas.ts`. */
const MAX_NAME_LENGTH = 80;

/**
 * `never` is offered because some integrations genuinely outlive any expiry a
 * user would pick, and the alternative is a token that silently stops working on
 * a morning nobody remembers choosing. It is not the default, and the form says
 * why.
 */
type ExpiryChoice = '30' | '90' | '365' | 'never';

const EXPIRY_OPTIONS: Array<{ value: ExpiryChoice; label: string }> = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days (recommended)' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'No expiry' },
];

interface CreateValues {
  name: string;
  scopes: TokenScope[];
  expiry: ExpiryChoice;
}

interface CreateTokenResponse {
  /** Plaintext, returned exactly once. */
  token: string;
  apiToken: ApiTokenSummary;
}

/**
 * Map a field path from a 422 onto the form control that produced it.
 *
 * The API validates what it receives, which is not quite what the form holds:
 * the expiry is a `<Select>` of `'30' | 'never'` posted as `expiresInDays`, and
 * a bad scope is reported at its index (`scopes.1`) so a client can highlight
 * one checkbox, but this form renders the group as a single control. Left
 * unmapped, those messages attach to fields that do not exist, and the user is
 * told "some fields need attention" with nothing marked.
 */
function toFormField(path: string): keyof CreateValues | null {
  if (path === 'name') return 'name';
  if (path === 'expiresInDays') return 'expiry';
  if (path === 'scopes' || path.startsWith('scopes.')) return 'scopes';
  return null;
}

export function CreateTokenModal({
  open,
  availableScopes,
  onClose,
  onCreated,
}: {
  open: boolean;
  /**
   * The scopes this API build actually understands, as shipped alongside the
   * token list. Offering a locally hardcoded set instead would keep showing a
   * retired scope, which the server then rejects at create time.
   */
  availableScopes: readonly TokenScope[];
  onClose: () => void;
  /** Hands the plaintext straight to the reveal dialog; nothing else may keep it. */
  onCreated: (token: string, name: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateValues>();
  const [busy, setBusy] = useState(false);

  function close() {
    form.resetFields();
    onClose();
  }

  async function submit(values: CreateValues) {
    setBusy(true);
    try {
      const result = await api.post<CreateTokenResponse>('/api/tokens', {
        name: values.name.trim(),
        scopes: values.scopes,
        // Null rather than a sentinel number: the column is nullable and NULL is
        // what "never expires" means there.
        expiresInDays: values.expiry === 'never' ? null : Number(values.expiry),
      });

      form.resetFields();
      onCreated(result.token, result.apiToken.name);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (fields) {
          // Several server paths can land on one control (`scopes.0`, `scopes.1`),
          // so messages are gathered per form field before they are applied.
          const byField = new Map<keyof CreateValues, string[]>();
          for (const [path, errors] of Object.entries(fields)) {
            const field = toFormField(path);
            if (!field) continue;
            byField.set(field, [...(byField.get(field) ?? []), ...errors]);
          }

          form.setFields([...byField].map(([name, errors]) => ({ name, errors })));
        }
        message.error(error.message);
      } else {
        message.error('Could not create the token');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Create an API token"
      width={560}
      okText="Create token"
      confirmLoading={busy}
      onOk={() => void form.submit()}
      onCancel={close}
      destroyOnHidden
    >
      <Form<CreateValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={busy}
        initialValues={
          {
            // Ticked by default because it is the reason almost everybody is
            // here, but only if this build still offers it.
            scopes: availableScopes.includes('tasks:read') ? ['tasks:read'] : [],
            expiry: '90',
          } satisfies Partial<CreateValues>
        }
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="name"
          label="Name"
          extra="For your eyes only. Name it after where it will be used, so you know which one to revoke later."
          rules={[
            { required: true, message: 'Give the token a name' },
            { max: MAX_NAME_LENGTH, message: `Keep the name under ${MAX_NAME_LENGTH} characters` },
          ]}
        >
          <Input placeholder="My portfolio site" maxLength={MAX_NAME_LENGTH} autoFocus />
        </Form.Item>

        <Form.Item
          name="scopes"
          label="What this token may read"
          rules={[
            {
              // A token with no scopes authenticates and is then refused
              // everywhere, which reads as a broken API rather than as a
              // mistake in the form.
              validator: (_rule, value: TokenScope[] | undefined) =>
                value && value.length > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error('Choose at least one thing this token may read')),
            },
          ]}
        >
          <Checkbox.Group style={{ width: '100%' }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {availableScopes.map((scope) => (
                <Checkbox key={scope} value={scope} style={{ alignItems: 'flex-start' }}>
                  <span style={{ display: 'block' }}>
                    <Typography.Text strong>{SCOPE_INFO[scope].label}</Typography.Text>{' '}
                    <Typography.Text
                      code
                      className="tf-muted"
                      style={{ fontSize: '0.8rem' }}
                    >
                      {scope}
                    </Typography.Text>
                  </span>
                  <Typography.Text className="tf-muted" style={{ fontSize: '0.85rem' }}>
                    {SCOPE_INFO[scope].grants}
                  </Typography.Text>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Form.Item>

        <Form.Item
          name="expiry"
          label="Expires"
          extra="An expiry is a safety net: a token you forget about, or one that leaks without you noticing, stops working on its own. You can always create a replacement."
        >
          <Select<ExpiryChoice> options={EXPIRY_OPTIONS} />
        </Form.Item>

        <Alert
          type="info"
          showIcon
          message="Every token is read-only"
          description="Nothing here can create, change or delete a task, and no token can reach your email address, your password or your security settings."
        />
      </Form>
    </Modal>
  );
}
