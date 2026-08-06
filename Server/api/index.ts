/**
 * Vercel serverless entry point.
 *
 * Vercel invokes an exported request handler rather than running `listen`, so
 * this exports the configured app instead of starting a server. Everything
 * else (routes, middleware, the connection pool) is identical to `src/index.ts`.
 *
 * Two things behave differently on serverless and are worth knowing before you
 * deploy this way:
 *
 *  - **Connection pooling.** Each warm instance holds its own pool, so total
 *    connections scale with concurrency. Point DATABASE_URL at Supabase's
 *    session pooler (port 5432) and keep DATABASE_POOL_MAX small, around 1 to 3.
 *
 *  - **Rate limiting.** The default limiter stores counters in process memory,
 *    which is per-instance. Under real traffic the effective limit is multiplied
 *    by the number of live instances. For anything public, add a shared store;
 *    see docs/DEPLOYMENT.md.
 *
 * A single long-running container (Railway, Render, Fly, Docker) avoids both
 * and is the recommended way to run this API.
 */
import { createApp } from '../src/app.js';

export default createApp();
