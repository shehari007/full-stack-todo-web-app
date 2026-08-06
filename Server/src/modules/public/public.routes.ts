/**
 * Public read API: `/api/v1/*`
 *
 * The surface a user points their own website at. Everything here is read-only,
 * authenticated by a personal access token, and scoped to that token's own
 * account.
 *
 * ---------------------------------------------------------------------------
 * Why this router carries `Access-Control-Allow-Origin: *`
 * ---------------------------------------------------------------------------
 * A wildcard CORS policy is normally a mistake, because the browser attaches
 * cookies to same-site requests by itself: `*` on a cookie-authenticated
 * endpoint lets any page on the internet read the visitor's logged-in data.
 *
 * It is safe *here*, and only because credentials are refused. `credentials:
 * false` means the browser sends no cookies and would reject the response if it
 * had; the only accepted credential is an `Authorization: Bearer` header, which
 * a browser never adds on its own. So a hostile page calling this endpoint gets
 * an anonymous request and a 401. To get data it must already hold the token,
 * and anyone holding the token could call this from curl regardless. The
 * wildcard therefore grants an attacker nothing they did not already have to
 * steal, while letting a legitimate user fetch their own tasks from their own
 * static site with no proxy in between.
 *
 * That reasoning has exactly one load-bearing premise: this router must never
 * authenticate a cookie. `authenticateApiToken` deletes any session context the
 * application-wide `optionalAuth` resolved, and 401s when no bearer token is
 * present. Weaken that and the wildcard becomes the bug it looks like.
 */
import { Router } from 'express';
import cors from 'cors';
import { and, asc, count, desc, eq, isNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { attachments, todos, users } from '../../db/schema.js';
import { authenticateApiToken, requireScope } from '../../middleware/api-token.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { publicApiLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler, requireAuthContext } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { todoPrioritySchema, todoStatusSchema } from '../todos/todos.schemas.js';
import { getStats } from '../todos/todos.service.js';

const router: Router = Router();

/** One page. Beyond this the caller should be paging, not asking for more. */
const MAX_LIMIT = 100;

/**
 * How long a client may reuse a response.
 *
 * `private` because the payload belongs to one account and must not be held by
 * a shared cache. Thirty seconds is short enough that a task ticked off is
 * visible almost immediately, and long enough that a page polling every second
 * costs two database queries a minute instead of sixty.
 */
const LIST_CACHE_CONTROL = 'private, max-age=30';

/* -------------------------------------------------------------------------- */
/* CORS                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Strip the credentialed header the application-wide CORS middleware set.
 *
 * It answers with `Access-Control-Allow-Credentials: true` for allowlisted
 * origins. Paired with the `*` below, that combination is invalid and every
 * browser rejects the whole response, so the header is removed before the
 * router's own policy is applied, rather than left to collide with it.
 *
 * `Vary: Authorization` is added at the same time. Every response here is
 * selected by the bearer token and nothing else (the URL is identical for every
 * caller), so a cache that keyed on the URL alone would serve one token's tasks
 * to another. `private` keeps shared caches out of it, but the browser's own
 * cache is not a shared cache, and `LIST_CACHE_CONTROL` explicitly invites it to
 * hold the response for thirty seconds.
 */
router.use((_req, res, next) => {
  res.removeHeader('Access-Control-Allow-Credentials');
  res.vary('Authorization');
  next();
});

router.use(
  cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['RateLimit', 'RateLimit-Policy'],
    maxAge: 86_400,
  }),
);

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

router.use(authenticateApiToken);
// Keyed on the token, which is why it sits after authentication rather than
// with the other limiters in front of the route table.
router.use(publicApiLimiter);

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

