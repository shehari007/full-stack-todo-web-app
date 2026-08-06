/**
 * Server entry point.
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeConnection, verifyConnection } from './db/index.js';

async function main(): Promise<void> {
  // Fail at boot on a bad connection string rather than on the first request.
  try {
    await verifyConnection();
    logger.info('Database connection verified');
  } catch (error) {
    logger.fatal({ err: error }, 'Cannot reach the database. Check DATABASE_URL');
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, origins: env.ALLOWED_ORIGINS },
      `TaskFlow API listening on http://localhost:${env.PORT}`,
    );
  });

  /**
   * Graceful shutdown.
   *
   * On deploy the platform sends SIGTERM and then kills the process. Closing
   * the listener first stops new connections while in-flight requests finish,
   * so a deploy does not turn into a burst of 502s. The timer is a backstop for
   * a request that hangs.
   */
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down');

    const force = setTimeout(() => {
      logger.error('Shutdown timed out after 10s, exiting immediately');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(async () => {
      try {
        await closeConnection();
      } catch (error) {
        logger.warn({ err: error }, 'Error while closing the database pool');
      }
      clearTimeout(force);
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  /*
   * A rejected promise nobody handled has left the process in an unknown state.
   * Log it and exit so the supervisor restarts cleanly, rather than continuing
   * to serve traffic from a half-broken instance.
   */
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

void main();
