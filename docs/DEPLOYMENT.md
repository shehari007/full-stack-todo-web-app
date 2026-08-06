# Deployment

TaskFlow is two deployable units and one database:

- **`Server/`**: the Express 5 API. Stateless apart from its Postgres connection pool.
- **`Frontend/`**: the Next.js 16 web app. It proxies `/api/*` to the API, so the browser only ever talks to one origin.
- **PostgreSQL 13 or newer.** The schema uses `gen_random_uuid()`, which is built into core Postgres from 13 onwards, so no extension has to be enabled. Attachments are stored as `bytea` columns in this same database, so there is no object store to provision.

Both apps require Node 20.9 or newer.

The rest of this document assumes you are deploying the API and the web app to separate services, which is the arrangement the code is written for.

---

## 1. Before you deploy

`Server/src/config/env.ts` is the only place the server reads configuration, and it validates everything at boot. A bad value is a startup failure with a message naming the key, never a confusing error at request time three days later.

There are two layers of checking.

**Per-field validation, always on.** Missing or malformed values are reported together:

```text
Invalid environment configuration:
  • JWT_ACCESS_SECRET: must be at least 32 characters. Generate one with: npm run gen:secret
  • ENCRYPTION_KEY: must be 32 bytes of base64. Generate one with: npm run gen:secret

Copy .env.example to .env and fill in the missing values.
```

**Cross-field rules that only apply when `NODE_ENV=production`.** These are the ones that catch a deployment which would technically run but would not be safe:

```text
Unsafe production configuration:
  • COOKIE_SECURE must be true in production (cookies would be sent over HTTP).
  • ALLOWED_ORIGINS cannot contain "*": credentialed CORS forbids wildcards.
  • ALLOWED_ORIGINS should use https:// in production.
```

In both cases the process writes to stderr and exits with status 1. It does not start and serve traffic in a degraded state, so a misconfigured deploy fails at the platform's health check rather than silently downgrading everyone's session security.

The complete production checklist enforced in code:

| Rule | Why it exists |
| --- | --- |
| `COOKIE_SECURE=true` | Without it the refresh cookie is sent over plain HTTP. |
| `COOKIE_SAME_SITE=none` requires `COOKIE_SECURE=true` | Browsers reject `SameSite=None` cookies that are not `Secure`. |
| `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET` | They protect different things; leaking one must not grant the other. |
| No `*` in `ALLOWED_ORIGINS` | The CORS spec forbids pairing a wildcard with `credentials: true`, and v1 shipped a `vercel.json` that set `Access-Control-Allow-Origin: *` and silently overrode the allowlist. |
| No `http://` origins in `ALLOWED_ORIGINS` | An allowed plaintext origin makes the `Secure` cookie flag pointless. |

### Generate the secrets

Three values have no sensible default and must be generated. Do not invent them by hand. `ENCRYPTION_KEY` in particular must decode to *exactly* 32 bytes, and the usual `openssl rand -base64 32 | cut -c1-32` recipes produce 32 *characters*, which fails validation with an error most people find puzzling.

```bash
cd Server
npm run gen:secret
```

That prints a ready-to-paste block:

```ini
JWT_ACCESS_SECRET=<48 random bytes, base64url>
JWT_REFRESH_SECRET=<48 random bytes, base64url>
ENCRYPTION_KEY=<32 random bytes, standard base64>
```

Rotating them is not free, so decide once and keep them in your platform's secret store:

- Rotating `JWT_ACCESS_SECRET` invalidates every outstanding access token, so everyone is signed out.
- Rotating `JWT_REFRESH_SECRET` is worse: it is also the HMAC pepper for `sessions.token_hash` and the signing key for the intermediate MFA challenge token, so no stored session can be looked up any more.
- Rotating `ENCRYPTION_KEY` makes existing TOTP secrets undecryptable. Every MFA-enrolled user has to re-enrol, and root can clear a stuck enrolment from `POST /api/admin/users/:id/reset-mfa`.

### Set `TRUST_PROXY` to match your topology

`TRUST_PROXY` is a security setting, not a convenience one. Express derives `req.ip` from it, and `req.ip` is what the rate limiter keys on for anonymous callers. Set it too high on a directly-exposed server and any client can send an `X-Forwarded-For` header of its choosing and get a fresh rate-limit budget per request.

