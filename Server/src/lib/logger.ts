/**
 * Structured logging.
 *
 * Pretty-printed and human-readable in development; newline-delimited JSON in
 * production so log aggregators can index it. The redaction list is not
 * optional. Without it, a request-body log would write plaintext passwords and
 * bearer tokens to disk.
 */
import { pino } from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  '*.password',
  'token',
  'accessToken',
  'refreshToken',
  'mfaSecret',
  'mfaCode',
  'recoveryCode',
  'recoveryCodes',
  'passwordHash',
];

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  ...(isProduction
    ? {
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      }
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

export type Logger = typeof logger;
