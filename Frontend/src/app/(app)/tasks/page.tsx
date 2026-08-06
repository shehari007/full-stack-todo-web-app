import { Suspense } from 'react';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/server-api';
import { TasksView, type TaskListResponse } from '@/components/tasks/TasksView';
import { parseTaskFilters, taskListPath } from '@/components/tasks/task-utils';

export const metadata: Metadata = {
  title: 'Tasks',
  description: 'Search, filter and organise everything on your list.',
  // A personal list has nothing to offer a crawler, and the page is behind a
  // session anyway.
  robots: { index: false, follow: false },
};

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The tasks page.
 *
 * The first page of results is fetched here rather than in the browser so a
 * shared link (`/tasks?status=todo&overdue=true`) arrives with its rows
 * already rendered. The client controller re-derives the same filters from the
 * URL, which makes that server payload its initial SWR cache entry instead of a
 * throwaway.
 */
export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const filters = parseTaskFilters(params);

  // Null when the API is unreachable or the session has lapsed; the client falls
  // back to fetching, and to its own error state, rather than 500-ing the page.
  const initialData = await serverGet<TaskListResponse>(taskListPath(filters));

  return (
    // `tf-container` for the max width and centring only: the app shell's
    // `tf-shell__content` already pads this region, and keeping the class's own
    // inline padding as well would cost 64px of a 360px screen.
    <div className="tf-container" style={{ paddingInline: 0 }}>
      {/* `useSearchParams` needs a boundary; the fallback matches the real
          header height so the page does not jump when the controller mounts. */}
      <Suspense fallback={<div style={{ minHeight: '60vh' }} aria-hidden="true" />}>
        <TasksView initialData={initialData} initialFilters={filters} />
      </Suspense>
    </div>
  );
}
