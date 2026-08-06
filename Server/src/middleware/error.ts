/**
 * Error handling.
 *
 * Every failure leaves the API in the same envelope:
 *
 *   { "error": { "code": "NOT_FOUND", "message": "...", "details": ... } }
 *
 * so the web app can branch on a stable `code` rather than parsing prose.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { env, isProduction, isServerless } from '../config/env.js';
import { logger } from '../lib/logger.js';

/** Terminal 404 for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    },
  });
};

/** Flatten a ZodError into `{ "field.path": ["message"] }` for form display. */
function formatZodError(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}

/** Postgres error codes that map to a meaningful HTTP status. */
const PG_ERROR_STATUS: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'CONFLICT', message: 'That value is already taken' },
  '23503': { status: 409, code: 'CONFLICT', message: 'That record is still referenced elsewhere' },
  '23502': { status: 400, code: 'BAD_REQUEST', message: 'A required field was missing' },
  '22001': { status: 400, code: 'BAD_REQUEST', message: 'A value was too long' },
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  /*
   * The connection pool is exhausted.
   *
   * Worth its own branch because the provider's wording ("max clients reached
   * in session mode") describes their side of the problem and says nothing
   * about the cause, which is almost always a per-process pool sized for a
   * long-running server while running on serverless, where every warm instance
   * keeps its own. Returning 503 is also more honest than 500: the request did
   * not fail, it was never given a connection, and retrying may well work.
   */
  const poolExhausted =
    typeof (err as Error)?.message === 'string' &&
    /max clients|too many clients|EMAXCONN|remaining connection slots/i.test(
      (err as Error).message,
    );

  if (poolExhausted) {
    logger.error(
      { err, requestId: req.id, poolMax: env.DATABASE_POOL_MAX, serverless: isServerless() },
      isServerless()
        ? 'Database connection pool exhausted. Each serverless instance holds its own pool, ' +
            'so the total reaching the database is DATABASE_POOL_MAX times the number of live ' +
            'instances. Lower DATABASE_POOL_MAX (1 is right for serverless), or move to the ' +
            'provider transaction pooler.'
        : 'Database connection pool exhausted. Raise DATABASE_POOL_MAX, or find the query ' +
            'holding connections open.',
    );

    res.setHeader('Retry-After', '2');
    res.status(503).json({
      error: {
        code: 'INTERNAL',
        message: 'The server is briefly out of database connections. Please try again.',
        requestId: req.id,
      },
    });
    return;
  }

  /* --- Errors we raised deliberately --- */
  if (err instanceof AppError) {
    logger[err.expected ? 'warn' : 'error'](
      { err, requestId: req.id, path: req.path, code: err.code },
      err.message,
    );
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  /* --- Validation --- */
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields need attention',
        details: formatZodError(err),
      },
    });
    return;
  }

  /* --- Database --- */
  const pgCode = (err as { code?: string })?.code;
  if (pgCode && PG_ERROR_STATUS[pgCode]) {
    const mapped = PG_ERROR_STATUS[pgCode];
    logger.warn({ err, requestId: req.id, pgCode }, 'Database constraint violation');
    res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
    return;
  }

  /* --- Malformed JSON body --- */
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON' },
    });
    return;
  }

  /* --- Body larger than the configured limit --- */
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
    return;
  }

  /* --- Anything else is a bug --- */
  logger.error({ err, requestId: req.id, path: req.path }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong on our end',
      // The stack is a disclosure risk, so it is development-only. The request
      // id is always returned so a user can quote it when reporting a problem.
      ...(isProduction ? {} : { stack: (err as Error)?.stack }),
      requestId: req.id,
    },
  });
};
