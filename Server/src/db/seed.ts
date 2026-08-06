/**
 * Bootstrap the installation.
 *
 *   npm run db:seed              create the root account and default settings
 *   npm run db:seed -- --demo    also add a demo user and sample tasks
 *   npm run db:seed -- --force   reset the existing root account's password
 *
 * Idempotent: running it twice does not create a second root or overwrite
 * settings an administrator has customised.
 *
 * v1 seeded `admin` / `admin123` and printed the credentials in the README,
 * meaning every deployment of it shipped with the same publicly known password.
 * Here the password comes from the environment, or is randomly generated and
 * shown exactly once.
 */
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, closeConnection } from './index.js';
import { rootErrorCode, waitForHostname, withRetry } from './preflight.js';
import { siteSettings, todos, users } from './schema.js';
import { hashPassword } from '../lib/password.js';
import { env } from '../config/env.js';
import { SETTINGS_KEYS, SETTINGS_REGISTRY, defaultsFor } from '../config/settings.js';

const args = new Set(process.argv.slice(2));
const withDemo = args.has('--demo');
const force = args.has('--force');

/** Readable but strong: 24 base64url characters is ~144 bits. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

function banner(lines: string[]): void {
  const width = Math.max(...lines.map((line) => line.length)) + 4;
  const edge = '─'.repeat(width);
  process.stdout.write(`\n┌${edge}┐\n`);
  for (const line of lines) {
    process.stdout.write(`│  ${line.padEnd(width - 4)}  │\n`);
  }
  process.stdout.write(`└${edge}┘\n\n`);
}

/* -------------------------------------------------------------------------- */

async function seedSettings(): Promise<void> {
  /*
   * Only inserts sections that are missing. `onConflictDoNothing` is what makes
   * re-running safe: an administrator's customised branding must survive a
   * redeploy that happens to run the seed again.
   */
  const rows = SETTINGS_KEYS.map((key) => ({
    key,
    value: defaultsFor(key),
    isPublic: SETTINGS_REGISTRY[key].isPublic,
  }));

  await db.insert(siteSettings).values(rows).onConflictDoNothing({ target: siteSettings.key });

  /*
   * Seed the byte limits from the environment on first run, so an operator who
   * set MAX_UPLOAD_BYTES gets what they asked for. After this the database is
   * authoritative and the control panel is the way to change them.
   */
  const [limitsRow] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'limits'))
    .limit(1);

  if (limitsRow) {
    const current = limitsRow.value as Record<string, unknown>;
    await db
      .update(siteSettings)
      .set({
        value: {
          ...current,
          maxUploadBytes: env.MAX_UPLOAD_BYTES,
          userStorageQuotaBytes: env.USER_STORAGE_QUOTA_BYTES,
          privilegedStorageQuotaBytes: env.ROOT_STORAGE_QUOTA_BYTES,
        },
      })
      .where(eq(siteSettings.key, 'limits'));
  }

  process.stdout.write(`  ✓ Settings ready (${SETTINGS_KEYS.length} sections)\n`);
}

async function seedRoot(): Promise<void> {
  const username = env.ROOT_USERNAME.toLowerCase();
  const email = env.ROOT_EMAIL.toLowerCase();

  const [existing] = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.role, 'root'))
    .limit(1);

  if (existing && !force) {
    process.stdout.write(
      `  ✓ Root account already exists (${existing.username}), leaving it alone\n` +
        `    Use "npm run db:seed -- --force" to reset its password.\n`,
    );
    return;
  }

  const generated = !env.ROOT_PASSWORD;
  const password = env.ROOT_PASSWORD ?? generatePassword();
  const passwordHash = await hashPassword(password);

  if (existing) {
    await db
      .update(users)
      .set({
        passwordHash,
        status: 'active',
        failedLoginCount: 0,
        lockedUntil: null,
        // Invalidates every outstanding token for the account.
        tokensValidFrom: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));

    banner([
      'ROOT PASSWORD RESET',
      '',
      `Username: ${existing.username}`,
      `Password: ${password}`,
      '',
      generated ? 'This password was generated and is shown only once.' : 'From ROOT_PASSWORD.',
      'All existing sessions for this account have been signed out.',
    ]);
    return;
  }

  await db.insert(users).values({
    username,
    email,
    passwordHash,
    displayName: 'Root Administrator',
    role: 'root',
    status: 'active',
    storageQuotaBytes: env.ROOT_STORAGE_QUOTA_BYTES,
  });

  banner([
    'ROOT ACCOUNT CREATED',
    '',
    `Username: ${username}`,
    `Email:    ${email}`,
    `Password: ${password}`,
    '',
    generated
      ? 'Generated password. Copy it now, because it is not stored anywhere.'
      : 'Password taken from ROOT_PASSWORD in your .env.',
    '',
    'Next: sign in, then enable multi-factor authentication',
    'from Security settings before exposing this to the internet.',
  ]);
}