const listTasksQuerySchema = z.object({
  status: todoStatusSchema.optional(),
  priority: todoPrioritySchema.optional(),
  /** Singular, and matched exactly: this is a filter, not the search box. */
  tag: z.string().trim().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  sort: z.enum(['created', 'due', 'priority', 'title']).default('created'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

const taskIdParamSchema = z.object({
  id: z.string().uuid('That is not a valid task id'),
});

/**
 * The shape this API promises.
 *
 * Every column is named. A `select()` would hand back whatever the table grows
 * next (`userId` today, an internal flag tomorrow) on an endpoint whose whole
 * job is to be embedded in a public web page. `attachments` are absent for the
 * same reason: their bytes live in Postgres, and a list query must never reach
 * for them.
 */
const TASK_COLUMNS = {
  id: todos.id,
  title: todos.title,
  description: todos.description,
  status: todos.status,
  priority: todos.priority,
  dueAt: todos.dueAt,
  completedAt: todos.completedAt,
  tags: todos.tags,
  createdAt: todos.createdAt,
} as const;

/** Mirrors the todos service: ranking is spelled out, not inherited from the enum. */
const PRIORITY_RANK = sql`case ${todos.priority}
    when 'urgent' then 4
    when 'high' then 3
    when 'medium' then 2
    else 1
  end`;

const SORT_TARGETS: Record<ListTasksQuery['sort'], SQLWrapper> = {
  created: todos.createdAt,
  due: todos.dueAt,
  priority: PRIORITY_RANK,
  title: todos.title,
};

function taskFilters(userId: string, query: ListTasksQuery): Array<SQL | undefined> {
  const filters: Array<SQL | undefined> = [eq(todos.userId, userId), isNull(todos.deletedAt)];

  if (query.status) filters.push(eq(todos.status, query.status));
  if (query.priority) filters.push(eq(todos.priority, query.priority));
  // Array overlap, as in the todos service. `sql.param` keeps the single-element
  // array from being expanded into a tuple by the template.
  if (query.tag) filters.push(sql`${todos.tags} && ${sql.param([query.tag])}::text[]`);

  return filters;
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/tasks',
  requireScope('tasks:read'),
  validate({ query: listTasksQuerySchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const query = validatedQuery<ListTasksQuery>(req);

    const where = and(...taskFilters(auth.userId, query));

    const rows = await db
      .select(TASK_COLUMNS)
      .from(todos)
      .where(where)
      // Tie-broken on the primary key, or two tasks with the same sort value can
      // swap between pages and the caller renders one of them twice.
      .orderBy((query.order === 'asc' ? asc : desc)(SORT_TARGETS[query.sort]), asc(todos.id))
      .limit(query.limit)
      .offset(query.offset);

    const [totals] = await db.select({ value: count() }).from(todos).where(where);
    const total = totals?.value ?? 0;

    res.setHeader('Cache-Control', LIST_CACHE_CONTROL);
    res.status(200).json({
      tasks: rows,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore: query.offset + rows.length < total,
      },
    });
  }),
);

router.get(
  '/tasks/:id',
  requireScope('tasks:read'),
  validate({ params: taskIdParamSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);
    const { id } = req.params as unknown as { id: string };

    const [task] = await db
      .select(TASK_COLUMNS)
      .from(todos)
      // Ownership is a predicate, not a check on the result: somebody else's id
      // matches no row, so "not yours" and "does not exist" answer identically.
      .where(and(eq(todos.id, id), eq(todos.userId, auth.userId), isNull(todos.deletedAt)))
      .limit(1);

    if (!task) {
      throw notFound('That task does not exist');
    }

    res.status(200).json({ task });
  }),
);

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The dashboard's own figures, unchanged. Recomputing them here would be a
 * second definition of "overdue" and "streak" that could quietly disagree with
 * what the user sees when they sign in.
 */
router.get(
  '/stats',
  requireScope('stats:read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    res.setHeader('Cache-Control', LIST_CACHE_CONTROL);
    res.status(200).json({ stats: await getStats(auth.userId) });
  }),
);

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Just enough to render an author byline.
 *
 * Three columns, named explicitly. Email, role, quota and status are all things
 * a personal site has no use for, and this response is one `fetch` away from
 * being visible in a browser's network tab on somebody else's page.
 */
router.get(
  '/me',
  requireScope('profile:read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    const [user] = await db
      .select({
        username: users.username,
        displayName: users.displayName,
        avatarId: users.avatarId,
      })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (!user) {
      throw notFound('That account does not exist');
    }

    res.status(200).json({ user });
  }),
);

/**
 * The caller's own avatar image.
 *
 * `/me` returns an `avatarId`, but `GET /api/attachments/:id` resolves
 * visibility through the session middleware, which cannot resolve a personal
 * access token, so without this route the id would be a field nobody holding a
 * token could ever use. Serving the bytes here keeps the attachment route's
 * authorisation untouched.
 *
 * The lookup joins through `users.avatar_id` for the authenticated caller
 * rather than taking an id from the URL, so there is no id to tamper with and
 * no way to reach anyone else's file.
 */
router.get(
  '/me/avatar',
  requireScope('profile:read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthContext(req);

    const [avatar] = await db
      .select({
        data: attachments.data,
        mimeType: attachments.mimeType,
        checksum: attachments.checksum,
        byteSize: attachments.byteSize,
      })
      .from(users)
      .innerJoin(attachments, eq(attachments.id, users.avatarId))
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (!avatar) {
      throw notFound('No avatar has been set');
    }

    if (req.get('if-none-match') === `"${avatar.checksum}"`) {
      res.status(304).end();
      return;
    }

    // Avatars are images, but the stored type is whatever passed upload
    // validation, so it is still pinned with nosniff and served as a download
    // rather than trusted to render inline.
    res.setHeader('Content-Type', avatar.mimeType);
    res.setHeader('Content-Length', String(avatar.byteSize));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('ETag', `"${avatar.checksum}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).send(avatar.data);
  }),
);

export default router;
