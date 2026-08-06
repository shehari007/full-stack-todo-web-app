/**
 * Support desk and contact form tests.
 *
 *   SMOKE_PASSWORD='...' npm run test:support
 *
 * The check that matters most is that an internal staff note can never reach
 * the person who opened the ticket. Everything else here is a normal feature;
 * that one is a confidentiality boundary, and it fails silently: the note
 * simply appears in a thread nobody meant to show it in.
 *
 * The contact-form section deliberately trips the anti-abuse limits, so run it
 * against a development database.
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

function section(title) {
  console.log(`\n${title}`);
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
  };
}

async function call(jar, path, options = {}) {
  const { method = 'GET', body, headers: extra } = options;
  const headers = new Headers();
  if (jar) jar.apply(headers);
  for (const [key, value] of Object.entries(extra ?? {})) headers.set(key, value);
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

const staff = makeJar();
const user = makeJar();

section('Setup');
const staffLogin = await call(staff, '/api/auth/login', {
  method: 'POST',
  body: { identifier: USERNAME, password: PASSWORD },
});

if (staffLogin.status !== 200) {
  console.error(`\nCould not sign in as ${USERNAME} (${staffLogin.status}). Is MFA enabled?\n`);
  process.exit(2);
}
check('signed in as staff', true);

const userName = `support${uniq}`;
const userPassword = 'CorrectHorseBatteryStaple7';
const registration = await call(user, '/api/auth/register', {
  method: 'POST',
  body: {
    username: userName,
    email: `${userName}@example.invalid`,
    password: userPassword,
    acceptedTerms: true,
  },
});

if (registration.status !== 201) {
  console.error(`\nCould not create a test user (${registration.status}). Is registration open?\n`);
  process.exit(2);
}
check('created a standard user', true);

/* -------------------------------------------------------------------------- */

section('A user can open a ticket');
let ticketId = null;
{
  const created = await call(user, '/api/support/tickets', {
    method: 'POST',
    body: {
      subject: `Cannot export my tasks ${uniq}`,
      category: 'Bug report',
      priority: 'high',
      message: 'The PDF export finishes but the file will not open.',
    },
  });

  check('create a ticket', created.status === 201, `got ${created.status}`);
  ticketId = created.data?.ticket?.id;
  check('  it has a reference number', typeof created.data?.ticket?.number === 'number');

  const escalated = await call(user, '/api/support/tickets', {
    method: 'POST',
    body: {
      subject: `Urgent attempt ${uniq}`,
      category: 'Bug report',
      priority: 'urgent',
      message: 'Trying to set urgent as an ordinary user.',
    },
  });
  check(
    'a user cannot self-assign urgent priority',
    escalated.status === 422 || escalated.data?.ticket?.priority !== 'urgent',
    `got ${escalated.status} priority=${escalated.data?.ticket?.priority}`,
  );
}

section('Internal notes are invisible to the requester');
{
  const SECRET = `INTERNAL-ONLY-${uniq}`;

  const note = await call(staff, `/api/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { body: `${SECRET}: suspect this is a duplicate of an earlier report.`, isInternal: true },
  });
  check('staff can add an internal note', note.status === 201, `got ${note.status}`);

  const publicReply = await call(staff, `/api/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { body: 'Thanks for the report, looking into it now.' },
  });
  check('staff can add a public reply', publicReply.status === 201, `got ${publicReply.status}`);

  const asRequester = await call(user, `/api/support/tickets/${ticketId}`);
  check('requester can read their own thread', asRequester.status === 200, `got ${asRequester.status}`);

  const requesterBlob = JSON.stringify(asRequester.data ?? {});
  check('  the internal note is ABSENT from the requester view', !requesterBlob.includes(SECRET));
  check('  the public reply IS present', requesterBlob.includes('looking into it now'));

  const asStaff = await call(staff, `/api/support/tickets/${ticketId}`);
  check('  staff still see the internal note', JSON.stringify(asStaff.data ?? {}).includes(SECRET));

  // A requester must not be able to smuggle an internal note in either.
  const forged = await call(user, `/api/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { body: 'trying to write an internal note', isInternal: true },
  });
  if (forged.status === 201) {
    const recheck = await call(staff, `/api/support/tickets/${ticketId}`);
    const messages = recheck.data?.messages ?? [];
    const smuggled = messages.find((m) => m.body?.includes('trying to write an internal note'));
    check('a requester cannot mark their own message internal', smuggled?.isInternal !== true);
  } else {
    check('a requester cannot mark their own message internal', true);
  }
}

section('Cross-user isolation');
{
  const other = makeJar();
  const otherName = `other${uniq}`;
  const reg = await call(other, '/api/auth/register', {
    method: 'POST',
    body: {
      username: otherName,
      email: `${otherName}@example.invalid`,
      password: userPassword,
      acceptedTerms: true,
    },
  });

  if (reg.status === 201) {
    const peek = await call(other, `/api/support/tickets/${ticketId}`);
    check("another user cannot read someone else's ticket", peek.status === 404 || peek.status === 403, `got ${peek.status}`);

    const reply = await call(other, `/api/support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: { body: 'butting in' },
    });
    check("another user cannot reply to someone else's ticket", reply.status === 404 || reply.status === 403, `got ${reply.status}`);

    const queue = await call(other, '/api/support/tickets?scope=all');
    const leaked = (queue.data?.tickets ?? []).some((t) => t.id === ticketId);
    check('scope=all does not expose the queue to a normal user', queue.status === 403 || !leaked, `got ${queue.status}`);
  }
}

