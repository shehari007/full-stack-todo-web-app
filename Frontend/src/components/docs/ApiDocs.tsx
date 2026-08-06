'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Button, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ApiOutlined, KeyOutlined } from '@ant-design/icons';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { SCOPE_INFO, TOKEN_SCOPES } from '@/components/tokens/token-scopes';
import type { TokenScope } from '@/types/api';

const { Paragraph, Text, Title } = Typography;

/**
 * Reference for the public read API.
 *
 * Written for somebody who wants their tasks on their own website, not for
 * somebody who already knows the codebase: every example is complete, runnable
 * and uses the base URL of the site they are reading it on.
 */
const DOCS_CSS = `
.tf-docs { display: grid; gap: 2rem; align-items: start; }
.tf-docs__toc { display: none; }
@media (min-width: 992px) {
  .tf-docs { grid-template-columns: minmax(0, 1fr) 220px; }
  /* Sticky rather than antd's own affix: affix positions a fixed element from
     the viewport, which fights the app shell's own sticky header. */
  .tf-docs__toc { display: block; position: sticky; top: 5.5rem; }
}
.tf-docs__section { scroll-margin-top: 5rem; }
.tf-docs__section + .tf-docs__section { margin-top: 2.75rem; }
.tf-docs__endpoint {
  border: 1px solid var(--tf-border);
  border-radius: 12px;
  background: var(--tf-surface);
  padding: 1rem;
  margin-block: 1.25rem;
}
.tf-docs__endpoint-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.tf-docs__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.95rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.tf-docs__lede { max-width: 68ch; }
`;

/** Clears the 60px sticky app header when the Anchor scrolls a heading into view. */
const ANCHOR_OFFSET = 80;

/**
 * Mirrors `publicApiLimiter` in `Server/src/middleware/rate-limit.ts`, the
 * limiter mounted on this router, keyed on the token id. It is the binding
 * ceiling and the one whose counters land in the `RateLimit` headers, because it
 * runs after the broader IP-keyed `generalLimiter` and overwrites them.
 * One constant, so a change on the API is a one-line change here.
 */
const RATE_LIMIT = { limit: 120, windowSeconds: 60 };

/** Shown only when the site has no canonical URL configured and JS has not run yet. */
const PLACEHOLDER_ORIGIN = 'https://your-taskflow-site.example';

/* -------------------------------------------------------------------------- */
/* Endpoint reference data                                                    */
/* -------------------------------------------------------------------------- */

interface QueryParam {
  name: string;
  type: string;
  fallback: string;
  notes: string;
}

/**
 * Taken from `listTasksQuerySchema` in `Server/src/modules/public/public.routes.ts`.
 *
 * Deliberately *not* the web app's own `listTodosQuerySchema`. This surface has
 * its own, smaller schema: single-valued filters, limit/offset instead of
 * page/pageSize, and no full-text search. Documenting the internal one would
 * advertise parameters that are silently dropped here.
 */
const TASK_QUERY_PARAMS: QueryParam[] = [
  {
    name: 'status',
    type: 'enum',
    fallback: 'all',
    notes: 'One of todo, in_progress, done. A single value, not a list.',
  },
  {
    name: 'priority',
    type: 'enum',
    fallback: 'all',
    notes: 'One of low, medium, high, urgent. A single value.',
  },
  {
    name: 'tag',
    type: 'string',
    fallback: 'all',
    notes: 'Singular, and matched exactly. One tag, up to 32 characters.',
  },
  {
    name: 'limit',
    type: 'integer',
    fallback: '20',
    notes: 'How many tasks to return, 1 to 100. Larger values are rejected, not clamped.',
  },
  {
    name: 'offset',
    type: 'integer',
    fallback: '0',
    notes: 'How many to skip. Page two of a 20-row page is offset=20.',
  },
  {
    name: 'sort',
    type: 'enum',
    fallback: 'created',
    notes: 'created, due, priority or title. Always tie-broken on the id, so no row appears on two pages.',
  },
  { name: 'order', type: 'enum', fallback: 'desc', notes: 'asc or desc.' },
];

