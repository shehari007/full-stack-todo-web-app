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
import { isProduction } from '../config/env.js';
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