section('Staff-only controls');
{
  const assign = await call(user, `/api/support/tickets/${ticketId}`, {
    method: 'PATCH',
    body: { priority: 'urgent', assignedToId: null },
  });
  check('a requester cannot change priority or assignment', assign.status === 403 || assign.status === 422, `got ${assign.status}`);

  const staffPatch = await call(staff, `/api/support/tickets/${ticketId}`, {
    method: 'PATCH',
    body: { status: 'pending', priority: 'urgent' },
  });
  check('staff can change status and priority', staffPatch.status === 200, `got ${staffPatch.status}`);
}

section('Contact form anti-abuse');
{
  const config = await call(null, '/api/contact/config');
  check('GET /api/contact/config is public', config.status === 200, `got ${config.status}`);

  const cfg = config.data?.config ?? {};
  const category = (cfg.categories ?? ['General question'])[0];
  const minFill = cfg.minFillSeconds ?? 3;

  const base = {
    name: 'Test Person',
    email: `contact${uniq}@example.invalid`,
    subject: `Contact probe ${uniq}`,
    category,
    message: 'A genuine enquiry sent by the test suite.',
    website: '',
  };

  /*
   * The per-IP limiter lives in the API process and runs on a one-hour window,
   * so, unlike everything else here, resetting the database does not reset
   * it. Running this suite twice inside an hour against the same server would
   * otherwise report the limiter working as four failures.
   *
   * Probing for that state and saying so is better than either tolerating 429
   * everywhere (which would hide a genuine regression) or pretending the run
   * passed. On a fresh server, which is what CI has, this never triggers.
   */
  const probe = await call(null, '/api/contact', {
    method: 'POST',
    body: { ...base, subject: `Probe ${uniq}`, startedAt: Date.now() - (minFill + 2) * 1000 },
  });

  if (probe.status === 429) {
    console.log(
      '  SKIP  the contact-form checks: this API process has already spent its\n' +
        '        hourly submission budget. Restart the server to run them again.',
    );
  } else {
    check('a genuine submission is accepted', probe.status === 201, `got ${probe.status} ${JSON.stringify(probe.data)?.slice(0, 140)}`);
    check('  it returns a reference number', typeof probe.data?.ticketNumber === 'number' || typeof probe.data?.ticket?.number === 'number');
    check('  it does not echo the message back', !JSON.stringify(probe.data ?? {}).includes('A genuine enquiry'));

    await runContactAbuseChecks(base, minFill);
  }
}

/**
 * The abuse defences, split out so the section above can skip them cleanly when
 * the limiter is already spent.
 */
async function runContactAbuseChecks(base, minFill) {
  // 1. Instant submission: a person cannot type this fast.
  const instant = await call(null, '/api/contact', {
    method: 'POST',
    body: { ...base, subject: `Instant ${uniq}`, startedAt: Date.now() },
  });
  check(
    'an instant submission is rejected',
    instant.status >= 400 && instant.status !== 429,
    `got ${instant.status}`,
  );

  // 2. Honeypot filled. Must LOOK like success while writing nothing.
  const trapped = await call(null, '/api/contact', {
    method: 'POST',
    body: {
      ...base,
      subject: `HONEYPOT-${uniq}`,
      website: 'http://spam.example',
      startedAt: Date.now() - (minFill + 2) * 1000,
    },
  });
  check('a honeypot submission is not rejected outright', trapped.status < 400, `got ${trapped.status}`);

  /*
   * 3. The queue is the source of truth for what was actually written.
   *
   * The honeypot returning 200 proves only that it does not announce itself;
   * this is the check that proves it discarded the submission. The probe from
   * the caller above is the genuine one, and it must be here.
   */
  const queue = await call(staff, '/api/support/tickets?scope=all&pageSize=100');
  const queueBlob = JSON.stringify(queue.data ?? {});
  check('the honeypot submission was never stored', !queueBlob.includes(`HONEYPOT-${uniq}`));
  check('the genuine submission IS in the queue', queueBlob.includes(`Probe ${uniq}`));

  // 4. Per-hour cap.
  let limited = false;
  for (let i = 0; i < 8; i += 1) {
    const attempt = await call(null, '/api/contact', {
      method: 'POST',
      body: {
        ...base,
        subject: `Flood ${uniq}-${i}`,
        startedAt: Date.now() - (minFill + 2) * 1000,
      },
    });
    if (attempt.status === 429) {
      limited = true;
      break;
    }
  }
  check('repeated submissions from one address are capped', limited);
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
