# syntax=docker/dockerfile:1
#
# TaskFlow API production image.
#
#   docker build -t taskflow-api ./Server
#   docker run --init -p 8000:8000 --env-file ./Server/.env taskflow-api
#
# Two stages: the first has the TypeScript toolchain and produces `dist/`, the
# second carries only what is needed to run it. The compiler, the type
# definitions and the test runner never reach the shipped image.

# ---------------------------------------------------------------------------
# Stage 1: compile
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copied before the source so that a change to a route does not invalidate the
# dependency layer and force a full reinstall on every build.
COPY package.json package-lock.json ./

# `npm ci` installs exactly what the lockfile pins, and `--include=dev` is
# explicit because the compiler lives in devDependencies.
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build

# Drop devDependencies in place. Pruning is preferred over a second `npm ci
# --omit=dev` because it reuses the tree that was just verified against the
# lockfile, including the platform-specific @node-rs/argon2 binary that was
# resolved for this exact base image.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

# NODE_ENV also switches on the production checks in src/config/env.ts, so the
# container refuses to start with COOKIE_SECURE=false or matching JWT secrets.
ENV NODE_ENV=production
ENV PORT=8000

# The `node` user (uid 1000) ships with the base image; there is no reason to
# create another. Nothing in the app writes to disk, so the whole tree can stay
# owned by root and be read-only to the process, but ownership is set anyway so
# `npm` and friends do not fail if someone execs into the container.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Migrations are resolved relative to the working directory by
# `drizzle-orm/node-postgres/migrator`, so the SQL has to be in the image for
# `node dist/db/migrate.js` to work as a release command.
COPY --chown=node:node drizzle ./drizzle

USER node

EXPOSE 8000

# Uses the runtime's own fetch rather than curl or wget, which keeps the image
# free of an HTTP client that an attacker could otherwise reuse. `/api/health`
# is reachable in maintenance mode by design, so a maintenance window does not
# make the platform kill the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and receives SIGTERM directly, which is what the
# graceful-shutdown handler in src/index.ts is waiting for.
CMD ["node", "dist/index.js"]
