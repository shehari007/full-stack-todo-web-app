# TaskFlow API Reference

Complete reference for the TaskFlow HTTP API (`Server/`, Express 5 + Drizzle ORM + PostgreSQL).

Every endpoint below was read from the route files in `Server/src/modules/*/*.routes.ts` and the mount table in `Server/src/routes.ts`. Nothing is aspirational: if it is documented here, it exists in the code.

---

## Contents

- [Conventions](#conventions)
- [Authentication](#authentication)
- [The two-step MFA sign-in](#the-two-step-mfa-sign-in)
- [Uploads](#uploads)
- [Auth](#auth-apiauth)
- [Todos](#todos-apitodos)
- [Attachments](#attachments-apiattachments)
- [Profile](#profile-apiprofile)
- [Exports](#exports-apiexports)
- [Personal access tokens](#personal-access-tokens-apitokens)
- [The public read API](#the-public-read-api-apiv1)
- [Admin](#admin-apiadmin)
- [Settings](#settings-apisettings)
- [Analytics and consent](#analytics-and-consent-apianalytics)

---

## Conventions

### Base URL

Everything is mounted under `/api`. There are two ways to reach it, and which one you use decides how you authenticate.

| Caller | Base URL | Why |
| --- | --- | --- |
| Browser (the TaskFlow web app) | `/api` on the Next.js origin, e.g. `http://localhost:3000/api` | `next.config.ts` rewrites `/api/:path*` to the Express origin, so the browser only ever talks to one origin and the session cookies can stay `SameSite=Lax` |
| Scripts, CLI, server-to-server | The Express origin directly, e.g. `http://localhost:8000/api` | No proxy hop needed; use a bearer token rather than cookies |

The Express port comes from `PORT` (default `8000`). Cross-origin browser callers must be listed in `ALLOWED_ORIGINS`. Credentialed CORS forbids `*`, and the server enforces an exact allowlist.

Two endpoints need no session and stay reachable while maintenance mode is on. Only the first of them sits outside the `/api` prefix; `/api/health` is mounted under it and is named explicitly as an exemption by the maintenance gate:

```http
GET /
```

```json
{
  "name": "TaskFlow API",
  "version": "2.1.0",
  "status": "ok",
  "docs": "https://github.com/shehari007/full-stack-todo-web-app/blob/main/docs/API.md"
}
```

```http
GET /api/health
```

```json
{ "status": "ok", "uptime": 3874, "timestamp": "2026-08-06T09:14:22.418Z" }
```

### Request and response format

Request bodies are JSON (`Content-Type: application/json`), capped at 256 kB. URL-encoded form bodies are also parsed, capped at 64 kB. The three upload routes are the exception and take raw bytes (see [Uploads](#uploads)).

Successful responses are JSON objects with a single named key (`{ "todo": ... }`, `{ "user": ... }`, `{ "settings": ... }`) rather than a bare value. Timestamps are ISO 8601 strings. `204` responses have no body.

Request validation runs through zod, and **unknown keys are stripped**, not rejected. Posting `{"title":"x","role":"root"}` silently drops `role`. This is deliberate mass-assignment protection, so do not rely on an error to tell you a field name was wrong.

### The error envelope

Every failure (validation, authorisation, database constraint, unhandled exception) comes back in one shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields need attention",
    "details": {
      "password": ["Password must be at least 12 characters"],
      "email": ["Enter a valid email address"]
    }
  }
}
```

- `code` is stable and machine-readable. **Branch on this, never on `message`**, because the prose is allowed to change.
- `message` is safe to show a user.
- `details` is present only when there is structured information to give. For `VALIDATION_FAILED` it is `{ "field.path": ["message", ...] }`, ready to drive a form. For `QUOTA_EXCEEDED` it carries the numbers (`{ "used": ..., "quota": ..., "required": ... }`).

Outside production (that is, whenever `NODE_ENV` is not `production`) a `500` additionally carries `stack`. A `500` always carries `requestId`, which matches the `X-Request-Id` response header. Quote it when reporting a fault.

### Error codes

The complete set, from `Server/src/lib/errors.ts`:

| Code | HTTP | Raised when |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformed request the schema could not catch: unparseable JSON body, a new password identical to the old one, a session id that is not active, `from >= to` on an analytics range |
| `VALIDATION_FAILED` | 422 | A zod schema rejected the body, query or params. `details` holds field-level messages |
| `UNAUTHORIZED` | 401 | No credentials, or a token that is invalid, expired, or was issued before `tokens_valid_from` |
| `INVALID_CREDENTIALS` | 401 | Wrong password. Identical response for "no such account", so sign-in cannot be used to enumerate users |
| `MFA_REQUIRED` | 400 | `POST /api/auth/mfa/disable` was called without a second-factor code |
| `MFA_INVALID` | 401 | Wrong TOTP code, wrong recovery code, or an expired/forged MFA challenge token |
| `ACCOUNT_LOCKED` | 423 | 8 consecutive failed sign-ins; locked for 15 minutes. The message states the remaining time |
| `ACCOUNT_SUSPENDED` | 403 | An administrator suspended the account |
| `FORBIDDEN` | 403 | Role insufficient, CSRF token missing or wrong, a feature switched off in site settings, or a policy refusal (last root, self-suspension, MFA enrolment required) |
| `NOT_FOUND` | 404 | No such record, *or* a record that exists but is not yours. Ownership is a SQL predicate, so the two are indistinguishable by design |
| `CONFLICT` | 409 | Username or email already taken; MFA already enabled; a Postgres unique/foreign-key violation |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeded the parser limit before the route saw it |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | The file's real type is not on `limits.allowedUploadMimeTypes`, could not be identified, or an avatar was not an image |
| `QUOTA_EXCEEDED` | 413 | Over a configured limit: file size, storage allowance, tasks per user, attachments per task. `details` carries the figures |
| `RATE_LIMITED` | 429 | A limiter tripped. Response carries `retryAfterSeconds` instead of `details` |
| `INTERNAL` | 500 | Unhandled fault. `requestId` is always included |

One code is emitted outside that union. When `features.maintenanceMode` is on, every request except `/api/health`, `/api/auth/*` and `/api/settings/*` (and every request from a `root` account) is answered with `503`, a `Retry-After: 600` header, and:

```json
{ "error": { "code": "MAINTENANCE", "message": "TaskFlow is undergoing scheduled maintenance. Please check back shortly." } }
```

### Pagination

Every paginated endpoint takes `page` (default `1`) and `pageSize`, and returns the rows alongside a `pagination` object:

```json
{
  "pagination": { "page": 1, "pageSize": 20, "total": 47, "totalPages": 3 }
}
```

| Endpoint | `pageSize` default | `pageSize` max | `totalPages` when empty |
| --- | --- | --- | --- |
| `GET /api/todos` | 20 | 100 | `1` |
| `GET /api/attachments` | 24 | 100 | `1` |
| `GET /api/admin/users` | 25 | 100 | `0` |
| `GET /api/admin/audit` | 25 | 100 | `0` |

The difference in `totalPages` on an empty result is real: the task and attachment lists floor it at `1`; the admin lists do not. Treat `total` as authoritative.

Sorts are always tie-broken on the primary key, so a row cannot appear on two pages when the sort column has duplicates.

### Rate limits

Limits are applied per user id when the caller is authenticated, otherwise per IP (normalised to a /64 for IPv6). `X-Forwarded-For` is trusted only as far as `TRUST_PROXY` allows. Limiters are skipped entirely when `NODE_ENV=test`.

| Limiter | Window | Limit | Keyed by | Applies to |
| --- | --- | --- | --- | --- |
| general | 60 s | 300 | user or IP | every request, as a backstop |
| auth | 15 min | 10 *failures* | IP | `register`, `login`, `password`, `PUT /profile/email`, `DELETE /profile` |
| mfa | 15 min | 8 *failures* | IP | every `/auth/mfa/*` route |
| write | 60 s | 120 | user or IP | task writes, profile writes, attachment delete, admin writes, `POST /analytics/consent`, `POST /tokens`, `DELETE /tokens/:id` |
| upload | 60 s | 20 | user or IP | `POST /attachments/todos/:todoId`, `POST /profile/avatar`, `POST /admin/assets` |
| export | 60 s | 10 | user or IP | `GET /exports/todos`, `GET /profile/export`, `GET /analytics/summary.csv` |
| public API | 60 s | 120 | **token id** | every route under `/api/v1` |
| analytics | 60 s | 60 | IP | `POST /analytics/collect` |

The auth and MFA limiters set `skipSuccessfulRequests`, so only failures count. Signing in correctly a hundred times will never lock you out, but a ninth wrong TOTP code inside the window will be refused (the limit of 8 is the number of failures *allowed*).

The public API limiter is the only one mounted *after* its authentication step, so that it can key on the token id rather than on an address (see [The public read API](#the-public-read-api-apiv1)). The general limiter still applies underneath it. That one runs application-wide, before `/api/v1` authenticates anything, and a personal access token is not a session, so for a token-only caller it keys on the address.

Headers follow IETF draft-7:

| Header | Meaning |
| --- | --- |
| `RateLimit` | Current state, e.g. `limit=300, remaining=287, reset=41` |
| `RateLimit-Policy` | The policy in force, e.g. `300;w=60` |

Legacy `X-RateLimit-*` headers are disabled. Both draft-7 headers are in the CORS `Access-Control-Expose-Headers` list, so a browser client can read them.

A tripped limiter answers:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many attempts. Please wait 15 minutes before trying again.",
    "retryAfterSeconds": 900
  }
}
```

### Other response headers

| Header | Notes |
| --- | --- |
| `X-Request-Id` | Set on every response; echoes an inbound `X-Request-Id` when a proxy supplied one |
| `Content-Disposition` | On downloads. Exposed to CORS callers |
| `ETag` / `Cache-Control` | On attachment downloads. The strong ETag is the file's SHA-256; `immutable` in production |

---

## Authentication

The API accepts credentials from exactly two places, and treats them differently.

**1. HttpOnly cookies, for the browser.** A successful sign-in sets three cookies:

| Cookie | HttpOnly | Path | Lifetime | Purpose |
| --- | --- | --- | --- | --- |
| `tf_access` | yes | `/` | `ACCESS_TOKEN_TTL` (default 15m) | The access JWT |
| `tf_refresh` | yes | `/api/auth` | `REFRESH_TOKEN_TTL_DAYS` (default 30d) | Opaque rotating refresh token |
| `tf_csrf` | **no** | `/` | matches the refresh token | The double-submit CSRF value |

`tf_csrf` is readable by JavaScript on purpose. That is the whole mechanism. An attacker on another origin can cause the cookie to be *sent* but cannot *read* it to build the matching header.

**2. `Authorization: Bearer <accessToken>`, for scripts.** The same JWT that is put in `tf_access` is also returned in the JSON body of `register`, `login`, `mfa/verify` and `refresh`. Present it as a bearer token and no cookies are needed.

### CSRF applies only to the cookie path

For any method other than `GET`, `HEAD` or `OPTIONS`, the server checks a CSRF token **only when auth cookies are actually present on the request**. Specifically, the check is skipped when:

- neither `tf_access` nor `tf_refresh` is on the request (nothing to forge), or
- an `Authorization: Bearer` header is present (the browser never attaches one on its own).

Otherwise the `tf_csrf` cookie must equal the `X-CSRF-Token` header, compared in constant time. A mismatch is `403 FORBIDDEN` with the message `CSRF token missing or invalid`.

So: **bearer clients never send `X-CSRF-Token`; cookie clients always must on writes.**

### Curl: cookie authentication

```bash
BASE=http://localhost:8000

# Sign in and keep the cookies.
curl -s -c jar.txt -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"root","password":"your-root-password"}'

# Pull the CSRF value out of the jar (field 6 is the name, field 7 the value).
CSRF=$(awk '$6=="tf_csrf"{print $7}' jar.txt)

# A write needs the cookies and the echoed header.
curl -s -b jar.txt -X POST "$BASE/api/todos" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"title":"Write the API docs","priority":"high"}'

# A read needs only the cookies.
curl -s -b jar.txt "$BASE/api/todos?status=todo&pageSize=5"
```

### Curl: bearer authentication

```bash
BASE=http://localhost:8000

TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"root","password":"your-root-password"}' \
  | jq -r '.accessToken')

# No cookie jar, no CSRF header.
curl -s -X POST "$BASE/api/todos" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Written by a script"}'
```

The access token expires in 15 minutes. A script that runs longer than that should either sign in again or keep the refresh cookie and call `POST /api/auth/refresh`.

### How a session is validated

Every authenticated request re-reads the user row rather than trusting the JWT's claims alone. That means suspension, role changes and "sign out everywhere" take effect immediately instead of when the token happens to expire. Three things will reject an otherwise well-formed token:

- the account is soft-deleted → `401 UNAUTHORIZED`
- the account is suspended → `403 ACCOUNT_SUSPENDED`
- the token's `iat` is earlier than the account's `tokens_valid_from` → `401 UNAUTHORIZED`. Changing a password, resetting one as an administrator, or revoking all sessions pushes that timestamp forward.

### Refresh token rotation

`POST /api/auth/refresh` issues a new token trio and revokes the old refresh token, recording the replacement. If a token that was already rotated is presented again, that is treated as theft: **every session for that account is revoked**, and the request fails with `401`.

The practical consequence for clients: never fire concurrent refreshes. Share one in-flight refresh promise, as `Frontend/src/lib/api.ts` does.

### Roles

`root` | `admin` | `user`. Role is never accepted from a request body at registration; new accounts are always `user`.

- `requireAuth`: any signed-in account.
- `requirePrivileged`: `root` or `admin`. Guards the whole admin router and the three installation-wide analytics reports (`/analytics/summary`, `/analytics/installation`, `/analytics/summary.csv`).
- `requireRoot`: `root` only. Guards irreversible or installation-wide operations.

Root is not implicitly granted admin routes by inheritance; each guard lists the roles it allows, and `requirePrivileged` names both.

Two policy gates sit on top:

- **`enforceMfaPolicy`** is applied to `/api/admin/*` only. When `features.requireMfaForPrivileged` is on, a privileged account without MFA gets `403 FORBIDDEN` with `details: { "reason": "mfa_enrolment_required" }`. It is scoped to the admin router precisely so the affected user can still reach `/api/auth/mfa/*` to enrol.
- **`maintenanceGate`** is applied to all of `/api`, as described under [Error codes](#error-codes).

---

## The two-step MFA sign-in

`POST /api/auth/login` has **two different 200 responses**. This is the single most confusing part of the API, so read this section before writing a login screen.

The server does not know whether MFA is owed until it has checked the password, so it cannot tell you in advance. Both outcomes are `200 OK` and neither is an error envelope. Branch on the presence of `mfaRequired`.

### Outcome A: no MFA on the account, so you have a session

```json
{
  "user": { "id": "9f1c...", "username": "alice", "mfaEnabled": false, "...": "..." },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "csrfToken": "0Qb7vJ8nK2mS4pW1xR6tZ9yA"
}
```

Cookies are set. You are signed in.

### Outcome B: MFA is enabled, so you have a challenge rather than a session

```json
{
  "mfaRequired": true,
  "challengeToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "methods": ["totp", "recovery_code"]
}
```

**No cookies are set and there is no `accessToken`.** The `challengeToken` is a separate short-lived JWT that proves only "this person knows the password". It is signed with a different key and carries a different audience (`taskflow-mfa`), so it is rejected outright by any authenticated endpoint. It expires in **5 minutes**.

`methods` tells the client which inputs to offer: a 6-digit authenticator code, or a recovery code.

### The follow-up call

```http
POST /api/auth/mfa/verify
```

Public (the caller has no session yet). Rate-limited by the MFA limiter: 8 failures per 15 minutes per IP.

| Field | Type | Notes |
| --- | --- | --- |
| `challengeToken` | string, required | Exactly as returned by `login` |
| `code` | string, 6-20 chars, required | Either a 6-digit TOTP code, or a recovery code in `XXXXX-XXXXX-XXXXX` form |

The presence of a `-` is what selects the recovery-code path, so do not strip hyphens on the client. Codes are trimmed and upper-cased server-side.

```bash
BASE=http://localhost:8000

LOGIN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"alice","password":"correct-horse-battery"}')

if [ "$(echo "$LOGIN" | jq -r '.mfaRequired // false')" = "true" ]; then
  CHALLENGE=$(echo "$LOGIN" | jq -r '.challengeToken')
  read -r -p 'Authenticator code: ' CODE

  LOGIN=$(curl -s -c jar.txt -X POST "$BASE/api/auth/mfa/verify" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg t "$CHALLENGE" --arg c "$CODE" '{challengeToken:$t,code:$c}')")
fi

echo "$LOGIN" | jq -r '.user.username'
```

On success the response is byte-for-byte the same shape as Outcome A (`{ user, accessToken, csrfToken }`), and the cookies are set. From this point the two paths are identical.

### Failure modes

| Situation | Status | Code |
| --- | --- | --- |
| Challenge token expired, forged, or wrong audience | 401 | `MFA_INVALID` (`MFA challenge expired. Please sign in again`) |
| Wrong TOTP code, or one already used | 401 | `MFA_INVALID` |
| Wrong recovery code | 401 | `MFA_INVALID` |
| Ninth failed attempt in the window | 429 | `RATE_LIMITED` |

A TOTP code is accepted within ±30 seconds of its window, and the consumed time step is recorded, so **the same code cannot be replayed**. A recovery code is consumed on use and removed from the account.

The failed-sign-in counter that drives `ACCOUNT_LOCKED` is cleared as soon as the password verifies, even when MFA is still owed. Password guessing and code guessing are metered separately.

---

## Uploads

Three routes take **raw bytes as the request body** instead of multipart form data:

- `POST /api/attachments/todos/:todoId`
- `POST /api/profile/avatar`
- `POST /api/admin/assets`

There is exactly one file and no accompanying form fields, so multipart would buy a dependency, a temp-file lifecycle and a second place a filename could come from. The top-level JSON parser is bypassed for these three paths specifically, so that uploading a `.json` file does not have its body eaten before the route sees it.

### The convention

| Part | Rule |
| --- | --- |
| Body | The file bytes, unencoded. An empty body is `400 BAD_REQUEST` |
| `X-Filename` | The intended filename. Optional; defaults to `upload` (or `avatar`) |
| `Content-Type` | A **hint only**. Never trusted to decide the stored type |

**`X-Filename` is not handled identically on all three routes.** `POST /api/attachments/todos/:todoId` and `POST /api/admin/assets` percent-*decode* the header before sanitising it, so a name with spaces or non-ASCII characters must be percent-encoded. `POST /api/profile/avatar` does not: it runs its own stricter pass first, which deletes every character outside `[A-Za-z0-9_. -]` (including `%`) and truncates to 120 characters. Sending `profile%20photo.png` to the avatar route therefore stores `profile20photo.png`, not `profile photo.png`. Send avatar filenames literally, using only that character set.

### Type detection

The stored MIME type comes from the file's **magic bytes**, via `file-type`. Renaming `payload.html` to `photo.png` gains nothing, and neither does declaring `Content-Type: image/png`.

Formats that have no magic bytes are the one exception. The extension table is exactly: `.txt` / `.text` / `.log` → `text/plain`, `.csv` → `text/csv`, `.md` / `.markdown` → `text/markdown`, `.json` → `application/json`, `.svg` → `image/svg+xml`. Even then the rules are strict:

1. The **extension in `X-Filename`** selects the candidate type. If there is no usable extension, the declared `Content-Type` may act as a fallback, but it is never allowed to select `image/svg+xml`.
2. The candidate must be on `limits.allowedUploadMimeTypes`.
3. The bytes must decode as valid UTF-8 with no NUL byte. A binary payload named `report.txt` is rejected with `415`.

So for text-format uploads, **send the right extension in `X-Filename`**. It is load-bearing, not decorative.

An SVG whose XML prolog makes `file-type` report `application/xml` is re-narrowed to `image/svg+xml` when the filename says `.svg` and the bytes are valid UTF-8.

### Limits and quotas

| Check | Source | Failure |
| --- | --- | --- |
| Per-file size | `limits.maxUploadBytes` (default 1 MB), or `limits.maxUploadBytesPrivileged` (default 5 MB) for `root`/`admin` | `413 QUOTA_EXCEEDED` with `details: { size, limit }` |
| Attachments per task | `limits.maxAttachmentsPerTodo` (default 10) | `413 QUOTA_EXCEEDED` with `details: { limit }` |
| Storage allowance | Per-user `storageQuotaBytes` override, else `limits.userStorageQuotaBytes` (25 MB) / `limits.privilegedStorageQuotaBytes` (512 MB) | `413 QUOTA_EXCEEDED` with `details: { used, quota, required }` |
| Type allowlist | `limits.allowedUploadMimeTypes` | `415 UNSUPPORTED_MEDIA_TYPE` |
| Feature switch | `features.attachmentsEnabled` | `403 FORBIDDEN` |

Default allowlist: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`, `image/x-icon`, `application/pdf`, `text/plain`, `text/csv`, `text/markdown`, `application/json`, `application/zip`, `application/msword`, and the OOXML `.docx` / `.xlsx` types.

Site assets (`POST /api/admin/assets`) belong to the installation, not the uploader, so they count against nobody's quota.

Filenames are sanitised on the way in: percent-decoded, control characters stripped, path separators (`/` and `\`) each **replaced with `_`**, leading dots and whitespace removed, truncated to 200 characters, falling back to `upload` if nothing survives. (The avatar route applies its own narrower pass first; see above.)

### Curl

```bash
BASE=http://localhost:8000

curl -s -X POST "$BASE/api/attachments/todos/$TODO_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/pdf' \
  -H 'X-Filename: quarterly-report.pdf' \
  --data-binary @quarterly-report.pdf
```

```json
{
  "attachment": {
    "id": "6b2e7f0a-6c1d-4b8e-9a3f-2d5c8e1f4a70",
    "kind": "todo_file",
    "userId": "9f1c3d5e-7a2b-4c6d-8e0f-1a2b3c4d5e6f",
    "todoId": "3c7a1b2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "filename": "quarterly-report.pdf",
    "mimeType": "application/pdf",
    "byteSize": 284117,
    "checksum": "9d5ea3...",
    "width": null,
    "height": null,
    "createdAt": "2026-08-06T09:22:41.006Z"
  }
}
```

On the two `sanitiseFilename` routes above, a name with spaces or non-ASCII characters must be percent-encoded, so `quarterly report.pdf` becomes `quarterly%20report.pdf`.

The avatar route is the exception: it strips `%` along with everything else outside `[A-Za-z0-9_. -]`, so the name goes in literally.

```bash
curl -s -X POST "$BASE/api/profile/avatar" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: image/png' \
  -H 'X-Filename: profile photo.png' \
  --data-binary @avatar.png
```

Image dimensions are read from the header bytes for PNG, JPEG, GIF and WebP and returned as `width` / `height`. Anything unrecognised or truncated returns `null` for both rather than failing the upload.

---

## Auth (`/api/auth`)

Mounted without a blanket guard; each route states its own.

### `POST /api/auth/register`

Public. Auth limiter. Refused with `403 FORBIDDEN` when `features.registrationEnabled` is off.

| Field | Type | Rules |
| --- | --- | --- |
| `username` | string, required | 3-32 chars, `[a-zA-Z0-9_-]` only, lowercased on save |
| `email` | string, required | Valid address, max 254, lowercased on save |
| `password` | string, required | 12-128 chars, at least 5 distinct characters, not on the common-password list |
| `displayName` | string, optional | Max 64 |
| `acceptedTerms` | `true`, **required** | Must be literally `true`; any other value is a `422` |

New accounts are always created with role `user`. Registration signs you straight in.

`201 Created`:

```json
{
  "user": {
    "id": "9f1c3d5e-7a2b-4c6d-8e0f-1a2b3c4d5e6f",
    "username": "alice",
    "email": "alice@example.com",
    "displayName": "Alice",
    "bio": null,
    "avatarId": null,
    "role": "user",
    "status": "active",
    "mfaEnabled": false,
    "timezone": "UTC",
    "locale": "en",
    "theme": "system",
    "storageUsedBytes": 0,
    "storageQuotaBytes": null,
    "createdAt": "2026-08-06T09:10:03.771Z",
    "lastLoginAt": "2026-08-06T09:10:03.912Z"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "csrfToken": "0Qb7vJ8nK2mS4pW1xR6tZ9yA"
}
```

This `user` object, built by naming every field explicitly and never by deleting sensitive ones, is the only shape a user is returned in anywhere in the API. `storageQuotaBytes: null` means "use the role default from site settings".

Conflicts return `409 CONFLICT` with either `That username is already taken` or `An account with that email already exists`.

### `POST /api/auth/login`

Public. Auth limiter. **Two possible 200 responses**; see [The two-step MFA sign-in](#the-two-step-mfa-sign-in).

| Field | Type | Rules |
| --- | --- | --- |
| `identifier` | string, required | Username *or* email; resolved server-side. Max 254 |
| `password` | string, required | 1-128 |
| `rememberMe` | boolean, optional | Accepted by the schema and defaulted to `false`, but **not currently read by the handler**: session lifetime is always `REFRESH_TOKEN_TTL_DAYS` |

### `POST /api/auth/mfa/verify`

Public. MFA limiter. Documented in full [above](#the-follow-up-call).

### `POST /api/auth/refresh`

No `requireAuth`: the point is that the access token has already expired. Reads the `tf_refresh` cookie; a bearer token will not work here.

Because a cookie is in play on a `POST`, this call **does** need the `X-CSRF-Token` header echoing the `tf_csrf` cookie, exactly like any other cookie-authenticated write.

Returns `{ user, accessToken, csrfToken }` and sets a fresh cookie trio. Missing cookie, expired token, revoked session, or a deleted account all give `401 UNAUTHORIZED`. A suspended account gives `403 ACCOUNT_SUSPENDED`.

Presenting an already-rotated token revokes every session for the account.

### `POST /api/auth/logout`

No auth required: an already-invalid token still clears the cookies. Revokes the session matching the `tf_refresh` cookie on a best-effort basis, writes an audit entry when there is a session, clears all three cookies. `204 No Content`.

### `GET /api/auth/me`

`requireAuth`. Returns `{ "user": ... }` in the shape shown above.

### `GET /api/auth/sessions`

`requireAuth`. Active, unrevoked, unexpired sessions for the caller, most recently used first.

```json
{
  "sessions": [
    {
      "id": "b7d2e4f6-1a3c-4e5b-9d8f-0c2a4e6b8d0f",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "ipAddress": "203.0.113.24",
      "createdAt": "2026-08-04T18:02:11.442Z",
      "lastUsedAt": "2026-08-06T09:08:57.130Z",
      "expiresAt": "2026-09-03T18:02:11.442Z",
      "current": true
    }
  ]
}
```

`current` marks the session the calling token belongs to.

### `DELETE /api/auth/sessions/:sessionId`

`requireAuth`. `sessionId` must be a UUID. Revokes one of the caller's own sessions; another user's session id is simply "not active".

`204 No Content`. Cookies are cleared if you revoked the session you are calling from. A session that is already revoked or does not exist gives `400 BAD_REQUEST` (`That session is no longer active`).

### `POST /api/auth/sessions/revoke-all`

`requireAuth`. No body. Revokes every session **and** pushes `tokens_valid_from` forward, so outstanding stateless access tokens die immediately rather than at expiry. Clears cookies. `204 No Content`.

### `POST /api/auth/password`

`requireAuth`. Auth limiter, because the body carries a password.

| Field | Type | Rules |
| --- | --- | --- |
| `currentPassword` | string, required | |
| `newPassword` | string, required | Same policy as registration |

Other devices are signed out; the calling session is kept.

```json
{ "message": "Password updated. Other devices have been signed out." }
```

Wrong current password → `401 INVALID_CREDENTIALS`. New password identical to the old one → `400 BAD_REQUEST`.

### `POST /api/auth/mfa/setup`

`requireAuth`. MFA limiter. No body. Step 1 of enrolment: generates a 160-bit TOTP secret and stores it **encrypted** (AES-256-GCM), but leaves `mfaEnabled` false until a working code proves the authenticator was set up.

```json
{
  "secret": "JBSWY3DPEHPK3PXP...",
  "otpauthUri": "otpauth://totp/alice?secret=JBSWY3DPEHPK3PXP...&issuer=TaskFlow",
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
}
```

`secret` is returned so it can be typed in by hand when the camera fails. `qrCode` is a 240 px data-URI PNG. `issuer` comes from `branding.siteName`.

`409 CONFLICT` if MFA is already enabled.

### `POST /api/auth/mfa/enable`

`requireAuth`. MFA limiter. Step 2.

| Field | Type | Rules |
| --- | --- | --- |
| `code` | string, required | Exactly 6 digits |

```json
{
  "message": "Multi-factor authentication is now enabled.",
  "recoveryCodes": [
    "K7F2P-9QXM4-TRW8H",
    "M3JD6-YT2NR-QK9VZ"
  ]
}
```

Ten codes are generated. **This is the only time they are ever visible**; they are stored as Argon2 digests. The alphabet excludes `I`, `O`, `0` and `1` so codes can be transcribed from a screen unambiguously.

Wrong code → `401 MFA_INVALID`. Setup not started → `400 BAD_REQUEST`.

### `POST /api/auth/mfa/disable`

`requireAuth`. MFA limiter.

| Field | Type | Rules |
| --- | --- | --- |
| `password` | string, required | Re-authentication |
| `code` | string, optional in the schema | 6-20 chars. **Effectively required**: omitting it returns `400 MFA_REQUIRED` |

Refused with `403 FORBIDDEN` for `root`/`admin` when `features.requireMfaForPrivileged` is on.

```json
{ "message": "Multi-factor authentication has been disabled." }
```

### `POST /api/auth/mfa/recovery-codes`

`requireAuth`. MFA limiter.

| Field | Type | Rules |
| --- | --- | --- |
| `password` | string, required | Re-authentication |

Issues ten fresh codes and invalidates all previous ones.

```json
{
  "message": "New recovery codes generated. Your previous codes no longer work.",
  "recoveryCodes": ["...", "..."]
}
```

`409 CONFLICT` if MFA is not enabled.

---

## Todos (`/api/todos`)

`requireAuth` is applied at the mount. Every query is scoped to the caller in SQL, so another user's task id is a `404`, never a leak.

### `GET /api/todos`

List the caller's live (not trashed) tasks.

| Query param | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string, max 200 | none | Full-text search over title + description. Terms shorter than 3 characters fall back to a substring match, because `plainto_tsquery` drops them. An empty `?q=` means "no filter" |
| `status` | list of `todo` \| `in_progress` \| `done` | none | Repeat the key or comma-separate: `?status=todo&status=done` and `?status=todo,done` are equivalent |
| `priority` | list of `low` \| `medium` \| `high` \| `urgent` | none | Same list handling |
| `tags` | list of strings, max 20, each 1-32 chars | none | Exact match, **any** of the given tags |
| `dueFrom` | date | none | Inclusive lower bound on `dueAt` |
| `dueTo` | date | none | Inclusive upper bound on `dueAt` |
| `overdue` | `true` \| `false` \| `1` \| `0` | none | `true` = past due and not done. `false` = the complement (undated, future, or done) |
| `includeCompleted` | `true` \| `false` \| `1` \| `0` | `true` | `false` excludes `status=done` |
| `sort` | `created` \| `due` \| `priority` \| `position` \| `title` | `created` | |
| `order` | `asc` \| `desc` | `desc` | |
| `page` | integer ≥ 1 | `1` | |
| `pageSize` | integer 1-100 | `20` | |

`sort=due` places undated tasks last in **both** directions, because "no due date" is not the same as "due first". `sort=priority` uses an explicit `urgent > high > medium > low` ranking, not the enum's declaration order.

```json
{
  "todos": [
    {
      "id": "3c7a1b2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "userId": "9f1c3d5e-7a2b-4c6d-8e0f-1a2b3c4d5e6f",
      "title": "Ship the API reference",
      "description": "Cover every module.",
      "status": "in_progress",
      "priority": "high",
      "dueAt": "2026-08-09T17:00:00.000Z",
      "completedAt": null,
      "tags": ["docs", "release"],
      "position": 7,
      "createdAt": "2026-08-05T11:20:44.118Z",
      "updatedAt": "2026-08-06T08:55:02.640Z",
      "deletedAt": null
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

### `GET /api/todos/stats`

Counts for the dashboard. Day and week boundaries use the caller's `timezone`, falling back to UTC for a zone Postgres would reject.

```json
{
  "stats": {
    "total": 42,
    "byStatus": { "todo": 18, "in_progress": 6, "done": 18 },
    "byPriority": { "low": 9, "medium": 20, "high": 10, "urgent": 3 },
    "overdue": 4,
    "dueToday": 2,
    "completedThisWeek": 7,
    "completionRate": 0.429,
    "currentStreak": 5
  }
}
```

`completionRate` is a 0-1 fraction rounded to three decimals. `dueToday` and `overdue` both exclude `done` tasks, because they count outstanding work. `currentStreak` is consecutive days ending today or yesterday on which something was completed.

### `GET /api/todos/:id`

One task, with its attachment metadata. `id` must be a UUID.

```json
{
  "todo": {
    "id": "3c7a1b2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "title": "Ship the API reference",
    "...": "...",
    "attachments": [
      {
        "id": "6b2e7f0a-6c1d-4b8e-9a3f-2d5c8e1f4a70",
        "filename": "quarterly-report.pdf",
        "mimeType": "application/pdf",
        "byteSize": 284117,
        "createdAt": "2026-08-06T09:22:41.006Z"
      }
    ]
  }
}
```

The nested attachment objects carry only these five fields, not the full metadata shape returned by the attachments module.

`404 NOT_FOUND` for a missing, trashed, or someone else's task.

### `POST /api/todos`

Write limiter.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `title` | string, **required** | none | 1-200, trimmed |
| `description` | string \| null, optional | `null` | Max 10 000 |
| `status` | `todo` \| `in_progress` \| `done`, optional | `todo` | |
| `priority` | `low` \| `medium` \| `high` \| `urgent`, optional | `medium` | |
| `dueAt` | date \| null, optional | `null` | |
| `tags` | string[], optional | `[]` | Max 20 tags, each 1-32 chars, deduplicated |

`position` is assigned automatically (end of the manual order). `completedAt` is derived from `status` and cannot be set by a client.

Over `limits.maxTodosPerUser` (default 5000, counting only live tasks) → `413 QUOTA_EXCEEDED` with `details: { limit }`.

`201 Created` → `{ "todo": ... }`.

### `PATCH /api/todos/:id`

Write limiter. Same fields as create, all optional, plus `position` (integer 0 to 1 000 000). **At least one field must be present** or the request is a `422`.

Setting `status` to `done` sets `completedAt` to now, or leaves an existing value alone, so re-saving a finished task does not look like finishing it twice. Any other status clears it.

`200 OK` → `{ "todo": ... }`.

### `DELETE /api/todos/:id`

Write limiter. **Soft delete.** Returns `200` with the updated row rather than a bare `204`, so a client can offer undo without re-fetching.

```json
{ "todo": { "id": "3c7a...", "deletedAt": "2026-08-06T09:31:18.220Z", "...": "..." } }
```

Trashed tasks stop counting against `maxTodosPerUser`, but their attachments keep occupying the owner's storage quota until purged.

### `POST /api/todos/:id/restore`

Write limiter. Brings a trashed task back. `404 NOT_FOUND` (`That task is not in the trash`) if it was not deleted. `200` → `{ "todo": ... }`.

### `POST /api/todos/bulk`

Write limiter. One action applied to many tasks in a single statement. The body is a discriminated union on `action`.

| `action` | `ids` | `value` |
| --- | --- | --- |
| `complete` | 1-200 UUIDs | not used |
| `reopen` | 1-200 UUIDs | not used |
| `delete` | 1-200 UUIDs | not used |
| `restore` | 1-200 UUIDs | not used |
| `setPriority` | 1-200 UUIDs | required: `low` \| `medium` \| `high` \| `urgent` |
| `addTags` | 1-200 UUIDs | required: string[], at least 1, max 20 |
| `removeTags` | 1-200 UUIDs | required: string[], at least 1, max 20 |

```json
{ "action": "setPriority", "ids": ["3c7a1b2d-...", "5e9f2a4b-..."], "value": "urgent" }
```

```json
{ "result": { "action": "setPriority", "affected": 2, "ids": ["3c7a1b2d-...", "5e9f2a4b-..."] } }
```

`ids` in the response are the rows that **actually changed**. Ids belonging to someone else, or already in the requested state for `delete`/`restore`, simply do not come back, so the count can legitimately be lower than what you sent. `delete` here is the same soft delete as the single-task route, and is the only bulk action written to the audit log.

`addTags` unions and sorts, so tags stay deduplicated and in a stable order.

### `POST /api/todos/reorder`

Write limiter. Rewrites manual ordering from the array index in one statement.

| Field | Type | Rules |
| --- | --- | --- |
| `ids` | string[] | 1-500 UUIDs, **no duplicates** (a repeated id would ask for two positions at once) |

```json
{ "result": { "affected": 3, "ids": ["3c7a1b2d-...", "5e9f2a4b-...", "7a1c3e5d-..."] } }
```

---

## Attachments (`/api/attachments`)

File bytes live in a `bytea` column in Postgres. Auth is per-route here, not at the mount, because the download route must serve site assets to signed-out visitors.

### `POST /api/attachments/todos/:todoId`

`requireAuth`. Upload limiter. Raw body (see [Uploads](#uploads)).

`todoId` must be a UUID and must belong to the caller and not be trashed, or the response is `404 NOT_FOUND`. Refused with `403 FORBIDDEN` when `features.attachmentsEnabled` is off.

`201 Created` → `{ "attachment": ... }`, in the attachment metadata shape shown in [Uploads](#uploads) and again under [`GET /api/attachments`](#get-apiattachments).

### `GET /api/attachments`

`requireAuth`. A page of the caller's own files.

| Query param | Type | Default |
| --- | --- | --- |
| `page` | integer ≥ 1 | `1` |
| `pageSize` | integer 1-100 | `24` |
| `kind` | `todo_file` \| `avatar` \| `site_asset` | none |
| `todoId` | UUID | none |

Newest first. Files attached to a soft-deleted task are still listed, because they still occupy the quota.

```json
{
  "attachments": [
    {
      "id": "6b2e7f0a-6c1d-4b8e-9a3f-2d5c8e1f4a70",
      "kind": "todo_file",
      "userId": "9f1c3d5e-...",
      "todoId": "3c7a1b2d-...",
      "filename": "quarterly-report.pdf",
      "mimeType": "application/pdf",
      "byteSize": 284117,
      "checksum": "9d5ea3...",
      "width": null,
      "height": null,
      "createdAt": "2026-08-06T09:22:41.006Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 24, "total": 1, "totalPages": 1 }
}
```

### `GET /api/attachments/:id`

`optionalAuth`, so no session is required. Returns the **file bytes**, not JSON.

Visibility is a SQL predicate:

| Caller | Can fetch |
| --- | --- |
| Anonymous | `site_asset` rows only (logo, favicon, social image) |
| Signed-in user | `site_asset` rows and their own files |
| `root` / `admin` | Any file |

Anything else is `404 NOT_FOUND`.

Response headers:

| Header | Value |
| --- | --- |
| `Content-Type` | The stored, magic-byte-verified type |
| `Content-Length` | Byte size |
| `Content-Disposition` | `inline` for PNG, JPEG, GIF, WebP, ICO and PDF; `attachment` for everything else. Both a plain `filename=` and an RFC 5987 `filename*=UTF-8''...` are sent |
| `ETag` | `"<sha256>"`, strong |
| `Cache-Control` | `private, max-age=31536000, immutable` in production; `no-cache` otherwise |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` |

`image/svg+xml` is deliberately excluded from the inline set: an SVG is a scriptable document, and rendering it inline would turn any accepted upload into stored XSS on the API origin.

Send `If-None-Match` to get a `304 Not Modified`. The check runs before the payload is fetched, so a cache hit never pulls the `bytea` out of Postgres.

```bash
curl -s -b jar.txt -o report.pdf -D - \
  "http://localhost:8000/api/attachments/6b2e7f0a-6c1d-4b8e-9a3f-2d5c8e1f4a70"
```

### `DELETE /api/attachments/:id`

`requireAuth`. Write limiter. **Hard delete**: the point of deleting a file is to stop paying for its bytes.

| Caller | May delete |
| --- | --- |
| `user` | Their own files only |
| `admin` | Any user's file, but **not** `site_asset` rows |
| `root` | Anything |

Anything outside that is `404 NOT_FOUND`. The owner's `storageUsedBytes` is credited back in the same transaction, and any profile pointing at the file as its avatar has `avatarId` cleared.

`200 OK` → `{ "attachment": ... }` with the metadata of the row that was removed.

---

## Profile (`/api/profile`)

`requireAuth` at the mount and again on the router. **No route in this module reads a user id from the request**; `req.auth.userId` is the only identity in play.

### `GET /api/profile`

`{ "user": ... }`, the same public shape as `GET /api/auth/me`.

### `PATCH /api/profile`

Write limiter. All fields optional; **at least one required** or `422`.

| Field | Type | Rules |
| --- | --- | --- |
| `displayName` | string \| null | Max 64. `""` is folded to `null` |
| `bio` | string \| null | Max 500. `""` is folded to `null` |
| `timezone` | string | Must be a recognised IANA zone, max 64 |
| `locale` | string | BCP 47 shape, e.g. `en`, `pt-BR`. Max 16 |
| `theme` | `light` \| `dark` \| `system` | |

`200 OK` → `{ "user": ... }`.

### `PUT /api/profile/email`

**Auth limiter**, not the write limiter: the body carries a password, and an unmetered version is a password oracle for anyone holding a stolen session cookie.

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string, required | Valid address, lowercased |
| `currentPassword` | string, required | Re-authentication: the email is the account's recovery channel |

`200 OK` → `{ "user": ... }`. Wrong password → `401 INVALID_CREDENTIALS`. Same address as now → `400 BAD_REQUEST`. Taken → `409 CONFLICT`.

### `POST /api/profile/avatar`

Upload limiter. Raw body, `X-Filename` header (see [Uploads](#uploads)). A static 8 MB parser backstop applies here; the authoritative role-aware ceiling still comes from site settings.

Beyond the installation-wide allowlist, an avatar must be **PNG, JPEG, WebP, GIF or ICO**, judged on the magic-byte type and never the declared one. SVG is excluded because the download route serves scriptable documents as attachments, so an SVG avatar could never display.

The new file is stored before the old one is removed, so a rejected upload never destroys the avatar you already had. A rejected type is rolled back rather than left orphaned against your quota.

`200 OK` → `{ "user": ... }` with the new `avatarId`.

Refused with `403 FORBIDDEN` when `features.attachmentsEnabled` is off. Wrong type → `415 UNSUPPORTED_MEDIA_TYPE`.

### `DELETE /api/profile/avatar`

Write limiter. Clears the pointer and hard-deletes the file, crediting the bytes back. `404 NOT_FOUND` if no avatar is set. `200 OK` → `{ "user": ... }`.

### `GET /api/profile/export`

Export limiter. The GDPR Article 20 portability right. It is **deliberately not gated on `features.exportsEnabled`**, so an operator cannot withdraw it with a feature switch.

Returns a downloadable, indented JSON document:

```http
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="taskflow-export-alice-2026-08-06.json"
```

```json
{
  "format": "taskflow.account-export/1",
  "exportedAt": "2026-08-06T09:40:12.004Z",
  "profile": { "id": "9f1c...", "username": "alice", "...": "..." },
  "todos": [],
  "attachments": [],
  "sessions": [],
  "consentRecords": []
}
```

`todos` includes soft-deleted tasks, because a task in the trash is still your data. `attachments` carries metadata only, with the id each file can be downloaded by; the bytes are not base64-inlined. `sessions` excludes `tokenHash`, which is a live credential.

### `DELETE /api/profile`

Auth limiter. **Permanent erasure**, not a soft delete (GDPR Article 17).

| Field | Type | Rules |
| --- | --- | --- |
| `password` | string, required | |
| `confirmUsername` | string, required | Your own username; compared case-insensitively |

Todos, attachments, sessions and consent records go with the account through `ON DELETE CASCADE`. Audit entries survive on their denormalised `actorUsername` once `actorId` is nulled.

Even self-service deletion is refused with `403 FORBIDDEN` if you are the last active root.

`204 No Content`, cookies cleared.

### `GET /api/profile/stats`

```json
{
  "stats": {
    "todos": {
      "active": 42,
      "byStatus": { "todo": 18, "inProgress": 6, "done": 18 },
      "overdue": 4,
      "inTrash": 3
    },
    "attachments": { "count": 11 },
    "storage": {
      "usedBytes": 4194304,
      "quotaBytes": 26214400,
      "remainingBytes": 22020096,
      "percentUsed": 16
    },
    "account": {
      "createdAt": "2026-05-02T14:11:09.220Z",
      "ageDays": 96,
      "lastLoginAt": "2026-08-06T09:10:03.912Z",
      "mfaEnabled": true,
      "activeSessions": 2
    }
  }
}
```

Note `byStatus.inProgress` is camelCase here, whereas `GET /api/todos/stats` returns `byStatus.in_progress`. A quota of `0` reports `percentUsed: 100`, because a zero allowance is fully consumed by definition.

---

## Exports (`/api/exports`)

`requireAuth` at the mount.

### `GET /api/exports/todos`

Export limiter. Downloads the caller's tasks as a file. Refused with `403 FORBIDDEN` when `features.exportsEnabled` is off.

Scope is always the caller. An administrator wanting someone else's data goes through the admin module, where that access is audited as such.

| Query param | Notes |
| --- | --- |
| `format` | `pdf` \| `csv` \| `xlsx` \| `json` \| `md` \| `ics`. Default `pdf` |
| everything else | Exactly the filter and sort parameters of `GET /api/todos`: `q`, `status`, `priority`, `tags`, `dueFrom`, `dueTo`, `overdue`, `includeCompleted`, `sort`, `order` |

`page` and `pageSize` are **stripped**, not rejected: an export is always the whole matching set, capped at 5000 rows.

| `format` | `Content-Type` | Notes |
| --- | --- | --- |
| `pdf` | `application/pdf` | A4, branded from `branding` and `seo` settings: logo, colours, organisation block, summary stats, status/priority pills |
| `csv` | `text/csv; charset=utf-8` | UTF-8 BOM so Excel on Windows does not mangle accents |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Real date and boolean cells, frozen header row |
| `json` | `application/json; charset=utf-8` | `{ meta, tasks }`, indented |
| `md` | `text/markdown; charset=utf-8` | Grouped by status, checkbox list |
| `ics` | `text/calendar; charset=utf-8` | RFC 5545 `VTODO` entries with a one-day-before `VALARM`. **Undated tasks are omitted**, since there is nothing to place on a calendar |

Response headers:

```http
Content-Disposition: attachment; filename="taskflow-tasks-2026-08-06.pdf"
Content-Length: 148223
Cache-Control: no-store, private
```

The filename slug comes from `branding.siteName`, and the date is rendered in the caller's own timezone.

```bash
curl -s -b jar.txt -OJ \
  "http://localhost:8000/api/exports/todos?format=xlsx&status=todo,in_progress&sort=due&order=asc"
```

---

## Personal access tokens (`/api/tokens`)

`requireAuth` at the mount. This module **manages** tokens; it never **accepts** one. Nothing here treats a personal access token as a credential, so a leaked token cannot be used to mint another, to list its siblings, or to revoke anything. The tokens created here authenticate exactly one surface: [the public read API](#the-public-read-api-apiv1).

Every statement in the service puts the caller's user id in the `WHERE` clause, so another account's token id is a `404`, never a leak.

### Token format

```text
tf_pat_ + base64url(32 random bytes)
```

Fifty characters in total. The `tf_pat_` prefix is there so a leaked token is recognisable in a diff, a log line or a secret scanner. GitHub writes `ghp_` for the same reason. Thirty-two random bytes is 256 bits of entropy, so the stored digest is a plain SHA-256 with no salt or stretching: unlike a password there is no low-entropy secret to protect.

### The plaintext is shown once, and is unrecoverable afterwards

`POST /api/tokens` is the only response anywhere in the API that contains a usable token, and it contains it exactly once.

Only `sha256(token)` is stored. There is no column holding the plaintext, no "reveal" route, no reissue, and no support path: the server cannot reproduce the value because it never kept it. `createToken` even names its `RETURNING` columns one by one rather than using a bare `.returning()`, so the digest is never one spread away from a response body.

**If you lose it, revoke the token and create a new one.** That is the whole recovery procedure.

What *is* kept is `tokenPrefix`: the first 13 characters (`tf_pat_` plus six), stored in the clear purely so a list of tokens can be told apart on screen. It is far too short to be used as a credential.

### `GET /api/tokens`

`requireAuth`. Every token on the account, oldest first. Revoked and expired tokens are included, because the row is the answer to "what was that credential, and when did I turn it off".

```json
{
  "tokens": [
    {
      "id": "1f8b4c6a-2d3e-4f50-8a71-9b2c3d4e5f60",
      "name": "personal-site",
      "tokenPrefix": "tf_pat_K3nQ7x",
      "scopes": ["tasks:read", "stats:read"],
      "lastUsedAt": "2026-08-06T09:41:55.318Z",
      "lastUsedIp": "203.0.113.24",
      "expiresAt": "2027-02-02T09:12:00.000Z",
      "revokedAt": null,
      "createdAt": "2026-08-06T09:12:00.000Z",
      "requestCount30d": 1284
    }
  ],
  "availableScopes": ["tasks:read", "stats:read", "profile:read"]
}
```

| Field | Notes |
| --- | --- |
| `tokenPrefix` | The 13 displayable characters. Never enough to authenticate with |
| `scopes` | Exactly what was stored at creation |
| `lastUsedAt` / `lastUsedIp` | Written on every authenticated call to `/api/v1`. `null` until the token is first used |
| `expiresAt` | `null` means it never expires |
| `revokedAt` | `null` while live. Revocation is a soft delete, so the row stays |
| `requestCount30d` | Sum of the daily usage rollup over the last 30 days, today included. Not a lifetime total |

`tokenHash` is not in the projection and is never returned by any route.

`availableScopes` is shipped alongside the list on purpose, so a create form offers exactly the scopes this build understands instead of a hardcoded copy that drifts from the server's.

### `POST /api/tokens`

`requireAuth`. Write limiter.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `name` | string, **required** | none | Trimmed, 1-80. A label you will recognise later |
| `scopes` | string[], **required** | none | At least 1, at most 3. Every entry must be one of `tasks:read`, `stats:read`, `profile:read`. Deduplicated on save |
| `expiresInDays` | integer \| null, optional | `null` | 1-365. `null` and an absent field both mean "no expiry" |

An unknown scope is a `422 VALIDATION_FAILED`, indexed so the offending checkbox can be highlighted: `details: { "scopes.1": ["Unknown scope \"tasks:write\""] }`.

The API refuses to mint anything longer-lived than a year. A token that never expires is the one that ends up in a public repository five years after the integration was switched off.

An account may hold **10 live tokens**. Revoked and expired ones do not count, so the ceiling is on what can actually reach the API. Over it:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "You already have 10 active tokens. Revoke one to create another.",
    "details": { "limit": 10 }
  }
}
```

`201 Created`:

```json
{
  "token": "tf_pat_9Xq2LmVt0aZbN4cR7sYh1KpD6uF3jW8eG5oT2iA0rXc",
  "apiToken": {
    "id": "1f8b4c6a-2d3e-4f50-8a71-9b2c3d4e5f60",
    "name": "personal-site",
    "tokenPrefix": "tf_pat_9Xq2Lm",
    "scopes": ["tasks:read", "stats:read"],
    "lastUsedAt": null,
    "lastUsedIp": null,
    "expiresAt": "2027-08-06T09:12:00.000Z",
    "revokedAt": null,
    "createdAt": "2026-08-06T09:12:00.000Z",
    "requestCount30d": 0
  }
}
```

The two keys are different things. **`token` is the secret and will never appear in a response again.** `apiToken` is the row `GET /api/tokens` would show, and can be re-read whenever you like. A client that displays this must say plainly that the value will not be shown a second time.

Audited as `token.create`, recording the name, the scopes and the expiry. Those three are the whole of what the credential can do.

```bash
BASE=http://localhost:8000

curl -s -X POST "$BASE/api/tokens" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"personal-site","scopes":["tasks:read","stats:read"],"expiresInDays":365}' \
  | jq -r '.token'
```

(`$TOKEN` here is a session access token, as set up under [Curl: bearer authentication](#curl-bearer-authentication). A personal access token cannot create another.)

### `DELETE /api/tokens/:id`

`requireAuth`. Write limiter. `id` must be a UUID.

A **soft** revoke, not a delete: the row keeps answering "this credential existed and was turned off on this date", which is the question asked after a leak. `revokedAt` is set and the token stops authenticating on its very next request. The middleware reads the row every time, so nothing is cached.

`204 No Content`. A token that does not exist, belongs to someone else, or was already revoked is indistinguishable:

```json
{ "error": { "code": "NOT_FOUND", "message": "That token does not exist, or it has already been revoked" } }
```

Audited as `token.revoke`.

```bash
curl -s -X DELETE "$BASE/api/tokens/1f8b4c6a-2d3e-4f50-8a71-9b2c3d4e5f60" \
  -H "Authorization: Bearer $TOKEN" \
  -o /dev/null -w '%{http_code}\n'
```

### `GET /api/tokens/:id/usage`

`requireAuth`. `id` must be a UUID. Daily request counts for one of the caller's own tokens over the last 30 days.

```json
{
  "usage": [
    { "day": "2026-07-08", "requestCount": 0 },
    { "day": "2026-07-09", "requestCount": 41 },
    { "day": "2026-08-06", "requestCount": 62 }
  ]
}
```

Exactly 30 points, oldest first, ending today. **Days with no traffic are filled in with zero** rather than omitted. A sparse series would draw a gap as a straight line between two distant dates and imply activity that never happened. `day` is a UTC calendar day.

`404 NOT_FOUND` (`That token does not exist`) for a token that is not yours.

---

## The public read API (`/api/v1`)

Read-only, token-authenticated, and scoped to one account's own data.

This is the surface you point your own website at. It exists so that a personal site, a blog widget, a status page or a shell script can render *your* tasks without embedding a session cookie, a password, or a login flow anywhere. Everything it returns is data you already own; there is no route here that writes anything.

It is mounted at `/api/v1` deliberately **outside** `requireAuth`, because it accepts a personal access token and refuses a session cookie, and that refusal is what lets it carry its own CORS policy.

### Authenticating to `/api/v1`

`Authorization: Bearer tf_pat_...`, and nothing else.

**Cookies are refused here.** `authenticateApiToken` runs `delete req.auth` as its first statement (before it reads a header, before it touches the database), discarding whatever the application-wide `optionalAuth` had already resolved from the visitor's `tf_access` cookie. There is no path through the middleware that can leave a cookie-derived identity attached to a request on this surface.

A session JWT presented as a bearer token does not work either: the value must start with `tf_pat_` and be longer than 27 characters, and that shape check happens before the database is consulted at all.

Every rejection uses the same message, so the endpoint cannot be used as an oracle to tell "no such token" apart from "revoked" or "expired":

```json
{ "error": { "code": "UNAUTHORIZED", "message": "A valid personal access token is required" } }
```

| Situation | Status | Code |
| --- | --- | --- |
| No `Authorization: Bearer` header (including a perfectly valid session cookie) | 401 | `UNAUTHORIZED` |
| The value is not `tf_pat_...` shaped | 401 | `UNAUTHORIZED` |
| No token matches the digest | 401 | `UNAUTHORIZED` |
| Token revoked, or past `expiresAt` | 401 | `UNAUTHORIZED` |
| The owning account is soft-deleted | 401 | `UNAUTHORIZED` |
| The owning account is suspended | 403 | `ACCOUNT_SUSPENDED` (`This account has been suspended`) |
| The token does not carry the route's scope | 403 | `FORBIDDEN` (`This token does not carry the "tasks:read" scope`) |

Suspension is named rather than folded into the generic rejection because the holder of a personal token *is* the account owner, and it is the one refusal that tells them what to do about it.

The owner row is joined onto the token lookup rather than fetched afterwards, so suspension and deletion are checked on the same round trip that finds the token and take effect the moment they happen. Nothing about the account is baked into the credential.

Stored scopes are filtered against the current scope list at authentication time, not trusted as written. A scope retired in a later release stays on old rows but stops granting anything.

Every authenticated request also increments that token's daily usage counter and updates `lastUsedAt` / `lastUsedIp`. Those writes are fire-and-forget: a failure is logged and the read still returns. Losing a usage count is cosmetic; failing the read is not.

`/api/v1` is not on the maintenance-mode exemption list, so while `features.maintenanceMode` is on it answers `503 MAINTENANCE` like the rest of `/api`.

### Why wildcard CORS is safe on this surface

This router answers `Access-Control-Allow-Origin: *`.

On a cookie-authenticated endpoint that would be a serious bug. The browser attaches cookies to requests **by itself**, so a wildcard there lets any page on the internet issue a request as the visitor and read the response: the visitor's logged-in data, handed to a hostile origin.

It is safe here, and only for one reason: **this surface accepts no credentials.**

Follow a request from a hostile page through the middleware:

1. **The application-wide CORS layer** uses an exact `ALLOWED_ORIGINS` allowlist with `credentials: true`. An unlisted origin gets no headers from it.
2. **This router strips `Access-Control-Allow-Credentials`** and adds `Vary: Authorization`. The credentialed header and a `*` origin are an invalid pairing that every browser rejects outright, so it is removed rather than left to collide with the policy below.
3. **This router's own CORS policy** is applied: `origin: '*'`, `credentials: false`, methods `GET` and `OPTIONS` only, allowed request headers `Authorization` and `Content-Type`, exposed response headers `RateLimit` and `RateLimit-Policy`, preflight cached for 86400 seconds.
4. **`authenticateApiToken` deletes any session context** the application-wide `optionalAuth` resolved, then requires an `Authorization: Bearer tf_pat_...` header.

`credentials: false` means the browser sends no cookies with the request, and would refuse to hand the response to the page if it had been told to send them, because a wildcard `Access-Control-Allow-Origin` is not valid for a credentialed request. A browser never adds an `Authorization` header on its own initiative. So the hostile page's request arrives anonymous, step 4 rejects it, and the page reads a `401`.

To get data out of this endpoint a caller must already hold the token, and anyone holding the token could call it from curl regardless, with no browser and no CORS involved. **The wildcard therefore grants an attacker nothing they did not already have to steal**, while letting a legitimate user fetch their own tasks from their own static site with no proxy in between.

That argument has exactly one load-bearing premise: **this router must never authenticate a cookie.** Weaken step 4 and the wildcard becomes the bug it looks like.

`Vary: Authorization` is part of the same reasoning. Every response here is selected by the bearer token and nothing else (the URL is identical for every caller), so a cache keyed on the URL alone would serve one token's tasks to another. `Cache-Control: private` keeps shared caches out of it, but the browser's own cache is not a shared cache, and the list routes explicitly invite it to hold a response for thirty seconds.

### Rate limits on this surface

Two limiters apply, and both can fire.

| Limiter | Window | Limit | Keyed by |
| --- | --- | --- | --- |
| general (the application-wide backstop) | 60 s | 300 | IP in practice. It runs application-wide, *before* this router authenticates anything, and a personal access token is not a session, so unless the caller also happens to present session credentials, `optionalAuth` leaves it nothing to key a user on |
| public API | 60 s | 120 | **token id** |

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "This token is making too many requests. The limit is 120 per minute.",
    "retryAfterSeconds": 60
  }
}
```

The public API limiter is mounted *after* authentication so that it can key on the token rather than on an address. These are server-to-server calls: a dozen users' integrations can run on the same PaaS and leave from one egress address. An IP-keyed budget would let the busiest of them throttle everybody else, and would hand an attacker a cheap way to take another customer's integration offline.

`RateLimit` and `RateLimit-Policy` are both on this router's exposed-header list, so a browser client can read its own remaining budget.

### Scopes

Three, and they are flat: no scope implies another.

| Scope | Grants |
| --- | --- |
| `tasks:read` | `GET /api/v1/tasks` and `GET /api/v1/tasks/:id` |
| `stats:read` | `GET /api/v1/stats` |
| `profile:read` | `GET /api/v1/me` and `GET /api/v1/me/avatar` |

Each route requires exactly one named scope. A token carrying `tasks:read` alone gets `403 FORBIDDEN` from `/api/v1/stats`, not a `401`, so a client can tell "wrong credential" from "credential without this permission".

Grant the fewest that make the integration work. A token for a page that lists tasks needs `tasks:read` and nothing more.

### `GET /api/v1/tasks`

Scope: `tasks:read`. The caller's live tasks; soft-deleted ones are never returned.

| Query param | Type | Default | Notes |
| --- | --- | --- | --- |
| `status` | `todo` \| `in_progress` \| `done` | none | A **single** value. Unlike `GET /api/todos`, this is not a list |
| `priority` | `low` \| `medium` \| `high` \| `urgent` | none | A single value |
| `tag` | string, 1-32, trimmed | none | Singular and matched exactly. This is a filter, not the search box; there is no `q` here |
| `limit` | integer 1-100 | `20` | |
| `offset` | integer 0 to 1 000 000 | `0` | |
| `sort` | `created` \| `due` \| `priority` \| `title` | `created` | `position` is accepted by `GET /api/todos` but is **not** in this enum |
| `order` | `asc` \| `desc` | `desc` | |

Note the pagination style: **`limit`/`offset`, not `page`/`pageSize`.** Unknown query keys are stripped rather than rejected, as everywhere else in the API.

`sort=priority` uses the explicit `urgent > high > medium > low` ranking, not the enum's declaration order. Results are tie-broken on the primary key, so two tasks with the same sort value cannot swap between pages and be rendered twice.

```http
Cache-Control: private, max-age=30
Vary: Authorization
```

```json
{
  "tasks": [
    {
      "id": "3c7a1b2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "title": "Ship the API reference",
      "description": "Cover every module.",
      "status": "in_progress",
      "priority": "high",
      "dueAt": "2026-08-09T17:00:00.000Z",
      "completedAt": null,
      "tags": ["docs", "release"],
      "createdAt": "2026-08-05T11:20:44.118Z"
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 47, "hasMore": true }
}
```

Those nine fields are the whole promise. Every column is named in the query rather than selected wholesale, because this is an endpoint whose job is to be embedded in a public web page: `userId`, `position`, `updatedAt` and `deletedAt` are all present on the table and none of them come back. Attachments are absent for the same reason: their bytes live in Postgres and a list query must never reach for them.

`pagination` is a different shape from the rest of the API: `hasMore` is `offset + returned < total`, and there is no `totalPages`.

### `GET /api/v1/tasks/:id`

Scope: `tasks:read`. `id` must be a UUID.

```json
{
  "task": {
    "id": "3c7a1b2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "title": "Ship the API reference",
    "description": "Cover every module.",
    "status": "in_progress",
    "priority": "high",
    "dueAt": "2026-08-09T17:00:00.000Z",
    "completedAt": null,
    "tags": ["docs", "release"],
    "createdAt": "2026-08-05T11:20:44.118Z"
  }
}
```

The same nine fields, keyed `task`. Ownership is a SQL predicate, so a missing task, a trashed one and somebody else's answer identically:

```json
{ "error": { "code": "NOT_FOUND", "message": "That task does not exist" } }
```

This route sets no `Cache-Control` header of its own.

### `GET /api/v1/stats`

Scope: `stats:read`. No query parameters.

The dashboard's own figures, from the same function that answers `GET /api/todos/stats`. Recomputing them here would be a second definition of "overdue" and "streak" that could quietly disagree with what the user sees when they sign in. Day and week boundaries use the account's `timezone`.

```http
Cache-Control: private, max-age=30
```

```json
{
  "stats": {
    "total": 42,
    "byStatus": { "todo": 18, "in_progress": 6, "done": 18 },
    "byPriority": { "low": 9, "medium": 20, "high": 10, "urgent": 3 },
    "overdue": 4,
    "dueToday": 2,
    "completedThisWeek": 7,
    "completionRate": 0.429,
    "currentStreak": 5
  }
}
```

### `GET /api/v1/me`

Scope: `profile:read`. Just enough to render an author byline.

```json
{
  "user": {
    "username": "alice",
    "displayName": "Alice",
    "avatarId": "6b2e7f0a-6c1d-4b8e-9a3f-2d5c8e1f4a70"
  }
}
```

Three columns, named explicitly. Email, role, quota and status are all things a personal site has no use for, and this response is one `fetch` away from being visible in a browser's network tab on somebody else's page. The account id is not returned either.

`displayName` and `avatarId` may be `null`. `404 NOT_FOUND` (`That account does not exist`) if the account has gone.

Note that `avatarId` is an attachment id, but `GET /api/attachments/:id` resolves visibility through the *session* middleware, which cannot resolve a personal access token, so that route will not serve the file to a token holder, and an anonymous caller gets site assets and nothing else. Fetch the image from `GET /api/v1/me/avatar` instead.

### `GET /api/v1/me/avatar`

Scope: `profile:read`. Returns the caller's own avatar as **image bytes**, not JSON.

Without this route the `avatarId` above would be a field nobody holding a token could ever use. The lookup joins through `users.avatar_id` for the authenticated caller rather than taking an id from the URL, so there is no id to tamper with and no way to reach anyone else's file, which is what lets the attachment route's own authorisation stay untouched.

Response headers:

| Header | Value |
| --- | --- |
| `Content-Type` | The stored, magic-byte-verified type |
| `Content-Length` | Byte size |
| `ETag` | `"<sha256>"`, strong, and equal to the stored checksum |
| `Cache-Control` | `private, max-age=300` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` |

Send `If-None-Match` with that ETag to get a `304 Not Modified`. Unlike [`GET /api/attachments/:id`](#get-apiattachmentsid), the check here runs *after* the row is read, so a cache hit still costs the query; it saves the transfer, not the fetch.

An avatar is an image, but the stored type is only whatever passed upload validation, so it is pinned with `nosniff` and sandboxed rather than trusted to render inline.

`404 NOT_FOUND` (`No avatar has been set`) when the account has no avatar.

```bash
curl -s -H "Authorization: Bearer $PAT" -o avatar.png "$BASE/api/v1/me/avatar"
```

### Worked example: curl

```bash
BASE=http://localhost:8000
PAT='tf_pat_9Xq2LmVt0aZbN4cR7sYh1KpD6uF3jW8eG5oT2iA0rXc'

# Five tasks in progress, soonest deadline first.
curl -s -H "Authorization: Bearer $PAT" \
  "$BASE/api/v1/tasks?status=in_progress&sort=due&order=asc&limit=5"

# Everything tagged "release".
curl -s -H "Authorization: Bearer $PAT" \
  "$BASE/api/v1/tasks?tag=release&limit=100"

# Dashboard counters.
curl -s -H "Authorization: Bearer $PAT" "$BASE/api/v1/stats"

# Byline.
curl -s -H "Authorization: Bearer $PAT" "$BASE/api/v1/me"

# Remaining budget for this token.
curl -s -o /dev/null -D - -H "Authorization: Bearer $PAT" "$BASE/api/v1/tasks?limit=1" \
  | grep -i '^ratelimit'
```

No cookie jar and no `X-CSRF-Token`: there are no cookies on this surface and no writes to forge.

### Worked example: browser fetch

```js
const BASE = 'https://taskflow.example.com';
const TOKEN = 'tf_pat_9Xq2LmVt0aZbN4cR7sYh1KpD6uF3jW8eG5oT2iA0rXc';

async function loadTasks() {
  const response = await fetch(`${BASE}/api/v1/tasks?status=todo&limit=10&sort=due&order=asc`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    // Explicit, though fetch's default of 'same-origin' already sends nothing
    // cross-origin. Do not set 'include': a credentialed request is not valid
    // against a wildcard Access-Control-Allow-Origin, and the browser discards
    // the response rather than handing it to the page.
    credentials: 'omit',
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(`${error.code}: ${error.message}`);
  }

  const { tasks } = await response.json();
  return tasks;
}
```

This works from any origin, with no entry in `ALLOWED_ORIGINS` and no proxy, which is the point of the wildcard policy.

Be clear-eyed about what it costs, though: **a token in page JavaScript is public.** Anyone who views source or opens the network tab has it, and can then read everything its scopes allow, from anywhere, until it is revoked. That is an acceptable trade only when the same data is already on the page. If it is not, fetch server-side (below) and render the result instead.

### Worked example: Node

```js
const BASE = process.env.TASKFLOW_URL ?? 'http://localhost:8000';
const TOKEN = process.env.TASKFLOW_TOKEN;

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (response.status === 429) {
    const { error } = await response.json();
    throw new Error(`Rate limited; retry in ${error.retryAfterSeconds}s`);
  }
  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(`${error.code}: ${error.message}`);
  }

  return response.json();
}

/** Walk every page. `limit` is capped at 100 by the server. */
async function allTasks() {
  const tasks = [];
  let offset = 0;

  for (;;) {
    const page = await getJson(`/api/v1/tasks?limit=100&offset=${offset}`);
    tasks.push(...page.tasks);
    if (!page.pagination.hasMore) return tasks;
    offset += page.tasks.length;
  }
}

const [tasks, { stats }] = await Promise.all([allTasks(), getJson('/api/v1/stats')]);
console.log(`${tasks.length} tasks, ${stats.currentStreak}-day streak`);
```

Node 18+ has `fetch` built in, so no HTTP client is needed. The top-level `await` on the last line requires an ES module: a `.mjs` file, or `"type": "module"` in `package.json`. Keep the token in the environment, never in the file.

### Keeping a token safe

- **Store it in an environment variable or a secret manager, never in source.** The `tf_pat_` prefix exists so that scanners can catch the mistake, not so that the mistake is fine.
- **Grant the fewest scopes that work.** A byline widget needs `profile:read`, not all three.
- **Set an expiry.** `expiresInDays` accepts up to 365, and the API will not mint anything longer-lived. A token with a deadline is a token that cannot outlive the integration by five years.
- **Revoke on suspicion, not on proof.** `DELETE /api/tokens/:id` takes effect on the very next request, and minting a replacement costs one call.
- **Watch `lastUsedAt` and `lastUsedIp`** on `GET /api/tokens`, and the per-day series from [`GET /api/analytics/tokens`](#get-apianalyticstokens). Traffic on a day you were not integrating, or from an address you do not recognise, is the signal.
- **Treat a token you put in a web page as published.** Scope it as if it were, because it is.
- Revoking a token does not sign anything else out, and signing out everywhere does not revoke tokens: they are separate credentials with separate lifecycles. Deleting the account removes them with it.

---

## Admin (`/api/admin`)

The whole router sits behind `requireAuth` + `requirePrivileged` + `enforceMfaPolicy`, and the router repeats `requireAuth` + `requirePrivileged` itself rather than depending on the mount site. Routes marked **root** add `requireRoot`.

Two shared rules apply to every user-management route, both enforced in one place:

- **Only root may act on a privileged account.** An admin who could edit another admin could reset that account's password and inherit its access. The one exemption is an admin editing their own row.
- **Nobody may destroy themselves.** Role change, status change and deletion on your own account are refused with `403 FORBIDDEN`.

On top of that, the last active root can never be deleted, demoted or suspended: `403 FORBIDDEN`, `This is the last active root account...`.

### `GET /api/admin/users`

| Query param | Type | Default |
| --- | --- | --- |
| `page` | integer ≥ 1 | `1` |
| `pageSize` | integer 1-100 | `25` |
| `search` | string 1-120 | none |
| `role` | `root` \| `admin` \| `user` | none |
| `status` | `active` \| `suspended` | none |
| `sort` | `createdAt` \| `username` \| `email` \| `role` \| `lastLoginAt` \| `storageUsedBytes` | `createdAt` |
| `order` | `asc` \| `desc` | `desc` |

`search` matches username, email or display name, case-insensitively, with `%` and `_` escaped.

```json
{
  "users": [
    {
      "id": "9f1c3d5e-...",
      "username": "alice",
      "email": "alice@example.com",
      "displayName": "Alice",
      "avatarId": null,
      "role": "user",
      "status": "active",
      "mfaEnabled": true,
      "storageUsedBytes": 4194304,
      "storageQuotaBytes": null,
      "lastLoginAt": "2026-08-06T09:10:03.912Z",
      "lockedUntil": null,
      "createdAt": "2026-05-02T14:11:09.220Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 }
}
```

This is a different projection from the public user object, not a subset of it: it drops `bio`, `timezone`, `locale` and `theme`, and adds `lockedUntil`, which a user's own profile never returns. What both have in common is that `passwordHash`, `mfaSecret` and `mfaRecoveryCodes` are named out of the query entirely; they are never selected from the database at all.

### `GET /api/admin/users/:id`

```json
{
  "user": { "id": "9f1c3d5e-...", "username": "alice", "...": "..." },
  "security": {
    "mfaEnrolledAt": "2026-06-14T08:31:55.100Z",
    "failedLoginCount": 0,
    "lockedUntil": null,
    "tokensValidFrom": "2026-06-14T08:31:55.100Z",
    "updatedAt": "2026-08-01T10:02:44.910Z"
  },
  "counts": { "todos": 42, "attachments": 11, "sessions": 2 }
}
```

`404 NOT_FOUND` for a missing or soft-deleted account.

### `POST /api/admin/users` (**root**)

Write limiter. The only path that can mint a privileged account.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `username` | string, required | none | Same rules as registration |
| `email` | string, required | none | |
| `password` | string, required | none | Same policy as registration |
| `displayName` | string, optional | `null` | Max 64 |
| `role` | `root` \| `admin` \| `user`, **required** | none | Explicit and required: the caller must say so out loud |
| `status` | `active` \| `suspended`, optional | `active` | |

`201 Created` → `{ "user": ... }`. Taken username or email → `409 CONFLICT`.

### `PATCH /api/admin/users/:id`

Write limiter. All fields optional; at least one required.

| Field | Type | Rules |
| --- | --- | --- |
| `displayName` | string \| null | Max 64 |
| `email` | string | Valid address |
| `status` | `active` \| `suspended` | Routed through the same guard as the dedicated status route, so this is not a way around the last-root and self-suspension rules |

Suspending here also revokes every session for the target. `200 OK` → `{ "user": ... }`.

### `PUT /api/admin/users/:id/role` (**root**)

Write limiter. Body: `{ "role": "root" | "admin" | "user" }`.

Sessions are deliberately **not** revoked: the role is re-read from the row on every request, so the change is already in force everywhere.

Already that role → `400 BAD_REQUEST`. `200 OK` → `{ "user": ... }`.

### `PUT /api/admin/users/:id/status`

Write limiter.

| Field | Type | Rules |
| --- | --- | --- |
| `status` | `active` \| `suspended`, required | |
| `reason` | string, optional | Max 280. Recorded in the audit entry only |

Suspending revokes every session. Otherwise a suspended account would simply mint itself a new one when the access token expired.

Already that status → `400 BAD_REQUEST`. `200 OK` → `{ "user": ... }`.

### `PUT /api/admin/users/:id/quota`

Write limiter.

| Field | Type | Rules |
| --- | --- | --- |
| `storageQuotaBytes` | integer \| null, required | 0 to 1 TiB. **`null` clears the override** and returns the account to its role default |

`200 OK` → `{ "user": ... }`.

### `POST /api/admin/users/:id/reset-password` (**root**)

Write limiter. Body: `{ "newPassword": "..." }` (same policy as registration).

Clears the lockout counter too, since an administrator resetting a password is the recovery path for a locked-out user. Pushes `tokens_valid_from` forward and revokes every session. The new password never reaches the audit trail.

```json
{ "message": "Password reset. Every session for that account has been signed out." }
```

### `POST /api/admin/users/:id/reset-mfa` (**root**)

Write limiter. No body. The recovery path when a user has lost both their authenticator and their recovery codes. Clears the secret, the recovery codes and the enrolment, then revokes every session, because the account has just been downgraded to a single factor.

```json
{ "message": "Multi-factor authentication cleared. The user can enrol a new authenticator." }
```

### `DELETE /api/admin/users/:id` (**root**)

Write limiter. Permanent. Cascades to sessions, todos, attachments and consent records. Audit entries survive with `actorId` nulled. `204 No Content`.

### `GET /api/admin/settings`

Every settings section, including the private ones.

```json
{
  "settings": {
    "branding": { "siteName": "TaskFlow", "...": "..." },
    "seo": { "...": "..." },
    "footer": { "...": "..." },
    "legal": { "...": "..." },
    "limits": { "...": "..." },
    "features": { "...": "..." },
    "analytics": { "...": "..." }
  }
}
```

Stored values are merged over the shipped defaults and validated before being returned, so a row written by an older version picks up new fields rather than surfacing as `undefined`. A section whose stored value fails validation falls back to defaults and logs a warning rather than taking the site down.

### `PUT /api/admin/settings/:key`

Write limiter. `key` must be one of `branding`, `seo`, `footer`, `legal`, `limits`, `features`, `analytics`; anything else is `422`.

The body is a **partial** object of that section's fields. It is merged over the current value and the *result* is validated as a whole, so a partial update can never leave a section in a state the schema would reject. An invalid result is a `422`.

```bash
curl -s -b jar.txt -X PUT http://localhost:8000/api/admin/settings/features \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"registrationEnabled":false,"maintenanceMode":false}'
```

```json
{ "settings": { "features": { "registrationEnabled": false, "requireMfaForPrivileged": false, "attachmentsEnabled": true, "analyticsEnabled": true, "exportsEnabled": true, "publicLandingEnabled": true, "maintenanceMode": false, "maintenanceMessage": "TaskFlow is undergoing scheduled maintenance. Please check back shortly." } } }
```

The response is keyed by the section name, containing the whole reconciled section, not just what you sent.

Settings are cached in memory for 30 seconds per instance, so a change is live everywhere within 30 seconds without cross-instance coordination.

The sections and their fields:

| Section | Public | Contains |
| --- | --- | --- |
| `branding` | yes | `siteName`, `tagline`, `logoText`, `logoAttachmentId`, `logoDarkAttachmentId`, `faviconAttachmentId`, `ogImageAttachmentId`, `primaryColor`, `accentColor`, `borderRadius` |
| `seo` | yes | `titleTemplate`, `defaultTitle`, `defaultDescription`, `keywords`, `indexingEnabled`, `canonicalBaseUrl`, `twitterHandle`, `organization{name,legalName,email,phone,addressLine,website}`, `verification{google,bing}` |
| `footer` | yes | `creditLine`, `copyrightHolder`, `copyrightTemplate`, `links[]`, `social[]` |
| `legal` | yes | `policyVersion`, `contactEmail`, `cookieBannerEnabled`, `cookieBannerText`, `privacy`, `terms`, `cookies` (each `{title, body, effectiveDate}`) |
| `limits` | **no** | `maxUploadBytes`, `maxUploadBytesPrivileged`, `userStorageQuotaBytes`, `privilegedStorageQuotaBytes`, `maxAttachmentsPerTodo`, `maxTodosPerUser`, `allowedUploadMimeTypes` |
| `features` | yes | `registrationEnabled`, `requireMfaForPrivileged`, `attachmentsEnabled`, `analyticsEnabled`, `exportsEnabled`, `publicLandingEnabled`, `maintenanceMode`, `maintenanceMessage` |
| `analytics` | **no** | `retentionDays`, `respectDoNotTrack`, `excludeAdminTraffic` |

Colours must be six-digit hex. Footer and social URLs must be a relative path or an `http(s)` URL. `javascript:` and `data:` are rejected, since an admin-editable link is otherwise stored XSS for every visitor.

### `POST /api/admin/settings/:key/reset`

Write limiter. No body. Restores one section to its shipped defaults. `200 OK` → `{ "settings": { "<key>": ... } }`.

### `POST /api/admin/assets` (**root**)

Upload limiter. Raw body, `X-Filename` header (see [Uploads](#uploads)). A 50 MB parser backstop applies; the configured ceiling, the magic-byte check and the filename sanitiser all still run.

Stores a `site_asset` attachment owned by the installation rather than by a user, so it outlives the uploader's account and counts against nobody's quota. The returned id is what you then save into `branding.logoAttachmentId` or one of its siblings.

```bash
curl -s -b jar.txt -X POST http://localhost:8000/api/admin/assets \
  -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: image/png' \
  -H 'X-Filename: logo.png' \
  --data-binary @logo.png
```

`201 Created` → `{ "attachment": ... }`.

### `GET /api/admin/audit`

Read-only. The table is append-only and there is deliberately **no update or delete route**. An administrator covering their tracks would have to reach the database directly.

| Query param | Type | Default |
| --- | --- | --- |
| `page` | integer ≥ 1 | `1` |
| `pageSize` | integer 1-100 | `25` |
| `action` | string, max 64 | none |
| `actorId` | UUID | none |
| `targetType` | string, max 40 | none |
| `targetId` | string, max 64 | none |
| `from` | date | none |
| `to` | date | none |

`action` is an exact match against the dotted verb.

```json
{
  "entries": [
    {
      "id": "d4a8f2c1-...",
      "actorId": "9f1c3d5e-...",
      "actorUsername": "root",
      "action": "user.suspend",
      "targetType": "user",
      "targetId": "2b6e8a0c-...",
      "metadata": { "username": "mallory", "from": "active", "to": "suspended", "reason": "spam" },
      "ipAddress": "203.0.113.24",
      "userAgent": "Mozilla/5.0 ...",
      "createdAt": "2026-08-06T09:44:02.331Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 1, "totalPages": 1 }
}
```

The declared vocabulary is: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.logout_all`, `auth.register`, `auth.password_change`, `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_recovery_used`, `auth.session_revoked`, `user.create`, `user.update`, `user.delete`, `user.suspend`, `user.reactivate`, `user.role_change`, `user.password_reset`, `user.quota_change`, `user.mfa_reset`, `token.create`, `token.revoke`, `todo.bulk_delete`, `attachment.delete`, `settings.update`, `settings.reset`, `site_asset.upload`, `analytics.purge`, `data.export`.

One of those is declared but never written: **`auth.login_failed` has no call site**, so filtering on it always returns an empty page. Failed sign-ins are visible through the account's `failedLoginCount` and `lockedUntil` on `GET /api/admin/users/:id`, not through the audit log.

Two are written from more than one place, so `targetType` is what distinguishes them: `user.update` covers both `PATCH /api/admin/users/:id` and a user changing their own address through `PUT /api/profile/email`; `data.export` covers `GET /api/exports/todos` (`targetType: "todos"`), `GET /api/profile/export` (`targetType: "user"`) and `GET /api/analytics/summary.csv` (`targetType: "analytics_summary"`). `user.delete` likewise covers both the admin route and self-service account deletion, which records `metadata.self: true`.

`token.create` and `token.revoke` both use `targetType: "api_token"` with the token's id. The create entry records the name, the scopes and the expiry (those three are the whole of what the credential can do) and never the token itself.

Sensitive values (`password`, `passwordHash`, `mfaSecret`, `mfaRecoveryCodes`, `data`) are recorded as `[redacted]` in change diffs, and any single diff value over 200 characters is recorded as `[omitted]` so a privacy-policy edit does not bloat the table.

### `GET /api/admin/overview`

Dashboard figures, all computed by Postgres.

```json
{
  "overview": {
    "totalUsers": 128,
    "activeUsers": 124,
    "newUsersThisWeek": 9,
    "totalTodos": 4207,
    "completedTodos": 2611,
    "totalAttachments": 388,
    "storageUsedBytes": 214958080,
    "mfaAdoptionRate": 0.211,
    "signups": [
      { "date": "2026-07-24", "count": 0 },
      { "date": "2026-07-25", "count": 3 }
    ]
  }
}
```

`signups` is always exactly 14 points ending today; days with no signups appear as zeros rather than missing points. `storageUsedBytes` counts every stored byte including site assets, so it will not equal the sum of user quotas. `mfaAdoptionRate` is a 0-1 fraction.

---

## Settings (`/api/settings`)

### `GET /api/settings/public`

**Unauthenticated on purpose.** Next.js calls this during server rendering to build `<title>`, Open Graph tags and the footer. It runs before any visitor has a session, and a crawler never has one at all.

Serves only the sections flagged public in the registry: `branding`, `seo`, `footer`, `legal`, `features`. The private `limits` and `analytics` sections are excluded, because they describe how to attack the installation rather than how to render it.

```http
Cache-Control: public, max-age=60
```

```json
{
  "settings": {
    "branding": {
      "siteName": "TaskFlow",
      "tagline": "A modern, full-stack task manager built for focus.",
      "logoText": "TaskFlow",
      "logoAttachmentId": null,
      "logoDarkAttachmentId": null,
      "faviconAttachmentId": null,
      "ogImageAttachmentId": null,
      "primaryColor": "#4f46e5",
      "accentColor": "#10b981",
      "borderRadius": 8
    },
    "seo": { "...": "..." },
    "footer": { "...": "..." },
    "legal": { "...": "..." },
    "features": { "...": "..." }
  }
}
```

This route stays reachable during maintenance mode.

---

## Analytics and consent (`/api/analytics`)

First-party, cookie-light analytics with no third-party scripts. Auth is per-route. Consent lives in this module because it is the gate on everything else in it.

### `POST /api/analytics/collect`

Public, with `optionalAuth` so a signed-in visitor can be recognised (that is what makes the admin-traffic exclusion work). Analytics limiter: 60/min per IP.

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string, required | Trimmed, 1-64. Must start with a letter or digit, then letters, digits, `.` `_` `:` `-`. The pattern is **case-insensitive**, so `Page_View` is accepted as readily as `page_view`, but the summary groups on the stored string, so pick one casing and keep to it |
| `path` | string, optional | Max 2048. A full `location.href` is accepted; **only the pathname is stored** |
| `referrer` | string, optional | Max 2048. **Only the origin is stored** |
| `metadata` | object, optional | Scalars only (string ≤ 200, number, boolean, null), keys ≤ 40 chars, **at most 10 keys**. Nested objects are rejected |

Two success codes, and they mean different things:

| Status | Meaning |
| --- | --- |
| `202 Accepted` | The event was written |
| `204 No Content` | Every rule was applied and nothing was written |

Both have empty bodies. The client cannot tell *which* rule declined it (that would hand a tracker a way to probe the visitor's settings), but an operator testing their own install can see at a glance whether collection is live.

An event is declined when: `features.analyticsEnabled` is off; `analytics.respectDoNotTrack` is on and the request carries `DNT: 1` or `Sec-GPC: 1`; `analytics.excludeAdminTraffic` is on and the caller is `root`/`admin`; there is no valid analytics consent for the *current* `legal.policyVersion`; or the user agent looks like a bot (an absent user agent counts as a bot).

Declined events never touch the database at all. Writing a row and filtering it out later would be exactly what a visitor sending `DNT: 1` asked us not to do.

What is stored: the event name, the pathname, the referring origin, a coarse device bucket (`mobile` / `tablet` / `desktop`), a two-letter country from the CDN edge header if present, the metadata, and `visitorHash`, a **daily-rotating HMAC of IP + user agent**. Neither the IP nor the user-agent string is stored on the event. `userId` is recorded only for a signed-in, consenting caller, and is nulled if that account is later deleted.

```bash
# -A is not optional here: curl's default user agent matches the bot pattern,
# so without a browser-like one this always answers 204 (declined as a bot).
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:8000/api/analytics/collect \
  -H 'Content-Type: application/json' \
  -H 'Cookie: tf_consent={"a":1,"p":1,"v":"1.0"}' \
  -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' \
  -d '{"name":"page_view","path":"/dashboard?tab=today"}'
```

The `v` in the cookie must equal the installation's current `legal.policyVersion` (`1.0` by default) or the event is declined as `no_consent`.

### `GET /api/analytics/summary`

`requireAuth` + `requirePrivileged`. Note this route is **not** behind `enforceMfaPolicy`, unlike the admin router.

| Query param | Type | Default |
| --- | --- | --- |
| `from` | date | `to` minus 30 days |
| `to` | date | now |
| `granularity` | `day` \| `week` | `day` |

The range is half-open (`to` is exclusive), so consecutive windows tile without double-counting the events on the boundary. `from >= to` is `400 BAD_REQUEST`.

```json
{
  "summary": {
    "range": { "from": "2026-07-07T09:00:00.000Z", "to": "2026-08-06T09:00:00.000Z", "granularity": "day" },
    "totals": { "pageViews": 8412, "uniqueVisitors": 1903, "events": 11077 },
    "series": [
      { "bucket": "2026-07-07", "pageViews": 241, "uniqueVisitors": 88, "events": 310 }
    ],
    "topPaths": [
      { "path": "/dashboard", "views": 3104, "visitors": 902 }
    ],
    "topReferrers": [
      { "referrer": "https://news.ycombinator.com", "views": 214, "visitors": 190 }
    ],
    "deviceBreakdown": [
      { "device": "desktop", "visitors": 1402, "events": 8221 },
      { "device": "mobile", "visitors": 501, "events": 2856 }
    ]
  }
}
```

Buckets are truncated in UTC. `topPaths` and `topReferrers` are capped at 10 entries each. Per-bucket unique counts are computed independently and **do not sum to `totals.uniqueVisitors`**: a visitor present on three days is one visitor overall and three in the series. Both figures are correct readings of different questions.

`deviceBreakdown` may include `"unknown"` for rows with no recorded device.

### `GET /api/analytics/installation`

`requireAuth` + `requirePrivileged`. Not behind `enforceMfaPolicy`, like the summary it is built on.

The whole installation, for an operator: traffic exactly as `/summary` reports it, plus the figures that only make sense at that scale.

| Query param | Type | Default |
| --- | --- | --- |
| `from` | date | `to` minus 30 days |
| `to` | date | now |
| `granularity` | `day` \| `week` | `day` |

The same schema as `/summary`, and the same half-open range; `from >= to` is `400 BAD_REQUEST`.

The response is keyed `installation` and **contains every key `summary` does** (`range`, `totals`, `series`, `topPaths`, `topReferrers`, `deviceBreakdown`) plus six more:

```json
{
  "installation": {
    "range": { "from": "2026-07-07T09:00:00.000Z", "to": "2026-08-06T09:00:00.000Z", "granularity": "day" },
    "totals": { "pageViews": 8412, "uniqueVisitors": 1903, "events": 11077 },
    "series": [{ "bucket": "2026-07-07", "pageViews": 241, "uniqueVisitors": 88, "events": 310 }],
    "topPaths": [{ "path": "/dashboard", "views": 3104, "visitors": 902 }],
    "topReferrers": [{ "referrer": "https://news.ycombinator.com", "views": 214, "visitors": 190 }],
    "deviceBreakdown": [{ "device": "desktop", "visitors": 1402, "events": 8221 }],
    "activeUsers": { "daily": 37, "weekly": 96, "monthly": 124 },
    "retention": [
      { "cohort": "2026-06-15", "users": 14, "retained": 9, "rate": 0.643 }
    ],
    "newVsReturningVisitors": { "new": 1502, "returning": 401 },
    "storageGrowth": [
      { "date": "2026-07-07", "addedBytes": 1048576, "cumulativeBytes": 213909504 }
    ],
    "exportVolume": [{ "date": "2026-07-09", "count": 3 }],
    "uploadVolume": [{ "date": "2026-07-09", "count": 7, "bytes": 3145728 }]
  }
}
```

| Key | Meaning |
| --- | --- |
| `activeUsers` | Accounts whose `lastLoginAt` falls inside the last 1 / 7 / 30 days. Counted from the column, **not** from the event stream, because collection is gated on consent and excludes admin traffic, so it would report a smaller installation than the one that exists. The trade-off is that a long-lived session which never signs in again does not refresh the column, so these are a floor rather than an exact count |
| `retention` | Weekly signup cohorts, anchored to the **current** week and reaching seven weeks back, not to the report's range, because "are the people who joined in March still here" is a question about now. `cohort` is the week's starting `YYYY-MM-DD` (Monday, as `date_trunc('week', ...)` cuts it), `retained` is how many of that cohort signed in during the last 7 days, and `rate` is `retained ÷ users` as a 0-1 fraction to three decimals |
| `newVsReturningVisitors` | Within the window. `visitorHash` rotates daily, so "returning" cannot mean "came back next week"; the identifier is designed not to survive that long. What is measured is whether a visitor opened more than one visit before their identifier rotated, where a gap of more than 30 minutes starts a new visit |
| `storageGrowth` | Daily attachment bytes. The running total deliberately starts *before* the window and is only clipped for presentation, so the curve describes storage rather than uploads |
| `exportVolume` | Counted from `data.export` audit entries: a download is streamed and leaves no other record, so the audit trail *is* the export history |
| `uploadVolume` | Attachment rows created per day, with their total `bytes` |

The three added series (`storageGrowth`, `exportVolume` and `uploadVolume`) are daily regardless of `granularity`; the setting only affects the inherited `series`. (`activeUsers` and `newVsReturningVisitors` are single figures over the window, and `retention` is weekly by construction.) Buckets are truncated in UTC, matching `/summary`, so two figures on the same screen are never cut on different day boundaries.

### `GET /api/analytics/summary.csv`

`requireAuth` + `requirePrivileged`. **Export limiter** (10/min), not the analytics one, because it builds a document.

Takes exactly the query parameters of `/summary` (`from`, `to`, `granularity`) and reports exactly the same figures, rendered as a file.

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="analytics-summary-2026-07-07-to-2026-08-06.csv"
Content-Length: 2184
Cache-Control: no-store, private
```

The filename is built from the resolved range, so it names the window rather than the download date.

Long format, one row per (section, label, metric), rather than a wide table, because the sections do not share columns: a day of traffic, a referring origin and a device bucket have nothing to line up under one header. It pivots cleanly in a spreadsheet, which is what it is for.

```csv
Section,Label,Metric,Value
range,,from,2026-07-07T09:00:00.000Z
range,,to,2026-08-06T09:00:00.000Z
range,,granularity,day
totals,,pageViews,8412
totals,,uniqueVisitors,1903
totals,,events,11077
series,2026-07-07,pageViews,241
series,2026-07-07,uniqueVisitors,88
series,2026-07-07,events,310
topPaths,/dashboard,views,3104
topPaths,/dashboard,visitors,902
topReferrers,https://news.ycombinator.com,views,214
topReferrers,https://news.ycombinator.com,visitors,190
deviceBreakdown,desktop,events,8221
deviceBreakdown,desktop,visitors,1402
```

The file opens with a UTF-8 BOM, so Excel on Windows does not decode a non-ASCII path or referring host with the machine's ANSI codepage and turn it into mojibake.

Audited as `data.export` with `targetType: "analytics_summary"` and `metadata: { format, from, to, granularity }`. That is not bookkeeping for its own sake: `exportVolume` on the installation report is counted from those entries, so an export that skipped the trail would be an export that never happened.

```bash
curl -s -b jar.txt -OJ \
  "http://localhost:8000/api/analytics/summary.csv?from=2026-07-07&to=2026-08-06&granularity=day"
```

### `GET /api/analytics/me`

`requireAuth`: **every signed-in account**, not just privileged ones. The caller's own productivity, scoped to them in SQL; there is no id in the path to tamper with.

| Query param | Type | Default |
| --- | --- | --- |
| `from` | date | `to` minus 90 days |
| `to` | date | now |
| `timezone` | string, 1-64 | The account's own `timezone` |

`from >= to` is `400 BAD_REQUEST`. A range longer than **366 days** is also `400 BAD_REQUEST` (`The range may not be longer than 366 days`). The day series is materialised one row per day, so an unbounded range is a request for an unbounded result set. A timezone Postgres does not recognise falls back to `UTC` rather than failing the request; `range.timezone` reports which zone was actually used.

```http
Cache-Control: no-store
```

```json
{
  "analytics": {
    "range": { "from": "2026-05-08T09:00:00.000Z", "to": "2026-08-06T09:00:00.000Z", "timezone": "Asia/Karachi" },
    "completionSeries": [
      { "date": "2026-05-08", "created": 3, "completed": 1 },
      { "date": "2026-05-09", "created": 0, "completed": 0 }
    ],
    "throughput": { "thisWeek": 11, "lastWeek": 8, "changePct": 37.5 },
    "onTimeRate": 0.812,
    "overdueRate": 0.194,
    "avgCompletionHours": 41.27,
    "byPriority": { "low": 9, "medium": 20, "high": 10, "urgent": 3 },
    "byStatus": { "todo": 18, "in_progress": 6, "done": 18 },
    "topTags": [
      { "tag": "docs", "total": 14, "completed": 9 }
    ],
    "streak": { "current": 5, "longest": 23 },
    "heatmap": [
      { "date": "2026-05-08", "count": 1 },
      { "date": "2026-05-09", "count": 0 }
    ],
    "busiestDayOfWeek": 2,
    "busiestHour": 21
  }
}
```

| Field | Notes |
| --- | --- |
| `completionSeries` | One row per calendar day in the range, in the report's timezone, zero-filled. `generate_series` supplies the calendar, so a day nobody touched is a zero rather than a missing point |
| `throughput` | Anchored on **now**, not on the selected range: "am I moving faster than last week" is a question about this week. `changePct` is a percentage to one decimal, and is `null` when last week was empty, because there is no percentage change from zero |
| `onTimeRate` | 0-1 fraction to three decimals, over tasks completed in the range that had a due date. `null` when that denominator is empty |
| `overdueRate` | 0-1 fraction to three decimals, over dated tasks created in the range that are still not done. Measured against work still open, so finishing a late task improves it. `null` when that denominator is empty |
| `avgCompletionHours` | Mean hours from creation to completion, to two decimals, for tasks completed in the range. `null` when nothing was completed |
| `byStatus` / `byPriority` | Counts of tasks **created** in the range. `byStatus` uses `in_progress`, matching `GET /api/todos/stats` and not `GET /api/profile/stats` |
| `topTags` | Capped at 10, ordered by total descending then tag |
| `streak` | Whole-history, deliberately: a streak the selected range happens to cut in half is not a streak. `current` is the run reaching today or yesterday |
| `heatmap` | The same rows as `completionSeries`, relabelled: `count` is that day's `completed` |
| `busiestDayOfWeek` | An integer `0` to `6` with **0 = Sunday**, matching `Date.prototype.getDay()`. `null` when nothing was completed in the range. It is a flat number; there is no `busiest` object |
| `busiestHour` | An integer `0` to `23` in the report's timezone. `null` on the same condition |

Two windows are in play and they are kept apart on purpose. Counts of *work in the period* (`byStatus`, `byPriority`, `topTags`, `overdueRate`) are scoped by creation; measures of *finishing* (`onTimeRate`, `avgCompletionHours`, and the `completed` column of the series) are scoped by completion. A task created in March and finished in June is June's throughput and March's backlog.

```bash
curl -s -b jar.txt \
  "http://localhost:8000/api/analytics/me?from=2026-07-01&to=2026-08-06&timezone=Europe/Berlin"
```

### `GET /api/analytics/tokens`

`requireAuth`. Daily request counts for the caller's **own** personal access tokens. The ownership predicate is on `api_tokens.user_id` in the `WHERE` clause, so the join can only ever reach usage rows belonging to the caller.

| Query param | Type | Default |
| --- | --- | --- |
| `days` | integer 1-90 | `30` |

Whole days only, because the underlying rollup has daily resolution, and a narrower unit would be an answer the data cannot give.

```http
Cache-Control: no-store
```

```json
{
  "usage": {
    "range": { "from": "2026-07-07T09:47:11.882Z", "to": "2026-08-06T09:47:11.882Z", "days": 30 },
    "tokens": [
      {
        "id": "1f8b4c6a-2d3e-4f50-8a71-9b2c3d4e5f60",
        "name": "personal-site",
        "tokenPrefix": "tf_pat_9Xq2Lm",
        "lastUsedAt": "2026-08-06T09:41:55.318Z",
        "expiresAt": "2027-08-06T09:12:00.000Z",
        "revokedAt": null,
        "requests": 1284,
        "series": [
          { "date": "2026-07-09", "requests": 41 },
          { "date": "2026-07-10", "requests": 62 }
        ]
      }
    ]
  }
}
```

Ordered by `requests` descending, then newest token first. Revoked and expired tokens are included (their history is the answer to "what was that thing doing before I turned it off"), and the timestamps come back so a client can present them as dead.

`requests` is the total **inside the window**, not the token's lifetime count. `range.from` is `days` × 24 hours before now, and `date` keys are UTC calendar days.

One difference from [`GET /api/tokens/:id/usage`](#get-apitokensidusage): `series` here contains **only days that have a row**. A day with no traffic is absent, not zero. The per-token route zero-fills; this one does not.

### `POST /api/analytics/purge` (**root**)

`requireAuth` + `requireRoot`. No body. Deletes every `analytics_events` row older than `analytics.retentionDays`.

**This is the only thing that enforces the retention window.** The server ships no scheduler (`purgeExpiredEvents` has exactly one caller, this route), so `analytics.retentionDays` describes what *would* be deleted, not what has been. Until this endpoint is called, events are kept indefinitely. Drive it from an external scheduler (a platform cron job, a `systemd` timer, GitHub Actions) if the setting is meant to be honoured without someone remembering.

```json
{
  "purge": {
    "deletedCount": 18422,
    "retentionDays": 90,
    "cutoff": "2026-05-08T09:47:11.882Z"
  }
}
```

### `POST /api/analytics/consent`

Public, with `optionalAuth`. Write limiter.

| Field | Type | Rules |
| --- | --- | --- |
| `categories.analytics` | boolean, required | |
| `categories.preferences` | boolean, required | |
| `anonymousId` | string, optional | 8-64 chars, `[A-Za-z0-9_-]`. Lets a signed-out visitor's consent be produced on request later |

**`necessary` is deliberately absent from the schema.** Unknown keys are stripped, so a client posting `necessary: false` simply has it discarded and the server writes `true` itself. Strictly necessary cookies are not a choice, and the API must not offer a shape implying they are.

`policyVersion` is likewise never accepted from the client; it is read from `legal.policyVersion`, because it is the claim that a specific published text was shown, and only the server knows which text that was.

Two things happen: an append-only `consent_records` row is written (the demonstrable evidence GDPR requires, including IP and user agent), and the `tf_consent` cookie is set with `httpOnly: false`, `SameSite=Lax`, path `/`, 365 days, holding `{"a":0|1,"p":0|1,"v":"<policyVersion>"}`.

Both are load-bearing: the cookie is what the running page reads before any network call, and the row is what proves consent was given.

```json
{
  "consent": {
    "categories": { "necessary": true, "analytics": true, "preferences": false },
    "policyVersion": "1.0",
    "activePolicyVersion": "1.0",
    "reconsentRequired": false
  }
}
```

### `GET /api/analytics/consent`

`optionalAuth`. Returns the caller's current consent state.

```http
Cache-Control: no-store
```

```json
{
  "consent": {
    "categories": { "necessary": true, "analytics": true, "preferences": false },
    "policyVersion": "1.0",
    "activePolicyVersion": "1.0",
    "reconsentRequired": false
  }
}
```

`categories` and `policyVersion` are `null` when nothing has been decided. `reconsentRequired` is true whenever the stored version differs from the active one. Consent against a superseded policy does not count, which is the entire reason the version is carried in the cookie.

The cookie wins when present, because it is this browser's answer. The stored record is consulted only for a signed-in caller with no cookie (a new device, or one where site data was cleared), and in that case the cookie is re-issued, but **only** if the stored record matches the active policy version. A record against a superseded policy has to go back through the banner.

---

## Appendix: complete endpoint index

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/` | none |
| `GET` | `/api/health` | none |
| `POST` | `/api/auth/register` | none |
| `POST` | `/api/auth/login` | none |
| `POST` | `/api/auth/mfa/verify` | challenge token |
| `POST` | `/api/auth/refresh` | `tf_refresh` cookie |
| `POST` | `/api/auth/logout` | none |
| `GET` | `/api/auth/me` | user |
| `GET` | `/api/auth/sessions` | user |
| `DELETE` | `/api/auth/sessions/:sessionId` | user |
| `POST` | `/api/auth/sessions/revoke-all` | user |
| `POST` | `/api/auth/password` | user |
| `POST` | `/api/auth/mfa/setup` | user |
| `POST` | `/api/auth/mfa/enable` | user |
| `POST` | `/api/auth/mfa/disable` | user |
| `POST` | `/api/auth/mfa/recovery-codes` | user |
| `GET` | `/api/todos` | user |
| `GET` | `/api/todos/stats` | user |
| `GET` | `/api/todos/:id` | user |
| `POST` | `/api/todos` | user |
| `PATCH` | `/api/todos/:id` | user |
| `DELETE` | `/api/todos/:id` | user |
| `POST` | `/api/todos/:id/restore` | user |
| `POST` | `/api/todos/bulk` | user |
| `POST` | `/api/todos/reorder` | user |
| `POST` | `/api/attachments/todos/:todoId` | user |
| `GET` | `/api/attachments` | user |
| `GET` | `/api/attachments/:id` | optional |
| `DELETE` | `/api/attachments/:id` | user |
| `GET` | `/api/profile` | user |
| `PATCH` | `/api/profile` | user |
| `PUT` | `/api/profile/email` | user |
| `POST` | `/api/profile/avatar` | user |
| `DELETE` | `/api/profile/avatar` | user |
| `GET` | `/api/profile/export` | user |
| `DELETE` | `/api/profile` | user |
| `GET` | `/api/profile/stats` | user |
| `GET` | `/api/exports/todos` | user |
| `GET` | `/api/tokens` | user |
| `POST` | `/api/tokens` | user |
| `DELETE` | `/api/tokens/:id` | user |
| `GET` | `/api/tokens/:id/usage` | user |
| `GET` | `/api/v1/tasks` | token with `tasks:read` |
| `GET` | `/api/v1/tasks/:id` | token with `tasks:read` |
| `GET` | `/api/v1/stats` | token with `stats:read` |
| `GET` | `/api/v1/me` | token with `profile:read` |
| `GET` | `/api/v1/me/avatar` | token with `profile:read` |
| `GET` | `/api/admin/users` | root or admin |
| `GET` | `/api/admin/users/:id` | root or admin |
| `POST` | `/api/admin/users` | root |
| `PATCH` | `/api/admin/users/:id` | root or admin |
| `PUT` | `/api/admin/users/:id/role` | root |
| `PUT` | `/api/admin/users/:id/status` | root or admin |
| `PUT` | `/api/admin/users/:id/quota` | root or admin |
| `POST` | `/api/admin/users/:id/reset-password` | root |
| `POST` | `/api/admin/users/:id/reset-mfa` | root |
| `DELETE` | `/api/admin/users/:id` | root |
| `GET` | `/api/admin/settings` | root or admin |
| `PUT` | `/api/admin/settings/:key` | root or admin |
| `POST` | `/api/admin/settings/:key/reset` | root or admin |
| `POST` | `/api/admin/assets` | root |
| `GET` | `/api/admin/audit` | root or admin |
| `GET` | `/api/admin/overview` | root or admin |
| `GET` | `/api/settings/public` | none |
| `POST` | `/api/analytics/collect` | optional |
| `GET` | `/api/analytics/summary` | root or admin |
| `GET` | `/api/analytics/installation` | root or admin |
| `GET` | `/api/analytics/summary.csv` | root or admin |
| `GET` | `/api/analytics/me` | user |
| `GET` | `/api/analytics/tokens` | user |
| `POST` | `/api/analytics/purge` | root |
| `POST` | `/api/analytics/consent` | optional |
| `GET` | `/api/analytics/consent` | optional |
