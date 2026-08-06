'use client';

import { Button, Checkbox, Empty, Skeleton, Typography } from 'antd';
import { ClearOutlined, PlusOutlined } from '@ant-design/icons';
import type { Todo } from '@/types/api';
import { TaskItem } from './TaskItem';

interface TaskListProps {
  todos: Todo[];
  loading: boolean;
  /** A background revalidation: the rows on screen are still valid. */
  refreshing: boolean;
  timezone?: string | undefined;
  hasActiveFilters: boolean;
  selectedIds: string[];
  onToggleSelect: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onToggleDone: (todo: Todo, done: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDuplicate: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onClearFilters: () => void;
  onCreate: () => void;
}

export function TaskList({
  todos,
  loading,
  refreshing,
  timezone,
  hasActiveFilters,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onToggleDone,
  onEdit,
  onDuplicate,
  onDelete,
  onClearFilters,
  onCreate,
}: TaskListProps) {
  if (loading && todos.length === 0) {
    return (
      <div className="tf-stack" aria-busy="true" aria-label="Loading tasks">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="tf-task">
            <Skeleton active paragraph={{ rows: 1 }} title={{ width: '40%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (todos.length === 0) {
    /*
     * The two empty states are not interchangeable. "Nothing matches" with a way
     * out is the difference between a filter someone can undo and an app that
     * looks empty and broken.
     */
    return hasActiveFilters ? (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            <strong>No tasks match these filters.</strong>
            <br />
            <span className="tf-muted">Try widening the search, or start again.</span>
          </span>
        }
      >
        <Button icon={<ClearOutlined />} onClick={onClearFilters}>
          Clear filters
        </Button>
      </Empty>
    ) : (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            <strong>No tasks yet.</strong>
            <br />
            <span className="tf-muted">Everything you add will show up here.</span>
          </span>
        }
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
          Create your first task
        </Button>
      </Empty>
    );
  }

  const selectedOnPage = todos.filter((todo) => selectedIds.includes(todo.id)).length;

  return (
    <div className="tf-stack" style={{ gap: '0.6rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          paddingInline: '0.25rem',
        }}
      >
        <Checkbox
          checked={selectedOnPage === todos.length}
          indeterminate={selectedOnPage > 0 && selectedOnPage < todos.length}
          onChange={(event) => onSelectAll(event.target.checked)}
        >
          <span style={{ fontSize: '0.875rem' }}>Select all on this page</span>
        </Checkbox>

        {refreshing ? (
          <Typography.Text
            className="tf-muted"
            style={{ fontSize: '0.8125rem' }}
            aria-live="polite"
          >
            Refreshing...
          </Typography.Text>
        ) : null}
      </div>

      <ul
        className="tf-stack"
        style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.6rem' }}
        aria-busy={refreshing}
      >
        {todos.map((todo) => (
          <TaskItem
            key={todo.id}
            todo={todo}
            timezone={timezone}
            selected={selectedIds.includes(todo.id)}
            onToggleSelect={onToggleSelect}
            onToggleDone={onToggleDone}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
}
