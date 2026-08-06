/**
 * Security regression tests.
 *
 *   SMOKE_PASSWORD='...' npm run test:security
 *
 * Every check here corresponds to a defect that was found by review and fixed.
 * They exist because each one is invisible in normal use: the app works
 * perfectly while being wrong, so only a test that actively attacks it notices
 * a regression.
 *
 * Requires a running server and a root account WITHOUT MFA enrolled. It creates
 * a probe admin account, so point it at a development database.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8000';
const USERNAME = process.env.SMOKE_USERNAME ?? 'root';
const PASSWORD = process.env.SMOKE_PASSWORD;

if (!PASSWORD) {
  console.error('\nSMOKE_PASSWORD is required.\n');
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
  const { method = 'GET', body, headers: extra, noCsrf } = options;
  const headers = new Headers();
  if (jar) jar.apply(headers);
  for (const [key, value] of Object.entries(extra ?? {})) headers.set(key, value);
  if (noCsrf) headers.delete('x-csrf-token');
  // Same-origin is what a real browser sends for the app's own requests.
  if (!headers.has('sec-fetch-site')) headers.set('sec-fetch-site', 'same-origin');

  let payload;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (jar) jar.absorb(response);
  const contentType = response.headers.get('content-type') ?? '';
  return {
    response,
    status: response.status,
    data: contentType.includes('json') ? await response.json().catch(() => null) : null,
  };
}

const uniq = process.hrtime.bigint().toString(36).slice(-6);

/* -------------------------------------------------------------------------- */

console.log('\nAuth rate limiting is per-identity, not per-address');
{
  /*
   * The web app proxies /api/* through Next.js, so every browser request
   * reaches Express from the same address. An IP-keyed auth limiter therefore
   * put the whole installation in one bucket, and eleven failed sign-ins from
   * anyone locked everybody out for fifteen minutes.
   */
  for (let i = 0; i < 12; i += 1) {
    await call(null, '/api/auth/login', {
      method: 'POST',
      body: { identifier: `victim-${uniq}`, password: 'wrong-password' },
    });
  }

  const attacked = await call(null, '/api/auth/login', {
    method: 'POST',
    body: { identifier: `victim-${uniq}`, password: 'wrong-password' },
  });
  check('the attacked identifier is limited', attacked.status === 429, `got ${attacked.status}`);

  const bystander = await call(null, '/api/auth/login', {
    method: 'POST',
    body: { identifier: `bystander-${uniq}`, password: 'wrong-password' },
  });
  check('a different account is NOT limited by it', bystander.status !== 429, `got ${bystander.status}`);

  const jar = makeJar();
  const real = await call(jar, '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: PASSWORD },
  });
  check(
    'a real sign-in still succeeds during the attack',
    real.status === 200 || real.data?.mfaRequired === true,
    `got ${real.status}`,
  );
}

console.log('\nRevocation is immediate, not eventual');
{
  /*
   * Access tokens are stateless, so revoking a session row alone left the token
   * working until it expired, up to fifteen minutes after the user pressed
   * "sign out". The middleware now checks the session is still live.
   */
  const jar = makeJar();
  const login = await call(jar, '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: PASSWORD },
  });

  if (login.status !== 200) {
    check('sign in for the revocation test', false, `got ${login.status} (is MFA enabled?)`);
  } else {
    const captured = jar.get('tf_access');
    const before = await call(jar, '/api/auth/me');
    check('the token works before signing out', before.status === 200);

    await call(jar, '/api/auth/logout', { method: 'POST' });

    const replay = await fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: `tf_access=${captured}` },
    });
    check('a captured token is refused after sign-out', replay.status === 401, `got ${replay.status}`);
  }

  const jar2 = makeJar();
  const login2 = await call(jar2, '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: PASSWORD },
  });

  if (login2.status === 200) {
    const captured = jar2.get('tf_access');
    const sessions = await call(jar2, '/api/auth/sessions');
    const current = (sessions.data?.sessions ?? []).find((s) => s.current);

    if (current) {
      await call(jar2, `/api/auth/sessions/${current.id}`, { method: 'DELETE' });
      const replay = await fetch(`${BASE}/api/auth/me`, {
        headers: { cookie: `tf_access=${captured}` },
      });
      check('a token is refused after its session is revoked', replay.status === 401, `got ${replay.status}`);
    }
  }
}

