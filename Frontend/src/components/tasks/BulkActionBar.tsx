'use client';

import { useCallback, useState } from 'react';
import { App, Button, Dropdown, Modal, Select, Space, Typography } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  FlagOutlined,
  ReloadOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { ApiError, api } from '@/lib/api';
import type { TodoPriority } from '@/types/api';
import { PRIORITY_META, TODO_PRIORITIES } from './task-utils';

interface BulkActionBarProps {
  selectedIds: string[];
  tagOptions: string[];
  onClear: () => void;
  /** Called after a successful batch so the list can revalidate. */
  onApplied: () => void | Promise<void>;
}

type BulkAction =
  'complete' | 'reopen' | 'delete' | 'restore' | 'setPriority' | 'addTags' | 'removeTags';

interface BulkResult {
  result: { action: BulkAction; affected: number; ids: string[] };
}

/** The API rejects a batch larger than this, so the bar warns before it tries. */
const MAX_BULK_IDS = 200;

export function BulkActionBar({ selectedIds, tagOptions, onClear, onApplied }: BulkActionBarProps) {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [tagMode, setTagMode] = useState<'addTags' | 'removeTags' | null>(null);
  const [tagDraft, setTagDraft] = useState<string[]>([]);

  const count = selectedIds.length;

  const run = useCallback(
    async (action: BulkAction, value?: TodoPriority | string[]): Promise<BulkResult | null> => {
      setBusy(true);
      try {
        const body =
          value === undefined ? { action, ids: selectedIds } : { action, ids: selectedIds, value };

        return await api.post<BulkResult>('/api/todos/bulk', body);
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : 'That batch could not be applied');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [message, selectedIds],
  );

  const apply = useCallback(
    async (action: BulkAction, value?: TodoPriority | string[], successVerb = 'updated') => {
      const response = await run(action, value);
      if (!response) return;

      await onApplied();

      const { affected } = response.result;
      message.success(`${affected} ${affected === 1 ? 'task' : 'tasks'} ${successVerb}`);
    },
    [message, onApplied, run],
  );

  const restore = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        await api.post<BulkResult>('/api/todos/bulk', {
          action: 'restore',
          ids,
        });
        await onApplied();
        message.success('Tasks restored');
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : 'Could not restore those tasks');
      }
    },
    [message, onApplied],
  );

  const handleDelete = useCallback(() => {
    modal.confirm({
      title: `Delete ${count} ${count === 1 ? 'task' : 'tasks'}?`,
      content: 'They move to the trash. You can undo this straight after.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Keep them',
      onOk: async () => {
        const response = await run('delete');
        if (!response) return;

        const { ids, affected } = response.result;
        await onApplied();

        // Only the rows the API actually deleted are offered back. Ids that
        // were already gone must not reappear in an undo that claims to restore
        // them.
        const toastKey = `bulk-deleted-${Date.now()}`;
        message.open({
          key: toastKey,
          type: 'success',
          duration: 8,
          content: (
            <span>
              {affected} {affected === 1 ? 'task' : 'tasks'} deleted.{' '}
              <Button
                type="link"
                size="small"
                onClick={() => {
                  message.destroy(toastKey);
                  void restore(ids);
                }}
              >
                Undo
              </Button>
            </span>
          ),
        });
      },
    });
  }, [count, message, modal, onApplied, restore, run]);

  const priorityItems: MenuProps['items'] = TODO_PRIORITIES.map((value) => ({
    key: value,
    label: PRIORITY_META[value].label,
  }));

  if (count === 0) return null;

  const overLimit = count > MAX_BULK_IDS;

  return (
    <>
      <div
        role="region"
        aria-label={`${count} tasks selected`}
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem',
          borderRadius: 12,
          border: '1px solid var(--tf-border)',
          background: 'var(--tf-surface-raised)',
          boxShadow: 'var(--tf-shadow-lg)',
        }}
      >
        <Typography.Text strong style={{ marginInlineEnd: '0.25rem' }} aria-live="polite">
          {count} selected
        </Typography.Text>

        {overLimit ? (
          <Typography.Text type="danger" style={{ fontSize: '0.8125rem' }}>
            Only {MAX_BULK_IDS} can be changed at once.
          </Typography.Text>
        ) : null}

        <Space wrap size={4}>
          <Button
            icon={<CheckOutlined />}
            disabled={busy || overLimit}
            onClick={() => void apply('complete', undefined, 'completed')}
          >
            Complete
          </Button>

          <Button
            icon={<ReloadOutlined />}
            disabled={busy || overLimit}
            onClick={() => void apply('reopen', undefined, 'reopened')}
          >
            Reopen
          </Button>

          <Dropdown
            disabled={busy || overLimit}
            menu={{
              items: priorityItems,
              onClick: ({ key }) => void apply('setPriority', key as TodoPriority),
            }}
            trigger={['click']}
          >
            <Button icon={<FlagOutlined />}>
              Priority <DownOutlined />
            </Button>
          </Dropdown>

          <Dropdown
            disabled={busy || overLimit}
            menu={{
              items: [
                { key: 'addTags', label: 'Add tags' },
                { key: 'removeTags', label: 'Remove tags' },
              ],
              onClick: ({ key }) => {
                setTagDraft([]);
                setTagMode(key === 'removeTags' ? 'removeTags' : 'addTags');
              },
            }}
            trigger={['click']}
          >
            <Button icon={<TagsOutlined />}>
              Tags <DownOutlined />
            </Button>
          </Dropdown>

          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={busy || overLimit}
            onClick={handleDelete}
          >
            Delete
          </Button>

          <Button type="text" icon={<CloseOutlined />} onClick={onClear}>
            Clear
          </Button>
        </Space>
      </div>

      <Modal
        open={tagMode !== null}
        title={tagMode === 'removeTags' ? 'Remove tags' : 'Add tags'}
        okText={tagMode === 'removeTags' ? 'Remove' : 'Add'}
        okButtonProps={{ disabled: tagDraft.length === 0, loading: busy }}
        onCancel={() => setTagMode(null)}
        onOk={() => {
          const action = tagMode;
          if (!action || tagDraft.length === 0) return;
          setTagMode(null);
          void apply(action, tagDraft, action === 'addTags' ? 'tagged' : 'untagged');
        }}
        destroyOnHidden
      >
        <label htmlFor="tf-bulk-tags" style={{ display: 'block', marginBottom: '0.4rem' }}>
          {tagMode === 'removeTags'
            ? `Tags to remove from ${count} ${count === 1 ? 'task' : 'tasks'}`
            : `Tags to add to ${count} ${count === 1 ? 'task' : 'tasks'}`}
        </label>
        <Select<string[]>
          id="tf-bulk-tags"
          mode="tags"
          style={{ width: '100%' }}
          value={tagDraft}
          onChange={setTagDraft}
          placeholder="Type a tag and press Enter"
          options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
          maxCount={20}
          tokenSeparators={[',']}
        />
      </Modal>
    </>
  );
}