| Deployment | Value |
| --- | --- |
| Bare Node, nothing in front | `0` (or `false`) |
| One reverse proxy (Vercel, Railway, Render, a single nginx) | `1` |
| Cloudflare in front of your own proxy | `2` |

The accepted values are the literal string `false` or an integer from 0 to 10.

---

## 2. Database

### Local Postgres with Docker

This command matches the `DATABASE_URL` already in `Server/.env.example` (`postgres://postgres:postgres@localhost:5432/taskflow`), so nothing else needs changing:

```bash
docker run -d \
  --name taskflow-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=taskflow \
  -p 5432:5432 \
  -v taskflow-db-data:/var/lib/postgresql/data \
  postgres:17-alpine
```

Confirm it is up:

```bash
docker exec taskflow-db pg_isready -U postgres
```

Leave `DATABASE_SSL=false` for local Postgres. It is not listening for TLS, and enabling it just produces a connection error.

### Supabase

Two details matter and both are easy to get wrong.

**Start with the session pooler on port 5432.** Supabase's dashboard offers both it and the transaction pooler on 6543. The session pooler gives each client its own server connection, which is what a long-running container wants, and it is the only one that supports the DDL and advisory locks migrations need.

On serverless the app switches to the transaction pooler by itself: if it detects a serverless runtime and a `DATABASE_URL` pointing at a Supabase pooler on 5432, it connects on 6543 instead and logs that it did. Set `DATABASE_NO_POOL_UPGRADE=true` to prevent that. The rewrite is confined to serverless because migrations need session mode and never run there.

The transaction pooler is the better choice for serverless, and it does work here: drizzle only sends a named prepared statement when you call `.prepare()`, which this codebase never does, so every statement is unnamed and safe to multiplex. Use 6543 for the deployed function and 5432 when running migrations. The session pooler string looks like this:

```ini
DATABASE_URL=postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

**Turn on TLS and keep the pool small.**

```ini
DATABASE_SSL=true
DATABASE_POOL_MAX=10     # long-running container (the default)
# On serverless the default is already 1. Do not raise it without reading §4.
```

`DATABASE_SSL=true` connects with `rejectUnauthorized: false` (`Server/src/db/index.ts`). That is deliberate: Supabase, Neon and Railway terminate TLS at a proxy whose certificate does not match the connection host, so strict verification fails against a perfectly legitimate endpoint. The transport is still encrypted.

`DATABASE_POOL_MAX` is **per process**. The relevant sum is `DATABASE_POOL_MAX × number of running instances`, and that has to stay under your plan's connection cap.

### Sizing

Attachments live in the `attachments.data` `bytea` column, so uploads count against your database storage and against the size and duration of every backup. The shipped defaults are 1 MB per file, 25 MB per standard user and 512 MB for root and admins. See §8 for when this stops being the right design.

---

## 3. Migrations

```bash
cd Server
npm run db:migrate     # apply pending migrations
npm run db:seed        # create the root account and default settings
```

or both at once:

```bash
npm run db:setup
```

**Migrations are forward-only and safe to re-run.** Drizzle records what it has applied in a `__drizzle_migrations` table inside its own `drizzle` schema, so a second run is a no-op that logs `Migrations applied` and exits 0. Run it on every deploy without special-casing.

This replaces v1's `sequelize.sync({ alter: true })`, which inspected the live schema and guessed at the DDL needed to match the models, a strategy that can silently drop a Postgres column when a type changes.

**Seeding is idempotent, with one exception you should know about.** Settings sections are inserted with `ON CONFLICT DO NOTHING`, so branding, SEO, legal copy and footer links an administrator has customised survive a redeploy that happens to re-run the seed. The root account is left alone if one already exists:

```text
  ✓ Settings ready (7 sections)
  ✓ Root account already exists (root), leaving it alone
    Use "npm run db:seed -- --force" to reset its password.
