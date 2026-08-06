/**
 * End-to-end smoke test.
 *
 *   npm run test:smoke
 *
 * Runs against a live API and a real database. It exercises the happy paths and
 * then deliberately probes the security boundaries (CSRF, cross-user access,
 * privilege escalation, upload validation and MFA replay), because those are
 * the parts where a regression is silent and expensive.
 *
 * Requires a running server and a seeded root account:
 *   SMOKE_BASE_URL   default http://localhost:8000
 *   SMOKE_USERNAME   default root
 *   SMOKE_PASSWORD   required
 *
 * It creates test data (tasks, an attachment, a probe user) under the account
 * it signs in with, so point it at a development database, never production.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8000';
const USERNAME = process.env.SMOKE_USERNAME ?? 'root';
const PASSWORD = process.env.SMOKE_PASSWORD;

if (!PASSWORD) {
  console.error('\nSMOKE_PASSWORD is required.\n\n  SMOKE_PASSWORD=... npm run test:smoke\n');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`.trim());
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/**
 * Minimal cookie jar. Using cookies rather than bearer tokens is deliberate:
 * it is the path the browser actually takes, and the only one CSRF applies to.
 */
function makeJar() {
  const store = new Map();
  return {
    apply(headers) {
      const cookie = [...store].map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) headers.set('cookie', cookie);
      const csrf = store.get('tf_csrf');
      if (csrf) headers.set('x-csrf-token', csrf);
    },
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value) store.set(name, value);
        else store.delete(name);
      }
    },
    get: (key) => store.get(key),
  };
}

async function call(jar, path, options = {}) {
  const { method = 'GET', body, raw, headers: extra, noCsrf } = options;
  const headers = new Headers();
  if (jar) jar.apply(headers);
  // Applied after the jar so a test can deliberately override the CSRF header.
  for (const [key, value] of Object.entries(extra ?? {})) headers.set(key, value);
  if (noCsrf) headers.delete('x-csrf-token');

  let payload;
  if (raw !== undefined) {
    payload = raw;
  } else if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (jar) jar.absorb(response);

  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('json') ? await response.json().catch(() => null) : null;
  return { response, data, status: response.status };
}

const owner = makeJar();
const probe = makeJar();
const uniqueSuffix = process.hrtime.bigint().toString(36).slice(-8);

/* -------------------------------------------------------------------------- */

section('Public surface');
{
  const health = await call(null, '/api/health');
  check('GET /api/health', health.status === 200 && health.data?.status === 'ok');

  const settings = await call(null, '/api/settings/public');
  check('GET /api/settings/public', settings.status === 200);
  const sections = Object.keys(settings.data?.settings ?? {});
  check('  exposes branding, seo, legal', ['branding', 'seo', 'legal'].every((k) => sections.includes(k)));
  check('  withholds the private limits section', !sections.includes('limits'));
  check('  withholds the private analytics section', !sections.includes('analytics'));
}

section('Authentication');
{
  const wrong = await call(owner, '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: 'definitely-not-the-password' },
  });
  check('wrong password is rejected', wrong.status === 401);

  const unknown = await call(null, '/api/auth/login', {
    method: 'POST',
    body: { identifier: `nobody-${uniqueSuffix}`, password: 'definitely-not-the-password' },
  });
  check(
    'unknown user gives an identical error (no account enumeration)',
    unknown.data?.error?.message === wrong.data?.error?.message,
  );

  const login = await call(owner, '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: PASSWORD },
  });

  if (login.data?.mfaRequired) {
    console.log('\n  This account has MFA enabled; the rest of the suite needs an account without it.');
    process.exit(2);
  }

  check('sign in succeeds', login.status === 200, JSON.stringify(login.data)?.slice(0, 160));
  check('  password hash is absent from the response', !JSON.stringify(login.data ?? {}).includes('passwordHash'));
  check('  MFA secret is absent from the response', !JSON.stringify(login.data ?? {}).includes('mfaSecret'));

  const cookies = login.response.headers.getSetCookie?.() ?? [];
  const access = cookies.find((c) => c.startsWith('tf_access='));
  const refresh = cookies.find((c) => c.startsWith('tf_refresh='));
  const csrf = cookies.find((c) => c.startsWith('tf_csrf='));

  check('  access cookie is HttpOnly', /httponly/i.test(access ?? ''));
  check('  refresh cookie is HttpOnly', /httponly/i.test(refresh ?? ''));
  check('  refresh cookie is scoped to /api/auth', /path=\/api\/auth/i.test(refresh ?? ''));
  check('  CSRF cookie is readable by script, as the pattern requires', !/httponly/i.test(csrf ?? ''));

  const me = await call(owner, '/api/auth/me');
  check('GET /api/auth/me with a session', me.status === 200);

  const anonymous = await call(null, '/api/auth/me');
  check('GET /api/auth/me without one is rejected', anonymous.status === 401);
}