console.log('\nCross-site requests cannot start a session');
{
  /*
   * The double-submit CSRF token cannot protect sign-in, because a visitor with
   * no session has no cookie to echo. A cross-site form POST could therefore
   * log a victim into the *attacker's* account, so everything they wrote next
   * landed somewhere the attacker could read.
   */
  const attack = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://evil.example.invalid',
      'sec-fetch-site': 'cross-site',
    },
    body: `identifier=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`,
  });

  check('a cross-site sign-in is refused', attack.status === 403, `got ${attack.status}`);
  check(
    'and no session cookie is planted',
    (attack.headers.getSetCookie?.() ?? []).length === 0,
  );

  const legitimate = await call(makeJar(), '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: PASSWORD },
  });
  check('same-origin sign-in still works', legitimate.status === 200, `got ${legitimate.status}`);
}

console.log('\nRegistration does not reveal who has an account');
{
  const takenEmail = await call(null, '/api/auth/register', {
    method: 'POST',
    body: {
      username: `fresh-${uniq}`,
      email: `${USERNAME}@taskflow.local`,
      password: 'CorrectHorseBatteryStaple7',
      acceptedTerms: true,
    },
  });

  const takenUsername = await call(null, '/api/auth/register', {
    method: 'POST',
    body: {
      username: USERNAME,
      email: `fresh-${uniq}@example.invalid`,
      password: 'CorrectHorseBatteryStaple7',
      acceptedTerms: true,
    },
  });

  check(
    'a taken email and a taken username give the same answer',
    takenEmail.data?.error?.message === takenUsername.data?.error?.message,
    `${takenEmail.data?.error?.message} vs ${takenUsername.data?.error?.message}`,
  );
}

console.log('\nA delegated admin cannot rewrite policy');
{
  /*
   * Editorial settings are open to admins; the sections that govern quotas,
   * registration and the MFA requirement are not. An admin able to switch off
   * the control that binds them is not constrained by it.
   */
  const rootJar = makeJar();
  const rootLogin = await call(rootJar, '/api/auth/login', {
    method: 'POST',
    body: { identifier: USERNAME, password: PASSWORD },
  });

  if (rootLogin.status !== 200) {
    check('sign in as root', false, `got ${rootLogin.status}`);
  } else {
    const adminPassword = 'AdminProbePassphrase9';
    const created = await call(rootJar, '/api/admin/users', {
      method: 'POST',
      body: {
        username: `probeadm${uniq}`,
        email: `probeadm${uniq}@example.invalid`,
        password: adminPassword,
        role: 'admin',
      },
    });

    if (created.status !== 201 && created.status !== 200) {
      check('create a probe admin', false, `got ${created.status}`);
    } else {
      const adminJar = makeJar();
      await call(adminJar, '/api/auth/login', {
        method: 'POST',
        body: { identifier: `probeadm${uniq}`, password: adminPassword },
      });

      const editorial = await call(adminJar, '/api/admin/settings/branding', {
        method: 'PUT',
        body: { tagline: 'Edited by an admin' },
      });
      check('an admin CAN edit editorial settings', editorial.status === 200, `got ${editorial.status}`);

      for (const section of ['features', 'limits', 'about']) {
        const attempt = await call(adminJar, `/api/admin/settings/${section}`, {
          method: 'PUT',
          body: {},
        });
        check(`an admin CANNOT edit ${section}`, attempt.status === 403, `got ${attempt.status}`);
      }
    }
  }
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
