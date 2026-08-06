/**
 * Application error types.
 *
 * Route handlers throw these; the error middleware turns them into responses.
 * The important property is that every error carries a `status` and a stable
 * machine-readable `code`, so the web app can branch on `code` instead of
 * pattern-matching on English prose that may change.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'MFA_REQUIRED'
  | 'MFA_INVALID'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /**
   * Marks errors that are a normal part of operation (a bad password, a missing
   * record). The error handler logs these at `warn` and everything else at
   * `error`, which keeps genuine faults visible instead of buried.
   */
  readonly expected: boolean;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; expected?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expected = options.expected ?? status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

/* Convenience constructors. These read better at the call site than `new AppError(404, ...)`. */

export const badRequest = (message = 'Bad request', details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, { details });

export const validationFailed = (details: unknown, message = 'Validation failed') =>
  new AppError(422, 'VALIDATION_FAILED', message, { details });

export const unauthorized = (message = 'Authentication required', code: ErrorCode = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message = 'That already exists') =>
  new AppError(409, 'CONFLICT', message);

export const payloadTooLarge = (message: string) =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', message);

export const unsupportedMediaType = (message: string) =>
  new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);

export const quotaExceeded = (message: string, details?: unknown) =>
  new AppError(413, 'QUOTA_EXCEEDED', message, { details });

export const internal = (message = 'Internal server error', cause?: unknown) =>
  new AppError(500, 'INTERNAL', message, { cause, expected: false });