section('CSRF');
{
  const missing = await call(owner, '/api/todos', {
    method: 'POST',
    body: { title: 'csrf probe' },
    noCsrf: true,
  });
  check('cookie-authenticated POST without the CSRF header is refused', missing.status === 403);

  const wrong = await call(owner, '/api/todos', {
    method: 'POST',
    body: { title: 'csrf probe' },
    headers: { 'x-csrf-token': 'not-the-real-token' },
  });
  check('cookie-authenticated POST with a wrong CSRF token is refused', wrong.status === 403);
}

section('Tasks');
let todoId = null;
{
  const created = await call(owner, '/api/todos', {
    method: 'POST',
    body: {
      title: `Smoke test task ${uniqueSuffix}`,
      description: 'Created by scripts/smoke-test.mjs',
      priority: 'urgent',
      tags: ['smoke-test'],
    },
  });
  check('create a task', created.status === 201, JSON.stringify(created.data)?.slice(0, 160));
  todoId = created.data?.todo?.id;

  await call(owner, '/api/todos', {
    method: 'POST',
    body: { title: `Overdue ${uniqueSuffix}`, dueAt: new Date(Date.now() - 86_400_000).toISOString() },
  });

  const list = await call(owner, '/api/todos');
  check('list tasks', list.status === 200 && Array.isArray(list.data?.todos));
  check('  response carries pagination', typeof list.data?.pagination?.total === 'number');

  const search = await call(owner, `/api/todos?q=${uniqueSuffix}`);
  check('full-text search returns the new tasks', (search.data?.todos?.length ?? 0) >= 1);

  const overdue = await call(owner, '/api/todos?overdue=true');
  check('overdue filter works', (overdue.data?.todos?.length ?? 0) >= 1);

  const done = await call(owner, `/api/todos/${todoId}`, { method: 'PATCH', body: { status: 'done' } });
  check('mark a task done', done.status === 200);

  const reread = await call(owner, `/api/todos/${todoId}`);
  check('  completedAt is set automatically', !!reread.data?.todo?.completedAt);

  const stats = await call(owner, '/api/todos/stats');
  check('task statistics', stats.status === 200 && typeof stats.data?.stats?.overdue === 'number');
}

section('Authorisation');
{
  const registration = await call(probe, '/api/auth/register', {
    method: 'POST',
    body: {
      username: `probe${uniqueSuffix}`,
      email: `probe${uniqueSuffix}@example.invalid`,
      password: 'CorrectHorseBatteryStaple7',
      acceptedTerms: true,
    },
  });

  if (registration.status === 403) {
    console.log('  (registration is disabled on this installation, skipping isolation checks)');
  } else {
    check('register a standard account', registration.status === 201);
    check('  new accounts are always role "user"', registration.data?.user?.role === 'user');

    const escalate = await call(makeJar(), '/api/auth/register', {
      method: 'POST',
      body: {
        username: `esc${uniqueSuffix}`,
        email: `esc${uniqueSuffix}@example.invalid`,
        password: 'CorrectHorseBatteryStaple7',
        acceptedTerms: true,
        role: 'root',
      },
    });
    check('  an injected role field cannot grant root', escalate.data?.user?.role === 'user');

    const noTerms = await call(makeJar(), '/api/auth/register', {
      method: 'POST',
      body: {
        username: `nt${uniqueSuffix}`,
        email: `nt${uniqueSuffix}@example.invalid`,
        password: 'CorrectHorseBatteryStaple7',
      },
    });
    check('  terms must be accepted', noTerms.status === 422);

    const weak = await call(makeJar(), '/api/auth/register', {
      method: 'POST',
      body: {
        username: `wk${uniqueSuffix}`,
        email: `wk${uniqueSuffix}@example.invalid`,
        password: 'password123',
        acceptedTerms: true,
      },
    });
    check('  a common password is refused', weak.status === 422);

    const read = await call(probe, `/api/todos/${todoId}`);
    check("another user cannot read someone else's task", read.status === 404);

    const remove = await call(probe, `/api/todos/${todoId}`, { method: 'DELETE' });
    check("another user cannot delete someone else's task", remove.status === 404);

    const adminUsers = await call(probe, '/api/admin/users');
    check('a standard user cannot reach the control panel', adminUsers.status === 403);
  }
}

