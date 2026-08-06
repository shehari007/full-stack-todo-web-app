/**
 * Environment configuration.
 *
 * Every setting the server reads is declared and validated here exactly once.
 * If something is missing or weak the process exits at boot with an actionable
 * message, rather than failing later at request time with a confusing error.
 */
import 'dotenv/config';
import { z } from 'zod';

/** Comma-separated string -> trimmed, non-empty array. */
const csv = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean));

/** Secrets must be long enough that brute-forcing a signature is not viable. */
const secret = z
  .string()
  .min(32, 'must be at least 32 characters. Generate one with: npm run gen:secret');

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const bytes = z.coerce.number().int().positive();

/**
 * Whether this process is a short-lived function invocation rather than a
 * long-running server.
 *
 * Read from the platform's own variables. Vercel, AWS Lambda and Netlify each
 * set one, and none of them are set by a container or a laptop.
 */
export function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ??
      process.env.AWS_LAMBDA_FUNCTION_NAME ??
      process.env.NETLIFY ??
      process.env.FUNCTIONS_WORKER_RUNTIME,
  );
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Number of reverse proxies in front of the app, or `false` when there are none.
   * This is a security setting, not a convenience one: Express derives `req.ip`
   * from it, and `req.ip` is the rate-limiter key. Setting it too high on a
   * directly-exposed server lets a client spoof `X-Forwarded-For` and bypass
   * every limit. Vercel/Railway/Render = 1, bare Node behind nothing = false.
   */
  TRUST_PROXY: z
    .union([z.literal('false'), z.coerce.number().int().min(0).max(10)])
    .default(0)
    .transform((value) => (value === 'false' ? false : Number(value))),

  /** Postgres connection string. `SEQ_CONNECTION` is accepted for v1 compatibility. */
  DATABASE_URL: z.string().url('must be a postgres:// connection string'),
  /** Supabase and most hosted Postgres require TLS; local Postgres usually does not. */
  DATABASE_SSL: booleanish.default(false),
  /**
   * Connections this process may hold.
   *
   * The default is per-process, and on serverless that is the wrong unit: every
   * warm instance keeps its own pool, so the number that reaches the database is
   * this value multiplied by however many instances are alive. Supabase's
   * session pooler allows 15 in total, and a single analytics request fans out
   * to five queries at once, so a default of 10 exhausts the limit at two or
   * three concurrent instances with `EMAXCONNSESSION`.
   *
   * One is the right default there. A serverless instance serves one request at
   * a time, so a larger pool buys nothing except parallelism inside a single
   * request, and pays for it with connections every other instance then cannot
   * have.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(isServerless() ? 1 : 10),

  /** Signing keys. Access and refresh are separate so leaking one does not grant the other. */
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  /** AES-256-GCM key protecting TOTP secrets at rest. Base64, decodes to exactly 32 bytes. */
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'must be 32 bytes of base64. Generate one with: npm run gen:secret',
    }),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Exact origins allowed to send credentialed requests. No wildcards: cookies are in play. */
  ALLOWED_ORIGINS: csv.default(['http://localhost:3000']),
  /** Public URL of the web app, used for absolute links in exports and emails. */
  APP_URL: z.string().url().default('http://localhost:3000'),

  COOKIE_DOMAIN: z.string().optional(),
  /** Must be true in production: without it refresh cookies travel in plaintext. */
  COOKIE_SECURE: booleanish.default(false),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),

  /** Upload ceilings. Per-user values are also stored in site settings and enforced per role. */
  MAX_UPLOAD_BYTES: bytes.default(1024 * 1024), // 1 MB, as specified
  USER_STORAGE_QUOTA_BYTES: bytes.default(25 * 1024 * 1024), // 25 MB per standard user
  ROOT_STORAGE_QUOTA_BYTES: bytes.default(512 * 1024 * 1024), // 512 MB for root/admin

  /** Bootstrap credentials for the root account, consumed by `npm run db:seed`. */
  ROOT_USERNAME: z.string().min(3).max(32).default('root'),
  ROOT_EMAIL: z.string().email().default('root@taskflow.local'),
  ROOT_PASSWORD: z.string().min(12, 'root password must be at least 12 characters').optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  // v1 used SEQ_CONNECTION. Accept it so existing .env files keep working.
  if (!process.env.DATABASE_URL && process.env.SEQ_CONNECTION) {
    process.env.DATABASE_URL = process.env.SEQ_CONNECTION;
  }

  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    process.stderr.write(
      `\nInvalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.\n\n`,
    );
    process.exit(1);
  }

  const env = parsed.data;

  // Cross-field rules that a per-field schema cannot express.
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];

    if (!env.COOKIE_SECURE) {
      problems.push('COOKIE_SECURE must be true in production (cookies would be sent over HTTP).');
    }
    if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
      problems.push('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.');
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
    }
    if (env.ALLOWED_ORIGINS.some((origin) => origin === '*')) {
      problems.push('ALLOWED_ORIGINS cannot contain "*": credentialed CORS forbids wildcards.');
    }
    if (env.ALLOWED_ORIGINS.some((origin) => origin.startsWith('http://'))) {
      problems.push('ALLOWED_ORIGINS should use https:// in production.');
    }

    if (problems.length > 0) {
      process.stderr.write(
        `\nUnsafe production configuration:\n${problems.map((p) => `  • ${p}`).join('\n')}\n\n`,
      );
      process.exit(1);
    }
  }

  return env;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
