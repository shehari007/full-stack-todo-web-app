/**
 * Express application assembly.
 *
 * Kept separate from `index.ts` so tests can import a configured app without
 * binding a port, and so serverless adapters can export it directly.
 *
 * Middleware order is significant and is commented where it matters.
 */
import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { csrfProtection, maintenanceGate, optionalAuth } from './middleware/auth.js';
import { generalLimiter } from './middleware/rate-limit.js';
import routes from './routes.js';

/**
 * Routes that receive raw bytes instead of JSON.
 *
 * `express.json()` parses any request whose Content-Type is `application/json`,
 * which would silently consume the body of an uploaded `.json` file before the
 * route's raw parser ever saw it. Skipping these paths at the top level is the
 * simplest fix that does not weaken parsing anywhere else.
 */
const RAW_BODY_PATHS = [
  /^\/api\/attachments\/todos\/[^/]+$/,
  /^\/api\/profile\/avatar$/,
  /^\/api\/admin\/assets$/,
];

function isRawBodyRoute(path: string, method: string): boolean {
  return method === 'POST' && RAW_BODY_PATHS.some((pattern) => pattern.test(path));
}

export function createApp(): Express {
  const app = express();

  /*
   * How many proxies to trust when deriving req.ip. Set from configuration
   * rather than hardcoded to 1, because `trust proxy` on a directly-exposed
   * server lets any client spoof X-Forwarded-For and defeat rate limiting.
   */
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  // Ensures a cached response keyed on Origin is not replayed to another origin.
  app.set('etag', 'strong');

  /* --- Request correlation --------------------------------------------- */

  app.use((req, res, next) => {
    // Honour an upstream id when the proxy sets one, so a trace spans both hops.
    req.id = req.get('x-request-id') ?? randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
      // Health checks would otherwise dominate the log volume.
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  /* --- Security headers ------------------------------------------------- */

  app.use(
    helmet({
      /*
       * This origin serves JSON and user-uploaded file bytes, never HTML that
       * should run scripts. Locking CSP to `default-src 'none'` means that even
       * if a hostile file slipped past upload validation and were rendered,
       * it could not load scripts, frames or make network calls.
       */
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          sandbox: ['allow-downloads'],
        },
      },
      // Attachments are fetched by the web app on another origin during dev.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  /* --- CORS ------------------------------------------------------------- */

  app.use(
    cors({
      /*
       * An explicit allowlist with `credentials: true`. The spec forbids
       * pairing credentials with `*`, and v1's vercel.json quietly set
       * `Access-Control-Allow-Origin: *`, which overrode the allowlist it was
       * configured with.
       */
      origin(origin, callback) {
        // Same-origin, curl and server-to-server requests send no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, env.ALLOWED_ORIGINS.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Filename', 'X-Request-Id'],
      exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  /* --- Body parsing ----------------------------------------------------- */

  const jsonParser = express.json({ limit: '256kb' });
  const formParser = express.urlencoded({ extended: false, limit: '64kb' });

  app.use((req, res, next) => {
    if (isRawBodyRoute(req.path, req.method)) {
      next();
      return;
    }
    jsonParser(req, res, (error) => (error ? next(error) : formParser(req, res, next)));
  });

  /* --- Auth context ----------------------------------------------------- */

  /*
   * Resolved before the rate limiter so limits can be keyed per user rather
   * than per IP, and before the CSRF guard so it knows whether credentials
   * arrived by cookie or bearer token.
   */
  app.use(optionalAuth);
  app.use(csrfProtection);
  app.use(generalLimiter);

  /* --- Health ----------------------------------------------------------- */

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'TaskFlow API',
      version: process.env.npm_package_version ?? '2.0.0',
      status: 'ok',
      docs: 'https://github.com/shehari007/full-stack-todo-web-app/blob/main/docs/API.md',
    });
  });

  /* --- API -------------------------------------------------------------- */

  app.use('/api', maintenanceGate, routes);

  /* --- Fallbacks -------------------------------------------------------- */

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
