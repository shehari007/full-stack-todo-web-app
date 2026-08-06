import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import type { Pagination, Todo, TodoStats } from '@/types/api';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your task overview: progress, priorities and what is due next.',
  // A signed-in page has nothing to offer a crawler and should never be indexed.
  robots: { index: false, follow: false },
};

interface TodoListResponse {
  todos: Todo[];
  pagination: Pagination;
}

/**
 * One page of open tasks, soonest due first.
 *
 * This is a *page*, not the whole set, and the split below depends on that: the
 * rows arrive overdue-first, so a user with more open overdue tasks than fit
 * here fills the page before a single task due today is reached. `DashboardView`
 * is told the page size so it can say "n+" rather than claim a total it cannot
 * see. See `agendaSaturated` there.
 */
const AGENDA_PAGE_SIZE = 25;

/**
 * One request instead of separate "overdue" and "due today" calls: the API sorts
 * undated tasks last in both directions, so the head of this list already *is*
 * the agenda, and the client can re-split it on the user's midnight without
 * asking the server again. The real overdue count comes from `/stats`, which is
 * not paginated.
 */
const AGENDA_QUERY = `/api/todos?includeCompleted=false&sort=due&order=asc&pageSize=${AGENDA_PAGE_SIZE}`;

const RECENT_QUERY = '/api/todos?pageSize=5&sort=created&order=desc';

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // The layout already redirected, but the type has to be narrowed here too and
  // `getCurrentUser` is request-cached, so this costs nothing.
  if (!user) {
    redirect('/login');
  }

  const [statsBody, recentBody, agendaBody] = await Promise.all([
    serverGet<{ stats: TodoStats }>('/api/todos/stats'),
    serverGet<TodoListResponse>(RECENT_QUERY),
    serverGet<TodoListResponse>(AGENDA_QUERY),
  ]);

  return (
    <DashboardView
      initialUser={user}
      initialStats={statsBody?.stats ?? null}
      initialRecent={recentBody?.todos ?? null}
      initialAgenda={agendaBody?.todos ?? null}
      statsKey="/api/todos/stats"
      recentKey={RECENT_QUERY}
      agendaKey={AGENDA_QUERY}
      agendaPageSize={AGENDA_PAGE_SIZE}
      // Rendered on the server and on the client from the same instant, so the
      // greeting and the overdue split cannot disagree across hydration.
      nowIso={new Date().toISOString()}
    />
  );
}
