'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Space, Tag, Typography, theme } from 'antd';
import type { FormInstance } from 'antd';
import { ExclamationCircleOutlined, ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { ApiError, api } from '@/lib/api';
import { applyFieldErrors, scrollToFieldPath } from '@/components/admin/form-errors';
import type { SettingsSectionKey, SettingsSectionResponse } from '@/components/admin/admin-types';

export interface SettingsFormProps<T extends object> {
  sectionKey: SettingsSectionKey;
  /** The section exactly as `GET /api/admin/settings` returned it. */
  initialValues: T;
  /** Supply one when the page needs `Form.useWatch` for a live preview. */
  form?: FormInstance<T>;
  children: React.ReactNode;
  /** Last chance to reshape values before the PUT, e.g. dropping a UI-only field. */
  serialize?: (values: T) => Record<string, unknown>;
  /** Extra confirmation before saving, e.g. maintenance mode. Reject to cancel. */
  beforeSave?: (values: T) => Promise<boolean>;
  onSaved?: (values: T) => void;
  readOnly?: boolean;
  readOnlyNotice?: React.ReactNode;
  footerExtra?: React.ReactNode;
}

/**
 * One section of the CMS: a form, a save, a reset-to-defaults, and a dirty guard.
 *
 * Every settings screen is this component plus its own `Form.Item`s, so the
 * save/reset/error behaviour is written once. The API merges a patch over the
 * current value before validating it, but the whole section is sent anyway. A
 * partial PUT would silently keep a field the operator just cleared.
 */
export function SettingsForm<T extends object>({
  sectionKey,
  initialValues,
  form: externalForm,
  children,
  serialize,
  beforeSave,
  onSaved,
  readOnly = false,
  readOnlyNotice,
  footerExtra,
}: SettingsFormProps<T>) {
  const [form] = Form.useForm<T>(externalForm);
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>('');

  /** What "discard" goes back to: the last state the server confirmed. */
  const savedValues = useRef<T>(initialValues);

  /*
   * The browser's own guard. Next.js has no general navigation blocker, so an
   * in-app link still leaves with unsaved edits. The persistent "Unsaved
   * changes" tag below is what covers that case, and it is why the save bar is
   * sticky rather than at the bottom of a long form.
   */
  useEffect(() => {
    if (!dirty) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const applyServerValues = useCallback(
    (values: T) => {
      savedValues.current = values;
      form.resetFields();
      form.setFieldsValue(values);
      setDirty(false);
      onSaved?.(values);
      // Server components read settings on the server; without this the pages
      // around this one keep rendering the old copy until a hard reload.
      router.refresh();
    },
    [form, onSaved, router],
  );

  const handleFinish = useCallback(
    async (values: T) => {
      if (beforeSave && !(await beforeSave(values))) return;

      setSaving(true);
      setStatus('Saving...');

      try {
        const payload = serialize ? serialize(values) : (values as Record<string, unknown>);
        const response = await api.put<SettingsSectionResponse<T>>(
          `/api/admin/settings/${sectionKey}`,
          payload,
        );

        const saved = response.settings[sectionKey] ?? values;
        applyServerValues(saved);
        setStatus('Saved.');
        message.success('Settings saved.');
      } catch (error) {
        if (error instanceof ApiError) {
          const fields = error.fieldErrors;

          if (fields) {
            // Nothing scrolls into view on its own when the failing field is
            // three sections down a long form.
            const first = applyFieldErrors(form, fields);
            if (first) scrollToFieldPath(form, first);
          }

          setStatus(`Not saved: ${error.message}`);
          message.error(error.message);
        } else {
          setStatus('Not saved: the request could not be sent.');
          message.error('Could not reach the server.');
        }
      } finally {
        setSaving(false);
      }
    },
    [applyServerValues, beforeSave, form, message, sectionKey, serialize],
  );

  const handleReset = useCallback(() => {
    modal.confirm({
      title: `Reset ${sectionKey} to its defaults?`,
      icon: <ExclamationCircleOutlined />,
      okText: 'Reset to defaults',
      okButtonProps: { danger: true },
      cancelText: 'Keep current settings',
      content: (
        <span>
          Every field in this section returns to the value it shipped with. This takes effect
          immediately for all visitors and is recorded in the audit log. It cannot be undone from
          here.
        </span>
      ),
      onOk: async () => {
        setResetting(true);
        setStatus('Resetting...');

        try {
          const response = await api.post<SettingsSectionResponse<T>>(
            `/api/admin/settings/${sectionKey}/reset`,
          );

          const defaults = response.settings[sectionKey];
          if (defaults) applyServerValues(defaults);

          setStatus('Reset to defaults.');
          message.success('Section reset to its defaults.');
        } catch (error) {
          const text = error instanceof ApiError ? error.message : 'Could not reach the server.';
          setStatus(`Not reset: ${text}`);
          message.error(text);
        } finally {
          setResetting(false);
        }
      },
    });
  }, [applyServerValues, message, modal, sectionKey]);

  const handleDiscard = useCallback(() => {
    form.resetFields();
    form.setFieldsValue(savedValues.current);
    setDirty(false);
    setStatus('Changes discarded.');
  }, [form]);

  return (
    <Form<T>
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={handleFinish}
      onValuesChange={() => {
        setDirty(true);
        setStatus('');
      }}
      disabled={readOnly}
      requiredMark="optional"
      scrollToFirstError
    >
      {readOnly && readOnlyNotice ? <div style={{ marginBottom: 16 }}>{readOnlyNotice}</div> : null}

      {children}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 5,
          marginTop: 24,
          padding: '0.75rem 0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          background: 'var(--tf-surface)',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space size={8} wrap>
          {/* Status is announced rather than only shown: a save that fails
              off-screen is otherwise silent for a screen-reader user. */}
          <Typography.Text
            className="tf-muted"
            aria-live="polite"
            role="status"
            style={{ fontSize: 13 }}
          >
            {status}
          </Typography.Text>
          {dirty ? (
            <Tag color="warning" icon={<ExclamationCircleOutlined />}>
              Unsaved changes
            </Tag>
          ) : null}
        </Space>

        <Space size={8} wrap>
          {footerExtra}
          <Button icon={<ReloadOutlined />} onClick={handleReset} loading={resetting} danger>
            Reset to defaults
          </Button>
          <Button icon={<UndoOutlined />} onClick={handleDiscard} disabled={readOnly || !dirty}>
            Discard
          </Button>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
            Save changes
          </Button>
        </Space>
      </div>
    </Form>
  );
}