const TASKS_RESPONSE = `{
  "tasks": [
    {
      "id": "6f2a91c4-8d3e-4a1b-9f77-0c5b2e8a41d9",
      "title": "Draft the Q3 retrospective",
      "description": "Pull the incident timeline out of the audit log first.",
      "status": "in_progress",
      "priority": "high",
      "dueAt": "2026-08-09T17:00:00.000Z",
      "completedAt": null,
      "tags": ["work", "writing"],
      "createdAt": "2026-08-01T09:12:44.118Z"
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 47, "hasMore": true }
}`;

const TASK_RESPONSE = `{
  "task": {
    "id": "6f2a91c4-8d3e-4a1b-9f77-0c5b2e8a41d9",
    "title": "Draft the Q3 retrospective",
    "description": "Pull the incident timeline out of the audit log first.",
    "status": "in_progress",
    "priority": "high",
    "dueAt": "2026-08-09T17:00:00.000Z",
    "completedAt": null,
    "tags": ["work", "writing"],
    "createdAt": "2026-08-01T09:12:44.118Z"
  }
}`;

const STATS_RESPONSE = `{
  "stats": {
    "total": 47,
    "byStatus": { "todo": 19, "in_progress": 6, "done": 22 },
    "byPriority": { "low": 8, "medium": 21, "high": 15, "urgent": 3 },
    "overdue": 2,
    "dueToday": 4,
    "completedThisWeek": 9,
    "completionRate": 0.468,
    "currentStreak": 5
  }
}`;

const ME_RESPONSE = `{
  "user": {
    "username": "sheharyar",
    "displayName": "Sheharyar Butt",
    "avatarId": "2c9d17bb-4a6e-4f80-9a2e-7d1f5b3c8e60"
  }
}`;

const ERROR_RESPONSE = `{
  "error": {
    "code": "FORBIDDEN",
    "message": "This token does not carry the \\"stats:read\\" scope"
  }
}`;

interface EndpointSpec {
  id: string;
  method: 'GET';
  path: string;
  scope: TokenScope;
  summary: string;
  params?: QueryParam[];
  pathParams?: QueryParam[];
  response: string;
}

const ENDPOINTS: EndpointSpec[] = [
  {
    id: 'endpoint-tasks',
    method: 'GET',
    path: '/api/v1/tasks',
    scope: 'tasks:read',
    summary:
      "Your tasks, filtered and paginated. Deleted tasks are never returned, and neither is anybody else's work: ownership is part of the database query, not a check that could be skipped.",
    params: TASK_QUERY_PARAMS,
    response: TASKS_RESPONSE,
  },
  {
    id: 'endpoint-task',
    method: 'GET',
    path: '/api/v1/tasks/{id}',
    scope: 'tasks:read',
    summary:
      "A single task by id. A task that exists but is not yours answers 404, identically to one that does not exist. The two are indistinguishable on purpose, so the API cannot be used to probe for other people's ids.",
    pathParams: [
      { name: 'id', type: 'uuid', fallback: 'required', notes: 'The task id, as returned by the list endpoint.' },
    ],
    response: TASK_RESPONSE,
  },
  {
    id: 'endpoint-stats',
    method: 'GET',
    path: '/api/v1/stats',
    scope: 'stats:read',
    summary:
      'Counts and completion figures for your account. Numbers only, with no titles and no descriptions, which makes it the safe one to put on a public page.',
    response: STATS_RESPONSE,
  },
  {
    id: 'endpoint-me',
    method: 'GET',
    path: '/api/v1/me',
    scope: 'profile:read',
    summary:
      'Just enough of your profile to render a byline: username, display name, and the id of your avatar. Your email address, role and account status are deliberately absent, because nothing about a token should make an address harvestable. Note that avatarId identifies the image but does not make it public: attachment downloads still require a signed-in session, so a token cannot fetch the picture itself.',
    response: ME_RESPONSE,
  },
];

/* -------------------------------------------------------------------------- */
/* Snippets                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Built as line arrays rather than template literals so the examples can contain
 * backticks and `${...}` without a layer of escaping between the reader and the
 * code they are about to paste.
 */

