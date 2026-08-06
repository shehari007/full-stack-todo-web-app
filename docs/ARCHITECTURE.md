# Architecture

How TaskFlow is put together, and why the awkward parts are the way they are.

This document describes the code as it exists. Where a decision has a real cost,
that cost is stated rather than glossed over. See
[Known trade-offs](#known-trade-offs).

---

## 1. Shape of the system

TaskFlow is a monorepo with two independently deployable applications.

| Directory | Runtime | Owns |
| --- | --- | --- |
| `Server/` | Node ≥ 20.9, Express 5, TypeScript ESM | All data, all authorisation, all validation. Drizzle ORM against PostgreSQL. |
| `Frontend/` | Next.js 16 App Router, React 19, Ant Design 6 | Rendering, routing and interaction. Holds no business rules. |

The split is deliberate: the API is the only thing that decides what a caller may
see or do. The web app has redirects and role checks in it, but every one of them
is a user-experience affordance, not a security control. `Frontend/src/proxy.ts`
says so in its own header comment, and `Frontend/src/app/admin/layout.tsx` calls
its role check "a second gate, not the gate".

### Why the rewrite proxy exists

The browser never talks to Express directly. `Frontend/next.config.ts` declares:

```ts
async rewrites() {
  return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
}
```

Everything the browser fetches is therefore same-origin. That is the whole reason
the cookie scheme is safe and simple:

- Session cookies can stay `SameSite=Lax`. If the browser called an API on a
  different origin, the cookies would need `SameSite=None`, which removes the
  browser's own cross-site protection and does not work over plain HTTP at all,
  so local development would need a different auth path from production.
- `Frontend/src/lib/api.ts` uses relative paths and `credentials: 'same-origin'`.
  No access token is ever handled in JavaScript, so an XSS bug cannot read one:
  `tf_access` and `tf_refresh` are `HttpOnly`.
- The API origin (`API_ORIGIN`) is a server-side environment variable in
  `Frontend/.env.example`. It is never exposed to the client.

Server components are the exception, and `Frontend/src/lib/server-api.ts` handles
it: server-side `fetch` has no notion of "this site", so it uses the absolute
`API_ORIGIN` and forwards the incoming cookies by hand via `next/headers`.

```text
                       ┌─────────────────────────────────────────┐
                       │              Browser                    │
                       │  React 19 + Ant Design 6 (client comps) │
                       │                                         │
                       │  HttpOnly : tf_access, tf_refresh       │
                       │  readable : tf_csrf, tf_consent         │
                       └───────────────────┬─────────────────────┘
                                           │  same-origin HTTPS
                                           │  /            -> page
                                           │  /api/...     -> rewritten
                                           v
                       ┌─────────────────────────────────────────┐
                       │        Next.js 16 (App Router)          │
                       │                                         │
                       │  proxy.ts        redirect-only guard    │
                       │  server comps    initial data + SSR     │
                       │  rewrites()      /api/* -> API_ORIGIN   │
                       └───────────────────┬─────────────────────┘
                                           │  server-to-server
                                           │  cookies forwarded
                                           v
                       ┌─────────────────────────────────────────┐
                       │       Express 5 API  (Server/)          │
                       │                                         │
                       │  helmet · CORS · CSRF · rate limits     │
                       │  optionalAuth -> requireAuth -> roles   │
                       │  modules: auth todos attachments        │
                       │           profile admin settings        │
                       │           analytics exports             │
                       └───────────────────┬─────────────────────┘
                                           │  single pg.Pool
                                           v
                       ┌─────────────────────────────────────────┐
                       │            PostgreSQL 13+               │
                       │                                         │
                       │  users sessions todos attachments       │
                       │  site_settings audit_logs               │
                       │  analytics_events consent_records       │
                       │                                         │
                       │  file bytes live here, as bytea         │
                       └─────────────────────────────────────────┘
```

There is exactly one `pg.Pool` per process, created in `Server/src/db/index.ts`
and exported as `pool`; the Drizzle instance wrapping it is exported as `db`, and
that is what every module imports. Nothing else constructs a pool.

---

## 2. Request lifecycle

`Server/src/app.ts` assembles the middleware stack. The order is load-bearing and
is walked here exactly as it appears in the file, using a real request:

```text
PATCH /api/todos/8f3c...  with cookies tf_access + tf_csrf and header X-CSRF-Token
```

Before any middleware runs, three settings are applied to the app instance:
`trust proxy` from `env.TRUST_PROXY`, `x-powered-by` disabled, and `etag` set to
`strong`. `trust proxy` is a security setting, not a convenience one: it decides
whether `X-Forwarded-For` is believed when deriving `req.ip`, and `req.ip` is the
rate-limiter key for anonymous callers.

**1. Request correlation.** A small inline middleware sets `req.id` from an
incoming `X-Request-Id` header when the proxy supplied one, otherwise a fresh
`randomUUID()`, and echoes it back in the response header. Honouring an upstream
id means one trace spans both hops.

**2. `pino-http`.** Structured request logging, seeded with the same id via
`genReqId`. The URLs `/api/health` and `/` are excluded from auto-logging (the
`autoLogging.ignore` predicate matches on `req.url` alone, whatever the method)
because health checks would otherwise dominate the volume. Status ≥ 500 or a
thrown error logs at `error`, ≥ 400 at `warn`, everything else at `info`.

**3. `helmet`.** CSP is `default-src 'none'` with `frame-ancestors`, `base-uri`
and `form-action` all `'none'` and `sandbox: ['allow-downloads']`. This origin
serves JSON and user-uploaded bytes, never HTML that should run scripts, so the
strictest possible policy costs nothing and contains anything that slipped past
upload validation. `crossOriginResourcePolicy` is `cross-origin` so attachments
load from the web app during development; HSTS is production-only.

**4. `cors`.** An explicit allowlist from `env.ALLOWED_ORIGINS` with
`credentials: true`. Requests with no `Origin` header (same-origin, curl,
server-to-server) are allowed. The spec forbids pairing credentials with `*`, and
`env.ts` refuses to boot in production if `ALLOWED_ORIGINS` contains one.
`X-CSRF-Token`, `X-Filename` and `X-Request-Id` are in `allowedHeaders`;
`Content-Disposition`, `X-Request-Id`, `RateLimit` and `RateLimit-Policy` are
exposed.

**5. `compression`.**

**6. `cookie-parser`.** Everything downstream (auth, CSRF, consent) reads
`req.cookies`, so this must precede all of them.

**7. Body parsing, with a carve-out.** A single wrapper runs
`express.json({ limit: '256kb' })` then `express.urlencoded({ extended: false, limit: '64kb' })`,
*unless* the request matches `RAW_BODY_PATHS`:

```ts
const RAW_BODY_PATHS = [
  /^\/api\/attachments\/todos\/[^/]+$/,
  /^\/api\/profile\/avatar$/,
  /^\/api\/admin\/assets$/,
];
```

on `POST` only. Uploads arrive as raw bytes rather than multipart, and
`express.json()` parses anything declaring `Content-Type: application/json`,
which would silently consume the body of an uploaded `.json` file before the
route's own `express.raw` parser ever saw it. Skipping three exact paths at the
top level is the narrowest fix that does not weaken parsing anywhere else.

**8. `optionalAuth`.** Resolves `req.auth` when credentials are present and never
rejects. It sits here, ahead of the next two, for two specific reasons: the rate
limiter can then key on user id instead of IP, and the CSRF guard can see whether
credentials arrived by cookie or by bearer token.

Auth itself (`Server/src/middleware/auth.ts`) verifies the JWT, then loads the
user row and checks four things: the row exists, `deleted_at` is null, `status`
is not `suspended`, and the token's `iat` is not older than the user's
`tokens_valid_from`. That last comparison is done in whole seconds on both
sides: a JWT `iat` has one-second resolution while a Postgres timestamp has
microseconds, and comparing in milliseconds rejected every token minted in the
same second the column was written.

**9. `csrfProtection`.** Skipped for `GET`/`HEAD`/`OPTIONS`. Skipped when no
`tf_access` or `tf_refresh` cookie is present, since there is then no CSRF
surface. Skipped when an `Authorization: Bearer` header is present, because the
browser never attaches one on its own. Otherwise the `tf_csrf` cookie must equal
the `X-CSRF-Token` header, compared with `safeEqual` (constant time). `tf_csrf`
is deliberately *not* `HttpOnly`: the client has to read it to build the header,
and an attacker on another origin can cause the cookie to be sent but cannot read
it.

**10. `generalLimiter`.** 300 requests per minute, keyed by `req.auth.userId`
when known and otherwise by `ipKeyGenerator(req.ip)`, which normalises IPv6 to a
/64 so one client cannot rotate through billions of addresses. This is a
backstop; the sharp limits (`authLimiter`, `mfaLimiter`, `uploadLimiter`,
`exportLimiter`, `writeLimiter`, `analyticsLimiter`) are applied per route inside
the modules.

**11. `GET /`.** A small JSON identity document. Declared after the limiter, so
it is metered like everything else.

**12. `app.use('/api', maintenanceGate, routes)`.** `maintenanceGate` reads the
cached `features` section; when `maintenanceMode` is on it returns 503 with
`Retry-After: 600` to everyone except `root`, and leaves `/auth`, `/health` and
`/settings` reachable so root can still sign in and fix the installation.

Then `Server/src/routes.ts` dispatches. For our request that is
`router.use('/todos', requireAuth, todoRoutes)`, so auth is resolved a second
time (this time rejecting rather than ignoring failures) and then the route's own
`writeLimiter` and `validate({ params, body })` run before the handler.

`validate` parses with zod and writes the result back: `req.body` is *replaced*,
while `req.params` is merged in place with `Object.assign` (Express reuses that
object, and the keys in it come from the route pattern rather than from the
client). Because zod objects are non-passthrough by default, the body's unknown
keys are *stripped*, which is a security property rather than a convenience: it
stops mass assignment, where a client posts `{"role":"root"}` alongside
legitimate fields. `req.query` cannot be assigned in Express 5 (it is a getter),
so the parsed value is stashed on `req._validatedQuery` and read back with
`validatedQuery<T>(req)`.

**13. `notFoundHandler`.** Terminal 404 for anything unmatched.

**14. `errorHandler`.** Every failure leaves as the same envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "Cannot PATCH /todos/8f3c..." } }
```

`details` is present only when there is something to put in it: a validation
failure's field map, or an `AppError` that was constructed with one. It is
omitted rather than sent as `null`, so a client must check for the key rather
than for a null value.

`AppError` instances carry their own status and a stable `ErrorCode`; `ZodError`
becomes a 422 with field-keyed messages; four Postgres SQLSTATE codes (`23505`,
`23503`, `23502`, `22001`) map to 409/409/400/400; malformed JSON becomes 400 and
`entity.too.large` becomes 413. Anything else is a bug: it logs at `error` and
returns 500 with the request id, plus the stack only outside production.

---

## 3. Module layout

Each API feature is a directory under `Server/src/modules/` with up to three
files, and the split is by role rather than by size:

- **`*.routes.ts`** is the HTTP surface. Wiring only: method, path, middleware
  chain, response shape, audit call. No SQL.
- **`*.service.ts`** does the actual work. Database access, business rules,
  ownership predicates. Takes plain arguments, returns plain data, throws
  `AppError`. Never touches `req` or `res`.
- **`*.schemas.ts`** holds zod schemas and the types inferred from them, so the
  route and the service agree on shapes without a hand-written interface in
  between.

```text
Server/
├── api/index.ts                     Vercel entry: exports createApp() without listen()
├── drizzle/0000_init.sql            generated migration + meta/
├── scripts/smoke-test.mjs           npm run test:smoke
└── src/
    ├── app.ts                       middleware assembly (section 2)
    ├── index.ts                     listen, graceful shutdown, boot DB check
    ├── routes.ts                    /api route table
    ├── config/
    │   ├── env.ts                   every env var, validated at boot
    │   └── settings.ts              SETTINGS_REGISTRY (section 5)
    ├── db/
    │   ├── index.ts                 the one pg.Pool + drizzle instance
    │   ├── schema.ts                the data model (section 4)
    │   ├── ensure-database.ts       creates the database if it does not exist
    │   ├── migrate.ts               npm run db:migrate
    │   └── seed.ts                  npm run db:seed
    ├── lib/
    │   ├── audit.ts crypto.ts errors.ts http.ts logger.ts
    │   └── password.ts pdf.ts settings.ts tokens.ts totp.ts
    ├── middleware/
    │   ├── auth.ts                  optionalAuth requireAuth requireRole
    │   │                            csrfProtection enforceMfaPolicy maintenanceGate
    │   ├── error.ts rate-limit.ts validate.ts
    ├── modules/
    │   ├── admin/        routes schemas service
    │   ├── analytics/    routes schemas service
    │   ├── attachments/  routes schemas service
    │   ├── auth/         routes schemas service
    │   ├── exports/      routes schemas service
    │   ├── profile/      routes schemas service
    │   ├── settings/     routes            (no service: it only projects the registry)
    │   └── todos/        routes schemas service
    ├── scripts/gen-secret.ts        npm run gen:secret
    └── types/express.d.ts           req.auth and req.id