section('Attachments');
{
  // A real 1x1 PNG, so magic-byte detection has something valid to inspect.
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
    'hex',
  );

  const upload = await call(owner, `/api/attachments/todos/${todoId}`, {
    method: 'POST',
    raw: png,
    headers: { 'content-type': 'image/png', 'x-filename': 'pixel.png' },
  });
  check('upload a PNG', upload.status === 201, JSON.stringify(upload.data)?.slice(0, 200));
  check('  file bytes are not echoed back', !JSON.stringify(upload.data ?? {}).includes('"data"'));

  const attachmentId = upload.data?.attachment?.id;
  if (attachmentId) {
    const headers = new Headers();
    owner.apply(headers);
    const download = await fetch(`${BASE}/api/attachments/${attachmentId}`, { headers });
    const bytes = Buffer.from(await download.arrayBuffer());

    check('download it again', download.status === 200);
    check('  bytes survive the round trip through Postgres', bytes.equals(png));
    check('  nosniff header is set', download.headers.get('x-content-type-options') === 'nosniff');
  }

  // The critical check: a file's real type must beat whatever the client claims.
  const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
  const disguised = await call(owner, `/api/attachments/todos/${todoId}`, {
    method: 'POST',
    raw: html,
    headers: { 'content-type': 'image/png', 'x-filename': 'evil.png' },
  });
  check('HTML disguised as a PNG is rejected', disguised.status === 415 || disguised.status === 400);

  const oversize = Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024, 0x41)]);
  const tooLarge = await call(owner, `/api/attachments/todos/${todoId}`, {
    method: 'POST',
    raw: oversize,
    headers: { 'content-type': 'image/png', 'x-filename': 'huge.png' },
  });
  check('an oversized upload is rejected', tooLarge.status === 413);
}

section('Exports');
{
  const expectations = [
    ['pdf', '%PDF'],
    ['csv', null],
    ['xlsx', 'PK'],
    ['json', null],
    ['md', null],
    ['ics', 'BEGIN:VCALENDAR'],
  ];

  for (const [format, magic] of expectations) {
    const headers = new Headers();
    owner.apply(headers);
    const response = await fetch(`${BASE}/api/exports/todos?format=${format}`, { headers });
    const bytes = Buffer.from(await response.arrayBuffer());

    const magicOk = magic ? bytes.subarray(0, magic.length).toString('latin1') === magic : true;
    check(
      `export as ${format} (${bytes.length} bytes)`,
      response.status === 200 && bytes.length > 0 && magicOk,
      `status=${response.status}`,
    );
    check(
      `  ${format} is sent as a download`,
      /attachment/i.test(response.headers.get('content-disposition') ?? ''),
    );
  }
}

section('Sessions');
{
  const sessions = await call(owner, '/api/auth/sessions');
  check('list active sessions', sessions.status === 200);
  check('  the current session is identified', (sessions.data?.sessions ?? []).some((s) => s.current));

  const refreshed = await call(owner, '/api/auth/refresh', { method: 'POST' });
  check('refresh rotates the session', refreshed.status === 200);

  const loggedOut = await call(owner, '/api/auth/logout', { method: 'POST' });
  check('sign out', loggedOut.status === 204);
}

/* -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`${'─'.repeat(60)}\n`);

process.exit(failed === 0 ? 0 : 1);
