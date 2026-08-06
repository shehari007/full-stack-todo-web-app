/**
 * Create the target database if it does not exist yet.
 *
 * v1's `setupDb.js` did this, and dropping it made first-time setup fail with a
 * bare `database "taskflow" does not exist`, which is a poor welcome. Drizzle
 * has no equivalent because `CREATE DATABASE` cannot run inside a transaction
 * or a migration. It has to happen on a separate connection, before migrating.
 *
 * Runs automatically as the first step of `npm run db:migrate`.
 */
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Quote an identifier for interpolation into DDL.
 *
 * `CREATE DATABASE` cannot take a bound parameter, so the name has to be
 * inlined. Postgres escapes a double quote inside a quoted identifier by
 * doubling it, which is what this does. The database name comes from the
 * operator's own connection string, but a name containing a quote would
 * otherwise produce broken SQL.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Hosts that hand out a fixed database name rather than letting you choose one.
 *
 * Matched on the hostname because that is the only signal available before a
 * connection succeeds. The list is not exhaustive, and it does not need to be:
 * anything unmatched simply falls through to the normal create-if-missing path.
 */
function isManagedHost(hostname: string): boolean {
  return /\.(supabase\.(com|co|net)|neon\.tech|render\.com|railway\.app)$/i.test(hostname);
}

export async function ensureDatabase(): Promise<void> {
  const url = new URL(env.DATABASE_URL);
  const databaseName = decodeURIComponent(url.pathname.slice(1));

  if (!databaseName) {
    throw new Error('DATABASE_URL has no database name in its path');
  }

  /*
   * Connect to `postgres`, the maintenance database that every server has, in
   * order to ask about (and possibly create) the real one.
   */
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({
    connectionString: adminUrl.toString(),
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  try {
    await admin.connect();
  } catch (error) {
    /*
     * Managed providers (Supabase, Neon, RDS) frequently refuse a connection to
     * `postgres`, or hand out a role with no CREATEDB right. On those the
     * database always exists already, so this is not fatal. Carry on and let
     * the migration itself report a genuine connectivity problem.
     */
    logger.debug(
      { err: error },
      'Could not connect to the maintenance database; assuming the target database already exists',
    );
    return;
  }

  /*
   * Managed Postgres does not let you pick the database name.
   *
   * Supabase's pooler routes on the *username* (`postgres.<project-ref>`) and
   * only ever serves the `postgres` database; Neon and several others behave
   * the same way. Someone who sets `/taskflow_v2` in the URL because it reads
   * better gets `3D000 database "taskflow_v2" does not exist` from the migrator
   * with nothing to suggest the name was the problem.
   *
   * Creating it is not the answer either, so say what is actually wrong.
   */
  if (isManagedHost(url.hostname) && databaseName !== 'postgres') {
    await admin.end().catch(() => {});
    throw new Error(
      `The database in DATABASE_URL is "${databaseName}", but ${url.hostname} only serves a ` +
        `database called "postgres".\n\n` +
        `  Managed Postgres providers route by the username (yours is "${url.username}"), ` +
        `not by the database name, and the name cannot be changed.\n` +
        `  Change the end of DATABASE_URL from "/${databaseName}" to "/postgres" and run this again.\n\n` +
        `  Your tables are still kept apart from anyone else's: the project ref in the ` +
        `username is what isolates them.`,
    );
  }

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if (existing.rowCount && existing.rowCount > 0) {
      logger.debug({ database: databaseName }, 'Database already exists');
      return;
    }

    logger.info({ database: databaseName }, 'Database not found, creating it');
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    logger.info({ database: databaseName }, 'Database created');
  } catch (error) {
    const code = (error as { code?: string }).code;

    // 42P04: another process created it between our check and our CREATE.
    if (code === '42P04') {
      logger.debug({ database: databaseName }, 'Database was created concurrently');
      return;
    }

    // 42501: the role lacks CREATEDB. Explain the fix rather than dumping the error.
    if (code === '42501') {
      logger.warn(
        { database: databaseName },
        `The database "${databaseName}" does not exist and this role may not create it. ` +
          `Create it manually, e.g.  createdb ${databaseName}`,
      );
      return;
    }

    throw error;
  } finally {
    await admin.end().catch(() => {
      /* Closing the throwaway admin connection must never mask a real error. */
    });
  }
}