```

`settings` has no service or schemas file because it does one thing: filter
`getAllSettings()` down to `PUBLIC_SETTINGS_KEYS`. Inventing two more files to
hold four lines would be worse than the asymmetry.

Mount points are in `routes.ts`:

```ts
router.use('/auth', authRoutes);
router.use('/settings', settingsRoutes);
router.use('/analytics', analyticsRoutes);

router.use('/todos', requireAuth, todoRoutes);
router.use('/attachments', attachmentRoutes);   // per-route: some are public
router.use('/profile', requireAuth, profileRoutes);
router.use('/exports', requireAuth, exportRoutes);

router.use('/admin', requireAuth, requirePrivileged, enforceMfaPolicy, adminRoutes);
```

`enforceMfaPolicy` is on the admin mount rather than applied globally, so that
when an installation turns on "require MFA for administrators", the affected users
can still reach `/api/auth/mfa/*` to enrol. Turning the policy on globally would
lock every administrator out of the only screen that could satisfy it.

The imports carry `.js` extensions (`from './routes.js'`) because the package is
`"type": "module"`. Node's ESM resolver does not do extension guessing, and the
`.js` refers to the compiled output even in a `.ts` source file.

---

## 4. Data model

`Server/src/db/schema.ts` is the single source of truth. Migrations are generated
from it (`npm run db:generate`) and applied forward-only (`npm run db:migrate`).
Drizzle records applied migrations in `__drizzle_migrations`, so re-running is
safe. Nothing calls anything resembling `sync({ alter: true })`. That inspects
the live schema and guesses at DDL, which on PostgreSQL can silently drop a
column when a type changes.

Five enums back the model: `user_role` (`root` | `admin` | `user`), `user_status`,
`todo_status`, `todo_priority`, and `attachment_kind` (`todo_file` | `avatar` |
`site_asset`).

### Tables

**`users`** is the accounts table. `username` and `email` are stored
already-lowercased with plain unique indexes, which gives case-insensitive
identity without the `citext` extension (Supabase does not enable it by
default). It also holds the Argon2id `password_hash`, MFA state, storage
accounting, preferences, brute-force counters and `tokens_valid_from`.

**`sessions`** keeps one row per live refresh token. Their existence is the
point: a refresh token is an opaque random string, not a JWT, precisely so it
can be revoked. The row is what makes "sign out this device" possible, and what
makes rotation-replay detection possible. Presenting a token that was already
rotated identifies a stolen token, and the whole family is revoked. Only a
peppered HMAC-SHA256 of the token is stored (`hashRefreshToken` in
`lib/tokens.ts`), keyed rather than a bare digest so read access to the table is
not enough to build a lookup table offline.

**`todos`** is the tasks table. `due_at` is a real `timestamptz`, not v1's
`DD-MM-YYYY` string, so it can be sorted, range-filtered and compared against
`now()` in SQL. `position` carries manual drag-to-reorder ordering. Four
indexes: a partial index on
`(user_id, deleted_at, position) WHERE deleted_at IS NULL` for the dashboard's
default query, `(user_id, status)`, `due_at`, and a GIN index over
`to_tsvector('english', title || ' ' || coalesce(description, ''))` that
`todos.service.ts` queries with `plainto_tsquery`.

**`attachments`** stores file bytes as `bytea`, plus metadata: `filename`, a
`mime_type` verified against the file's magic bytes rather than trusted from the
client, `byte_size`, a SHA-256 `checksum` used as a strong ETag, and optional
`width`/`height`. `user_id` is nullable. Only `site_asset` rows leave it null,
because a logo belongs to the installation and must outlive whoever uploaded it.

**`site_settings`** is the CMS store. One row **per section**, not per field:
`key` is `branding` / `seo` / `footer` / `legal` / `limits` / `features` /
`analytics`, and `value` is a JSON object validated by that section's zod schema.
This keeps the table at seven rows and lets the admin UI save a whole section
atomically. `is_public` mirrors the registry flag.

**`audit_logs`** is an append-only record of privileged actions. There is
deliberately no update or delete path anywhere in the application; the root panel
can read and filter it, and that is all. `actor_username` is denormalised
alongside the `actor_id` foreign key (`ON DELETE SET NULL`) so an entry stays
readable after the account is gone. A log that says "someone deleted this user"
is not much of a log.

**`analytics_events`** is the first-party page-view stream. `visitor_hash` is a
daily-rotating HMAC of IP + user agent; `device` and `country` are coarse buckets;
`path` is cut at `?` because query strings routinely carry tokens and search
terms. No raw IP, no raw user-agent, no full URL.

**`consent_records`** holds proof of cookie consent, which GDPR requires to be
*demonstrable*. A record is keyed by a client-generated `anonymous_id` for
signed-out visitors, linked to `user_id` once they sign in, and stamped with the
`policy_version` that was actually shown, so bumping the version re-prompts
rather than silently treating old consent as covering new text.

### Decisions worth knowing

**Soft delete is scoped, not universal.** `todos` is the one table that is
actually soft-deleted in practice: `DELETE /api/todos/:id` sets `deleted_at` and
returns the updated row so the client can offer an undo without re-fetching, and
`POST /api/todos/:id/restore` clears it. Every query in `todos.service.ts` carries
`isNull(todos.deletedAt)` explicitly. There is no global filter doing it
invisibly.

`users` also has a `deleted_at` column and every user query filters on it
(including `resolveAuth`, which treats a soft-deleted row as unauthenticated), but
no code path currently writes it. Account deletion, whether self-service via
`DELETE /api/profile` or administrative via `DELETE /api/admin/users/:id`, is a
real `DELETE`. The foreign keys do the rest: `sessions`, `todos`, `attachments`
and `consent_records` cascade, while `audit_logs.actor_id`,
`analytics_events.user_id` and `site_settings.updated_by` are set to NULL so the
record of what happened survives the account. `purgeAccount` says why in as many
words: `deleted_at` exists so that *content* can be restored from the trash, not
so that erased accounts can linger. A user exercising GDPR Article 17 gets
erasure. The column and the filters that read it are the defensive half of a
convention every table shares; nothing sets them on `users` today.

**`tokens_valid_from` is the stateless-revocation cut-off.** Access tokens are
JWTs and cannot be individually recalled. Pushing this timestamp forward rejects
every outstanding access token for that user at once, without tracking any of
them. It is what makes a password change, "sign out everywhere", and an
administrator's forced password reset take effect immediately.

**`attachments.data` must never appear in a list query.** `attachments.service.ts`
defines a `metadataColumns` projection and every query that is not serving bytes
uses it. A bare `select()` would pull the whole `bytea` for every row: a listing
of fifty 1 MB files is 50 MB in memory. Even the download path settles access and
`If-None-Match` from metadata first, so a 304 never reads the payload at all.

**`users.storage_used_bytes` moves in the same transaction as the row it counts.**
A counter that can drift from reality is not a quota.

---

## 5. Settings and the CMS

`Server/src/config/settings.ts` defines seven sections, each a zod schema plus a
complete default value, collected into one registry:

```ts
export const SETTINGS_REGISTRY = {
  branding:  { schema: brandingSchema,  defaults: brandingDefaults,  isPublic: true  },
  seo:       { schema: seoSchema,       defaults: seoDefaults,       isPublic: true  },
  footer:    { schema: footerSchema,    defaults: footerDefaults,    isPublic: true  },
  legal:     { schema: legalSchema,     defaults: legalDefaults,     isPublic: true  },
  limits:    { schema: limitsSchema,    defaults: limitsDefaults,    isPublic: false },
  features:  { schema: featuresSchema,  defaults: featuresDefaults,  isPublic: true  },
  analytics: { schema: analyticsSchema, defaults: analyticsDefaults, isPublic: false },
} as const;
```

One registry drives four things:

1. **Validation.** `updateSettings` merges an administrator's patch over the
   *current* value and validates the whole section, so a partial update can never
   leave a section in a state the schema would reject.
2. **Defaults and forward compatibility.** `reconcile()` in `lib/settings.ts`
   merges the stored value over the defaults *before* parsing. That is what makes
   adding a setting a non-breaking change: a row written by an older version
   simply inherits the new field's default instead of surfacing as `undefined`
   somewhere in the UI. If a stored value fails validation anyway, the section
   falls back to defaults and logs a warning. A corrupt settings row must not
   take the site down.
3. **The public/private split.** `PUBLIC_SETTINGS_KEYS` is derived from the
   `isPublic` flags, and `GET /api/settings/public` filters through that derived
   list rather than a second list kept beside it. `limits` and `analytics` are
   private because they describe how to attack the installation, not how to
   render it.
4. **The admin UI.** The section screens under `Frontend/src/app/admin/` mirror
   the registry one-to-one.

Adding a setting means adding a field to one schema and a matching default.
Nothing else has to change.

### Why the cache is TTL-based

`lib/settings.ts` holds each section in a process-local `Map` for **30 seconds**:

```ts
const CACHE_TTL_MS = 30_000;
```

Settings are read on nearly every request (`maintenanceGate` reads `features`,
uploads read `limits`, MFA enrolment reads `branding`) and written rarely, so
caching is not optional. The interesting choice is invalidation.

Invalidate-on-write is the obvious design and it is the wrong one here. One
instance clearing its own `Map` says nothing about the others. On a multi-instance
deployment, or on serverless where instances appear and vanish, a write would
refresh the instance that served it and leave every other one serving stale values
indefinitely. A 30-second ceiling means a change is live *everywhere* within 30
seconds with no coordination, no pub/sub and no shared cache, at the cost of the
writing instance briefly disagreeing with itself, which `updateSettings` avoids
anyway by re-seeding its own entry on write.

`clearSettingsCache()` exists for tests. Production relies on the TTL.

Two more cache layers sit in front of this on the public path:
`GET /api/settings/public` sets `Cache-Control: public, max-age=60`, and
`getPublicSettings()` in `server-api.ts` fetches with `next: { revalidate: 60 }`.
So a branding change can take up to roughly 90 seconds to reach an anonymous page
view. That is the intended trade: every page render would otherwise be a database
round trip for every visitor.

---

## 6. Frontend rendering

**Every `page.tsx` and `layout.tsx` under `Frontend/src/app/` is a server
component.** No file in the routing tree carries `'use client'`. Interaction lives
in `src/components/` and `src/providers/`, where 47 files do.

The pattern is the same everywhere: the server component fetches the initial data
and hands it to a client view as props, which then keeps itself fresh with SWR.
`dashboard/page.tsx` is representative: it issues three `serverGet` calls in
parallel (stats, the recent list, the agenda) and passes the data, the SWR keys
and the page size down together:

```tsx
<DashboardView
  initialUser={user}
  initialStats={statsBody?.stats ?? null}
  initialRecent={recentBody?.todos ?? null}
  initialAgenda={agendaBody?.todos ?? null}
  statsKey="/api/todos/stats"
  recentKey={RECENT_QUERY}
  agendaKey={AGENDA_QUERY}
  agendaPageSize={AGENDA_PAGE_SIZE}
  nowIso={new Date().toISOString()}
/>
```

The keys are the exact query strings the server already fetched, so SWR
rehydrates against the same URL rather than firing a second, slightly different
request on mount. `agendaPageSize` travels with them because the agenda is one
page of 25 rather than the whole set, and the view has to be able to say "n+"
instead of claiming a total it cannot see.

`nowIso` is passed rather than computed on both sides so the greeting and the
overdue split cannot disagree across hydration. The admin settings screens do the
same through `loadSettingsSection()`: forms are server-rendered with their real
values, because a client-side fetch would paint an empty form first and on a page
of text inputs that reads as "the settings were lost".

**Server-side data access** goes through `src/lib/server-api.ts`. `serverFetch`
reads `cookies()` from `next/headers` and forwards them, since server-side `fetch`
carries none by default. `getPublicSettings` and `getCurrentUser` are both wrapped
in React's `cache()`, which deduplicates them within a single render pass: the
root layout, `generateMetadata` and the footer all ask for settings, and without
deduplication that is three round trips per request. Both return `null` rather
than throwing when the API is unreachable, so a restarting API degrades the site
to `FALLBACK_SETTINGS` instead of an error page.

**`AntdRegistry`** wraps the tree inside `ThemeProvider` (`src/providers/ThemeProvider.tsx`),
outside `ConfigProvider` and antd's `App`. Ant Design generates its CSS at runtime;
the registry collects that CSS during SSR and inlines it, so the server-rendered
HTML arrives already styled. Without it the first paint is unstyled markup.

The same provider seeds antd's design tokens from the CMS: `colorPrimary`,
`colorSuccess` and `borderRadius` come from `settings.branding`, so an
administrator restyles the whole app without touching code. A separate inline
script (`themeInitScript`) runs in `<head>` before first paint to apply the stored
light/dark preference. Otherwise dark-mode users get a white flash on every load.

**CMS settings reach `generateMetadata`** because `src/app/layout.tsx` exports it
as an `async` function rather than a static `metadata` object:

```tsx
export async function generateMetadata(): Promise<Metadata> {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const { seo, branding } = settings;
  ...
}
```

From there, `seo.titleTemplate` becomes the Next.js title template,
`seo.indexingEnabled` flips the whole site between `index` and `noindex` (so a
staging deploy never competes with production), `branding.ogImageAttachmentId` and
`branding.faviconAttachmentId` become `/api/attachments/<id>` URLs, and
`seo.verification.*` become meta tags when non-empty. The `cache()` wrapper means
this shares one fetch with the layout body below it, which renders the JSON-LD
`Organization` block from the same object.

**`src/proxy.ts`** is Next 16's renamed `middleware` convention, now running on
the Node runtime. It only checks whether `tf_access` or `tf_refresh` is *present*,
to redirect signed-out visitors to `/login` and signed-in ones away from
`/login`. It cannot verify a token (the signing key lives on the API) and a
forged cookie gets past it trivially. Removing the file would cost UX, not safety.

---

## Known trade-offs

These are real costs, not caveats-for-form. Each is a decision that could
reasonably have gone the other way.

**Files live in PostgreSQL, and that does not scale to large media.** `bytea`
means one backing store, one backup, one set of credentials, and access control
expressed as a SQL predicate rather than as bucket policy, which is why the
default per-file cap is 1 MB and `limitsSchema` refuses to accept more than 10 MB
(50 MB for privileged uploads). Every byte also crosses the connection pool and is
buffered in Node before it is written. If you need to host video, or hundreds of
gigabytes of anything, this is the wrong design and the fix is object storage with
signed URLs, not a bigger limit.

**The rate limiter is per-process, so limits multiply across instances.**
`middleware/rate-limit.ts` uses `express-rate-limit`'s default memory store. That
is exactly correct for one Node process and honestly wrong for anything else: with
four instances behind a load balancer, the effective `authLimiter` is 40 attempts
per 15 minutes, not 10. The fix is a shared store (`rate-limit-redis`), and the
code notes it. `Server/api/index.ts` repeats the warning for serverless, where the
instance count is not even knowable.

**Authentication does a database read on every request, by design.** `resolveAuth`
verifies the JWT and then loads the user row to check status, deletion and
`tokens_valid_from`. Trusting the token's claims alone would remove that read, and
would also mean a suspended user keeps full access until their access token
expires: up to 15 minutes of a revoked account behaving normally. The read is one
indexed primary-key lookup, and the cost is paid more than once: `optionalAuth`
runs globally, then `requireAuth` runs again at the mount, and the admin router
repeats `requireAuth` a third time rather than trusting its mount site to have
remembered. Three lookups on an admin request is a deliberate purchase of "a
missing guard here means a stranger editing accounts".

**There is no email sender, so there is no email verification and no
password-reset-by-email.** Nothing in `Server/` sends mail: no SMTP client, no
transactional provider, no queue. The consequences are concrete: email addresses
are unverified strings, and a user who forgets their password cannot recover it
themselves. Recovery is `POST /api/admin/users/:id/reset-password` (root only), or
`npm run db:seed -- --force` for the root account itself. Adding email means
picking a provider, a queue, a bounce policy and a set of templates, and every one
of those is a deployment dependency this project does not currently have.

**Analytics is first-party and deliberately coarse.** `analytics_events` stores a
daily-rotating HMAC instead of a visitor id, a bucketed device string instead of a
user agent, a country code read from a CDN header when one exists, and a path with
the query string removed. Collection is gated on stored consent, honours `DNT: 1`
when `respectDoNotTrack` is set, drops known bots, and can exclude the operator's
own traffic. What you get is page views, unique-visitors-per-day, top paths, top
referrers and a device split. What you do not get is funnels, sessions, retention
cohorts or any per-person history. The daily key rotation makes those
structurally impossible, not merely unimplemented. If you need product analytics,
this is not it.

**Exports are built entirely in memory and capped at 5,000 rows.** Every format
buffers a finished `Buffer` before anything is sent, which keeps a failure an
ordinary thrown error rather than a half-written download, but 5,000 rows is
already a hundred-page PDF, and past that the honest answer is a paginated API
query rather than a larger file.

**Settings changes are not instant.** See section 5: up to 30 seconds inside the
API, and up to about 90 seconds on a cached anonymous page. This is the price of
not needing a shared cache or a pub/sub channel between instances.

---

## Related documents

- [docs/API.md](API.md): every endpoint, with request and response examples
- [docs/SECURITY.md](SECURITY.md): threat model and hardening checklist
- [docs/DEPLOYMENT.md](DEPLOYMENT.md): environment reference and deployment targets
