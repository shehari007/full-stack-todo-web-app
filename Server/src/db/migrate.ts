/**
 * Apply pending migrations.
 *
 * Forward-only, run with `npm run db:migrate`. Drizzle records what it has
 * applied in a `__drizzle_migrations` table, so re-running is safe.
 *
 * This deliberately replaces v1's `sequelize.sync({ alter: true })`. `alter`
 * inspects the live schema and guesses at the DDL needed to reach the model
 * definition, which on PostgreSQL can silently drop a column when a type
 * changes. Versioned migrations are reviewable, repeatable and reversible.
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeConnection } from './index.js';
import { ensureDatabase } from './ensure-database.js';
import { rootErrorCode, waitForHostname, withRetry } from './preflight.js';
import { logger } from '../lib/logger.js';

async function main(): Promise<void> {
  try {
    await waitForHostname();
  } catch (error) {
    logger.fatal((error as Error).message);
    process.exit(1);
  }

  try {
    // Creating the database has to happen on its own connection, before the
    // pool in ./index.js tries to reach a database that may not exist yet.
    await ensureDatabase();
  } catch (error) {
    // A wrong database name or an unreachable host is a configuration problem,
    // and its message is written to be read. Do not bury it in a stack trace.
    const code = rootErrorCode(error);
    logger.fatal(code ? `${(error as Error).message} (${code})` : (error as Error).message);
    process.exit(1);
  }

  logger.info('Applying migrations...');

  try {
    await withRetry('migrate', () => migrate(db, { migrationsFolder: './drizzle' }));
    logger.info('Migrations applied');
  } catch (error) {
    logger.fatal({ err: error }, 'Migration failed');
    await closeConnection();
    process.exit(1);
  }

  await closeConnection();
  process.exit(0);
}

void main();
