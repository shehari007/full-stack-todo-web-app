'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Alert, App, Button, Grid, Pagination, Space, Typography } from 'antd';
import { ExclamationCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import type { Pagination as PaginationMeta, Todo, TodoStatus } from '@/types/api';
import { TaskFilters } from './TaskFilters';
import { TaskList } from './TaskList';
import { TaskFormModal } from './TaskFormModal';
import { BulkActionBar } from './BulkActionBar';
import { ExportMenu } from './ExportMenu';
import {
  PAGE_SIZE_OPTIONS,
  clearedFilters,
  countActiveFilters,
  parseTaskFilters,
  serialiseTaskFilters,
  taskListPath,
  type TaskFilterState,
} from './task-utils';

export interface TaskListResponse {
  todos: Todo[];
  pagination: PaginationMeta;
}

interface TasksViewProps {
  initialData: TaskListResponse | null;
  initialFilters: TaskFilterState;
}

/** The API caps a title at 200 characters, so the suffix has to fit inside it. */
const MAX_TITLE_LENGTH = 200;

export function TasksView({ initialData, initialFilters }: TasksViewProps) {
  const { message, modal } = App.useApp();
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screens = Grid.useBreakpoint();

  /*
   * The URL is the single source of truth for the filters. Keeping a second copy
   * in component state would mean the back button, a reload and a pasted link
   * could each disagree with what is on screen.
   */
  const filters = useMemo<TaskFilterState>(() => parseTaskFilters(searchParams), [searchParams]);

  const listPath = taskListPath(filters);
  const initialPath = useRef(taskListPath(initialFilters));

  const { data, error, isLoading, isValidating, mutate } = useSWR<TaskListResponse>(
    listPath,
    swrFetcher,
    {
      // Only the page the server actually rendered may seed the cache; a
      // different filter set has to be fetched.
      fallbackData: listPath === initialPath.current && initialData ? initialData : undefined,
      // Filter changes keep the old rows on screen while the new ones load,
      // which reads as a refresh rather than as the list vanishing.
      keepPreviousData: true,
      revalidateOnFocus: false,
    },
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);

  // A selection is only meaningful for rows that are on screen.
  useEffect(() => {
    setSelectedIds([]);
  }, [listPath]);

  const todos = data?.todos ?? [];
  const pagination = data?.pagination;
  const activeFilterCount = countActiveFilters(filters);

  /**
   * Write the filters to the address bar without a router navigation.
   *
   * `router.push` would re-run the server component and refetch the page the SWR
   * cache is already loading: two requests for one filter change. The History
   * API is the supported way to keep `useSearchParams` in step without that
   * round trip.
   */
  const applyFilters = useCallback(
    (patch: Partial<TaskFilterState>, history: 'replace' | 'push' = 'replace') => {
      const next: TaskFilterState = { ...filters, ...patch };

      // Narrowing the list invalidates the page number: page 4 of the old result
      // set is usually past the end of the new one.
      if (patch.page === undefined) next.page = 1;

      const search = serialiseTaskFilters(next);
      const url = search ? `${pathname}?${search}` : pathname;

      // Paging is a place someone wants to come back to; retyping a search term
      // is not, and a debounced box would otherwise leave one entry per keystroke.
      if (history === 'push') {
        window.history.pushState(null, '', url);
      } else {
        window.history.replaceState(null, '', url);
      }
    },
    [filters, pathname],
  );

  const handleClearFilters = useCallback(() => {
    applyFilters(clearedFilters(filters));
  }, [applyFilters, filters]);

  /* ---------------------------------------------------------------------- */
  /* Row actions                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Completion is applied to the cache first and reconciled afterwards.
   *
   * A checkbox that waits for a round trip before it ticks feels broken, and
   * this is the action people perform most. On failure SWR rolls the row back
   * and the toast explains why.
   */
  const handleToggleDone = useCallback(
    async (todo: Todo, done: boolean) => {
      const nextStatus: TodoStatus = done ? 'done' : 'todo';

      try {
        await mutate(
          async () => {
            await api.patch<{ todo: Todo }>(`/api/todos/${todo.id}`, {
              status: nextStatus,
            });
            // Nothing is returned so the revalidation below decides the final
            // cache contents, which matters when the active filter excludes
            // the status the row just moved to and it should disappear.
            return undefined;
          },
          {
            optimisticData: (current) => applyStatus(current ?? data, todo.id, nextStatus),
            rollbackOnError: true,
            populateCache: false,
            revalidate: true,
          },
        );
      } catch (err) {
        message.error(
          err instanceof ApiError ? err.message : 'That change could not be saved. Try again.',
        );
      }
    },
    [data, message, mutate],
  );

  const handleDuplicate = useCallback(
    async (todo: Todo) => {
      try {
        await api.post<{ todo: Todo }>('/api/todos', {
          // Truncated rather than rejected: a long title is not a reason to
          // refuse the copy, and the API would 422 on 201 characters.
          title: `${todo.title} (copy)`.slice(0, MAX_TITLE_LENGTH),
          description: todo.description,
          status: todo.status,
          priority: todo.priority,
          dueAt: todo.dueAt,
          tags: todo.tags,
        });
        await mutate();
        message.success('Task duplicated');
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : 'Could not duplicate that task');
      }
    },
    [message, mutate],
  );

  const restoreTask = useCallback(
    async (todo: Todo, toastKey: string) => {
      message.destroy(toastKey);
      try {
        await api.post<{ todo: Todo }>(`/api/todos/${todo.id}/restore`);
        await mutate();
        message.success('Task restored');
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : 'Could not restore that task');
      }
    },
    [message, mutate],
  );

  const handleDelete = useCallback(
    (todo: Todo) => {
      modal.confirm({
        title: 'Delete this task?',
        icon: <ExclamationCircleOutlined />,
        content: `"${todo.title}" will be moved to the trash.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        cancelText: 'Keep it',
        onOk: async () => {
          try {
            await api.delete<{ todo: Todo }>(`/api/todos/${todo.id}`);
            await mutate();

            // Deletion is soft, so an undo is a single call, and offering it
            // here is cheaper than a trash screen nobody visits.
            const toastKey = `task-deleted-${todo.id}`;
            message.open({
              key: toastKey,
              type: 'success',
              duration: 8,
              content: (
                <span>
                  Task deleted.{' '}
                  <Button type="link" size="small" onClick={() => void restoreTask(todo, toastKey)}>
                    Undo
                  </Button>
                </span>
              ),
            });
          } catch (err) {
            message.error(err instanceof ApiError ? err.message : 'Could not delete that task');
          }
        },
      });
    },
    [message, modal, mutate, restoreTask],
  );

  /* ---------------------------------------------------------------------- */
  /* Selection                                                              */
  /* ---------------------------------------------------------------------- */

  const handleToggleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((current) =>
      selected ? [...new Set([...current, id])] : current.filter((entry) => entry !== id),
    );
  }, []);

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      setSelectedIds(selected ? todos.map((todo) => todo.id) : []);
    },
    [todos],
  );

  /* ---------------------------------------------------------------------- */
  /* Form                                                                   */
  /* ---------------------------------------------------------------------- */

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((todo: Todo) => {
    setEditing(todo);
    setFormOpen(true);
  }, []);

  /**
   * Tag suggestions come from the rows on screen, plus whatever is already
   * filtered on. There is no tag catalogue endpoint, and every tag input accepts
   * free text anyway. These are a shortcut, not a closed list.
   */
  const tagOptions = useMemo(() => {
    const seen = new Set<string>(filters.tags);
    for (const todo of todos) {
      for (const tag of todo.tags) seen.add(tag);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [filters.tags, todos]);

  const total = pagination?.total ?? 0;
  const rangeStart = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const rangeEnd = Math.min(filters.page * filters.pageSize, total);

  const status = isLoading
    ? 'Loading tasks...'
    : total === 0
      ? 'No tasks to show'
      : `Showing ${rangeStart} to ${rangeEnd} of ${total} ${total === 1 ? 'task' : 'tasks'}`;

  const isCompact = !screens.md;

  return (
    <div className="tf-stack" style={{ gap: '1.25rem' }}>
      <header className="tf-page-header" style={{ marginBottom: 0 }}>
        <div>
          <Typography.Title level={1} style={{ fontSize: '1.65rem', margin: 0 }}>
            Tasks
          </Typography.Title>
          {/* Announced rather than merely shown, so a screen-reader user learns
              the result count changed after filtering. */}
          <p className="tf-muted" style={{ margin: '0.2rem 0 0' }} aria-live="polite">
            {status}
          </p>
        </div>

        <Space wrap>
          <ExportMenu filters={filters} total={total} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New task
          </Button>
        </Space>
      </header>

      <TaskFilters
        filters={filters}
        activeFilterCount={activeFilterCount}
        tagOptions={tagOptions}
        compact={isCompact}
        onChange={applyFilters}
        onClear={handleClearFilters}
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          message="That list could not be loaded"
          description={error instanceof ApiError ? error.message : 'The server did not respond.'}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void mutate()}>
              Retry
            </Button>
          }
        />
      ) : null}

      <TaskList
        todos={todos}
        loading={isLoading}
        refreshing={isValidating && !isLoading}
        timezone={user?.timezone}
        hasActiveFilters={activeFilterCount > 0}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onSelectAll={handleSelectAll}
        onToggleDone={handleToggleDone}
        onEdit={openEdit}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onClearFilters={handleClearFilters}
        onCreate={openCreate}
      />

      {total > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            current={filters.page}
            pageSize={filters.pageSize}
            total={total}
            // `simple` on a phone: the numbered variant overflows 360px the
            // moment the count reaches double digits.
            simple={isCompact}
            size={isCompact ? 'small' : undefined}
            showSizeChanger={!isCompact}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onChange={(page, pageSize) => applyFilters({ page, pageSize }, 'push')}
          />
        </div>
      ) : null}

      <BulkActionBar
        selectedIds={selectedIds}
        tagOptions={tagOptions}
        onClear={() => setSelectedIds([])}
        onApplied={async () => {
          setSelectedIds([]);
          await mutate();
        }}
      />

      <TaskFormModal
        open={formOpen}
        todo={editing}
        tagOptions={tagOptions}
        onClose={() => setFormOpen(false)}
        onSaved={async () => {
          setFormOpen(false);
          await mutate();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function applyStatus(
  current: TaskListResponse | undefined,
  id: string,
  status: TodoStatus,
): TaskListResponse {
  if (!current)
    return {
      todos: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    };

  return {
    ...current,
    todos: current.todos.map((todo) =>
      todo.id === id
        ? {
            ...todo,
            status,
            // Kept in step so the row's own "completed" affordances agree with
            // the tick while the request is in flight.
            completedAt: status === 'done' ? (todo.completedAt ?? new Date().toISOString()) : null,
          }
        : todo,
    ),
  };
}