function curlSnippet(base: string): string {
  return [
    '# Keep the token out of your shell history and out of your scripts.',
    'export TASKFLOW_TOKEN="tf_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
    '',
    '# Quote the URL: an unquoted & would background the command.',
    'curl -sS \\',
    '  -H "Authorization: Bearer $TASKFLOW_TOKEN" \\',
    `  "${base}/api/v1/tasks?status=in_progress&limit=5"`,
  ].join('\n');
}

function browserSnippet(base: string): string {
  return [
    '// Runs in a page on your own site.',
    '//',
    '// Anything you ship to a browser is public: view-source is all it takes to',
    '// read this token. Use one scoped to tasks:read and nothing else, and treat',
    '// everything it can reach as published.',
    "const TOKEN = 'tf_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';",
    '',
    'async function renderTasks() {',
    `  const url = new URL('/api/v1/tasks', '${base}');`,
    "  url.searchParams.set('status', 'in_progress');",
    "  url.searchParams.set('sort', 'due');",
    "  url.searchParams.set('order', 'asc');",
    "  url.searchParams.set('limit', '5');",
    '',
    '  const response = await fetch(url, {',
    '    headers: { Authorization: `Bearer ${TOKEN}` },',
    '    // Must stay omitted. This surface refuses cookies outright, which is',
    '    // exactly why it can answer every origin with',
    '    // Access-Control-Allow-Origin: *. There is no ambient session for a',
    '    // hostile page to ride on, only the token you put in the header.',
    "    credentials: 'omit',",
    '  });',
    '',
    '  if (!response.ok) {',
    '    const { error } = await response.json();',
    '    throw new Error(`${error.code}: ${error.message}`);',
    '  }',
    '',
    '  const { tasks } = await response.json();',
    "  const list = document.querySelector('#taskflow-tasks');",
    '',
    '  for (const task of tasks) {',
    "    const item = document.createElement('li');",
    '    // textContent, not innerHTML: your own titles are still text, and one',
    '    // stray "<" should never become markup.',
    '    item.textContent = task.title;',
    '    list.append(item);',
    '  }',
    '}',
    '',
    'renderTasks().catch(console.error);',
  ].join('\n');
}

function nodeSnippet(base: string): string {
  return [
    '// Node 18 or newer: fetch is built in, so no dependencies are needed.',
    '//',
    '// This is the shape to prefer: the token stays on your server, and the',
    '// browser only ever sees the HTML you chose to render.',
    'const TOKEN = process.env.TASKFLOW_TOKEN;',
    "if (!TOKEN) throw new Error('TASKFLOW_TOKEN is not set');",
    '',
    `const BASE = '${base}';`,
    '',
    'export async function openTasks({ limit = 10 } = {}) {',
    "  const url = new URL('/api/v1/tasks', BASE);",
    "  url.searchParams.set('status', 'in_progress');",
    "  url.searchParams.set('sort', 'due');",
    "  url.searchParams.set('order', 'asc');",
    "  url.searchParams.set('limit', String(limit));",
    '',
    '  const response = await fetch(url, {',
    '    headers: { Authorization: `Bearer ${TOKEN}` },',
    '  });',
    '',
    '  if (response.status === 429) {',
    '    const { error } = await response.json();',
    '    throw new Error(`Rate limited. Retry in ${error.retryAfterSeconds}s`);',
    '  }',
    '',
    '  if (!response.ok) {',
    '    const { error } = await response.json();',
    '    // Branch on the code, never on the message: the prose may change.',
    '    throw new Error(`${error.code}: ${error.message}`);',
    '  }',
    '',
    '  const { tasks, pagination } = await response.json();',
    '  return { tasks, total: pagination.total, hasMore: pagination.hasMore };',
    '}',
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="tf-docs__section" aria-labelledby={`${id}-heading`}>
      <Title level={2} id={`${id}-heading`} style={{ marginTop: 0 }}>
        {title}
      </Title>
      {children}
    </section>
  );
}

