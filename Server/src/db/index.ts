/**
 * Database client.
 *
 * Exactly one `pg.Pool` exists for the whole process. v1 created a new Sequelize
 * instance inside every model file, so each model held its own pool and the
 * connection count grew with the number of models, which Supabase's connection
 * cap punishes quickly. Import `db` from here and nowhere else.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env, isServerless } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

const { Pool } = pg;

/**
 * `bigint` columns arrive as strings by default because a 64-bit integer does
 * not fit in a JS number. Our bigints are byte counts well under 2^53, so
 * parsing them to numbers is safe and keeps arithmetic simple.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

/**
 * The connection string this process should actually use.
 *
 * Serverless against a session-mode pooler is the one combination that cannot
 * work. Session mode gives every client its own server connection and holds it
 * for the life of that connection, while the number of clients is "however many
 * instances the platform decided to keep warm". Supabase allows 15, so a
 * handful of warm functions exhausts it and then *every* request fails with
 * `EMAXCONNSESSION`, including ones that only wanted to read a single settings
 * row, because what failed was acquiring a connection rather than running a
 * query.
 *
 * Transaction mode (port 6543) multiplexes many clients onto few server
 * connections, which is exactly this shape of deployment. It is safe here
 * because nothing calls drizzle's `.prepare()`, so every statement is unnamed
 * and can move between backends freely.
 *
 * This is corrected rather than merely warned about because the correct value
 * depends on where the process is running, not on what the operator intended:
 * the same connection string is right locally and wrong on Vercel. Migrations
 * still need session mode, and they never run here, so the rewrite is confined
 * to serverless. Set `DATABASE_NO_POOL_UPGRADE=true` to opt out.
 */
function resolveConnectionString(): string {
  if (!isServerless() || process.env.DATABASE_NO_POOL_UPGRADE === 'true') {
    return env.DATABASE_URL;
  }

  const url = new URL(env.DATABASE_URL);
  const onSessionPort = url.port === '5432' || url.port === '';

  if (!/pooler\.supabase\.com$/i.test(url.hostname) || !onSessionPort) {
    return env.DATABASE_URL;
  }

  url.port = '6543';

  logger.warn(
    { hostname: url.hostname, from: 5432, to: 6543 },
    'Serverless runtime detected against the Supabase session pooler. Using the transaction ' +
      'pooler on 6543 instead, because session mode runs out of connections at around 15 warm ' +
      'instances. Set DATABASE_NO_POOL_UPGRADE=true to keep 5432.',
  );

  return url.toString();
}

export const pool = new Pool({
  connectionString: resolveConnectionString(),
  max: env.DATABASE_POOL_MAX,
  /*
   * Idle connections are given up quickly on serverless.
   *
   * An instance sits idle between invocations while still holding whatever it
   * opened, and those connections count against the provider's global limit the
   * whole time. Releasing after ten seconds lets a frozen instance stop
   * squatting on a slot another one needs. A long-running server has the
   * opposite incentive and keeps them.
   */
  idleTimeoutMillis: isServerless() ? 10_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  /**
   * Hosted Postgres (Supabase, Neon, Railway) terminates TLS at a proxy whose
   * certificate does not match the connection host, so verification is relaxed
   * here. The transport is still encrypted. Local Postgres needs no TLS at all.
   */
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (error) => {
  // An idle client failing is recoverable: pg discards it and opens another.
  logger.error({ err: error }, 'Unexpected database pool error');
});

export const db = drizzle(pool, {
  schema,
  logger: env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace',
});

export type Database = typeof db;

/** Verify connectivity at boot so a bad URL fails loudly instead of per-request. */
export async function verifyConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function closeConnection(): Promise<void> {
  await pool.end();
}

export * from './schema.js';
