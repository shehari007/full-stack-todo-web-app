# Security

How TaskFlow protects accounts and data, what the code actually does, and where
the sharp edges are. Everything below is described as implemented. File paths
are given so you can check any claim against the source.

- [Reporting a vulnerability](#reporting-a-vulnerability)
- [Password storage](#password-storage)
- [Sessions and tokens](#sessions-and-tokens)
- [CSRF](#csrf)
- [Multi-factor authentication](#multi-factor-authentication)
- [Authorisation](#authorisation)
- [File uploads](#file-uploads)
- [Transport and response headers](#transport-and-response-headers)
- [Input handling](#input-handling)
- [Production hardening checklist](#production-hardening-checklist)
- [Known limitations](#known-limitations)

---

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:

<https://github.com/shehari007/full-stack-todo-web-app/security/advisories/new>

Do **not** open a public issue or pull request for a vulnerability. A public
issue is a disclosure: it tells every operator running this code about the
problem at the same moment it tells the maintainer, and there is no patch yet.

A useful report includes the affected version or commit, the endpoint or file
involved, the steps to reproduce it, and what an attacker gains. A proof of
concept against your own installation is welcome; please do not test against
anyone else's.

TaskFlow is a self-hosted, volunteer-maintained project. There is no bounty
programme and no guaranteed response time. Fixes land on `main` and the advisory
is published once a fix exists.

---

## Password storage

Passwords are hashed with **Argon2id** via `@node-rs/argon2`
(`Server/src/lib/password.ts`), with these parameters:

| Parameter | Value | Meaning |
| --- | --- | --- |
| `algorithm` | Argon2id | Hybrid mode that resists both GPU and side-channel attacks |
| `memoryCost` | `19456` | 19 MiB of memory per hash |
| `timeCost` | `2` | Two passes |
| `parallelism` | `1` | One lane |

That is OWASP's recommended Argon2id baseline. The salt and the parameters are
encoded in the digest itself, so every hash is self-describing and the cost can
be raised later without breaking existing rows.

Memory-hardness is the point. Attacking bcrypt or PBKDF2 is mostly a question of
how many hash cores you can buy, and GPUs supply cores by the thousand cheaply.
Argon2id forces each guess through 19 MiB of memory that has to be allocated,
written and read, so a GPU with thousands of cores but a fixed memory bus cannot
run thousands of guesses in parallel. Raising `memoryCost` is the single most
effective hardening knob here if your host has RAM to spare.

Supporting rules in the same file:

- Minimum 12 characters, maximum 128. Length is weighted over composition rules,
  following NIST 800-63B. Mandating a symbol mostly produces `Password1!`.
- Passwords on a short built-in denylist of the most-abused choices
  (`password123`, `qwerty`, `letmein`, `taskflow`, ...) are rejected outright.
- At least 5 distinct characters, which rejects `aaaaaaaaaaaa`.
- `verifyPassword` returns `false` on a malformed digest rather than throwing, so
  a corrupt row cannot be distinguished from a wrong password by status code.

Sign-in against a non-existent account still performs one Argon2 verification
against a throwaway digest (`burnTiming` in
`Server/src/modules/auth/auth.service.ts`). Without it, "no such user" answers in
under a millisecond while a real account takes tens of milliseconds, and that gap
alone enumerates usernames.

Eight consecutive failed sign-ins lock the account for 15 minutes. A correct
password clears the counter even when MFA is still owed: the counter exists to
stop password guessing, and at that point the password is known to be correct.

---

## Sessions and tokens

Two credentials, deliberately different in kind
(`Server/src/lib/tokens.ts`, `Server/src/modules/auth/auth.service.ts`):

| | Access token | Refresh token |
| --- | --- | --- |
| Form | Signed JWT (HS256) | Opaque random string, 32 bytes |
| Lifetime | `ACCESS_TOKEN_TTL`, default `15m` | `REFRESH_TOKEN_TTL_DAYS`, default 30 |
| State | Stateless | Row in `sessions` |
| Cookie | `tf_access`, HttpOnly, path `/` | `tf_refresh`, HttpOnly, path `/api/auth` |

The access token carries `sub`, `role` and `sid` (the session id), with issuer
`taskflow` and audience `taskflow-web`. Verification pins `algorithms: ['HS256']`
(the token's own header never gets to choose the algorithm) and every failure
is collapsed into one `Invalid or expired session` message, because "expired"
versus "bad signature" is useful information to someone probing tokens.

**Why the refresh token is opaque.** A JWT cannot be revoked; that is its whole
design. A random string with a database row behind it can be, which is what makes
"sign out this device" and replay detection possible at all. The trade (one
database lookup per refresh) is paid once every 15 minutes per session.

**Why it is stored as a peppered HMAC.** `sessions.token_hash` holds
`HMAC-SHA-256(JWT_REFRESH_SECRET, token)`, never the token itself. A plain
SHA-256 would let anyone with a copy of the table build a lookup table offline;
keying the hash with a secret that lives in the environment, not the database,
means a database dump alone yields no working tokens. The column has a unique
index, so the hash doubles as the lookup key.

**Rotation and replay detection.** Every call to `POST /api/auth/refresh` issues a
new session row and marks the old one `revoked_at` with `replaced_by` pointing at
its successor. If a token that was already rotated is presented again, that
means two parties hold it (the legitimate client and a thief), so
`rotateSession` revokes **every** session for that account rather than merely
refusing the request, and writes a warning to the log. The alternative, failing
just that one call, leaves the attacker free to keep using whichever copy won the
race.

**`tokensValidFrom` is the global kill switch.** Access tokens are stateless, so
revoking session rows alone would leave outstanding access tokens working until
they expired. `users.tokens_valid_from` is pushed forward by a password change,
an admin password reset, an MFA reset and "sign out everywhere"; `resolveAuth`
rejects any token whose `iat` predates it. Both sides are compared in **whole
seconds**, because a JWT's `iat` has one-second resolution while the Postgres
timestamp has microseconds. Comparing in milliseconds rejected every token
minted in the same second the column was written, which locked users out
immediately after registering or changing their password.

**Revoking one session is also immediate.** `tokensValidFrom` is a per-account
switch, so it cannot express "sign out this one device". The access token carries
the id of the session that minted it, and `resolveAuth` checks that session is
still live (not revoked, not expired) on every request. Without that check,
"sign out this device" and an ordinary logout deleted the refresh token's row
while the stateless access token kept working for the rest of its fifteen
minutes, which is precisely the window someone who had copied the cookie needed.

Every authenticated request re-reads the user row (`Server/src/middleware/auth.ts`)
rather than trusting the token's claims. That costs two indexed lookups (the
user and the session) and buys immediate effect for suspension, role changes and
revocation. Suspending an account also revokes its sessions, so a suspended user
cannot mint a fresh access token from a live refresh token.

Sign-in responses also return `accessToken` and `csrfToken` in the JSON body for
scripts and API clients; browsers ignore them and use the cookies.

---

## CSRF

`csrfProtection` (`Server/src/middleware/auth.ts`) runs globally, before the
routes. It is a **double-submit** check:

1. On sign-in the server sets `tf_csrf` to a fresh 24-byte random value.
2. The client reads that cookie and echoes it in the `X-CSRF-Token` header.
3. The server compares the two with `safeEqual`, a constant-time comparison.

The check applies only to unsafe methods (anything other than `GET`, `HEAD`,
`OPTIONS`) and only when a `tf_access` or `tf_refresh` cookie is actually
present. No cookie credentials means no double-submit surface.

**An origin check runs first, and covers sign-in.** The double-submit token
cannot protect `POST /api/auth/login`, because a visitor who has not signed in
yet has no `tf_csrf` cookie to echo. Left at that, an attacker's page could
submit a cross-site form and log the victim into the *attacker's* account, so
every task and file the victim then created would land in storage the attacker
could read. `SameSite=Lax` does not prevent it: it restricts when cookies are
*sent*, not whether a response may *set* them.

So before the cookie logic, any unsafe request whose `Sec-Fetch-Site` is
something other than `same-origin`/`none`, or whose `Origin` is not in
`ALLOWED_ORIGINS`, is rejected outright. `Sec-Fetch-Site` is set by the browser
and cannot be overridden by page script. Requests carrying neither header are
allowed through: those are not browser requests (curl, a server-to-server call)
and have no victim session to ride on.

**`tf_csrf` is deliberately not HttpOnly.** That looks wrong until you see what
the attack is. A cross-site attacker can *cause* your cookies to be sent (that
is what CSRF is), but the same-origin policy stops them *reading* any response
from this origin, so they cannot learn the cookie's value and cannot construct
the matching header. Making the cookie HttpOnly would hide it from the
legitimate client too, and the mechanism would stop working. The cookie holds no
authority of its own: it is a nonce, not a credential.

**Bearer-authenticated requests skip the check.** A browser never attaches an
`Authorization` header on its own: a script has to set it, and a script on
another origin cannot read the token to set it. There is nothing to forge, so
requiring a CSRF token there would only inconvenience API clients. The bearer
branch is checked before the cookie comparison, so a client that sends both wins
on the bearer token.

The browser client never needs `SameSite=None`. `Frontend/next.config.ts`
rewrites `/api/*` to the Express origin, so from the browser's point of view
everything is same-origin and `SameSite=Lax` (the default, via
`COOKIE_SAME_SITE`) holds as a second, independent layer.

---

## Multi-factor authentication

TOTP (RFC 6238), compatible with any authenticator that reads an `otpauth://`
URI: Google Authenticator, Authy, 1Password, Bitwarden.
(`Server/src/lib/totp.ts`, `Server/src/lib/crypto.ts`.)

**Secrets encrypted at rest.** The secret is 20 bytes (160 bits, the size RFC 4226
specifies for HMAC-SHA1). It is stored in `users.mfa_secret` as AES-256-GCM
ciphertext under `ENCRYPTION_KEY`, formatted `iv.authTag.ciphertext` in base64url
with a fresh random 96-bit IV per encryption. GCM authenticates as well as
encrypts, so a tampered value fails to decrypt rather than decrypting to garbage.
Reusing an IV under the same GCM key breaks the cipher completely, hence the
per-call `randomBytes`.

**Enrolment is two steps.** `POST /api/auth/mfa/setup` generates and stores the
secret but leaves `mfa_enabled` false; `POST /api/auth/mfa/enable` requires a
working code first. A mistyped setup therefore cannot lock a user out of their
own account.

**Replay guard.** A six-digit code stays valid for its whole 30-second step, plus
one step either side for clock drift (`epochTolerance: 30`). Anyone who
intercepts a code could otherwise reuse it inside that window.
`users.mfa_last_time_step` stores the highest step already consumed, and it is
passed back as `afterTimeStep` on the next verification, so a given code works
exactly once. The step is recorded at enrolment confirmation too, not just at
sign-in.

**Recovery codes.** Ten codes are generated at enrolment, in the form
`K7F2A-9QXMB-4TRWD`: 15 characters from a 32-symbol alphabet that excludes
`I`, `O`, `0` and `1` so they can be transcribed from a screen, giving roughly 75
bits. They are stored as **Argon2 digests** (the same parameters as passwords),
never in the clear, which is why they are displayed exactly once: the server
cannot show them again. Using one removes that digest from the array, so a
photographed sheet of codes cannot be replayed. Regenerating codes replaces the
whole set and requires the password.

**Turning MFA off** requires the account password *and* a current code (or a
recovery code). Otherwise a hijacked session could quietly strip the second
factor.

**Policy enforcement.** When `features.requireMfaForPrivileged` is on,
`enforceMfaPolicy` blocks root and admin accounts from the control panel until
they enrol, and `POST /api/auth/mfa/disable` refuses for privileged accounts. The
gate is mounted on `/api/admin` rather than globally, so an administrator caught
by a newly-enabled policy can still reach their own security settings to satisfy
it. Mounting it globally would lock every administrator out of the only screen
that could fix the situation.

**Rate limits.** MFA submission allows 8 attempts per 15 minutes and does not
count successes. Six digits is only 1,000,000 possibilities, so an attacker who
already has the password must not get many guesses.

The intermediate challenge token issued between the password step and the code
step is a separate JWT: audience `taskflow-mfa`, `purpose: "mfa"`, 5-minute
expiry, signed with a different key from access tokens. `verifyAccessToken` will
not accept it.

---

## Authorisation

Three roles: **`root`**, **`admin`**, **`user`**. Root is the owner account.

`requireRole(...)` (`Server/src/middleware/auth.ts`) is explicit: `root` is *not*
implicitly included, so `requireRole('admin')` really does exclude root. Two
named helpers cover the common cases: `requirePrivileged` (`root` or `admin`) and
`requireRoot`.

Every route that acts on an existing account (edit, role, status, quota,
password reset, MFA reset, delete) loads its target through `loadManagedUser`,
which applies one shared gate, `assertCanManage` in
`Server/src/modules/admin/admin.service.ts`. It enforces two rules:

- **An admin may not act on a root or on another admin.** Only root can manage a
  privileged account. Without this rule, an admin who can edit another admin can
  reset that account's password, sign in as it and inherit whatever it could do,
  or simply suspend every other administrator. The one exemption is an admin
  editing their own row, which grants nothing they do not already have.
- **Nobody may destroy themselves.** Role changes, status changes and deletion of
  your own account are refused from the control panel. Self-demotion and
  self-suspension are how an installation ends up with a panel nobody can open.

**Last-root protection.** `assertNotLastRoot` counts active, non-deleted root
accounts and refuses to demote, suspend or delete the last one. The refusal
message tells you the fix: promote another user to root first. There is
deliberately no override. The alternative to this check is editing the database
by hand to get back in.

A status change submitted through `PATCH /api/admin/users/:id` is routed through
the same guard the dedicated status endpoint uses, so `{"status":"suspended"}`
is not a way around the rules.

Other authorisation properties worth knowing:

- Registration never reads a role from the request; new accounts are always
  `user`.
- Role changes do **not** revoke sessions, because `resolveAuth` reads the role
  from the row on every request; the new role is already in force everywhere.
- Suspension, password reset and MFA reset all revoke sessions.
- Users are serialised through `toPublicUser`, an explicit allowlist of fields.
  Admin listings select named columns, so `passwordHash`, `mfaSecret` and
  `mfaRecoveryCodes` never leave the database at all.
- Ownership is expressed as a SQL predicate, not a check on a fetched row, so
  another user's id returns 404 rather than confirming the record exists.
- Site assets (logo, favicon, social image) are root-only to create, and a
  delegated admin cannot delete them even though they can delete users' files.
- The audit log (`Server/src/lib/audit.ts`) is append-only: there is no update or
  delete route. Sensitive fields are `[redacted]` in diffs, and `actorUsername`
  is denormalised so an entry stays readable after the account is deleted.

---

## File uploads

Uploads arrive as a raw request body with the intended name percent-encoded in
`X-Filename`; the bytes go straight into a `bytea` column.
(`Server/src/modules/attachments/attachments.service.ts`,
`Server/src/modules/attachments/attachments.routes.ts`.)

**Magic bytes decide the type, not the client.** `resolveMimeType` runs
`file-type` over the buffer first. Whatever that reports is authoritative and
must appear in the allowlist, so renaming `payload.html` to `photo.png` gains
nothing. The `Content-Type` header the client sent is a hint of last resort.

Formats with no magic bytes (plain text, CSV, Markdown, JSON, SVG) cannot be
detected that way, since a CSV is just text. For those the *extension* proposes a
candidate and the content has to back it up: the buffer must contain no NUL byte
and must decode as strict UTF-8. That is what stops a binary payload being
smuggled in as `report.txt` and served back with a text content type.

**The allowlist** lives in editable site settings (`limits.allowedUploadMimeTypes`,
`Server/src/config/settings.ts`) and defaults to PNG, JPEG, WebP, GIF, SVG, ICO,
PDF, plain text, CSV, Markdown, JSON, ZIP, DOC, DOCX and XLSX. It is an
allowlist, never a blocklist. Avatars are restricted further, to PNG, JPEG,
WebP, GIF and ICO only (`Server/src/modules/profile/profile.service.ts`).

**How SVG is handled, and why.** An SVG is not an image in the sense the other
entries are: it is an XML document that can carry `<script>` and event handlers.
Served inline from your own origin it executes *as* your origin, which turns any
accepted upload into stored XSS against every other route on it. TaskFlow still
accepts SVG, because logos are SVGs, but it is contained three ways:

1. The client's declared `Content-Type` may never select `image/svg+xml`. The
   only route to that type is uploading a file that genuinely ends in `.svg`,
   whose bytes are valid UTF-8. (Real SVGs usually open with an XML prolog, which
   `file-type` reports as `application/xml`; that is narrowed to `image/svg+xml`
   only when the extension says `.svg` and the content is UTF-8, and the
   allowlist still has to accept the result.)
2. `image/svg+xml` is absent from `INLINE_MIME_TYPES`, so the download route
   always answers with `Content-Disposition: attachment`. The file is handed over,
   never rendered live on this origin.
3. Every attachment response carries `Content-Security-Policy: default-src 'none';
   sandbox` and `X-Content-Type-Options: nosniff`, so anything a browser does
   choose to render can neither run script nor call home.

Avatars exclude SVG entirely, for the plain reason that an attachment-disposition
file could never display in an `<img>` anyway.

**Quota enforcement.** Files live in Postgres, so `users.storage_used_bytes` is
the only thing between a user and an unbounded database. Checks run
cheapest-first. An oversized body is rejected by the raw parser before it is
fully buffered, the size ceiling is checked before the buffer is hashed or
sniffed, and the quota check runs last, inside the transaction that will change
the number it read:

- Per-file ceiling by role: `limits.maxUploadBytes` (default 1 MB) for users,
  `limits.maxUploadBytesPrivileged` (default 5 MB) for root and admin.
- Per-account storage: `limits.userStorageQuotaBytes` (default 25 MB) or
  `limits.privilegedStorageQuotaBytes` (default 512 MB), overridable per user by
  an administrator.
- `limits.maxAttachmentsPerTodo`, default 10.
- The owner row is read `FOR UPDATE`, so two concurrent uploads cannot both read
  the same figure, both decide there is room, and both commit.
- The counter is incremented in SQL, not read-modify-write in JavaScript, so a
  concurrent update from another connection cannot be lost. Deletion decrements
  with `GREATEST(..., 0)`, because a negative counter would silently grant that
  user unlimited storage.

**Filenames** are sanitised on the way in (`sanitiseFilename`): control
characters removed, path separators replaced, leading dots and whitespace
stripped, truncated to 200 characters. `../../.ssh/authorized_keys` is inert
while it sits in a database column and stops being inert the first time anyone
writes it to disk or into a zip. Control characters would also let a name inject
a line break into `Content-Disposition`, which is re-encoded on the way out in
both the ASCII and RFC 5987 forms.

---

## Transport and response headers

The API sets its headers with helmet (`Server/src/app.ts`); the Next.js app sets
its own (`Frontend/next.config.ts`).

**CSP on the API origin.** `createApp()` configures five directives:

```ts
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
    sandbox: ['allow-downloads'],
  },
}
```

helmet's `useDefaults` option is left at its default of `true`, so those five
override the matching entries in helmet's own baseline and the remainder of that
baseline is still emitted. The header actually sent is:

```http
Content-Security-Policy: default-src 'none';base-uri 'none';font-src 'self' https: data:;form-action 'none';frame-ancestors 'none';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests;sandbox allow-downloads
```

`default-src 'none'` is the right choice here precisely because this origin
serves JSON and user-uploaded bytes and never serves HTML that should run: there
is no legitimate script, style, image or font for the API to fetch, so nothing
needs a permissive fallback. Be clear-eyed about what the inherited baseline
leaves behind, though: `script-src 'self'`, `style-src 'self' https:
'unsafe-inline'`, `img-src 'self' data:` and `font-src 'self' https: data:` are
helmet's defaults rather than this project's decisions, and each is looser than
`'none'`. Passing `useDefaults: false` would reduce the header to exactly the
five directives above. The policy that actually contains a hostile file is not
this one but the per-response header on the download route
(`default-src 'none'; sandbox`, described under **File uploads**), which inherits
nothing.

Alongside it:

- `Referrer-Policy: no-referrer`.
- `Cross-Origin-Resource-Policy: cross-origin`, because the web app fetches
  attachments from another origin during development.
- HSTS is enabled only when `NODE_ENV=production`: one year,
  `includeSubDomains`, `preload`. Sending it in development would poison
  `localhost` for every other project on your machine.
- `x-powered-by` disabled.
- Attachment responses add their own `Content-Security-Policy` and `nosniff`, as
  described above.

**CORS** is an explicit allowlist with `credentials: true`. The spec forbids
pairing credentials with `*`, and `ALLOWED_ORIGINS` is compared by exact string:
no wildcards, no suffix matching. Requests with no `Origin` header at all
(same-origin, `curl`, server-to-server) are allowed through, which is standard:
the header's absence means no browser is applying an origin boundary in the first
place. Allowed request headers are `Content-Type`, `Authorization`,
`X-CSRF-Token`, `X-Filename` and `X-Request-Id`; `Content-Disposition`,
`X-Request-Id` and the `RateLimit` headers are exposed to clients.

Middleware order in `createApp()` is load-bearing and commented as such: request
id, logging, helmet, CORS, compression, cookie parsing, body parsing, then
`optionalAuth` → `csrfProtection` → `generalLimiter`. Auth is resolved first so
rate limits can be keyed per user rather than per IP, and so the CSRF guard knows
whether credentials arrived by cookie or bearer token.

The Next.js origin sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy`
disabling camera, microphone, geolocation and interest cohorts. Its image
optimiser has an empty `remotePatterns` list, so a compromised settings value
cannot turn it into an open proxy.

**Error responses** never include a stack trace in production
(`Server/src/middleware/error.ts`). Every failure returns the same
`{ "error": { "code", "message", "details"? } }` envelope, so a client branches
on a stable `code` rather than on prose. The correlation id travels as the
`X-Request-Id` response header, set before any other middleware runs and reusing
an upstream `X-Request-Id` when a proxy supplies one; it is additionally copied
into the body as `requestId` on a 500, which is the one case where the user has
nothing else to quote.

---

## Input handling

All request validation is zod schemas applied by `validate({ body, query, params })`
(`Server/src/middleware/validate.ts`). The parsed result *replaces* the original,
so handlers only ever see coerced, checked values.

**Unknown keys are stripped.** zod objects are non-passthrough by default, and
that is a security property rather than a convenience: it blocks mass assignment,
where a client posts `{"role":"root"}` alongside legitimate fields and hopes it
reaches an update statement. A `ZodError` becomes a 422 with per-field messages.

**v1's "sanitiser" was removed, on purpose.** The previous version stripped quotes
and backslashes from every incoming string. It corrupted legitimate data
(`O'Brien` was stored as `OBrien`) and it prevented nothing. SQL injection was
never the exposure it claimed to address: Drizzle, like Sequelize before it,
sends values as **bound parameters**, so a quote in a name is data and never
becomes SQL syntax. Escaping input on the way in is the wrong model anyway; the
correct rule is to validate shape and length on the way in, and escape on the way
*out* according to the destination: HTML, CSV, a header, a PDF. Storing exactly
what the user typed is correct.

Where dynamic SQL is genuinely unavoidable, it is not built from user strings:

- Sort columns come from a lookup table, so `?sort=` never reaches the SQL text.
- `%` and `_` are escaped before being interpolated into a `LIKE` pattern, so a
  search for `100%` does not match everything.
- Analytics granularity is branched on rather than interpolated, because a date
  part cannot be a bind parameter.
- Admin-editable footer and social links must be a relative path or an `http(s)`
  URL (`safeUrl` in `Server/src/config/settings.ts`), which rejects
  `javascript:` and `data:` URLs that would otherwise turn an editable link into
  stored XSS for every visitor.

Body sizes are capped globally: 256 KB for JSON, 64 KB for form bodies. Upload
routes bypass the JSON parser entirely. Otherwise `express.json()` would consume
the body of an uploaded `.json` file before the route's raw parser saw it.

Every environment variable is validated at boot by `Server/src/config/env.ts`. If
something is missing or weak, the process exits with a message naming the key
rather than failing later at request time.

---

## Production hardening checklist

Work through this before exposing an installation. Several items are enforced at
boot (the server refuses to start in production if they are wrong) and those
are marked.

1. **`COOKIE_SECURE=true`** *(enforced)*. Without it, session cookies travel over
   plain HTTP. The server exits at boot if `NODE_ENV=production` and this is
   false, and also if `COOKIE_SAME_SITE=none` is set without it.

2. **`TRUST_PROXY` set to the real number of proxies in front of you.** This is a
   security setting, not a convenience one. Express derives `req.ip` from it, and
   `req.ip` is the rate-limiter key. Set it too high on a directly-exposed server
   and any client can send a forged `X-Forwarded-For`, get a different limiter
   key on every request, and bypass every limit including the sign-in one. Set it
   too low behind a real proxy and every request appears to come from the proxy's
   address, so one visitor's failures exhaust everyone's budget.

   ```text
   bare Node, no proxy .......... TRUST_PROXY=0
   Vercel / Render / Railway .... TRUST_PROXY=1
   Cloudflare -> your proxy ..... TRUST_PROXY=2
   ```

3. **Generate fresh secrets. Never reuse the example values.**

   ```bash
   cd Server
   npm run gen:secret
   ```

   `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32
   characters *(enforced at boot in every environment)* and must differ from each
   other *(enforced in production only)*, so that leaking one does not grant the
   other. `ENCRYPTION_KEY` must be base64 that decodes to exactly 32 bytes
   *(enforced at boot in every environment)*.

   Know what rotation costs before you do it:

   | Secret | Effect of rotating |
   | --- | --- |
   | `JWT_ACCESS_SECRET` | Every outstanding access token stops verifying; clients refresh and recover |
   | `JWT_REFRESH_SECRET` | Every stored `token_hash` becomes unmatchable and every MFA challenge token breaks; everyone is signed out |
   | `ENCRYPTION_KEY` | Existing `mfa_secret` values become undecryptable; **every MFA user must re-enrol** |

   There is no key-versioning or dual-read scheme, so rotating `ENCRYPTION_KEY`
   is a planned maintenance event, not a routine one. Plan to reset MFA for
   affected users from the control panel.

4. **Restrict `ALLOWED_ORIGINS`** to the exact origins that need credentialed
   access, typically just your web app. No wildcards *(enforced)*, and
   `https://` only *(enforced)*. Every extra origin is another site whose XSS
   becomes your problem.

5. **Turn on `requireMfaForPrivileged`** in the root control panel (Settings →
   Features). Enrol at least one authenticator on the root account *before*
   enabling it, and store the recovery codes somewhere other than the machine you
   sign in from.

6. **Change the seeded root password.** If `ROOT_PASSWORD` was left blank,
   `npm run db:seed` generated a strong one and printed it exactly once; that
   output belongs in a password manager, not a terminal scrollback.

7. **Back up the database, and test a restore.** File bytes live in Postgres, so
   a `pg_dump` is a complete backup: attachments included, nothing else to
   synchronise. The corollary is that your dumps grow with every upload, so watch
   their size and keep the per-user quotas honest.

8. **Verify the deployment end to end** after any infrastructure change.
   `scripts/smoke-test.mjs` runs against a *live* API and a real database, so the
   server has to be up and seeded first:

   ```bash
   cd Server
   SMOKE_BASE_URL=https://api.example.com \
   SMOKE_USERNAME=root \
   SMOKE_PASSWORD='the root password' \
   npm run test:smoke
   ```

   `SMOKE_PASSWORD` has no default: without it the script prints its usage and
   exits with code 2 before contacting anything. `SMOKE_BASE_URL` defaults to
   `http://localhost:8000` and `SMOKE_USERNAME` to `root`. The run signs in for
   real and creates data (tasks, an attachment, a probe user) under that
   account, so point it at a staging installation rather than at production.

9. **Watch the logs for two specific warnings.** `Reuse of a rotated refresh
   token detected` means a token was captured and replayed: every session for
   that account has just been revoked, and the user should change their password.
   `Account locked after repeated failed sign-in attempts` in volume means
   someone is guessing.

---

## Known limitations

These are real, they are known, and they are listed here rather than left for you
to discover in production.

**Rate limiting is per-process and in-memory.** `Server/src/middleware/rate-limit.ts`
uses `express-rate-limit`'s default memory store. That is correct for a single
Node instance. Behind several instances, or on serverless where each invocation
may be a fresh process, every process keeps its own counters and the effective
limit is multiplied by the instance count. The store is pluggable (a shared
backend such as Redis restores a single global counter), but nothing of the sort
is wired in by default. Rate limiting is also skipped entirely when
`NODE_ENV=test`.

Note what the credential limiters are keyed on, because the obvious choice is
wrong here. The web app proxies `/api/*` through Next.js, so every browser
request reaches Express from the Next server's address; an IP-keyed sign-in
limiter would put the whole installation in a single bucket, and a handful of
failed attempts from anyone would return 429 to every user for fifteen minutes.
`TRUST_PROXY` does not rescue it either, since the forwarded chain terminates at
the proxy's own egress address. `authLimiter` and `mfaLimiter` therefore key on
the identity being attacked (the submitted identifier, or the account inside the
MFA challenge token), so the limit slows guessing against one account without
letting one attacker deny sign-in to everybody. The other limiters remain keyed
per user, falling back to IP for anonymous callers.

**There is no email verification.** The project sends no email at all: there is
no SMTP configuration, no verification step, and no self-service password reset.
The only reset is administrator-initiated. An address is therefore never proven
to belong to the person who typed it. If that matters for your deployment, close
registration (`features.registrationEnabled`) and create accounts from the
control panel.

Account enumeration itself is closed. `POST /api/auth/register` returns one
message for both collisions, "That username or email is already registered", so
the response cannot be used to test whether a given address has an account.
Sign-in behaves the same way: every credential failure returns
`INVALID_CREDENTIALS` with identical wording, the password is verified *before*
the lockout and suspension checks so that 423 and 403 are only ever reachable by
someone who already knows the password, and a request naming a non-existent
account still performs a decoy Argon2 verification so the timing matches.

**Nothing is scheduled automatically.** `pruneExpiredSessions` exists and works,
but no caller in the codebase invokes it. Expired and revoked session rows
accumulate until something calls it. Analytics retention is likewise only applied
when the root purge endpoint is hit; `analytics.retentionDays` describes what
*would* be deleted, not what has been. If you want either to happen on a
schedule, run it from your platform's cron.

**Analytics IP hashing is pseudonymisation, not anonymisation.** The visitor
identifier is `HMAC-SHA-256(ENCRYPTION_KEY, ip|userAgent|YYYY-MM-DD)`, truncated
to 32 hex characters. The rotating date component means the same visitor produces
a different value tomorrow, which is what makes long-term tracking impossible,
but *within* a single UTC day, the same IP and user agent always produce the same
hash. Anyone holding the key who can also guess a candidate IP and user-agent
string can confirm a match by recomputing it. This is meaningfully weaker than
discarding the IP outright, and it is the deliberate cost of being able to count
unique visitors per day. Note also that consent records, unlike analytics events,
*do* store the IP address and user agent, because a consent record has to
identify the act of consenting well enough to stand up to a regulator.

**Audit writes are best-effort.** `recordAudit` logs a warning and continues if
the insert fails, rather than failing the request. The reasoning is that a full
audit table should not lock every administrator out of the system, but it does
mean the log is not a guaranteed-complete record.

**The password denylist is a token gesture.** It holds around twenty of the most
abused passwords. A real check against a breach corpus belongs behind an API such
as Pwned Passwords, which would add a network dependency the project does not
currently take.

**No CAPTCHA, no bot challenge, no IP reputation.** Sign-in is defended by rate
limiting, account lockout and Argon2's cost. Nothing else. A distributed
attacker with many source addresses gets more attempts than a single-source one.

**Attachment ETags are content hashes.** Files are served with an ETag equal to
the SHA-256 of the content, and in production with
`Cache-Control: private, max-age=31536000, immutable`. Two users uploading
identical files therefore produce identical ETags. This leaks nothing about who
else holds a file (access is still checked by SQL predicate on every request),
but it does mean an ETag is a content fingerprint rather than an opaque
identifier.