```

The exception: on every run the seed unconditionally rewrites three fields of the `limits` section from the environment. `maxUploadBytes`, `userStorageQuotaBytes` and `privilegedStorageQuotaBytes` are taken from `MAX_UPLOAD_BYTES`, `USER_STORAGE_QUOTA_BYTES` and `ROOT_STORAGE_QUOTA_BYTES`. If you raise a quota in the control panel and later re-run the seed, it reverts. Either keep the environment values in step with the control panel, or simply do not re-run the seed after the first deploy. Every other field of `limits` is preserved.

Two flags:

```bash
npm run db:seed -- --demo     # also create a "demo" user with four sample tasks
npm run db:seed -- --force    # reset the existing root password and sign it out everywhere
```

**The root password.** If `ROOT_PASSWORD` is set (minimum 12 characters) the seed uses it. If it is blank, the seed generates a strong random password and prints it inside a banner **once**; it is not stored anywhere recoverable. Capture that output from your deploy logs before they roll over.

**Running migrations inside a production container.** `npm run db:migrate` runs through `tsx`, which is a devDependency and is not present in the pruned production image. Use the compiled entrypoints instead. The `drizzle/` folder is copied into the image for exactly this reason:

```bash
node dist/db/migrate.js
node dist/db/seed.js
```

Both accept the same environment and behave identically to the npm scripts.

---

## 4. Deploying the API

### Recommended: one long-running container

Railway, Render, Fly.io or plain Docker on a VM. This is the arrangement the API is designed for:

- One process, one connection pool, one predictable connection count.
- The in-memory rate limiter is *correct* rather than approximate, because there is one set of counters.
- `SIGTERM` reaches the graceful-shutdown handler in `src/index.ts`, so a deploy drains in-flight requests instead of turning into a burst of 502s.
- `src/index.ts` runs `SELECT 1` before it binds the port, so a bad `DATABASE_URL` exits the process at boot with `Cannot reach the database` instead of failing on the first request.

`Server/Dockerfile` and `Server/.dockerignore` are committed. Here is the Dockerfile, with its longer comments trimmed:

```dockerfile
# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: compile
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copied before the source so that a change to a route does not invalidate the
# dependency layer and force a full reinstall on every build.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build

# Drop devDependencies in place, reusing the tree that was just verified against
# the lockfile, including the platform-specific @node-rs/argon2 binary.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node drizzle ./drizzle

