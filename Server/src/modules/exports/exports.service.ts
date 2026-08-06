/**
 * Export generation.
 *
 * One fetch feeds every format: the rows are read once, then handed to a
 * renderer. Nothing here touches the response. Each renderer returns a
 * finished `Buffer`, so a failure stays an ordinary thrown error instead of a
 * half-written download.
 */
import { eq } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import writeXlsxFile from 'write-excel-file/node';
import type { CellObject, Row as XlsxRow } from 'write-excel-file/node';
import { db } from '../../db/index.js';
import { attachments, users } from '../../db/schema.js';
import type { Todo, TodoPriority, TodoStatus } from '../../db/schema.js';
import type { SettingsShape } from '../../config/settings.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';
import { renderReportPdf, type PdfColumn, type PdfLogo } from '../../lib/pdf.js';
import type { TodoFilter } from '../todos/todos.schemas.js';
import { listTodos } from '../todos/todos.service.js';
import type { ExportFormat } from './exports.schemas.js';

/**
 * Ceiling on a single export.
 *
 * Every format buffers the whole document in memory, and 5,000 rows is already
 * a hundred-page PDF. Past that the honest answer is a paginated API query, not
 * a larger download.
 */
const EXPORT_ROW_CAP = 5000;

/**
 * How many exports may be building at once, process-wide.
 *
 * `EXPORT_ROW_CAP` bounds rows, which is the wrong unit for the thing that
 * actually exhausts the heap. A row's cost is unbounded: a description may be
 * ten thousand characters, and PDFKit wraps every one of them into laid-out
 * text it holds alongside the page buffers and the finished document. Five
 * thousand rows is a hundred-page PDF at best and a few hundred megabytes at
 * worst, and the row cap says nothing about several of those arriving together.
 *
 * A byte ceiling is the honest bound, but it can only be measured once the
 * buffer exists, by which point the memory has already been spent, so it would
 * report the problem rather than prevent it. Capping concurrency bounds the peak
 * before it is reached, which is what keeps the process alive. The per-user
 * limiter in the routes layer does not help here: ten different users asking at
 * the same moment are ten separate budgets and one heap.
 */
const MAX_CONCURRENT_EXPORTS = 2;

let activeExports = 0;

export interface ExportedTodo {
  id: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: Date | null;
  completedAt: Date | null;
  tags: string[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExportArtifact {
  buffer: Buffer;
  contentType: string;
  filename: string;
  rowCount: number;
}

const STATUS_LABELS: Record<TodoStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

const PRIORITY_LABELS: Record<TodoPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  todo: '#94a3b8',
  in_progress: '#3b82f6',
  done: '#10b981',
};

const PRIORITY_COLORS: Record<TodoPriority, string> = {
  low: '#94a3b8',
  medium: '#0ea5e9',
  high: '#f59e0b',
  urgent: '#ef4444',
};

/** Reading order for the grouped formats, not the enum's declaration order. */
const STATUS_ORDER: TodoStatus[] = ['todo', 'in_progress', 'done'];

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  ics: 'text/calendar; charset=utf-8',
};

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the rows to export.
 *
 * The filtering, the ownership predicate and the sort order all come from the
 * task list's own service, so a report can never disagree with what the user
 * was looking at when they pressed Export. Pagination is bypassed with a single
 * oversized page: `pageSize` is capped by the *list* schema, which an export
 * never goes through, and an export is by definition the whole matching set.
 */
async function fetchTodos(userId: string, filters: TodoFilter): Promise<ExportedTodo[]> {
  const { todos: rows } = await listTodos(userId, {
    ...filters,
    page: 1,
    pageSize: EXPORT_ROW_CAP,
  });

  return rows.map(toExportRow);
}

/**
 * Project a task row into the shape the renderers agree on.
 *
 * Every field is named rather than spreading the row, so a column added to the
 * table later (an internal flag, another timestamp) does not silently appear
 * in the JSON and CSV that users hand to other people.
 */
