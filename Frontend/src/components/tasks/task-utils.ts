/**
 * Filter state for the tasks page, and the translation between it and a URL.
 *
 * This lives outside both the server page and the client controller because
 * both have to derive the *same* request from the same query string: the server
 * component renders the first page from it, and SWR immediately re-issues it in
 * the browser. If the two disagreed about a single default, the first paint
 * would be silently replaced the moment the client revalidated.
 *
 * Deliberately free of React and Ant Design so the server component can import
 * it without pulling client-only code into the RSC graph.
 */
import type { TodoPriority, TodoStatus } from '@/types/api';

export const TODO_STATUSES = ['todo', 'in_progress', 'done'] as const;
export const TODO_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TODO_SORTS = ['created', 'due', 'priority', 'position', 'title'] as const;

export type TodoSort = (typeof TODO_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

export interface TaskFilterState {
  q: string;
  status: TodoStatus[];
  priority: TodoPriority[];
  tags: string[];
  /** ISO instants; the API coerces them with `z.coerce.date()`. */
  dueFrom: string | null;
  dueTo: string | null;
  overdue: boolean;
  sort: TodoSort;
  order: SortOrder;
  page: number;
  pageSize: number;
}

/** Mirrors `listTodosQuerySchema`: 20 per page, newest first. */
export const DEFAULT_PAGE_SIZE = 20;
/** The API rejects anything above 100, so offering more would only produce a 422. */
export const MAX_PAGE_SIZE = 100;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const DEFAULT_FILTERS: TaskFilterState = {
  q: '',
  status: [],
  priority: [],
  tags: [],
  dueFrom: null,
  dueTo: null,
  overdue: false,
  sort: 'created',
  order: 'desc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

export type RawSearchParams = URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * Duck-typed rather than `instanceof`: the value arriving from `useSearchParams`
 * is a Next.js subclass, and the plain object arriving from a server component's
 * `searchParams` is not a URLSearchParams at all.
 */
function isSearchParams(value: RawSearchParams): value is URLSearchParams {
  return typeof (value as URLSearchParams).getAll === 'function';
}

function readAll(params: RawSearchParams, key: string): string[] {
  if (isSearchParams(params)) return params.getAll(key);

  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readOne(params: RawSearchParams, key: string): string | undefined {
  return readAll(params, key)[0];
}

/**
 * The API accepts `?tags=a&tags=b` and `?tags=a,b` alike, so a hand-written or
 * shared link may use either. Both are flattened here.
 */
function readList(params: RawSearchParams, key: string): string[] {
  return readAll(params, key)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isTodoStatus(value: string): value is TodoStatus {
  return (TODO_STATUSES as readonly string[]).includes(value);
}

function isTodoPriority(value: string): value is TodoPriority {
  return (TODO_PRIORITIES as readonly string[]).includes(value);
}

function isTodoSort(value: string): value is TodoSort {
  return (TODO_SORTS as readonly string[]).includes(value);
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Normalised to an ISO instant, or dropped: a bad date would 422 the list. */
function toIsoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isTrue(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/** Turn a query string (or a server component's `searchParams`) into filters. */
export function parseTaskFilters(params: RawSearchParams): TaskFilterState {
  const sort = readOne(params, 'sort') ?? '';
  const order = readOne(params, 'order');

  // Deduplicated: `?status=done&status=done` would otherwise render two ticked
  // entries in the Select for one filter.
  const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

  return {
    q: (readOne(params, 'q') ?? '').slice(0, 200),
    status: unique(readList(params, 'status').filter(isTodoStatus)),
    priority: unique(readList(params, 'priority').filter(isTodoPriority)),
    tags: unique(readList(params, 'tags').map((tag) => tag.slice(0, 32))).slice(0, 20),
    dueFrom: toIsoOrNull(readOne(params, 'dueFrom')),
    dueTo: toIsoOrNull(readOne(params, 'dueTo')),
    overdue: isTrue(readOne(params, 'overdue')),
    sort: isTodoSort(sort) ? sort : DEFAULT_FILTERS.sort,
    order: order === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, toInt(readOne(params, 'page'), 1)),
    pageSize: clamp(toInt(readOne(params, 'pageSize'), DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE),
  };
}

/* -------------------------------------------------------------------------- */
/* Serialising                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The query string shown in the address bar.
 *
 * Defaults are omitted so a plain `/tasks` stays plain and a shared link carries
 * only what the sender actually chose.
 */
export function serialiseTaskFilters(filters: TaskFilterState): string {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  for (const status of filters.status) params.append('status', status);
  for (const priority of filters.priority) params.append('priority', priority);
  for (const tag of filters.tags) params.append('tags', tag);
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) params.set('dueTo', filters.dueTo);
  if (filters.overdue) params.set('overdue', 'true');
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize));

  return params.toString();
}

/**
 * The API path for a set of filters, and also the SWR cache key.
 *
 * Every parameter is written explicitly and in a fixed order, so two identical
 * filter states always produce the same key and SWR does not refetch a page it
 * is already showing.
 */
export function taskListPath(filters: TaskFilterState): string {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  for (const status of filters.status) params.append('status', status);
  for (const priority of filters.priority) params.append('priority', priority);
  for (const tag of filters.tags) params.append('tags', tag);
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) params.set('dueTo', filters.dueTo);
  if (filters.overdue) params.set('overdue', 'true');
  params.set('sort', filters.sort);
  params.set('order', filters.order);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));

  return `/api/todos?${params.toString()}`;
}

