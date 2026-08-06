/**
 * Personal access token and public API tests.
 *
 *   SMOKE_PASSWORD='...' npm run test:tokens
 *
 * The check that matters most here is that a session cookie CANNOT authenticate
 * /api/v1. That surface serves wildcard CORS, which is only safe while bearer
 * tokens are the sole accepted credential. If a cookie ever worked there, any
 * site on the internet could read a logged-in visitor's tasks.
 *
 * Creates a token and a task under the account it signs in with, so point it at
 * a development database.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8000';
const PASS = process.env.SMOKE_PASSWORD;
if (!PASS) {
  console.error('\nSMOKE_PASSWORD is required.\n');
  process.exit(2);
}
let pass = 0, fail = 0; const failures = [];
const check = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; failures.push(`${n} ${d}`); console.log(`  FAIL  ${n} ${d}`); } };

function jarOf() {
  const s = new Map();
  return {
    apply(h) { const c = [...s].map(([k, v]) => `${k}=${v}`).join('; '); if (c) h.set('cookie', c); const x = s.get('tf_csrf'); if (x) h.set('x-csrf-token', x); },
    absorb(r) { for (const raw of r.headers.getSetCookie?.() ?? []) { const [p] = raw.split(';'); const i = p.indexOf('='); const n = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (v) s.set(n, v); else s.delete(n); } },
    get: k => s.get(k), all: () => [...s].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}
async function call(jar, path, o = {}) {
  const h = new Headers(); if (jar) jar.apply(h);
  for (const [k, v] of Object.entries(o.headers ?? {})) h.set(k, v);
  if (!h.has('sec-fetch-site')) h.set('sec-fetch-site', 'same-origin');
  let b; if (o.body !== undefined) { h.set('content-type', 'application/json'); b = JSON.stringify(o.body); }
  const r = await fetch(`${BASE}${path}`, { method: o.method ?? 'GET', headers: h, body: b });
  if (jar) jar.absorb(r);
  const ct = r.headers.get('content-type') ?? '';
  return { r, status: r.status, data: ct.includes('json') ? await r.json().catch(() => null) : null };
}

const jar = jarOf();
const li = await call(jar, '/api/auth/login', { method: 'POST', body: { identifier: 'root', password: PASS } });
check('sign in', li.status === 200, `got ${li.status}`);

await call(jar, '/api/todos', { method: 'POST', body: { title: 'Token API test task', priority: 'high', tags: ['api'] } });

console.log('\nToken management');
const created = await call(jar, '/api/tokens', { method: 'POST', body: { name: 'my-website', scopes: ['tasks:read', 'stats:read'], expiresInDays: 90 } });
check('create a token', created.status === 201 || created.status === 200, `got ${created.status} ${JSON.stringify(created.data)?.slice(0, 200)}`);
const plaintext = created.data?.token ?? created.data?.plaintext;
check('  plaintext returned once', typeof plaintext === 'string' && plaintext.startsWith('tf_pat_'), String(plaintext).slice(0, 20));
check('  hash NOT returned', !JSON.stringify(created.data ?? {}).includes('tokenHash'));

const list = await call(jar, '/api/tokens');
check('list tokens', list.status === 200, `got ${list.status}`);
check('  plaintext NOT in the list', !JSON.stringify(list.data ?? {}).includes(String(plaintext)));

console.log('\nPublic API with the token');
{
  const r = await fetch(`${BASE}/api/v1/tasks`, { headers: { authorization: `Bearer ${plaintext}` } });
  const d = await r.json().catch(() => null);
  check('GET /api/v1/tasks with token', r.status === 200, `got ${r.status} ${JSON.stringify(d)?.slice(0, 160)}`);
  check('  returns tasks', Array.isArray(d?.tasks), JSON.stringify(d)?.slice(0, 120));
  check('  no userId leaked in task shape', !JSON.stringify(d ?? {}).includes('"userId"'));
  check('  CORS is wildcard', r.headers.get('access-control-allow-origin') === '*', r.headers.get('access-control-allow-origin'));
  check('  credentials NOT allowed', r.headers.get('access-control-allow-credentials') !== 'true', r.headers.get('access-control-allow-credentials'));

  const stats = await fetch(`${BASE}/api/v1/stats`, { headers: { authorization: `Bearer ${plaintext}` } });
  check('GET /api/v1/stats with token', stats.status === 200, `got ${stats.status}`);

  const me = await fetch(`${BASE}/api/v1/me`, { headers: { authorization: `Bearer ${plaintext}` } });
  check('GET /api/v1/me needs profile:read (not granted) -> 403', me.status === 403, `got ${me.status}`);
}

console.log('\nThe critical property: cookies must NOT authenticate the public API');
{
  const r = await fetch(`${BASE}/api/v1/tasks`, { headers: { cookie: jar.all(), origin: 'https://evil.example.invalid' } });
  check('session cookie alone is REFUSED on /api/v1', r.status === 401, `got ${r.status}`);
  const d = await r.json().catch(() => null);
  check('  and no task data leaked', !Array.isArray(d?.tasks), JSON.stringify(d)?.slice(0, 120));
}

console.log('\nWrite attempts must fail (read-only)');
{
  for (const [m, p] of [['POST', '/api/v1/tasks'], ['DELETE', '/api/v1/tasks/x'], ['PATCH', '/api/v1/tasks/x']]) {
    const r = await fetch(`${BASE}${p}`, { method: m, headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' }, body: '{}' });
    check(`${m} ${p} rejected`, r.status === 404 || r.status === 405 || r.status === 403, `got ${r.status}`);
  }
  const main = await fetch(`${BASE}/api/todos`, { method: 'POST', headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'should not work' }) });
  check('a PAT cannot write via the MAIN api', main.status === 401 || main.status === 403, `got ${main.status}`);
}

console.log('\nRevocation');
{
  const id = created.data?.apiToken?.id ?? created.data?.token?.id ?? (list.data?.tokens ?? [])[0]?.id;
  const del = await call(jar, `/api/tokens/${id}`, { method: 'DELETE' });
  check('revoke the token', del.status === 204 || del.status === 200, `got ${del.status}`);
  const after = await fetch(`${BASE}/api/v1/tasks`, { headers: { authorization: `Bearer ${plaintext}` } });
  check('revoked token is refused', after.status === 401, `got ${after.status}`);
}

console.log(`\n${'='.repeat(56)}\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(56) + '\n');
process.exit(fail === 0 ? 0 : 1);
