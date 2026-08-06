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
import { env } from '../config/env.js';
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
  idleTimeoutMillis: 30_000,
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
