'use client';

import { useState } from 'react';
import { App, Form, Input, Modal, Select, Typography } from 'antd';
import { ApiError, api } from '@/lib/api';
import {
  REQUESTER_TICKET_PRIORITIES,
  TICKET_PRIORITY_META,
  type Ticket,
  type TicketPriority,
} from '@/components/support/ticket-meta';

/**
 * `MAX_SUBJECT_LENGTH` and `MIN_SUBJECT_LENGTH` are the API's own bounds
 * (`createTicketSchema`), so the form refuses what the request would refuse
 * rather than trading a keystroke for a 422.
 *
 * `MAX_MESSAGE_LENGTH` is deliberately well under the API's 20,000-character
 * structural ceiling: that number is there to stop an oversized body being
 * parsed at all, not to invite one, and 5,000 characters is already far more
 * than a bug report needs.
 */
const MIN_SUBJECT_LENGTH = 3;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;

/**
 * Fallback categories.
 *
 * The real list is an operator setting (`support.categories`), served with the
 * public settings. This copy only covers an API too old to send it. Without one,
 * an empty `<Select>` would block the form on a required field with nothing in
 * it.
 */
const FALLBACK_CATEGORIES = [
  'General question',
  'Bug report',
  'Feature request',
  'Account or billing',
  'Security concern',
];

interface NewTicketValues {
  subject: string;
  category: string;
  priority: TicketPriority;
  message: string;
}

/** Field paths the API reports, mapped onto the controls that produced them. */
function toFormField(path: string): keyof NewTicketValues | null {
  if (path === 'subject') return 'subject';
  if (path === 'category') return 'category';
  if (path === 'priority') return 'priority';
  if (path === 'message' || path === 'body') return 'message';
  return null;
}

export function NewTicketModal({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** From `support.categories` in the public settings; see the fallback above. */
  categories?: readonly string[];
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<NewTicketValues>();
  const [busy, setBusy] = useState(false);

  const options = (categories?.length ? categories : FALLBACK_CATEGORIES).map((category) => ({
    value: category,
    label: category,
  }));

  function close() {
    form.resetFields();
    onClose();
  }

  async function submit(values: NewTicketValues) {
    setBusy(true);
    try {
      const { ticket } = await api.post<{ ticket: Ticket }>('/api/support/tickets', {
        subject: values.subject.trim(),
        category: values.category,
        priority: values.priority,
        message: values.message.trim(),
      });

      form.resetFields();
      onCreated(ticket);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors;
        if (fields) {
          const byField = new Map<keyof NewTicketValues, string[]>();
          for (const [path, errors] of Object.entries(fields)) {
            const field = toFormField(path);
            if (!field) continue;
            byField.set(field, [...(byField.get(field) ?? []), ...errors]);
          }
          form.setFields([...byField].map(([name, errors]) => ({ name, errors })));
        }
        message.error(error.message);
      } else {
        message.error('Could not open that ticket');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="New support ticket"
      width={580}
      okText="Send ticket"
      confirmLoading={busy}
      onOk={() => void form.submit()}
      onCancel={close}
      destroyOnHidden
    >
      <Form<NewTicketValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={busy}
        initialValues={
          {
            category: options[0]?.value ?? FALLBACK_CATEGORIES[0],
            priority: 'normal',
          } satisfies Partial<NewTicketValues>
        }
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="subject"
          label="Subject"
          rules={[
            { required: true, message: 'Give the ticket a subject' },
            {
              min: MIN_SUBJECT_LENGTH,
              message: `Use at least ${MIN_SUBJECT_LENGTH} characters`,
            },
            { max: MAX_SUBJECT_LENGTH, message: `Keep it under ${MAX_SUBJECT_LENGTH} characters` },
          ]}
        >
          <Input
            placeholder="Exports finish but the PDF will not open"
            maxLength={MAX_SUBJECT_LENGTH}
            autoFocus
          />
        </Form.Item>

        <Form.Item
          name="category"
          label="Category"
          rules={[{ required: true, message: 'Pick a category' }]}
        >
          <Select options={options} />
        </Form.Item>

        <Form.Item
          name="priority"
          label="Priority"
          extra="A rough steer, not a promise: the support team sets the final priority once they have read it."
        >
          {/*
            Only low/normal/high are offered. `urgent` is reserved for staff, and
            the API does not reject it from an ordinary account; it silently
            stores `high` instead. Listing it would mean a control that appears
            to work and produces a ticket marked something else.
          */}
          <Select<TicketPriority>
            options={REQUESTER_TICKET_PRIORITIES.map((priority) => ({
              value: priority,
              label: TICKET_PRIORITY_META[priority].label,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="message"
          label="What has happened?"
          extra="What you were doing, what you expected, and what happened instead. Exact wording of any error helps."
          rules={[
            { required: true, message: 'Describe the problem' },
            { max: MAX_MESSAGE_LENGTH, message: 'That message is too long to send' },
          ]}
        >
          <Input.TextArea
            rows={6}
            maxLength={MAX_MESSAGE_LENGTH}
            showCount
            placeholder="I clicked Export → PDF on my task list. The download finished, but opening the file shows 'damaged and cannot be repaired'."
          />
        </Form.Item>

        <Typography.Text className="tf-muted" style={{ fontSize: '0.85rem' }}>
          Your name and email address are attached automatically so the team can reply.
          Please do not include passwords or recovery codes.
        </Typography.Text>
      </Form>
    </Modal>
  );
}
