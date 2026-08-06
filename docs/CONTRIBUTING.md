# Contributing to TaskFlow

Thanks for taking the time. This file covers what is specific to this repository:
the conventions you would otherwise have to discover by having a pull request
sent back, and the checks that have to pass before it can be merged.

## Getting set up

Local setup (prerequisites, environment files, migrations, seeding) is in the
[README](../README.md). Follow it once. Everything below assumes you have a
working `Server/.env`, a migrated database and a root account.

Two further documents are worth reading before a first change:
[ARCHITECTURE.md](ARCHITECTURE.md) for why the pieces fit together the way they
do, and [API.md](API.md) for the endpoints and their contracts.

The repository is a two-package monorepo with no workspace tooling; each side
has its own `package.json` and its own `node_modules`:

```text
Server/     Express 5 + Drizzle ORM + PostgreSQL API. TypeScript, native ESM.
Frontend/   Next.js 16 App Router web app. React 19, Ant Design 6.
docs/       Documentation, including this file.
```

Both packages declare an `engines.node` range with an upper bound (`>=20.9.0 <25.0.0`). CI runs Node 22.

The upper bound is deliberate. Vercel resolves `engines.node` to the highest
matching release it offers, so an open-ended range silently moves the runtime to
a new major the day it ships. Bounding it means the Node version changes when
someone edits this file, not when a release happens.

## Conventions

### The API is native ESM

`Server/package.json` sets `"type": "module"` and `Server/tsconfig.json` uses
`module`/`moduleResolution: "NodeNext"`. Every relative import must carry the
extension of the *emitted* file, so `.js` even though the file on disk is `.ts`:

```ts
import { db } from '../db/index.js';   // correct
import { db } from '../db/index';      // TS2835 at compile time, ERR_MODULE_NOT_FOUND at runtime
```

Package imports (`express`, `drizzle-orm`, `zod`) are unaffected. `npm run
typecheck` catches the mistake before you run anything.

### There is exactly one database client

`Server/src/db/index.ts` creates the process's only `pg.Pool` and exports `db`.
Import it; never construct another `Pool` or call `drizzle()` in a module.
Connection limits are per-process and hosted Postgres (Supabase, Neon) enforces
them tightly. A second pool created in a service file doubles the connection
count for no benefit, and that is how the v1 codebase ran out of connections.

Scripts that exit (`db:seed`, `db:migrate`, one-off tooling) should call
`closeConnection()` before exiting so the process does not hang on an open pool.

### Schema changes go through a generated migration

Edit `Server/src/db/schema.ts`, then:

```bash
cd Server
npm run db:generate     # writes drizzle/NNNN_name.sql and updates drizzle/meta/
npm run db:migrate      # applies it to your local database
```

Commit the generated SQL *and* the `drizzle/meta/` changes: they are source,
not build output, and `.gitignore` is written to keep them. Migrations are
forward-only and applied in journal order.

Never hand-edit a migration that is already on `main`. Drizzle records applied
migrations by hash; changing a shipped file means your database and everyone
else's silently diverge. Fix it forward with a new migration instead.

There is deliberately no `db:push` script. `push`-style syncing is what
`sequelize.sync({ alter: true })` did in v1, and on PostgreSQL it can drop a
column to satisfy a type change without asking.

### Ownership belongs in the SQL, not in JavaScript

Every query for user-owned data carries the owner in its `WHERE` clause:

```ts
const [todo] = await db
  .select()
  .from(todos)
  .where(and(eq(todos.id, todoId), eq(todos.userId, userId), isNull(todos.deletedAt)))
  .limit(1);
```

Not `select by id` followed by `if (todo.userId !== userId)`. The predicate
version cannot be bypassed by an early return, a refactor that moves the check,
or a new code path that forgets it; the row simply does not exist for the wrong
caller. It is also why a missing row and someone else's row both produce `404`
rather than `403`: a `403` would confirm that the id exists.

The smoke test asserts it for tasks: a second account gets `404` on both read
and delete. Adding a new owned resource means adding the same check there.

### Adding a setting to the control panel

Two edits, both in `Server/src/config/settings.ts`: a field on the section's zod
schema, and a matching value in that section's defaults object. Nothing else on
the API side.

That is enough because everything reads the registry rather than a second list.
`lib/settings.ts` merges the stored row over the defaults *before* validating,
so rows written before your field existed inherit its default instead of
surfacing as `undefined`. `SETTINGS_REGISTRY[key].isPublic` is what decides
whether `/api/settings/public` serves the section. Do not add the key anywhere
else, or a private section can be leaked by editing one list and forgetting the
other. `npm run db:seed` inserts only missing sections, so an operator's
customised values survive.

Settings live in a `jsonb` column, so a new field needs no migration.

If the field should be editable, add a `Form.Item` to that section's form in
`Frontend/src/components/admin/`. The forms are hand-written; only the save,
reset and dirty-state behaviour is shared through `SettingsForm`. For a section
flagged `isPublic`, mirror the field in `Frontend/src/types/api.ts` and in
`Frontend/src/lib/settings-defaults.ts`, whose duplicated defaults are what keep
the public pages rendering while the API is unreachable.