async function seedDemo(): Promise<void> {
  const demoUsername = 'demo';

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, demoUsername))
    .limit(1);

  if (existing) {
    process.stdout.write('  ✓ Demo user already exists, skipping\n');
    return;
  }

  const password = generatePassword();

  const [demo] = await db
    .insert(users)
    .values({
      username: demoUsername,
      email: 'demo@taskflow.local',
      passwordHash: await hashPassword(password),
      displayName: 'Demo User',
      role: 'user',
    })
    .returning({ id: users.id });

  if (!demo) return;

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  await db.insert(todos).values([
    {
      userId: demo.id,
      title: 'Welcome to TaskFlow',
      description:
        'This is a sample task. Open it to see descriptions, tags, priorities and file attachments.',
      status: 'done',
      priority: 'low',
      completedAt: new Date(now - day),
      tags: ['getting-started'],
      position: 0,
    },
    {
      userId: demo.id,
      title: 'Try filtering and search',
      description: 'Use the filter bar to narrow by status, priority, tags or due date.',
      status: 'in_progress',
      priority: 'medium',
      dueAt: new Date(now + day),
      tags: ['getting-started'],
      position: 1,
    },
    {
      userId: demo.id,
      title: 'Export your tasks as a branded PDF',
      description: 'The export menu produces A4 PDF, CSV, Excel, JSON, Markdown and calendar files.',
      status: 'todo',
      priority: 'high',
      dueAt: new Date(now + 3 * day),
      tags: ['getting-started', 'exports'],
      position: 2,
    },
    {
      userId: demo.id,
      title: 'This one is overdue on purpose',
      description: 'Overdue tasks are highlighted on the dashboard.',
      status: 'todo',
      priority: 'urgent',
      dueAt: new Date(now - 2 * day),
      tags: ['demo'],
      position: 3,
    },
  ]);

  banner(['DEMO ACCOUNT', '', `Username: ${demoUsername}`, `Password: ${password}`]);
}

async function main(): Promise<void> {
  process.stdout.write('\nSeeding TaskFlow...\n\n');

  try {
    await waitForHostname();
  } catch (error) {
    process.stderr.write(`\n${(error as Error).message}\n\n`);
    process.exit(1);
  }

  try {
    /*
     * A missing migration is the usual cause of a confusing seed failure.
     *
     * Wrapped in the retry because this is the first query to open a pooled
     * connection, so a flaky resolver surfaces here rather than during the
     * migration that ran moments earlier.
     */
    const [{ present } = { present: false }] = await withRetry('seed preflight', () =>
      db
        .execute<{ present: boolean }>(sql`SELECT to_regclass('public.users') IS NOT NULL AS present`)
        .then((result) => result.rows as Array<{ present: boolean }>),
    );

    if (!present) {
      process.stderr.write(
        '\nThe "users" table does not exist. Run migrations first:\n\n  npm run db:migrate\n\n',
      );
      await closeConnection();
      process.exit(1);
    }

    await seedSettings();
    await seedRoot();
    if (withDemo) await seedDemo();

    process.stdout.write('Done.\n\n');
  } catch (error) {
    // Name the underlying code. Drizzle reports "Failed query: SELECT ..." and
    // keeps the real cause several `cause` links down, which sends people
    // looking at the SQL when the actual problem was the network.
    const code = rootErrorCode(error);
    process.stderr.write(
      `\nSeed failed: ${(error as Error).message}${code ? ` [${code}]` : ''}\n\n`,
    );
    await closeConnection();
    process.exit(1);
  }

  await closeConnection();
  process.exit(0);
}

void main();