function toExportRow(todo: Todo): ExportedTodo {
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description,
    status: todo.status,
    priority: todo.priority,
    dueAt: todo.dueAt,
    completedAt: todo.completedAt,
    tags: todo.tags,
    position: todo.position,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

/**
 * Load the branding logo's bytes.
 *
 * The only query in this module that selects `attachments.data`. It is a single
 * row by primary key, which is the case that column exists for; the rule it
 * must never break is appearing in a *list* projection.
 */
async function loadLogo(attachmentId: string | null): Promise<PdfLogo | null> {
  if (!attachmentId) return null;

  const [row] = await db
    .select({ data: attachments.data, mimeType: attachments.mimeType })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  if (!row) return null;
  return { data: row.data, mimeType: row.mimeType };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fall back to UTC for a timezone Intl will not accept.
 *
 * A stored zone stops being valid when a platform's ICU database drops it, and
 * an uncaught `RangeError` here would turn every one of that account's exports
 * into a 500 with no obvious cause.
 */
function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

function formatDate(value: Date | null, timeZone: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(value);
}

function formatDateTime(value: Date | null, timeZone: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(value);
}

/** `YYYY-MM-DD` as it reads on the recipient's calendar, for the filename. */
function isoDateIn(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

const SORT_LABELS: Record<TodoFilter['sort'], string> = {
  created: 'date created',
  due: 'due date',
  priority: 'priority',
  position: 'manual order',
  title: 'title',
};

/**
 * Turn the applied query into a sentence a reader can check the report against.
 *
 * A printed table with no statement of what was left out is a table nobody can
 * trust, so the sort order is included alongside the filters: two reports of
 * the same tasks in different orders are otherwise indistinguishable.
 */
function describeFilters(filters: TodoFilter, timeZone: string): string {
  const parts: string[] = [];

  if (filters.status?.length) {
    parts.push(`Status: ${filters.status.map((status) => STATUS_LABELS[status]).join(', ')}`);
  }

  if (filters.priority?.length) {
    parts.push(
      `Priority: ${filters.priority.map((priority) => PRIORITY_LABELS[priority]).join(', ')}`,
    );
  }

  if (filters.tags?.length) parts.push(`Tagged: ${filters.tags.join(', ')}`);
  if (filters.q) parts.push(`Matching "${filters.q}"`);
  if (filters.dueFrom) parts.push(`Due after ${formatDate(filters.dueFrom, timeZone)}`);
  if (filters.dueTo) parts.push(`Due before ${formatDate(filters.dueTo, timeZone)}`);
  if (!filters.includeCompleted) parts.push('Excluding completed');
  if (filters.overdue === true) parts.push('Overdue only');
  if (filters.overdue === false) parts.push('Excluding overdue');

  const scope = parts.length > 0 ? parts.join(' · ') : 'All tasks, no filters applied';
  const direction = filters.order === 'asc' ? 'ascending' : 'descending';

  return `${scope} · Sorted by ${SORT_LABELS[filters.sort]}, ${direction}`;
}

interface ExportSummary {
  total: number;
  done: number;
  inProgress: number;
  overdue: number;
  completionPercent: number;
}

function summarise(rows: ExportedTodo[]): ExportSummary {
  const now = Date.now();
  const done = rows.filter((row) => row.status === 'done').length;
  const inProgress = rows.filter((row) => row.status === 'in_progress').length;
  const overdue = rows.filter(
    (row) => row.status !== 'done' && row.dueAt !== null && row.dueAt.getTime() < now,
  ).length;

  return {
    total: rows.length,
    done,
    inProgress,
    overdue,
    completionPercent: rows.length === 0 ? 0 : Math.round((done / rows.length) * 100),
  };
}

/** Lowercase, hyphenated ASCII: safe to place unquoted in `Content-Disposition`. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'taskflow';
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

function renderCsv(rows: ExportedTodo[], timeZone: string): Buffer {
  const body = stringify(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      status: STATUS_LABELS[row.status],
      priority: PRIORITY_LABELS[row.priority],
      dueAt: formatDateTime(row.dueAt, timeZone),
      completedAt: formatDateTime(row.completedAt, timeZone),
      tags: row.tags.join(', '),
      createdAt: formatDateTime(row.createdAt, timeZone),
      updatedAt: formatDateTime(row.updatedAt, timeZone),
    })),
    {
      header: true,
      /*
       * Excel on Windows decodes a `.csv` using the machine's ANSI codepage
       * unless the file opens with a UTF-8 byte order mark, so without this an
       * accented character or an emoji in a task title arrives as mojibake.
       */
      bom: true,
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'title', header: 'Title' },
        { key: 'description', header: 'Description' },
        { key: 'status', header: 'Status' },
        { key: 'priority', header: 'Priority' },
        { key: 'dueAt', header: 'Due' },
        { key: 'completedAt', header: 'Completed' },
        { key: 'tags', header: 'Tags' },
        { key: 'createdAt', header: 'Created' },
        { key: 'updatedAt', header: 'Updated' },
      ],
    },
  );

  return Buffer.from(body, 'utf8');
}

