'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { App, DatePicker, Divider, Form, Input, Modal, Select, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import type { Todo, TodoPriority, TodoStatus } from '@/types/api';
import { AttachmentPanel } from './AttachmentPanel';
import { PRIORITY_META, STATUS_META, TODO_PRIORITIES, TODO_STATUSES } from './task-utils';

interface TaskFormModalProps {
  open: boolean;
  /** Null creates; a task edits it. */
  todo: Todo | null;
  tagOptions: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface TaskFormValues {
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt?: Dayjs | null;
  tags?: string[];
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 10_000;

const FORM_FIELDS = ['title', 'description', 'status', 'priority', 'dueAt', 'tags'] as const;
type FormField = (typeof FORM_FIELDS)[number];

function isFormField(name: string): name is FormField {
  return (FORM_FIELDS as readonly string[]).includes(name);
}

export function TaskFormModal({ open, todo, tagOptions, onClose, onSaved }: TaskFormModalProps) {
  const { message } = App.useApp();
  const { settings } = useAuth();
  const [form] = Form.useForm<TaskFormValues>();
  const [saving, setSaving] = useState(false);

  const isEdit = todo !== null;

  /*
   * The list endpoint returns tasks without their attachments, so editing has to
   * ask for the single task to know what is already attached. Fetched only while
   * the modal is open, because it is a request per row otherwise.
   */
  const { data: detail, mutate: refreshDetail } = useSWR<{ todo: Todo }>(
    open && todo ? `/api/todos/${todo.id}` : null,
    swrFetcher,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!open) return;

    form.setFieldsValue({
      title: todo?.title ?? '',
      description: todo?.description ?? '',
      status: todo?.status ?? 'todo',
      priority: todo?.priority ?? 'medium',
      dueAt: todo?.dueAt ? dayjs(todo.dueAt) : null,
      tags: todo?.tags ?? [],
    });
  }, [open, todo, form]);

  const handleSubmit = async () => {
    let values: TaskFormValues;
    try {
      values = await form.validateFields();
    } catch {
      // Ant Design has already marked the offending fields.
      return;
    }

    const description = values.description?.trim() ?? '';
    const payload = {
      title: values.title.trim(),
      // An empty box means "no description", which is null rather than "".
      description: description.length > 0 ? description : null,
      status: values.status,
      priority: values.priority,
      dueAt: values.dueAt ? values.dueAt.toISOString() : null,
      tags: values.tags ?? [],
    };

    setSaving(true);
    try {
      if (todo) {
        await api.patch<{ todo: Todo }>(`/api/todos/${todo.id}`, payload);
      } else {
        await api.post<{ todo: Todo }>('/api/todos', payload);
      }
      message.success(todo ? 'Task updated' : 'Task created');
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.fieldErrors;
        if (fieldErrors) {
          // A 422 belongs on the fields it came from, not in a toast the user has
          // to hold in their head while hunting for the bad one.
          const known = Object.entries(fieldErrors).filter(([name]) => isFormField(name));
          form.setFields(
            known.map(([name, errors]) => ({
              name: name as FormField,
              errors,
            })),
          );

          // Anything the form has no field for (a whole-body rule, say) would
          // otherwise be swallowed silently.
          const orphans = Object.entries(fieldErrors)
            .filter(([name]) => !isFormField(name))
            .flatMap(([, errors]) => errors);

          message.error(orphans[0] ?? 'Check the highlighted fields');
        } else {
          message.error(err.message);
        }
      } else {
        message.error('That task could not be saved. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit task' : 'New task'}
      okText={isEdit ? 'Save changes' : 'Create task'}
      onOk={() => void handleSubmit()}
      onCancel={onClose}
      confirmLoading={saving}
      // Discards the form and the attachment queue, so reopening never shows the
      // previous task's values for a frame.
      destroyOnHidden
      width={{ xs: '100%', sm: 560, md: 620 }}
      styles={{
        body: { maxHeight: '68vh', overflowY: 'auto', paddingTop: '0.5rem' },
      }}
    >
      <Form<TaskFormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        // The dialog's OK button submits, but Enter in the title should too.
        onFinish={() => void handleSubmit()}
      >
        <Form.Item
          name="title"
          label="Title"
          rules={[
            { required: true, message: 'Give the task a title' },
            {
              max: MAX_TITLE,
              message: `Titles are limited to ${MAX_TITLE} characters`,
            },
          ]}
        >
          <Input placeholder="What needs doing?" maxLength={MAX_TITLE} autoFocus showCount />
        </Form.Item>

        <Form.Item
          name="description"
          label="Description"
          rules={[{ max: MAX_DESCRIPTION, message: 'That description is too long' }]}
        >
          <Input.TextArea
            placeholder="Any detail worth remembering"
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={MAX_DESCRIPTION}
          />
        </Form.Item>

        <Form.Item name="status" label="Status">
          <Select<TodoStatus>
            options={TODO_STATUSES.map((value) => ({
              value,
              label: STATUS_META[value].label,
            }))}
          />
        </Form.Item>

        <Form.Item name="priority" label="Priority">
          <Select<TodoPriority>
            options={TODO_PRIORITIES.map((value) => ({
              value,
              label: PRIORITY_META[value].label,
            }))}
          />
        </Form.Item>

        <Form.Item name="dueAt" label="Due">
          <DatePicker
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            style={{ width: '100%' }}
            placeholder="No due date"
          />
        </Form.Item>

        <Form.Item name="tags" label="Tags" extra="Type to add a tag, then press Enter.">
          <Select<string[]>
            mode="tags"
            placeholder="e.g. work, urgent"
            options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
            maxCount={20}
            tokenSeparators={[',']}
          />
        </Form.Item>
      </Form>

      {isEdit && todo && settings.features.attachmentsEnabled ? (
        <>
          <Divider style={{ margin: '0.5rem 0 1rem' }} />
          <Typography.Title level={2} style={{ fontSize: '0.95rem', margin: '0 0 0.6rem' }}>
            Attachments
          </Typography.Title>
          <AttachmentPanel
            todoId={todo.id}
            initialAttachments={detail?.todo.attachments ?? todo.attachments ?? []}
            onChanged={() => void refreshDetail()}
          />
        </>
      ) : null}

      {!isEdit ? (
        <Typography.Paragraph className="tf-muted" style={{ fontSize: '0.8125rem', margin: 0 }}>
          Files can be attached once the task exists.
        </Typography.Paragraph>
      ) : null}
    </Modal>
  );
}
