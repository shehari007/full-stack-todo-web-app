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

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
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

/*
 * Serverless against a session-mode pooler is the combination that runs out of
 * connections.
 *
 * Session mode gives every client its own server connection and holds it for
 * the life of that connection, which is exactly wrong when the number of
 * clients is "however many instances the platform decided to keep warm".
 * Supabase allows 15; a handful of warm functions reaches it and then every
 * endpoint fails with EMAXCONNSESSION, including trivial ones, because the
 * failure is getting a connection rather than running a query.
 *
 * Transaction mode multiplexes many clients onto few server connections, which
 * is what this shape of deployment needs. It is safe here because nothing calls
 * drizzle's `.prepare()`, so every statement is unnamed.
 *
 * Warned rather than switched automatically: migrations need session mode, and
 * silently rewriting someone's connection string is worse than telling them.
 */
if (isServerless()) {
  const { hostname, port } = new URL(env.DATABASE_URL);
  const sessionModePort = port === '5432' || port === '';

  if (/pooler\.supabase\.com$/i.test(hostname) && sessionModePort) {
    logger.warn(
      { hostname, port: port || '5432' },
      'Running on serverless against the Supabase session pooler (port 5432). Each warm ' +
        'instance holds its own connection, so this runs out at around 15 and every request ' +
        'starts failing with EMAXCONNSESSION. Point DATABASE_URL at port 6543 (the transaction ' +
        'pooler) for the deployed function, and keep 5432 for running migrations.',
    );
  }
}

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