/* -------------------------------------------------------------------------- */
/* JSON                                                                       */
/* -------------------------------------------------------------------------- */

function renderJson(rows: ExportedTodo[], meta: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ meta, tasks: rows }, null, 2), 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                   */
/* -------------------------------------------------------------------------- */

function renderMarkdown(
  rows: ExportedTodo[],
  context: { title: string; filterSummary: string; generatedAt: string; owner: string },
  timeZone: string,
): Buffer {
  const summary = summarise(rows);

  const lines: string[] = [
    `# ${context.title}`,
    '',
    `_${context.filterSummary}_`,
    '',
    `Prepared for **${context.owner}** · generated ${context.generatedAt}`,
    '',
    `**${summary.total}** tasks · **${summary.done}** done · **${summary.inProgress}** in progress · **${summary.overdue}** overdue · **${summary.completionPercent}%** complete`,
    '',
  ];

  for (const status of STATUS_ORDER) {
    const group = rows.filter((row) => row.status === status);
    if (group.length === 0) continue;

    lines.push(`## ${STATUS_LABELS[status]} (${group.length})`, '');

    for (const row of group) {
      const details = [`\`${PRIORITY_LABELS[row.priority]}\``];
      if (row.dueAt) details.push(`due ${formatDate(row.dueAt, timeZone)}`);
      if (row.tags.length > 0) details.push(row.tags.map((tag) => `#${tag}`).join(' '));

      lines.push(`- [${status === 'done' ? 'x' : ' '}] **${row.title}**: ${details.join(' · ')}`);

      if (row.description) {
        // Indented two spaces so the description stays part of the list item
        // rather than terminating it.
        lines.push(...row.description.split(/\r?\n/).map((line) => `  ${line}`));
      }
    }

    lines.push('');
  }

  if (rows.length === 0) {
    lines.push('_No tasks matched these filters._', '');
  }

  return Buffer.from(lines.join('\n'), 'utf8');
}

/* -------------------------------------------------------------------------- */
/* ICS (RFC 5545)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 *
 * Backslash is replaced first: doing it later would double the escape
 * characters the other replacements had just inserted.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, per RFC 5545 §3.1.
 *
 * The limit counts octets, not characters, and a multi-byte UTF-8 sequence must
 * not be split across the fold or the client decodes both halves as replacement
 * characters. Continuation bytes (`10xxxxxx`) are therefore walked back to the
 * start of their sequence before the cut. Continuation lines begin with a
 * single space, which itself spends one of the 75 octets.
 */
function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset + 1 && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
      end -= 1;
    }
    chunks.push(bytes.subarray(offset, end).toString('utf8'));
    offset = end;
    limit = 74;
  }

  return chunks.join('\r\n ');
}