USER node

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
```

Notes on the choices, since they are load-bearing:

- **`npm prune --omit=dev` rather than a second `npm ci --omit=dev`.** `@node-rs/argon2` is a native module and resolves a different binary per platform and libc. Pruning keeps the musl build that `npm ci` already selected for this exact base image.
- **`NODE_ENV=production` in the image.** That is what activates the §1 boot checks, so the container refuses to start with `COOKIE_SECURE=false` or matching JWT secrets.
- **`USER node`.** uid 1000 ships with the base image. Nothing in the app writes to disk.
- **The health check uses the runtime's own `fetch`** instead of `curl` or `wget`, which keeps an HTTP client out of the image. `/api/health` stays reachable while maintenance mode is on, so a maintenance window does not make the platform kill the container.
- **Exec-form `CMD`.** Node runs as PID 1 and receives `SIGTERM` directly, which is what the shutdown handler is waiting for.

Build and run:

```bash
docker build -t taskflow-api ./Server
docker run --init -p 8000:8000 --env-file ./Server/.env taskflow-api
```

`--init` is optional (Node handles `SIGTERM` itself), but it gives you a real init process for zombie reaping if you ever exec into the container.

Check it:

```bash
curl -s http://localhost:8000/api/health
# {"status":"ok","uptime":3,"timestamp":"..."}
```

On a managed platform:

- Set `TRUST_PROXY=1` on Railway, Render and Fly, since each terminates TLS at a proxy in front of your container. Leave it at `0` for plain Docker with nothing in front, and use `2` if Cloudflare sits in front of your own proxy.
- Leave `PORT` alone if the platform injects it; the server reads `PORT` and binds all interfaces.
- Point the platform's health check at `/api/health`.
- Run `node dist/db/migrate.js` as a release/pre-deploy command.

### Alternative: Vercel serverless

`Server/vercel.json` and `Server/api/index.ts` are committed and work. Set the Vercel project's **root directory to `Server`**; the config does the rest:

```json
{
  "installCommand": "npm ci --include=dev",
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "framework": null,
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }],
  "functions": { "api/index.ts": { "maxDuration": 30 } }
}
```

`api/index.ts` exports the same configured app as `src/index.ts`; it just does not call `listen`. Routes, middleware and the pool are identical. Set `TRUST_PROXY=1`.

Two details in that config are not incidental, and both were originally wrong:

- **`--include=dev` is required.** Vercel builds with `NODE_ENV=production`, and npm omits `devDependencies` when it sees that. `typescript` is a dev dependency, so a plain `npm ci` installs 201 packages, none of them the compiler, and `npm run build` fails with `sh: line 1: tsc: command not found`.
- **`outputDirectory` must not be `dist`.** Vercel publishes everything in the output directory as static files at the site root, so pointing it at the compiler's output puts the entire server on the public internet: `/config/env.js`, `/db/seed.js` and the rest, fetchable by anyone. `Server/public/` exists and is empty for exactly this reason. The catch-all rewrite sends real traffic to the function regardless.

Two things genuinely behave worse this way, and you should choose it knowing them:

1. **Connection pools are per instance.** Each warm lambda holds its own `pg.Pool`, so the number reaching the database is `DATABASE_POOL_MAX x live instances`, not whatever you configured.

   The default handles this: on a platform that sets `VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`, `NETLIFY` or `FUNCTIONS_WORKER_RUNTIME`, `DATABASE_POOL_MAX` defaults to **1** instead of 10. A serverless instance serves one request at a time, so a larger pool only adds parallelism within a single request and takes connections every other instance then cannot have. Supabase's session pooler allows 15 in total, and one analytics request fans out to five queries at once, so a pool of 10 exhausts the cap at two or three warm instances and every endpoint starts failing with `EMAXCONNSESSION`.

   If you raise it, keep `DATABASE_POOL_MAX x expected instances` under the cap. Supabase shows yours under Database, Connection pooling.

   Beyond a handful of instances, move to the **transaction pooler** (port 6543). It multiplexes many clients onto few server connections, which is what serverless actually needs. It is compatible here because the code never calls drizzle's `.prepare()`, so every statement is unnamed. Migrations still need the session pooler on 5432.
2. **Rate-limit counters are per instance.** The default `express-rate-limit` store is process memory. Across *n* live instances the effective limit is roughly *n* times what is configured, including on the sign-in and MFA endpoints where the limit is the defence. For anything public, add a shared store first (see §8).

A third, smaller constraint: `maxDuration` is 30 seconds. Exports build their document in memory, and a first analytics purge over a large table is a single large `DELETE`; those are the operations most likely to approach it.

Migrations cannot run inside the function. Run `npm run db:migrate` from a checkout or a CI job that can reach the database.

---

## 5. Deploying the web app

The web app is a normal Next.js App Router deployment. The part that is specific to TaskFlow is `API_ORIGIN`.

### `API_ORIGIN` and why the rewrite matters

`API_ORIGIN` is **server-side only**. It is read in two places, both of which run on the Next.js server: `next.config.ts`, to build the `/api/*` rewrite, and `src/lib/server-api.ts`, for server components and `generateMetadata`. It is never prefixed with `NEXT_PUBLIC_`, so it is never shipped to the browser.

```ini
API_ORIGIN=https://api.example.com
```

The browser-side client in `src/lib/api.ts` only ever requests relative paths like `/api/todos`. Next.js rewrites those to `API_ORIGIN` server-side. The browser therefore sees a single origin, which is the whole reason the session cookies can be `SameSite=Lax`. If the browser called the API directly on a second origin, the cookies would have to be `SameSite=None`, giving up the browser's built-in CSRF protection and not working over plain HTTP in local development at all.

**Set `API_ORIGIN` in the build environment as well as at runtime.** The rewrite destination is resolved during `next build` and baked into `.next/routes-manifest.json`; changing the variable afterwards does not move the rewrite. On Vercel a project environment variable covers both. In a Docker image, build and run must use the same value, or the rewrite and the server components will disagree about where the API is.

The build does **not** require the API to be reachable. `getPublicSettings` catches connection failures and callers fall back to `src/lib/settings-defaults.ts`, so pages still render while the API is starting.

### Vercel

Set the project's root directory to `Frontend`. Framework detection handles the rest. Add `API_ORIGIN` and `NEXT_PUBLIC_SITE_URL` as project environment variables.

### Node

```bash
cd Frontend
npm ci
API_ORIGIN=https://api.example.com NEXT_PUBLIC_SITE_URL=https://tasks.example.com npm run build
npm start
```

`next start` serves on port 3000 by default. Put it behind your own TLS terminator, or use `next start -p <port>`.

### Then point the API back at the web app

Whatever origin the web app ends up on has to appear in the API's `ALLOWED_ORIGINS`, and should also be `APP_URL`:

```ini
ALLOWED_ORIGINS=https://tasks.example.com
APP_URL=https://tasks.example.com
```

In this topology the browser never makes a cross-origin request to the API, so CORS is not the layer doing the work. The API's allowlist matters for any browser client that calls the API directly, and the production boot check will stop you deploying with a wildcard or a plaintext origin either way. `APP_URL` is a separate concern: analytics compares referrer origins against it to tell internal navigation from an external referral.

If you deliberately put the API and the web app on different subdomains of one site and skip the rewrite, `COOKIE_DOMAIN` (e.g. `.example.com`) is the setting for that. It is the only supported use for it, and it means accepting `SameSite=None`.

---

## 6. Environment variables

### `Server/.env`

Copy `Server/.env.example` and fill it in. Only four variables have no default.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | none | Postgres connection string. `SEQ_CONNECTION` is accepted as a fallback for v1 `.env` files. |
| `JWT_ACCESS_SECRET` | **yes** | none | Signs the short-lived access JWT. Minimum 32 characters. |
| `JWT_REFRESH_SECRET` | **yes** | none | Signs the intermediate MFA challenge token and peppers the HMAC stored in `sessions.token_hash`. Minimum 32 characters, and must differ from the access secret in production. |
| `ENCRYPTION_KEY` | **yes** | none | AES-256-GCM key protecting TOTP secrets at rest. Base64 that decodes to exactly 32 bytes. |
| `NODE_ENV` | no | `development` | `development`, `test` or `production`. `production` enables HSTS, immutable attachment caching and the §1 boot checks. |
| `PORT` | no | `8000` | Port to bind. |
| `LOG_LEVEL` | no | `info` | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. `debug` and `trace` also switch on Drizzle SQL logging. |
| `TRUST_PROXY` | no | `0` | Number of proxies in front (0-10), or `false`. Decides whether `X-Forwarded-For` is trusted for `req.ip`, the rate-limiter key. |
| `DATABASE_SSL` | no | `false` | Connect to Postgres over TLS. Required by Supabase and most hosted Postgres. |
| `DATABASE_POOL_MAX` | no | `10`, or `1` on serverless | Maximum pooled connections **per process** (1-100). The default drops to 1 when `VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`, `NETLIFY` or `FUNCTIONS_WORKER_RUNTIME` is set. |
| `ACCESS_TOKEN_TTL` | no | `15m` | Access-token lifetime, as `30s` / `15m` / `2h` / `7d`. |
| `REFRESH_TOKEN_TTL_DAYS` | no | `30` | Refresh-token lifetime in days (1-365). |
| `ALLOWED_ORIGINS` | no | `http://localhost:3000` | Comma-separated exact origins allowed to send credentialed requests. No wildcards. |
| `APP_URL` | no | `http://localhost:3000` | Public URL of the web app. Analytics uses its origin to tell internal navigation from an external referral. |
| `COOKIE_SECURE` | no | `false` | Mark session cookies `Secure`. Must be `true` in production or the server refuses to start. |
| `COOKIE_SAME_SITE` | no | `lax` | `strict`, `lax` or `none`. `none` additionally requires `COOKIE_SECURE=true`. |
| `COOKIE_DOMAIN` | no | unset | Cookie `Domain` attribute. Only set when the API and web app are on different subdomains of one site. |
| `MAX_UPLOAD_BYTES` | no | `1048576` | Seeds `limits.maxUploadBytes` (1 MB). After the first seed the control panel is authoritative, but see the §3 caveat. |
| `USER_STORAGE_QUOTA_BYTES` | no | `26214400` | Seeds the per-user storage quota (25 MB). |
| `ROOT_STORAGE_QUOTA_BYTES` | no | `536870912` | Seeds the root/admin storage quota (512 MB), and is the quota given to the root account at creation. |
| `ROOT_USERNAME` | no | `root` | Username for the seeded root account (3-32 characters). |
| `ROOT_EMAIL` | no | `root@taskflow.local` | Email for the seeded root account. |
| `ROOT_PASSWORD` | no | unset | Password for the seeded root account, minimum 12 characters. Leave blank and the seed generates one and prints it once. |

### `Frontend/.env.local`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `API_ORIGIN` | no | `http://localhost:8000` | The API's origin **as seen from the Next.js server**. Backs the `/api/*` rewrite and server-side fetches. Never sent to the browser. Must be set at build time as well as at runtime. |
| `NEXT_PUBLIC_SITE_URL` | no | unset | Public URL of this site, used for canonical links, `sitemap.xml` and Open Graph image URLs. Inlined at build time by the `NEXT_PUBLIC_` prefix, so changing it needs a rebuild. The control panel's SEO → *Canonical base URL* takes precedence and is read at runtime. |

Both defaults are development conveniences. In production, set `API_ORIGIN` explicitly and set the canonical base URL (see §7).

---

## 7. Post-deploy

Work through this in order. Steps 1 to 3 close the window in which a freshly deployed installation has a known-shaped administrator account and no second factor.

**1. Sign in as root.** Go to `/login` and use the credentials from the seed banner.

**2. Change the seeded password.** `/settings/security`. This matters most if you set `ROOT_PASSWORD` in an environment variable, because that value is now in your platform's dashboard, your shell history and possibly a CI log. Changing the password pushes `tokens_valid_from` forward, which signs out every other device immediately.

**3. Enable multi-factor authentication.** `/settings/security` → scan the QR code with an authenticator app → confirm with a code. **Store the recovery codes when they are shown; that is the only time they are ever displayed.** They are single-use.

Once at least one administrator is enrolled, consider turning on **Features → Require MFA for administrators** (`/admin/features`). The policy is enforced on `/api/admin/*` but deliberately exempts the MFA setup routes, so an administrator who has not enrolled yet can still reach the screen that lets them comply.

**4. Set your branding.** `/admin/branding`: site name, tagline, logo, dark-mode logo, favicon, Open Graph image, primary and accent colours, corner radius. Uploaded images become attachments served from the API; there is no external asset host to configure. The branding values also drive the PDF export letterhead and the issuer name shown in authenticator apps.

**5. Set the canonical base URL.** `/admin/seo` → *Canonical base URL*, e.g. `https://tasks.example.com`. This is the one SEO field with a functional consequence rather than a cosmetic one:

- `sitemap.xml` emits an **empty sitemap** when no base URL is resolvable, because a sitemap of relative paths is invalid and a crawler would reject it.
- `robots.txt` omits its `Sitemap:` and `Host:` lines.
- Open Graph image URLs and canonical links cannot be made absolute.

It falls back to `NEXT_PUBLIC_SITE_URL`, but setting it here is better: it is read at runtime, so it works without a rebuild.

While you are on that page, fill in the title template, default description, organisation details (they are emitted as JSON-LD and printed on PDF exports) and any search-console verification tokens.

**6. For a staging or preview deployment, turn indexing off.** `/admin/seo` → *Indexing enabled* → off. `robots.txt` then serves a blanket `Disallow: /`, so the preview cannot duplicate or outrank production.

**7. Decide whether registration stays open.** `/admin/features` → *Registration enabled*. Also there: maintenance mode, which serves a 503 to everyone except root while leaving `/api/auth`, `/api/health` and `/api/settings` reachable so root can still sign in and turn it off.

**8. Verify.**

```bash
curl -s https://api.example.com/api/health
curl -s https://tasks.example.com/robots.txt
curl -s https://tasks.example.com/sitemap.xml
```

There is also a full end-to-end smoke test with 102 checks covering the happy paths plus CSRF, cross-user access, privilege escalation, upload validation and MFA replay. It creates tasks, an attachment and a probe user under the account it signs in with, so **point it at a development database, never production**:

```bash
cd Server
SMOKE_BASE_URL=http://localhost:8000 SMOKE_USERNAME=root SMOKE_PASSWORD=... npm run test:smoke
```

---

## 8. Scaling notes

The shipped configuration is deliberately sized for one instance. Here is what to change, in the order it usually starts to matter.

### Move the rate limiter to a shared store

This is the first thing to fix when you run more than one instance, and it is a genuine security boundary rather than a performance concern: with per-process counters, the sign-in limit of 10 failures per 15 minutes becomes 10 × *n* across *n* instances.

`Server/src/middleware/rate-limit.ts` funnels every limiter through one `build()` helper, so there is a single place to change. Install `rate-limit-redis` and a Redis client, then pass a `store` in `build()`. Nothing else in the file needs touching: `generalLimiter`, `authLimiter`, `mfaLimiter`, `uploadLimiter`, `exportLimiter`, `writeLimiter` and `analyticsLimiter` all inherit it.

Note that no Redis integration ships today: there is no `REDIS_URL` in `src/config/env.ts`, so adding one means adding the variable to the schema as well.

### Schedule the analytics purge

Analytics events accumulate forever until something deletes them. The retention window is a setting (`/admin/analytics` → *Retention days*, default 90, maximum 730), but nothing runs on a timer inside the app.

The purge is exposed as a root-only endpoint:

```http
POST /api/analytics/purge
```

It responds with `{ purge: { deletedCount, retentionDays, cutoff } }` and writes an `analytics.purge` audit entry. Call it from your platform's scheduler: a daily cron job with a root session, or a small script that imports `purgeExpiredEvents()` from `src/modules/analytics/analytics.service.ts` and runs alongside your migration command. Both paths call the same function, so the schedule changes *when* data disappears, never *whether* it does.

The first purge on an installation that has been collecting for months is a single large `DELETE`. Run it during a quiet period, and not inside a 30-second serverless function.

### Prune expired sessions

`pruneExpiredSessions()` in `src/modules/auth/auth.service.ts` deletes session rows more than seven days past expiry. It is **not** wired to any route or scheduler; it exists so you can call it. Either invoke it from a script, or run the equivalent statement from a scheduled job:

```sql
DELETE FROM sessions WHERE expires_at < now() - interval '7 days';
```

Expired rows cannot authenticate anything, so this is housekeeping rather than security. It matters mostly for table size and index bloat once you have a large user base rotating refresh tokens every fifteen minutes.

### Watch the connection count

`DATABASE_POOL_MAX × instances` has to stay under the Postgres connection cap. Managed Postgres plans are often far stingier here than their CPU and storage numbers suggest, and connection exhaustion presents as intermittent failures across unrelated endpoints. Prefer a smaller number of larger instances over many small ones, and if you must fan out, put a pooler in front.

### Know how settings propagate

Site settings are cached in memory for 30 seconds per process (`src/lib/settings.ts`). The cache is not invalidated on write, on purpose: one instance clearing its own map says nothing about the others. So a branding or feature-flag change is live everywhere within 30 seconds with no coordination between instances, but it is not instant, and a stale value for a few seconds after an admin saves is expected behaviour, not a bug.

### When to move attachments out of Postgres

Storing files as `bytea` is the right call at this scale and buys real things: one backup contains everything, an attachment row cannot outlive the task it belongs to because `ON DELETE CASCADE` sees to it, the `users.storage_used_bytes` quota counter moves in the same transaction as the row it accounts for, and there are no object-store credentials to leak. None of those hold for free once the bytes live somewhere the database cannot see. That is why the per-file ceiling is modest.

Reconsider when any of these becomes true:

- **Backups get painful.** File bytes dominate dump size and restore time long before row counts do. A restore you cannot complete inside your recovery window is the clearest signal.
- **You need a CDN.** Every download loads the whole file into the API process's memory as a `Buffer` and writes it out. That is fine for avatars and modest attachments behind authentication; it is the wrong shape for large or high-volume public downloads.
- **You are pushing the ceilings.** `limitsSchema` caps `maxUploadBytes` at 10 MB and the privileged limit at 50 MB. If you find yourself wanting to raise those, the storage model is what is actually being outgrown.

The seam is narrow: `storeAttachment()` in `src/modules/attachments/attachments.service.ts` is the only writer (task attachments, avatars and site assets all go through it), and `readAttachmentBytes()` in the same file is the only reader of `attachments.data`. Moving to S3-compatible storage means changing where the bytes go and keeping the `attachments` row as metadata: the checksum, MIME type and byte size are already there, and every quota and validation rule keys off that row rather than off the blob.