function ParamTable({ params, caption }: { params: QueryParam[]; caption: string }) {
  return (
    <Table<QueryParam>
      rowKey="name"
      size="small"
      pagination={false}
      dataSource={params}
      // Four columns of prose do not fit a phone; the table scrolls, the page does not.
      scroll={{ x: 'max-content' }}
      title={() => <Text strong>{caption}</Text>}
      columns={[
        {
          title: 'Parameter',
          dataIndex: 'name',
          key: 'name',
          render: (name: string) => <Text code>{name}</Text>,
        },
        { title: 'Type', dataIndex: 'type', key: 'type' },
        { title: 'Default', dataIndex: 'fallback', key: 'fallback' },
        {
          title: 'Notes',
          dataIndex: 'notes',
          key: 'notes',
          render: (notes: string) => <span style={{ maxWidth: 420, display: 'inline-block' }}>{notes}</span>,
        },
      ]}
    />
  );
}

function Endpoint({ spec }: { spec: EndpointSpec }) {
  return (
    <div className="tf-docs__endpoint" id={spec.id}>
      <div className="tf-docs__endpoint-head">
        <Tag color="blue" style={{ marginInlineEnd: 0 }}>
          {spec.method}
        </Tag>
        <span className="tf-docs__path">{spec.path}</span>
        <Tag>{spec.scope}</Tag>
      </div>

      <Paragraph className="tf-muted tf-docs__lede">{spec.summary}</Paragraph>

      {spec.pathParams ? <ParamTable params={spec.pathParams} caption="Path parameters" /> : null}
      {spec.params ? <ParamTable params={spec.params} caption="Query parameters" /> : null}

      <CodeBlock code={spec.response} language="json" label="200 response" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function ApiDocs({ canonicalBaseUrl }: { canonicalBaseUrl: string }) {
  /*
   * Every example should be pasteable as-is, which means it needs this
   * installation's real origin. The canonical URL from site settings is the
   * authoritative answer but is frequently left blank; the browser knows the
   * truth, only not until after hydration, and reading `location` during render
   * would make the server and client markup disagree.
   */
  const [origin, setOrigin] = useState(canonicalBaseUrl);

  useEffect(() => {
    if (!canonicalBaseUrl) setOrigin(window.location.origin);
  }, [canonicalBaseUrl]);

  const base = (origin || PLACEHOLDER_ORIGIN).replace(/\/+$/, '');

  return (
    <div className="tf-docs">
      <style href="tf-docs-layout" precedence="default">
        {DOCS_CSS}
      </style>

      <article>
        <header style={{ marginBottom: '2rem' }}>
          <Title level={1} style={{ marginBottom: '0.35rem' }}>
            API documentation
          </Title>
          <Paragraph className="tf-muted tf-docs__lede" style={{ fontSize: '1.05rem' }}>
            A read-only HTTP API for your own tasks, authenticated with a personal
            access token. It exists so you can put your task list, or just the
            numbers, on a page you control, without handing that page your
            password.
          </Paragraph>
          <Space wrap>
            <Link href="/settings/tokens">
              <Button type="primary" icon={<KeyOutlined />}>
                Manage your tokens
              </Button>
            </Link>
          </Space>
        </header>

        {/* ------------------------------------------------------------ */}
        <Section id="overview" title="What this API is">
          <Paragraph className="tf-docs__lede">
            Every endpoint below lives under <Text code>{base}/api/v1</Text> and answers{' '}
            <Text strong>GET</Text> requests only. There is no write surface: a token
            cannot create a task, edit one, delete one, or change anything at all about
            your account.
          </Paragraph>

          <Title level={3}>What a token can do</Title>
          <ul className="tf-docs__lede">
            <li>Read your own tasks, statistics and public profile, according to the scopes you granted it.</li>
            <li>Be used from anywhere: a browser, a server, a cron job, a static site build.</li>
            <li>Be revoked by you at any moment, immediately, without affecting anything else.</li>
          </ul>

          <Title level={3}>What it cannot do</Title>
          <ul className="tf-docs__lede">
            <li>Create, change or delete anything.</li>
            <li>See another account&rsquo;s data. Ownership is part of the SQL query, not a check that can be skipped.</li>
            <li>Read your email address, password, sessions, recovery codes or security settings.</li>
            <li>Sign in to the web app, or reach the control panel.</li>
          </ul>

          <Alert
            type="info"
            showIcon
            message="Deleted tasks stay deleted"
            description="Tasks in the trash are excluded from every response. The public API has no view of them and no way to restore one."
          />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="tokens" title="Getting a token">
          <Paragraph className="tf-docs__lede">
            Go to <Link href="/settings/tokens">Settings → API tokens</Link>, choose a
            name and the scopes you need, and pick an expiry. The token is shown once,
            at that moment, and never again. TaskFlow stores only a SHA-256 hash of it,
            so nobody can recover it for you. Lost it? Revoke it and make another; it
            takes ten seconds.
          </Paragraph>

          <Paragraph className="tf-docs__lede">
            Tokens start with <Text code>tf_pat_</Text>. That prefix is deliberate: it
            makes a leaked token recognisable in a diff, a log file or a secret scanner.
          </Paragraph>

          <Title level={3}>Scopes</Title>
          <Paragraph className="tf-docs__lede">
            A scope is a permission. Grant only the ones the integration actually needs.
            A widget that shows how many tasks you have finished this week does not
            need to be able to read their titles.
          </Paragraph>

          <Table<{ scope: TokenScope }>
            rowKey="scope"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={TOKEN_SCOPES.map((scope) => ({ scope }))}
            columns={[
              {
                title: 'Scope',
                dataIndex: 'scope',
                key: 'scope',
                render: (scope: TokenScope) => <Text code>{scope}</Text>,
              },
              {
                title: 'Grants',
                key: 'grants',
                render: (_value, row) => (
                  <span style={{ maxWidth: 460, display: 'inline-block' }}>
                    {SCOPE_INFO[row.scope].grants}
                  </span>
                ),
              },
              {
                title: 'Endpoints',
                key: 'endpoints',
                render: (_value, row) => (
                  <Space direction="vertical" size={2}>
                    {SCOPE_INFO[row.scope].endpoints.map((endpoint) => (
                      <Text code key={endpoint} style={{ whiteSpace: 'nowrap' }}>
                        {endpoint}
                      </Text>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="auth" title="Authentication">
          <Paragraph className="tf-docs__lede">
            Put the token in an <Text code>Authorization</Text> header. That is the only
            way in. There is no query-string parameter, because URLs end up in browser
            history, server logs and <Text code>Referer</Text> headers.
          </Paragraph>

          <CodeBlock
            code="Authorization: Bearer tf_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            language="http"
            label="Request header"
          />

          <CodeBlock code={curlSnippet(base)} language="bash" label="Try it now" />

          <Paragraph className="tf-docs__lede">
            Cookies are ignored here. If you are signed in to TaskFlow in the same
            browser, that session has no effect on an <Text code>/api/v1</Text> call:
            the token is the only credential the surface accepts. That is precisely
            what makes it safe for it to answer{' '}
            <Text code>Access-Control-Allow-Origin: *</Text>. With no ambient session
            to ride on, a hostile page cannot make a request that is authenticated as
            you unless it already has your token.
          </Paragraph>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="endpoints" title="Endpoints">
          <Paragraph className="tf-docs__lede">
            All paths are relative to <Text code>{base}</Text>. Every successful
            response is a JSON object whose payload sits under a named key:{' '}
            <Text code>tasks</Text>, <Text code>task</Text>, <Text code>stats</Text> or{' '}
            <Text code>user</Text>. It is never a bare array, so a field can be added
            later without breaking your parser. Every timestamp is an ISO 8601 string
            in UTC.
          </Paragraph>

          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: '1rem' }}
            message="Unrecognised query parameters are ignored, not rejected"
            description="Only the parameters listed below exist on this API. Anything else (including the names used by the web app's own task list, such as pageSize, includeCompleted or q) is dropped silently, and you get the default result rather than an error. If a filter appears to do nothing, check its spelling against the table."
          />

          {ENDPOINTS.map((spec) => (
            <Endpoint key={spec.id} spec={spec} />
          ))}
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="examples" title="Integration examples">
          <Paragraph className="tf-docs__lede">
            Three ways to call it. All three are complete: swap in your own token and
            they run.
          </Paragraph>

          <Tabs
            defaultActiveKey="curl"
            items={[
              {
                key: 'curl',
                label: 'curl',
                children: (
                  <>
                    <Paragraph className="tf-muted tf-docs__lede">
                      The fastest way to check a token works and see the real shape of a
                      response.
                    </Paragraph>
                    <CodeBlock code={curlSnippet(base)} language="bash" />
                  </>
                ),
              },
              {
                key: 'browser',
                label: 'Browser (fetch)',
                children: (
                  <>
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: '0.85rem' }}
                      message="A token in browser JavaScript is a public token"
                      description="Anyone who opens the page can read it and call the API as you, until you revoke it. Only do this with a narrowly scoped token whose data you are happy to publish, and prefer the Node example, which keeps the token on your server."
                    />
                    <Paragraph className="tf-muted tf-docs__lede">
                      Cross-origin requests are allowed from any site. That is only safe
                      because this surface refuses cookies: there is no session for a
                      third-party page to borrow, so the wildcard grants nothing that the
                      token in the header did not already grant.
                    </Paragraph>
                    <CodeBlock code={browserSnippet(base)} language="javascript" />
                  </>
                ),
              },
              {
                key: 'node',
                label: 'Node',
                children: (
                  <>
                    <Paragraph className="tf-muted tf-docs__lede">
                      The version to reach for first. The token stays in an environment
                      variable on your server, and visitors receive only the HTML you
                      chose to render.
                    </Paragraph>
                    <CodeBlock code={nodeSnippet(base)} language="javascript" />
                  </>
                ),
              },
            ]}
          />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="errors" title="Errors">
          <Paragraph className="tf-docs__lede">
            Every failure (a bad token, a missing scope, a rejected query parameter)
            comes back in the same envelope, with the same HTTP status you would expect.
          </Paragraph>

          <CodeBlock code={ERROR_RESPONSE} language="json" label="403 response" />

          <Paragraph className="tf-docs__lede">
            Branch on <Text code>error.code</Text>. It is stable and machine-readable;{' '}
            <Text code>error.message</Text> is written for people and is allowed to
            change.
          </Paragraph>

          <Table<{ code: string; status: string; meaning: string }>
            rowKey="code"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={[
              {
                code: 'UNAUTHORIZED',
                status: '401',
                meaning:
                  'No Authorization header, or a token that is unknown, revoked or past its expiry.',
              },
              {
                code: 'FORBIDDEN',
                status: '403',
                meaning: 'The token is valid but was not granted the scope this endpoint needs.',
              },
              {
                code: 'ACCOUNT_SUSPENDED',
                status: '403',
                meaning:
                  'The account the token belongs to has been suspended. Named separately from FORBIDDEN because it is the one refusal you can act on.',
              },
              {
                code: 'NOT_FOUND',
                status: '404',
                meaning: 'No such task, or one that exists but is not yours. Identical by design.',
              },
              {
                code: 'VALIDATION_FAILED',
                status: '422',
                meaning:
                  'A query parameter was rejected. details carries a message per field.',
              },
              {
                code: 'RATE_LIMITED',
                status: '429',
                meaning: 'You went over the limit. retryAfterSeconds says how long to wait.',
              },
              {
                code: 'INTERNAL',
                status: '500',
                meaning:
                  'Something broke on our side. requestId matches the X-Request-Id header, so quote it if you report it.',
              },
              {
                code: 'MAINTENANCE',
                status: '503',
                meaning:
                  'The installation is in maintenance mode. Retry-After tells you when to come back.',
              },
            ]}
            columns={[
              {
                title: 'Code',
                dataIndex: 'code',
                key: 'code',
                render: (code: string) => <Text code>{code}</Text>,
              },
              { title: 'HTTP', dataIndex: 'status', key: 'status' },
              {
                title: 'Means',
                dataIndex: 'meaning',
                key: 'meaning',
                render: (meaning: string) => (
                  <span style={{ maxWidth: 480, display: 'inline-block' }}>{meaning}</span>
                ),
              },
            ]}
          />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="limits" title="Rate limits">
          <Paragraph className="tf-docs__lede">
            {RATE_LIMIT.limit} requests per {RATE_LIMIT.windowSeconds} seconds, counted
            per token. That is far more than a page or a dashboard needs. If you are
            near it, cache the response rather than asking for the same list on every
            page view. List and statistics responses already carry{' '}
            <Text code>Cache-Control: private, max-age=30</Text>, so a browser will
            reuse them for you.
          </Paragraph>

          <Paragraph className="tf-docs__lede">
            A second, broader ceiling of 300 requests per minute sits in front of the
            whole API and is counted per IP address rather than per token. You will only
            meet it if several integrations share one outbound address (a few
            containers on the same host, for instance), in which case they share that
            budget between them.
          </Paragraph>

          <Paragraph className="tf-docs__lede">
            Every response carries IETF draft-7 headers, and they are exposed to
            cross-origin callers so browser code can read them:
          </Paragraph>

          <CodeBlock
            code={[
              `RateLimit: limit=${RATE_LIMIT.limit}, remaining=287, reset=41`,
              `RateLimit-Policy: ${RATE_LIMIT.limit};w=${RATE_LIMIT.windowSeconds}`,
            ].join('\n')}
            language="http"
            label="Response headers"
          />

          <Paragraph className="tf-docs__lede">
            Go over it and you get a <Text code>429</Text> with{' '}
            <Text code>retryAfterSeconds</Text> in the error body. Wait that long; do
            not retry in a tight loop.
          </Paragraph>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="safety" title="Keeping your token safe">
          <ul className="tf-docs__lede">
            <li>
              <Text strong>Never commit it.</Text> Not to a public repository, not to a
              private one. Use an environment variable, and add your{' '}
              <Text code>.env</Text> to <Text code>.gitignore</Text>.
            </li>
            <li>
              <Text strong>Prefer a server-side call.</Text> A token in browser
              JavaScript is readable by every visitor. Fetch on your server, render the
              result.
            </li>
            <li>
              <Text strong>Set an expiry.</Text> A token you forget about is a token
              nobody is watching. An expiry closes it for you.
            </li>
            <li>
              <Text strong>Grant the narrowest scope that works.</Text> A statistics
              widget needs <Text code>stats:read</Text>, not <Text code>tasks:read</Text>.
            </li>
            <li>
              <Text strong>Revoke on the slightest doubt.</Text> Revocation is instant
              and costs you one replacement token. Check the{' '}
              <Link href="/settings/tokens">last-used time and request count</Link> if
              you want to know whether a token was actually used.
            </li>
          </ul>

          <Alert
            type="success"
            showIcon
            message="The worst case is bounded"
            description="A leaked token exposes read access to your own tasks and nothing else. It cannot delete your work, change your password, or lock you out, which is exactly why this API exists instead of asking you to embed a session."
          />
        </Section>
      </article>

      {/* Hidden below 992px rather than collapsed into an accordion: on a phone
          the document is one scroll away, and a duplicate index is more to swipe
          past than it is a shortcut. */}
      <nav className="tf-docs__toc" aria-label="On this page">
        <Anchor
          affix={false}
          targetOffset={ANCHOR_OFFSET}
          items={[
            { key: 'overview', href: '#overview', title: 'What this API is' },
            { key: 'tokens', href: '#tokens', title: 'Getting a token' },
            { key: 'auth', href: '#auth', title: 'Authentication' },
            {
              key: 'endpoints',
              href: '#endpoints',
              title: 'Endpoints',
              children: ENDPOINTS.map((spec) => ({
                key: spec.id,
                href: `#${spec.id}`,
                title: spec.path.replace('/api/v1', ''),
              })),
            },
            { key: 'examples', href: '#examples', title: 'Examples' },
            { key: 'errors', href: '#errors', title: 'Errors' },
            { key: 'limits', href: '#limits', title: 'Rate limits' },
            { key: 'safety', href: '#safety', title: 'Token safety' },
          ]}
        />

        <Space direction="vertical" size={8} style={{ marginTop: '1.25rem', width: '100%' }}>
          <Link href="/settings/tokens">
            <Button block icon={<ApiOutlined />}>
              Your tokens
            </Button>
          </Link>
        </Space>
      </nav>
    </div>
  );
}