/** `YYYYMMDDTHHMMSSZ`: the UTC form every calendar client accepts. */
function toIcsUtc(value: Date): string {
  return `${value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '')}Z`;
}

const ICS_STATUS: Record<TodoStatus, string> = {
  todo: 'NEEDS-ACTION',
  in_progress: 'IN-PROCESS',
  done: 'COMPLETED',
};

const ICS_PERCENT: Record<TodoStatus, number> = { todo: 0, in_progress: 50, done: 100 };

/** RFC 5545 priority runs 1 (highest) to 9 (lowest), the reverse of the enum. */
const ICS_PRIORITY: Record<TodoPriority, number> = { urgent: 1, high: 3, medium: 5, low: 9 };

/**
 * Build a calendar from the dated tasks.
 *
 * VTODO rather than VEVENT: its STATUS vocabulary maps one-to-one onto the task
 * statuses, and DUE is the correct property for a deadline where a VEVENT would
 * have to invent a DTSTART. The trade-off is client support: Apple Reminders
 * and Thunderbird import VTODO, but Google Calendar ignores it.
 */
function renderIcs(
  rows: ExportedTodo[],
  context: { calendarName: string; productId: string; host: string },
): Buffer {
  const stamp = toIcsUtc(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(context.productId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(context.calendarName)}`,
  ];

  for (const row of rows) {
    // An undated task has nothing to place on a calendar, so it is left out
    // rather than pinned to an invented date.
    if (!row.dueAt) continue;

    lines.push(
      'BEGIN:VTODO',
      // Stable across re-exports, so a second import updates the entry the user
      // already has instead of duplicating it.
      `UID:${row.id}@${context.host}`,
      `DTSTAMP:${stamp}`,
      `DUE:${toIcsUtc(row.dueAt)}`,
      `SUMMARY:${escapeIcsText(row.title)}`,
      `STATUS:${ICS_STATUS[row.status]}`,
      `PERCENT-COMPLETE:${ICS_PERCENT[row.status]}`,
      `PRIORITY:${ICS_PRIORITY[row.priority]}`,
    );

    if (row.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(row.description)}`);
    }
    if (row.completedAt) {
      lines.push(`COMPLETED:${toIcsUtc(row.completedAt)}`);
    }
    if (row.tags.length > 0) {
      // CATEGORIES is a comma-separated list of TEXT values, so each tag is
      // escaped on its own and the separating commas stay unescaped.
      lines.push(`CATEGORIES:${row.tags.map(escapeIcsText).join(',')}`);
    }

    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`Due tomorrow: ${row.title}`)}`,
      // With no DTSTART on the VTODO, RELATED=END anchors the trigger to DUE,
      // which is what "one day before the deadline" has to mean here.
      'TRIGGER;RELATED=END:-P1D',
      'END:VALARM',
      'END:VTODO',
    );
  }

  lines.push('END:VCALENDAR');

  return Buffer.from(`${lines.map(foldIcsLine).join('\r\n')}\r\n`, 'utf8');
}

/**
 * Host part of the ICS UIDs.
 *
 * RFC 5545 asks for a globally unique identifier; `id@host` achieves that as
 * long as the host is stable for the installation. An unset canonical URL falls
 * back to a reserved-looking name rather than leaving the UID bare.
 */
function calendarHost(canonicalBaseUrl: string): string {
  try {
    return new URL(canonicalBaseUrl).hostname;
  } catch {
    return 'taskflow.local';
  }
}

/* -------------------------------------------------------------------------- */
/* XLSX                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A genuine date cell, so Excel sorts and filters the column chronologically
 * instead of alphabetically. An empty date still declares the type: that keeps
 * the date number format on the blank cell, so the column stays uniform and
 * anything typed there later formats like its neighbours.
 */
function dateCell(value: Date | null): CellObject {
  return value ? { value, type: Date } : { type: Date };
}

async function renderXlsx(
  rows: ExportedTodo[],
  context: { sheetName: string; headerColor: string },
): Promise<Buffer> {
  const headerStyle: CellObject = {
    fontWeight: 'bold',
    backgroundColor: context.headerColor,
    textColor: '#FFFFFF',
    align: 'left',
    alignVertical: 'center',
    height: 22,
  };

  const header: XlsxRow = [
    'Title',
    'Status',
    'Done',
    'Priority',
    'Due',
    'Completed',
    'Tags',
    'Description',
    'Created',
    'ID',
  ].map((label) => ({ ...headerStyle, value: label, type: String }));

  const body: XlsxRow[] = rows.map((row) => [
    { value: row.title, type: String, wrap: true },
    { value: STATUS_LABELS[row.status], type: String },
    // A real boolean rather than "Yes"/"No", so the column can be filtered and
    // counted in Excel without a helper formula.
    { value: row.status === 'done', type: Boolean, align: 'center' },
    { value: PRIORITY_LABELS[row.priority], type: String },
    dateCell(row.dueAt),
    dateCell(row.completedAt),
    { value: row.tags.join(', '), type: String },
    { value: row.description ?? '', type: String, wrap: true },
    dateCell(row.createdAt),
    { value: row.id, type: String },
  ]);

  return writeXlsxFile([header, ...body], {
    sheet: context.sheetName,
    // Freezes the header so it stays visible while scrolling a long export.
    stickyRowsCount: 1,
    dateFormat: 'dd mmm yyyy hh:mm',
    columns: [
      { width: 44 },
      { width: 14 },
      { width: 9 },
      { width: 12 },
      { width: 20 },
      { width: 20 },
      { width: 24 },
      { width: 52 },
      { width: 20 },
      { width: 38 },
    ],
  }).toBuffer();
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

async function renderTodosPdf(context: {
  rows: ExportedTodo[];
  timeZone: string;
  title: string;
  filterSummary: string;
  ownerName: string;
  generatedAtLabel: string;
  branding: SettingsShape['branding'];
  seo: SettingsShape['seo'];
  footer: SettingsShape['footer'];
}): Promise<Buffer> {
  const { rows, timeZone, branding, seo, footer } = context;
  const summary = summarise(rows);

  // Dates are formatted here rather than inside the PDF builder, which stays a
  // generic table renderer with no opinion about timezones.
  /*
   * Weights are tuned against the widest value each column can hold at A4
   * (`In progress` as a pill, `06 Aug 2026` as a date), so only the title and
   * tag columns ever reach the ellipsis. They are relative, so the table still
   * fills the page exactly if the margins are ever changed.
   */
  const columns: PdfColumn<ExportedTodo>[] = [
    { header: 'Task', weight: 33, value: (row) => row.title },
    {
      header: 'Status',
      weight: 13,
      value: (row) => STATUS_LABELS[row.status],
      pill: (row) => ({ label: STATUS_LABELS[row.status], color: STATUS_COLORS[row.status] }),
    },
    {
      header: 'Priority',
      weight: 12,
      value: (row) => PRIORITY_LABELS[row.priority],
      pill: (row) => ({
        label: PRIORITY_LABELS[row.priority],
        color: PRIORITY_COLORS[row.priority],
      }),
    },
    { header: 'Due', weight: 13, value: (row) => formatDate(row.dueAt, timeZone) || '-' },
    { header: 'Tags', weight: 16, value: (row) => row.tags.join(', ') },
    { header: 'Created', weight: 13, value: (row) => formatDate(row.createdAt, timeZone) },
  ];

  return renderReportPdf<ExportedTodo>({
    title: context.title,
    subtitle: branding.tagline,
    filterSummary: context.filterSummary,
    generatedAt: context.generatedAtLabel,
    ownerName: context.ownerName,
    siteName: branding.siteName,
    logoText: branding.logoText,
    logo: await loadLogo(branding.logoAttachmentId),
    organisation: seo.organization,
    creditLine: footer.creditLine,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    stats: [
      { label: 'Total', value: String(summary.total) },
      { label: 'Completed', value: String(summary.done) },
      { label: 'In progress', value: String(summary.inProgress) },
      { label: 'Overdue', value: String(summary.overdue) },
      { label: 'Complete', value: `${summary.completionPercent}%` },
    ],
    columns,
    rows,
    emptyMessage: 'No tasks matched these filters.',
  });
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

export async function buildTodoExport(input: {
  userId: string;
  format: ExportFormat;
  filters: TodoFilter;
}): Promise<ExportArtifact> {
  if (activeExports >= MAX_CONCURRENT_EXPORTS) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Too many exports are being generated right now. Please try again in a moment.',
    );
  }

  // No `await` separates the test from the increment, and Node runs this
  // function body to its first suspension without interleaving, so two callers
  // cannot both observe the same slot as free.
  activeExports += 1;

  try {
    return await buildArtifact(input);
  } finally {
    activeExports -= 1;
  }
}

async function buildArtifact(input: {
  userId: string;
  format: ExportFormat;
  filters: TodoFilter;
}): Promise<ExportArtifact> {
  const [owner] = await db
    .select({
      displayName: users.displayName,
      username: users.username,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!owner) throw notFound('Account not found');

  const [branding, seo, footer, rows] = await Promise.all([
    getSettings('branding'),
    getSettings('seo'),
    getSettings('footer'),
    fetchTodos(input.userId, input.filters),
  ]);

  const timeZone = safeTimezone(owner.timezone);
  const generatedAt = new Date();
  const ownerName = owner.displayName ?? owner.username;
  const filterSummary = describeFilters(input.filters, timeZone);
  const title = `${branding.siteName} Task Report`;

  const buffer = await renderFormat({
    format: input.format,
    rows,
    timeZone,
    title,
    filterSummary,
    ownerName,
    generatedAt,
    branding,
    seo,
    footer,
  });

  return {
    buffer,
    contentType: CONTENT_TYPES[input.format],
    filename: `${slugify(branding.siteName)}-tasks-${isoDateIn(generatedAt, timeZone)}.${input.format}`,
    rowCount: rows.length,
  };
}

async function renderFormat(context: {
  format: ExportFormat;
  rows: ExportedTodo[];
  timeZone: string;
  title: string;
  filterSummary: string;
  ownerName: string;
  generatedAt: Date;
  branding: SettingsShape['branding'];
  seo: SettingsShape['seo'];
  footer: SettingsShape['footer'];
}): Promise<Buffer> {
  const { format, rows, timeZone, branding, seo, footer } = context;
  const generatedAtLabel = formatDateTime(context.generatedAt, timeZone);

  switch (format) {
    case 'csv':
      return renderCsv(rows, timeZone);

    case 'json':
      return renderJson(rows, {
        title: context.title,
        generatedAt: context.generatedAt.toISOString(),
        timezone: timeZone,
        owner: context.ownerName,
        filters: context.filterSummary,
        summary: summarise(rows),
        count: rows.length,
      });

    case 'md':
      return renderMarkdown(
        rows,
        {
          title: context.title,
          filterSummary: context.filterSummary,
          generatedAt: generatedAtLabel,
          owner: context.ownerName,
        },
        timeZone,
      );

    case 'ics':
      return renderIcs(rows, {
        calendarName: `${branding.siteName} (${context.ownerName})`,
        productId: `-//${seo.organization.name || branding.siteName}//${branding.siteName} Export//EN`,
        host: calendarHost(seo.canonicalBaseUrl),
      });

    case 'xlsx':
      return renderXlsx(rows, { sheetName: 'Tasks', headerColor: branding.primaryColor });

    case 'pdf':
    default:
      return renderTodosPdf({
        rows,
        timeZone,
        title: context.title,
        filterSummary: context.filterSummary,
        ownerName: context.ownerName,
        generatedAtLabel,
        branding,
        seo,
        footer,
      });
  }
}