/**
 * The same filters as an export query.
 *
 * `page` and `pageSize` are dropped: an export is always the whole matching set,
 * and sending them would only invite the reader of a 40-row PDF to wonder why it
 * stopped at 20.
 */
export function taskExportQuery(filters: TaskFilterState, format: string): Record<string, unknown> {
  return {
    format,
    q: filters.q || undefined,
    status: filters.status.length > 0 ? filters.status : undefined,
    priority: filters.priority.length > 0 ? filters.priority : undefined,
    tags: filters.tags.length > 0 ? filters.tags : undefined,
    dueFrom: filters.dueFrom ?? undefined,
    dueTo: filters.dueTo ?? undefined,
    overdue: filters.overdue ? 'true' : undefined,
    sort: filters.sort,
    order: filters.order,
  };
}

/** How many filters are narrowing the list. Sort and paging do not count. */
export function countActiveFilters(filters: TaskFilterState): number {
  let count = 0;
  if (filters.q) count += 1;
  if (filters.status.length > 0) count += 1;
  if (filters.priority.length > 0) count += 1;
  if (filters.tags.length > 0) count += 1;
  if (filters.dueFrom || filters.dueTo) count += 1;
  if (filters.overdue) count += 1;
  return count;
}

/** Clearing keeps the sort and page size: those are preferences, not filters. */
export function clearedFilters(filters: TaskFilterState): TaskFilterState {
  return {
    ...DEFAULT_FILTERS,
    sort: filters.sort,
    order: filters.order,
    pageSize: filters.pageSize,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/** Ant Design preset colour names, which follow the light/dark algorithm. */
export const PRIORITY_META: Record<TodoPriority, { label: string; color: string }> = {
  low: { label: 'Low', color: 'default' },
  medium: { label: 'Medium', color: 'blue' },
  high: { label: 'High', color: 'orange' },
  urgent: { label: 'Urgent', color: 'red' },
};

export const STATUS_META: Record<TodoStatus, { label: string; color: string }> = {
  todo: { label: 'To do', color: 'default' },
  in_progress: { label: 'In progress', color: 'processing' },
  done: { label: 'Done', color: 'success' },
};

export const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'created:desc', label: 'Newest first' },
  { value: 'created:asc', label: 'Oldest first' },
  { value: 'due:asc', label: 'Due soonest' },
  { value: 'due:desc', label: 'Due latest' },
  { value: 'priority:desc', label: 'Priority: high to low' },
  { value: 'priority:asc', label: 'Priority: low to high' },
  { value: 'title:asc', label: 'Title A to Z' },
  { value: 'title:desc', label: 'Title Z to A' },
  { value: 'position:asc', label: 'Manual order' },
];

export function sortValue(filters: TaskFilterState): string {
  return `${filters.sort}:${filters.order}`;
}

export function parseSortValue(value: string): {
  sort: TodoSort;
  order: SortOrder;
} {
  const [rawSort, rawOrder] = value.split(':');
  return {
    sort: rawSort && isTodoSort(rawSort) ? rawSort : DEFAULT_FILTERS.sort,
    order: rawOrder === 'asc' ? 'asc' : 'desc',
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Format an instant in an explicit zone.
 *
 * The zone is passed in rather than left to the runtime because this markup is
 * rendered twice, once on the server and once during hydration. A host in UTC
 * and a reader in Karachi would otherwise produce different text for the same
 * timestamp, which React reports as a hydration mismatch.
 */
export function formatDateTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };

  try {
    return new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: timeZone || 'UTC',
    }).format(date);
  } catch {
    // An invalid IANA name from a profile must not take the whole list down.
    return new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: 'UTC',
    }).format(date);
  }
}

export function isImageMime(mimeType: string): boolean {
  // SVG is excluded on purpose: the API serves it with `Content-Disposition:
  // attachment` precisely so it is never rendered, and a broken <img> is a worse
  // thumbnail than a file icon.
  return mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';
}

/** URL of an attachment's bytes, served by the API on this origin. */
export function attachmentHref(id: string): string {
  return `/api/attachments/${id}`;
}