### Input validation

Request bodies, queries and params are parsed by zod through the `validate()`
middleware. Zod objects strip unknown keys by default, and that stripping is
load-bearing: it is what stops a client posting `{"role": "root"}` alongside
legitimate fields. Do not loosen a schema with `.passthrough()`, and do not read
a field off `req.body` that the schema does not declare.

Validate shape and length on the way in; escape on the way out. Do not "sanitise"
by stripping characters from user input. Values are always sent to Postgres as
bound parameters, and v1's sanitiser turned `O'Brien` into `OBrien`.

### Frontend

- **Server component by default.** `page.tsx` files are async server components:
  they read initial data through `@/lib/server-api` and pass it to a client
  component. Put `'use client'` on the leaf that needs state, effects or event
  handlers, not on the page, so the data fetch stays on the server and the
  client bundle stays small. `src/app/admin/users/page.tsx` and `UsersTable` are
  the pattern to copy.
- **Use `App.useApp()`, not the static antd APIs.** `message.success(...)`
  imported straight from `antd` renders outside the `ConfigProvider`, so it
  ignores the theme tokens and the branding colours. The tree is already wrapped
  in antd's `<App>` inside `ThemeProvider`; take `const { message, modal } =
  App.useApp()` in the component.
- **Every `Table` needs `scroll={{ x: 'max-content' }}`.** Without it a table
  with more than three columns forces the whole page to scroll sideways on a
  phone instead of scrolling inside its own container.
- **`src/proxy.ts` is Next 16's renamed `middleware.ts`.** It only redirects on
  the presence of a session cookie so signed-out visitors do not see a dashboard
  flash. It cannot verify a token and must never become an authorisation check.
  The API is the only place that decides what a caller may do.
- **Browser code calls relative `/api/...` paths** through `@/lib/api`, which
  `next.config.ts` rewrites to the Express origin. Never point the browser at the
  API origin directly: same-origin is what lets the session cookies stay
  `SameSite=Lax` instead of the much weaker `SameSite=None`.

### Comments explain why

The comment style here is deliberate: say why the code is the way it is (the
constraint, the failure it prevents, the alternative that was rejected) and
leave out what the next line plainly says.

```ts
// Cleared on the next tick so every awaiting caller sees the same result.
queueMicrotask(() => { refreshInFlight = null; });
```

A comment that restates its line is worse than none; it goes stale and it hides
the reasoning that was actually worth keeping. If nothing surprising is
happening, write nothing.

### Formatting

There is no committed Prettier configuration, so `npm run format` falls back to
Prettier's defaults (double quotes, 80 columns), which do not match the tree.
Do not run it across the repository in a pull request. Match the surrounding
style instead: single quotes, roughly 100 columns.

## Running the checks

These are exactly what CI runs (`.github/workflows/ci.yml`), so a green local run
is a green pipeline.

### API

```bash
cd Server
npm ci
npm run typecheck
npm run build
```

The end-to-end smoke test needs a running server and a seeded root account. In
one terminal:

```bash
cd Server
npm run db:migrate
npm run db:seed        # prints the root password once; copy it
npm run dev
```

In another:

```bash
cd Server
SMOKE_PASSWORD='the-password-the-seed-printed' npm run test:smoke
```

PowerShell:

```powershell
cd Server
$env:SMOKE_PASSWORD = 'the-password-the-seed-printed'
npm run test:smoke
```

`SMOKE_BASE_URL` (default `http://localhost:8000`) and `SMOKE_USERNAME` (default
`root`) can be overridden. The script exits with code 2 if `SMOKE_PASSWORD` is
missing or if the account has MFA enabled, and it must finish with
`0 failed`.

It signs in, creates tasks, uploads an attachment and registers a probe user, so
point it at a development database, never a real one.

### Web

```bash
cd Frontend
npm ci
npm run typecheck
npm run build
```

There is a `lint` script in `Frontend/package.json`, but Next 16 removed the
`next lint` command and no ESLint configuration is committed, so typecheck and
build are the checks that actually run.

## Pull requests

- **One change per pull request.** A bug fix, a feature or a refactor, not two
  of them. Small diffs get reviewed; large ones sit.
- **Branch from `main`** and keep the branch rebased on it.
- **Checks pass.** Typecheck and build on both sides, and the smoke test if you
  touched anything the API serves.
- **Say why in the description.** What the behaviour was, what it is now, and
  what you decided against. The diff already says what changed.
- **Include the generated migration** when you touched `schema.ts`, and mention
  in the description whether it is safe to run against a populated database.
- **No drive-by changes.** No reformatting files you did not otherwise edit, no
  dependency bumps bundled with a feature, no renames mixed into a fix.
- **Say if you changed a default.** Anything in `config/settings.ts`,
  `config/env.ts` or `.env.example` affects existing installations on upgrade.

## Reporting a security problem

Do not open a public issue, a pull request or a discussion for a vulnerability.
Report it privately; the process and contact details are in
[SECURITY.md](SECURITY.md). That includes anything that looks like
authentication bypass, cross-user data access, privilege escalation, or a way to
get a hostile file past upload validation.
