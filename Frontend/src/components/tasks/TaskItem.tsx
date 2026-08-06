'use client';

import { useMemo } from 'react';
import { Button, Checkbox, Dropdown, Tag, Tooltip } from 'antd';
import {
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PaperClipOutlined,
  TagOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { Todo } from '@/types/api';
import { PRIORITY_META, STATUS_META, formatDateTime } from './task-utils';

interface TaskItemProps {
  todo: Todo;
  timezone?: string | undefined;
  selected: boolean;
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleDone: (todo: Todo, done: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDuplicate: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

export function TaskItem({
  todo,
  timezone,
  selected,
  onToggleSelect,
  onToggleDone,
  onEdit,
  onDuplicate,
  onDelete,
}: TaskItemProps) {
  const done = todo.status === 'done';
  const priority = PRIORITY_META[todo.priority];
  const status = STATUS_META[todo.status];

  const due = todo.dueAt ? formatDateTime(todo.dueAt, timezone) : null;
  // A finished task is never overdue, however long it sat there.
  const overdue = todo.dueAt !== null && !done && new Date(todo.dueAt).getTime() < Date.now();

  const menuItems = useMemo<MenuProps['items']>(
    () => [
      { key: 'edit', icon: <EditOutlined />, label: 'Edit' },
      { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: 'Delete',
        danger: true,
      },
    ],
    [],
  );

  const onMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'edit') onEdit(todo);
    else if (key === 'duplicate') onDuplicate(todo);
    else if (key === 'delete') onDelete(todo);
  };

  const attachmentCount = todo.attachments?.length ?? 0;

  return (
    <li className={done ? 'tf-task tf-task--done' : 'tf-task'}>
      <Tooltip title={selected ? 'Deselect' : 'Select for bulk actions'}>
        <Checkbox
          checked={selected}
          onChange={(event) => onToggleSelect(todo.id, event.target.checked)}
          aria-label={`Select "${todo.title}" for bulk actions`}
          style={{ marginTop: '0.15rem' }}
        />
      </Tooltip>

      <Tooltip title={done ? 'Mark as not done' : 'Mark as done'}>
        <Checkbox
          checked={done}
          onChange={(event) => onToggleDone(todo, event.target.checked)}
          aria-label={done ? `Reopen "${todo.title}"` : `Complete "${todo.title}"`}
          style={{ marginTop: '0.15rem' }}
        />
      </Tooltip>

      <div className="tf-task__body">
        <p className="tf-task__title">{todo.title}</p>

        {todo.description ? (
          <p
            className="tf-muted"
            style={{
              margin: '0 0 0.35rem',
              fontSize: '0.875rem',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {todo.description}
          </p>
        ) : null}

        <div className="tf-task__meta">
          <Tag color={status.color} style={{ marginInlineEnd: 0 }}>
            {status.label}
          </Tag>
          {/* The word is carried by the label, not just the colour: priority
              has to survive a monochrome screen and colour blindness alike. */}
          <Tag color={priority.color} style={{ marginInlineEnd: 0 }}>
            {priority.label} priority
          </Tag>

          {due ? (
            overdue ? (
              <Tag icon={<ClockCircleOutlined />} color="error" style={{ marginInlineEnd: 0 }}>
                Overdue · {due}
              </Tag>
            ) : (
              <span>
                <ClockCircleOutlined aria-hidden="true" />{' '}
                <span className="tf-muted">Due {due}</span>
              </span>
            )
          ) : null}

          {todo.tags.map((tag) => (
            <Tag key={tag} icon={<TagOutlined />} style={{ marginInlineEnd: 0 }}>
              {tag}
            </Tag>
          ))}

          {attachmentCount > 0 ? (
            <span
              aria-label={`${attachmentCount} ${attachmentCount === 1 ? 'attachment' : 'attachments'}`}
            >
              <PaperClipOutlined aria-hidden="true" /> {attachmentCount}
            </span>
          ) : null}
        </div>
      </div>

      <div className="tf-task__actions">
        <Dropdown
          menu={{ items: menuItems, onClick: onMenuClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button type="text" icon={<MoreOutlined />} aria-label={`Actions for "${todo.title}"`} />
        </Dropdown>
      </div>
    </li>
  );
}
