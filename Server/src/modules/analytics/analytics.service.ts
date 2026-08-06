/**
 * First-party analytics.
 *
 * The whole module is built so that a row, on its own or in bulk, cannot be
 * traced back to a person: no IP address, no user-agent string, no full URLs,
 * no third-party script. What is stored is a daily-rotating HMAC of IP + user
 * agent, which is enough to count unique visitors within a day and useless for
 * anything longer.
 */
import type { Request, Response } from 'express';
import { and, desc, eq, gte, isNotNull, isNull, lt, or, sql, type SQLWrapper } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import { db } from '../../db/index.js';
import {
  analyticsEvents,
  apiTokenUsage,
  apiTokens,
  attachments,
  auditLogs,
  consentRecords,
  todos,
  users,
  type TodoPriority,
  type TodoStatus,
} from '../../db/schema.js';
import { env } from '../../config/env.js';
import { visitorHash } from '../../lib/crypto.js';
import { clientIp, clientUserAgent } from '../../lib/http.js';
import { getSettings } from '../../lib/settings.js';
import { logger } from '../../lib/logger.js';
import { badRequest } from '../../lib/errors.js';
import { usageDay } from '../../lib/api-tokens.js';
import { safeTimeZone } from '../todos/todos.service.js';
import {
  consentCookieSchema,
  type CollectEventInput,
  type PersonalAnalyticsQuery,
  type SummaryQuery,
  type TokenUsageQuery,
} from './analytics.schemas.js';

/** The event name the summary counts as a page view. */
const PAGE_VIEW_EVENT = 'page_view';

/** Query strings routinely carry tokens, emails and search terms, so paths are cut at `?`. */
const MAX_PATH_LENGTH = 512;

const TOP_LIST_LIMIT = 10;

const DEFAULT_WINDOW_DAYS = 30;

/** Only ever used to strip the query string and fragment off a relative path. */
const PATH_PARSE_BASE = 'http://analytics.invalid';

const APP_ORIGIN = new URL(env.APP_URL).origin;

/* -------------------------------------------------------------------------- */
/* Consent                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Consent is deliberately stored in two places, and both are load-bearing.
 *
 *  - The **cookie** is what the running page reads. It has to be, because the
 *    banner must decide whether to show itself before any network call, and it
 *    must work for a signed-out visitor who has no record to look up. It is not
 *    HttpOnly for exactly that reason: the client owns the decision to re-prompt.
 *  - The **database row** is the evidence. GDPR requires consent to be
 *    *demonstrable*, and a cookie proves nothing: the visitor can clear it, and
 *    the operator could have written it themselves. `consent_records` is
 *    append-only, so it preserves what was agreed to, under which policy
 *    version, and when.
 *
 * Neither substitutes for the other: the cookie without the row is unprovable;
 * the row without the cookie means re-prompting a visitor who already answered.
 */
export const CONSENT_COOKIE = 'tf_consent';

const CONSENT_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export interface ConsentCategories {
  necessary: true;
  analytics: boolean;
  preferences: boolean;
}

export interface StoredConsent {
  analytics: boolean;
  preferences: boolean;
  /** The policy revision the visitor actually agreed to, not the current one. */
  policyVersion: string;
}

export interface ConsentState {
  categories: ConsentCategories | null;
  policyVersion: string | null;
  activePolicyVersion: string;
  reconsentRequired: boolean;
}

/** Read the visitor's own choice back. A malformed or tampered cookie is simply no consent. */
export function readConsentCookie(req: Request): StoredConsent | null {
  const raw = req.cookies?.[CONSENT_COOKIE];
  if (typeof raw !== 'string' || !raw) return null;

  try {
    const parsed = consentCookieSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    return {
      analytics: parsed.data.a === 1,
      preferences: parsed.data.p === 1,
      policyVersion: parsed.data.v,
    };
  } catch {
    return null;
  }
}

export function writeConsentCookie(res: Response, consent: StoredConsent): void {
  const value = JSON.stringify({
    a: consent.analytics ? 1 : 0,
    p: consent.preferences ? 1 : 0,
    v: consent.policyVersion,
  });

  res.cookie(CONSENT_COOKIE, value, {
    // Readable by scripts on purpose: the banner has to know the answer before
    // it can decide not to render.
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    // `lax` rather than `strict`: a visitor arriving from an external link must
    // not be re-prompted just because the navigation was cross-site.
    sameSite: 'lax',
    path: '/',
    maxAge: CONSENT_COOKIE_MAX_AGE_MS,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

/**
 * Write the proof-of-consent row.
 *
 * `necessary` is forced true here rather than trusted from the request: it
 * describes cookies the service cannot function without, so a client claiming
 * otherwise would produce a record that misrepresents what was agreed.
 *
 * Unlike an analytics event, this row *does* keep the IP and user agent. That is
 * the point: a consent record has to identify the act of consenting well enough
 * to stand up to a regulator, and it is retained under a different lawful basis
 * from the analytics stream it authorises.
 */
export async function recordConsent(
  req: Request,
  input: {
    categories: { analytics: boolean; preferences: boolean };
    policyVersion: string;
    userId?: string | null;
    anonymousId?: string | null;
  },
): Promise<ConsentCategories> {
  const categories: ConsentCategories = {
    necessary: true,
    analytics: input.categories.analytics === true,
    preferences: input.categories.preferences === true,
  };

  await db.insert(consentRecords).values({
    userId: input.userId ?? null,
    anonymousId: input.anonymousId ?? null,
    categories,
    policyVersion: input.policyVersion,
    ipAddress: clientIp(req),
    userAgent: clientUserAgent(req),
  });

  return categories;
}

/**
 * What the caller has consented to, and whether the banner should reappear.
 *
 * The cookie wins when present because it is this browser's answer. The stored
 * record is only consulted for a signed-in caller with no cookie (a new device,
 * or one where site data was cleared), so their earlier choice is honoured
 * instead of being asked for again.
 */
export async function getConsentState(req: Request): Promise<ConsentState> {
  const legal = await getSettings('legal');
  const fromCookie = readConsentCookie(req);

  let categories: ConsentCategories | null = fromCookie
    ? { necessary: true, analytics: fromCookie.analytics, preferences: fromCookie.preferences }
    : null;
  let policyVersion: string | null = fromCookie?.policyVersion ?? null;

  if (!categories && req.auth) {
    const [record] = await db
      .select({
        categories: consentRecords.categories,
        policyVersion: consentRecords.policyVersion,
      })
      .from(consentRecords)
      .where(eq(consentRecords.userId, req.auth.userId))
      .orderBy(desc(consentRecords.createdAt))
      .limit(1);

    if (record) {
      categories = record.categories;
      policyVersion = record.policyVersion;
    }
  }

  return {
    categories,
    policyVersion,
    activePolicyVersion: legal.policyVersion,
    reconsentRequired: policyVersion !== legal.policyVersion,
  };
}

/**
 * Consent recorded against a superseded policy does not count.
 *
 * That is the entire reason the version is carried in the cookie: a material
 * change to the privacy policy must re-prompt rather than silently inherit an
 * agreement to text the visitor never saw.
 */
function hasAnalyticsConsent(req: Request, activePolicyVersion: string): boolean {
  const consent = readConsentCookie(req);
  return consent?.analytics === true && consent.policyVersion === activePolicyVersion;
}

/* -------------------------------------------------------------------------- */
/* Ingestion                                                                  */
/* -------------------------------------------------------------------------- */

export type Device = 'mobile' | 'tablet' | 'desktop' | 'bot';

/**
 * Outcomes are enumerated rather than collapsed to a boolean so an operator
 * looking at "why is my dashboard empty" gets a straight answer from the logs.
 */
export type CollectOutcome =
  | 'recorded'
  | 'analytics_disabled'
  | 'do_not_track'
  | 'admin_excluded'
  | 'no_consent'
  | 'bot';

const BOT_PATTERN =
  /bot|crawler|spider|crawl|slurp|facebookexternalhit|embedly|quora link preview|monitor|uptime|headless|lighthouse|pingdom|curl|wget|python-requests|axios|node-fetch|okhttp|postman|scrapy/i;

/** Android tablets are identified by the *absence* of `Mobile`, hence the lookahead. */
const TABLET_PATTERN = /ipad|tablet|playbook|silk|kindle|android(?!.*mobile)/i;

const MOBILE_PATTERN =
  /mobi|iphone|ipod|blackberry|iemobile|opera mini|windows phone|android.*mobile/i;

/**
 * Coarse buckets only. Anything finer (versions, engines, screen sizes) is a
 * fingerprint, and a fingerprint plus a timestamp identifies a person.
 *
 * An empty user agent is classified as a bot: every real browser sends one, so
 * its absence means a script.
 */
export function deviceFromUserAgent(userAgent: string): Device {
  if (!userAgent || BOT_PATTERN.test(userAgent)) return 'bot';
  if (TABLET_PATTERN.test(userAgent)) return 'tablet';
  if (MOBILE_PATTERN.test(userAgent)) return 'mobile';
  return 'desktop';
}

/**
 * Reduce whatever the client sent to a bare pathname.
 *
 * Parsing against a base means a relative path and a full href both land in the
 * same place, and taking `pathname` is what drops the query string, which is
 * where session tokens, password-reset links and typed search terms live.
 */
function normalisePath(input: string | undefined): string | null {
  if (!input) return null;

  let pathname: string;
  try {
    pathname = new URL(input, PATH_PARSE_BASE).pathname;
  } catch {
    return null;
  }

  // A value that did not resolve to a path (`javascript:...`, `mailto:...`) is discarded.
  if (!pathname.startsWith('/')) return null;

  return pathname.slice(0, MAX_PATH_LENGTH);
}

/**
 * Keep the origin and throw the rest away. A full referring URL leaks the other
 * site's query string and deep path, which is their visitor's business and not
 * ours to store.
 */
function referrerOrigin(input: string | undefined): string | null {
  if (!input) return null;

  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Internal navigation is not a referral; keeping it would bury the real
    // acquisition sources under our own pages.
    if (url.origin === APP_ORIGIN) return null;
    return url.origin.slice(0, 255);
  } catch {
    return null;
  }
}

/**
 * Country comes from the CDN edge, which resolved it before the request reached
 * us. Deriving it here would mean shipping a GeoIP database and, worse, holding
 * on to the IP address long enough to look it up.
 */
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'] as const;

function countryFromHeaders(req: Request): string | null {
  for (const header of COUNTRY_HEADERS) {
    const value = req.get(header);
    if (value && /^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  }
  return null;
}

/** UTC, so the HMAC rotates at the same instant for every visitor. */
function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Ingest one event, or decline to.
 *
 * Every suppression path returns without touching the database. Writing a row
 * and filtering it out later would be worse than useless: the data would exist,
 * which is precisely what a visitor who sent `DNT: 1` asked us not to do.
 */
export async function collectEvent(req: Request, input: CollectEventInput): Promise<CollectOutcome> {
  const [features, analytics, legal] = await Promise.all([
    getSettings('features'),
    getSettings('analytics'),
    getSettings('legal'),
  ]);

  const decline = (outcome: Exclude<CollectOutcome, 'recorded'>): CollectOutcome => {
    logger.debug({ outcome, name: input.name }, 'Analytics event not recorded');
    return outcome;
  };

  if (!features.analyticsEnabled) return decline('analytics_disabled');

  if (analytics.respectDoNotTrack && (req.get('dnt') === '1' || req.get('sec-gpc') === '1')) {
    return decline('do_not_track');
  }

  if (analytics.excludeAdminTraffic && (req.auth?.role === 'root' || req.auth?.role === 'admin')) {
    return decline('admin_excluded');
  }

  if (!hasAnalyticsConsent(req, legal.policyVersion)) return decline('no_consent');

  const userAgent = clientUserAgent(req);
  const device = deviceFromUserAgent(userAgent);

  // Bots would otherwise dominate every count while representing nobody.
  if (device === 'bot') return decline('bot');

  await db.insert(analyticsEvents).values({
    name: input.name,
    path: normalisePath(input.path),
    referrer: referrerOrigin(input.referrer),
    /*
     * The one directly identifying field, and the one the visitor explicitly
     * agreed to: it is written only for a signed-in caller who has consented,
     * and the foreign key nulls it out if the account is ever deleted, so the
     * aggregate survives an erasure request while the link does not.
     */
    userId: req.auth?.userId ?? null,
    // The only identifier an anonymous row carries. Both inputs are consumed
    // here and neither is stored anywhere on the event.
    visitorHash: visitorHash(clientIp(req), userAgent, utcDayKey(new Date())),
    device,
    country: countryFromHeaders(req),
    metadata: input.metadata ?? null,
  });

  return 'recorded';
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

export interface AnalyticsSummary {
  range: { from: string; to: string; granularity: SummaryQuery['granularity'] };
  totals: { pageViews: number; uniqueVisitors: number; events: number };
  series: Array<{ bucket: string; pageViews: number; uniqueVisitors: number; events: number }>;
  topPaths: Array<{ path: string; views: number; visitors: number }>;
  topReferrers: Array<{ referrer: string; views: number; visitors: number }>;
  deviceBreakdown: Array<{ device: Device | 'unknown'; visitors: number; events: number }>;
}

/**
 * Every figure below is computed by Postgres.
 *
 * Selecting the rows and reducing them in JavaScript instead would turn a
 * quarter of traffic into hundreds of thousands of objects in the heap to
 * produce about forty numbers, and would get slower exactly as the installation
 * gets busier.
 */
export async function getSummary(input: SummaryQuery): Promise<AnalyticsSummary> {
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);

  if (from >= to) {
    throw badRequest('`from` must be earlier than `to`');
  }

  const range = and(gte(analyticsEvents.createdAt, from), lt(analyticsEvents.createdAt, to));

  /*
   * Truncating in UTC rather than the session timezone keeps buckets stable no
   * matter which connection or replica answers. `granularity` is branched on
   * rather than interpolated. It is a validated enum, but a date part is not a
   * bind parameter, so it must never come from a string the client supplied.
   */
  const bucket =
    input.granularity === 'week'
      ? sql`date_trunc('week', ${analyticsEvents.createdAt} at time zone 'UTC')`
      : sql`date_trunc('day', ${analyticsEvents.createdAt} at time zone 'UTC')`;

  const pageViews = sql<number>`count(*) filter (where ${analyticsEvents.name} = ${PAGE_VIEW_EVENT})::int`;
  const events = sql<number>`count(*)::int`;
  const visitors = sql<number>`count(distinct ${analyticsEvents.visitorHash})::int`;

  const [totalsRows, series, pathRows, referrerRows, deviceRows] = await Promise.all([
    db.select({ pageViews, uniqueVisitors: visitors, events }).from(analyticsEvents).where(range),

    db
      .select({
        bucket: sql<string>`to_char(${bucket}, 'YYYY-MM-DD')`,
        pageViews,
        uniqueVisitors: visitors,
        events,
      })
      .from(analyticsEvents)
      .where(range)
      .groupBy(bucket)
      .orderBy(bucket),

    db
      .select({ path: analyticsEvents.path, views: events, visitors })
      .from(analyticsEvents)
      .where(and(range, isNotNull(analyticsEvents.path)))
      .groupBy(analyticsEvents.path)
      .orderBy(desc(sql`count(*)`))
      .limit(TOP_LIST_LIMIT),

    db
      .select({ referrer: analyticsEvents.referrer, views: events, visitors })
      .from(analyticsEvents)
      .where(and(range, isNotNull(analyticsEvents.referrer)))
      .groupBy(analyticsEvents.referrer)
      .orderBy(desc(sql`count(*)`))
      .limit(TOP_LIST_LIMIT),

    db
      .select({ device: analyticsEvents.device, events, visitors })
      .from(analyticsEvents)
      .where(range)
      .groupBy(analyticsEvents.device)
      .orderBy(desc(sql`count(*)`)),
  ]);

  // An ungrouped aggregate always returns exactly one row, even over no data,
  // but the type system has no way to know that.
  const [totals] = totalsRows;

  return {
    range: { from: from.toISOString(), to: to.toISOString(), granularity: input.granularity },
    totals: totals ?? { pageViews: 0, uniqueVisitors: 0, events: 0 },
    // Per-bucket uniques are counted independently and do not sum to
    // `totals.uniqueVisitors`: a visitor present on three days is one visitor
    // overall and three here. That is the correct reading of both figures.
    series,
    topPaths: pathRows.map((row) => ({ path: row.path ?? '', views: row.views, visitors: row.visitors })),
    topReferrers: referrerRows.map((row) => ({
      referrer: row.referrer ?? '',
      views: row.views,
      visitors: row.visitors,
    })),
    deviceBreakdown: deviceRows.map((row) => ({
      device: (row.device as Device | null) ?? 'unknown',
      visitors: row.visitors,
      events: row.events,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Personal productivity                                                      */
/* -------------------------------------------------------------------------- */

const PERSONAL_WINDOW_DAYS = 90;

/**
 * The day series is materialised one row per day so the heatmap has no holes,
 * which means an unbounded `from` is a request for an unbounded result set.
 */
const MAX_PERSONAL_RANGE_DAYS = 366;

/** Minutes of silence that end a visit, for the new-vs-returning split below. */
const SESSION_GAP = '30 minutes';

export interface PersonalAnalytics {
  range: { from: string; to: string; timezone: string };
  completionSeries: Array<{ date: string; created: number; completed: number }>;
  /**
   * Anchored on *now*, not on the selected range: "am I moving faster than last
   * week" is a question about this week, and answering it from a window the user
   * happened to scroll to would make the number mean something different every
   * time they changed the dates. `changePct` is null when last week is empty:
   * there is no percentage change from zero, and reporting 0 or 100 would both
   * be inventions.
   */
  throughput: { thisWeek: number; lastWeek: number; changePct: number | null };
  /**
   * Rates are fractions from 0 to 1, matching `TodoStats.completionRate`. Each
   * is null rather than 0 when its denominator is empty: "none of the tasks I
   * finished were late" and "I have not finished a dated task" are different
   * statements, and a zero would let the second masquerade as the first.
   */
  onTimeRate: number | null;
  overdueRate: number | null;
  avgCompletionHours: number | null;
  byPriority: Record<TodoPriority, number>;
  byStatus: Record<TodoStatus, number>;
  topTags: Array<{ tag: string; total: number; completed: number }>;
  /** Whole-history, deliberately: a streak the range happens to cut in half is not a streak. */
  streak: { current: number; longest: number };
  heatmap: Array<{ date: string; count: number }>;
  /** 0 = Sunday, matching `Date.prototype.getDay()`. Null when nothing was completed. */
  busiestDayOfWeek: number | null;
  /** 0 to 23 in the report's timezone. */
  busiestHour: number | null;
}

/**
 * One person's productivity, entirely in SQL.
 *
 * Six statements go out in parallel rather than one that answers everything:
 * each has a different row scope (the selected range, the current week, all of
 * history), and folding them together would mean the widest scope decides which
 * rows every other figure is allowed to see.
 */
export async function getPersonalAnalytics(
  userId: string,
  input: PersonalAnalyticsQuery,
): Promise<PersonalAnalytics> {
  const to = input.to ?? new Date();
  const from = input.from ?? new Date(to.getTime() - PERSONAL_WINDOW_DAYS * 86_400_000);

  if (from >= to) {
    throw badRequest('`from` must be earlier than `to`');
  }
  if (to.getTime() - from.getTime() > MAX_PERSONAL_RANGE_DAYS * 86_400_000) {
    throw badRequest(`The range may not be longer than ${MAX_PERSONAL_RANGE_DAYS} days`);
  }

  // Days and weeks are the user's own. A task completed at 23:00 in Karachi
  // belongs to that day, not to the UTC one that had already ended.
  const [owner] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const zone = safeTimeZone(input.timezone ?? owner?.timezone);

  const owned = and(eq(todos.userId, userId), isNull(todos.deletedAt));

  /*
   * The two windows are kept apart on purpose. Counts of *work in the period*
   * (status, priority, tags) are scoped by creation; measures of *finishing*
   * (on-time, duration) are scoped by completion, because a task created in
   * March and finished in June is June's throughput and March's backlog.
   */
  const createdInRange = sql`${todos.createdAt} >= ${from} and ${todos.createdAt} < ${to}`;
  const completedInRange = sql`${todos.completedAt} >= ${from} and ${todos.completedAt} < ${to}`;

  const [series, aggregates, throughput, tags, streak, busiest] = await Promise.all([
    /*
     * `generate_series` supplies the calendar, so a day nobody touched comes
     * back as a zero instead of being missing. A client filling the gaps itself
     * has to re-derive the range, the timezone and the DST-affected day count:
     * three chances to draw a heatmap that disagrees with its own axis.
     */
    db.execute<{ date: string; created: number; completed: number }>(sql`
      with bounds as (
        select
          date_trunc('day', ${from}::timestamptz at time zone ${zone}) as first_day,
          -- The upper bound is exclusive, so the last bucket is the day holding
          -- the instant just before it; truncating the bound itself appends a
          -- trailing empty day whenever the range ends on a midnight boundary.
          date_trunc('day', (${to}::timestamptz - interval '1 microsecond') at time zone ${zone})
            as last_day
      ),
      days as (
        select generate_series(first_day, last_day, interval '1 day') as day from bounds
      ),
      created_days as (
        select date_trunc('day', ${todos.createdAt} at time zone ${zone}) as day,
               count(*)::int as total
        from ${todos}
        where ${todos.userId} = ${userId} and ${todos.deletedAt} is null and ${createdInRange}
        group by 1
      ),
      completed_days as (
        select date_trunc('day', ${todos.completedAt} at time zone ${zone}) as day,
               count(*)::int as total
        from ${todos}
        where ${todos.userId} = ${userId} and ${todos.deletedAt} is null and ${completedInRange}
        group by 1
      )
      select to_char(days.day, 'YYYY-MM-DD') as date,
             coalesce(created_days.total, 0) as created,
             coalesce(completed_days.total, 0) as completed
      from days
      left join created_days on created_days.day = days.day
      left join completed_days on completed_days.day = days.day
      order by days.day
    `),

    db
      .select({
        statusTodo: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.status} = 'todo'))::int`,
        statusInProgress: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.status} = 'in_progress'))::int`,
        statusDone: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.status} = 'done'))::int`,
        priorityLow: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.priority} = 'low'))::int`,
        priorityMedium: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.priority} = 'medium'))::int`,
        priorityHigh: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.priority} = 'high'))::int`,
        priorityUrgent: sql<number>`(count(*) filter (where ${createdInRange} and ${todos.priority} = 'urgent'))::int`,
        // `nullif` on every denominator: division by zero would abort the whole
        // statement, and the null it produces instead is the honest answer.
        onTimeRate: sql<number | null>`round(
          (count(*) filter (
            where ${completedInRange}
              and ${todos.dueAt} is not null
              and ${todos.completedAt} <= ${todos.dueAt}
          ))::numeric
          / nullif(count(*) filter (where ${completedInRange} and ${todos.dueAt} is not null), 0),
          3)::float8`,
        // Measured against dated work still open, so finishing a late task
        // improves the rate instead of leaving it stuck for good.
        overdueRate: sql<number | null>`round(
          (count(*) filter (
            where ${createdInRange} and ${todos.status} <> 'done' and ${todos.dueAt} < now()
          ))::numeric
          / nullif(count(*) filter (
            where ${createdInRange} and ${todos.status} <> 'done' and ${todos.dueAt} is not null
          ), 0),
          3)::float8`,
        avgCompletionHours: sql<number | null>`round(
          (avg(extract(epoch from (${todos.completedAt} - ${todos.createdAt})) / 3600)
            filter (where ${completedInRange}))::numeric,
          2)::float8`,
      })
      .from(todos)
      // Rows outside both windows cannot contribute to any figure above, so the
      // planner is told that here rather than being left to discover it inside
      // eleven separate FILTER clauses.
      .where(and(owned, or(createdInRange, completedInRange))),

    db.execute<{ thisWeek: number; lastWeek: number; changePct: number | null }>(sql`
      with weeks as (
        select date_trunc('week', now() at time zone ${zone}) at time zone ${zone} as current_start
      ),
      counts as (
        select
          (count(*) filter (where ${todos.completedAt} >= weeks.current_start))::int as this_week,
          (count(*) filter (
            where ${todos.completedAt} >= weeks.current_start - interval '7 days'
              and ${todos.completedAt} < weeks.current_start
          ))::int as last_week
        from ${todos} cross join weeks
        where ${todos.userId} = ${userId}
          and ${todos.deletedAt} is null
          and ${todos.completedAt} >= weeks.current_start - interval '7 days'
      )
      select this_week as "thisWeek",
             last_week as "lastWeek",
             round(((this_week - last_week)::numeric / nullif(last_week, 0)) * 100, 1)::float8
               as "changePct"
      from counts
    `),

    // Tags are an array column, so the grouping key has to be produced by
    // `unnest`. Pulling the arrays out and counting them in JavaScript would
    // mean fetching every task to arrive at ten rows.
    db.execute<{ tag: string; total: number; completed: number }>(sql`
      select tag,
             count(*)::int as total,
             (count(*) filter (where ${todos.completedAt} is not null))::int as completed
      from ${todos} cross join lateral unnest(${todos.tags}) as tag
      where ${todos.userId} = ${userId} and ${todos.deletedAt} is null and ${createdInRange}
      group by tag
      order by count(*) desc, tag
      limit ${TOP_LIST_LIMIT}
    `),

    /*
     * Gaps and islands. Numbering the distinct completion days and subtracting
     * the row number collapses each consecutive run to a single constant, so the
     * runs can be counted with an ordinary GROUP BY. The current streak is the
     * run that reaches today or yesterday. Yesterday still counts, so a streak
     * is not declared broken at 09:00 before the user has had a chance to
     * finish anything.
     */
    db.execute<{ current: number; longest: number }>(sql`
      with days as (
        select distinct date_trunc('day', ${todos.completedAt} at time zone ${zone})::date as day
        from ${todos}
        where ${todos.userId} = ${userId}
          and ${todos.deletedAt} is null
          and ${todos.completedAt} is not null
      ),
      grouped as (
        select day, day - (row_number() over (order by day))::int as island from days
      ),
      runs as (
        select island, count(*)::int as run_length, max(day) as last_day
        from grouped group by island
      )
      select
        coalesce(max(run_length), 0)::int as longest,
        coalesce(max(run_length) filter (
          where last_day >= date_trunc('day', now() at time zone ${zone})::date - 1
        ), 0)::int as current
      from runs
    `),

    // Hour-of-day and day-of-week are extracted rather than truncated: there is
    // no `date_trunc` that folds a quarter of timestamps onto a 24-hour clock.
    db.execute<{ dayOfWeek: number | null; hour: number | null }>(sql`
      select
        (select extract(dow from ${todos.completedAt} at time zone ${zone})::int
         from ${todos}
         where ${todos.userId} = ${userId} and ${todos.deletedAt} is null and ${completedInRange}
         group by 1
         order by count(*) desc, 1
         limit 1) as "dayOfWeek",
        (select extract(hour from ${todos.completedAt} at time zone ${zone})::int
         from ${todos}
         where ${todos.userId} = ${userId} and ${todos.deletedAt} is null and ${completedInRange}
         group by 1
         order by count(*) desc, 1
         limit 1) as "hour"
    `),
  ]);

  const [totals] = aggregates;
  const pace = throughput.rows[0];
  const runs = streak.rows[0];
  const peak = busiest.rows[0];

  return {
    range: { from: from.toISOString(), to: to.toISOString(), timezone: zone },
    completionSeries: series.rows,
    throughput: {
      thisWeek: pace?.thisWeek ?? 0,
      lastWeek: pace?.lastWeek ?? 0,
      changePct: pace?.changePct ?? null,
    },
    onTimeRate: totals?.onTimeRate ?? null,
    overdueRate: totals?.overdueRate ?? null,
    avgCompletionHours: totals?.avgCompletionHours ?? null,
    byPriority: {
      low: totals?.priorityLow ?? 0,
      medium: totals?.priorityMedium ?? 0,
      high: totals?.priorityHigh ?? 0,
      urgent: totals?.priorityUrgent ?? 0,
    },
    byStatus: {
      todo: totals?.statusTodo ?? 0,
      in_progress: totals?.statusInProgress ?? 0,
      done: totals?.statusDone ?? 0,
    },
    topTags: tags.rows,
    streak: { current: runs?.current ?? 0, longest: runs?.longest ?? 0 },
    // Same scan as the series: the contribution graph counts completions, which
    // is the column the series already carries, so re-querying it would be a
    // second pass over the same rows to relabel one field.
    heatmap: series.rows.map((row) => ({ date: row.date, count: row.completed })),
    busiestDayOfWeek: peak?.dayOfWeek ?? null,
    busiestHour: peak?.hour ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Installation reporting                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Installation-wide buckets stay in UTC, like `getSummary`'s, so two figures on
 * the same admin screen are never cut on different day boundaries.
 */
function utcDayBucket(column: SQLWrapper) {
  return sql`date_trunc('day', ${column} at time zone 'UTC')`;
}

export interface InstallationAnalytics extends AnalyticsSummary {
  activeUsers: { daily: number; weekly: number; monthly: number };
  retention: Array<{ cohort: string; users: number; retained: number; rate: number | null }>;
  newVsReturningVisitors: { new: number; returning: number };
  storageGrowth: Array<{ date: string; addedBytes: number; cumulativeBytes: number }>;
  exportVolume: Array<{ date: string; count: number }>;
  uploadVolume: Array<{ date: string; count: number; bytes: number }>;
}

/**
 * The operator's view of the installation.
 *
 * Built on top of `getSummary` rather than beside it: the traffic figures, the
 * top lists and the resolved range are already correct there, and a second
 * implementation of the same window would eventually drift from the first.
 * Every series added here is daily regardless of the summary's granularity: a
 * cumulative storage curve and a per-day upload count are read against a
 * calendar, not against whatever bucket size the traffic chart is using.
 */
export async function getInstallationAnalytics(input: SummaryQuery): Promise<InstallationAnalytics> {
  const summary = await getSummary(input);
  const from = new Date(summary.range.from);
  const to = new Date(summary.range.to);

  const [activeUsers, retention, visitors, storageGrowth, exportVolume, uploadVolume] =
    await Promise.all([
      /*
       * Counted from `last_login_at`, not from the event stream: analytics
       * collection is gated on consent and excludes admin traffic, so it would
       * report a smaller installation than the one that exists. The trade-off is
       * that a long-lived session which never signs in again does not refresh
       * the column, making these figures a floor rather than an exact count.
       */
      db
        .select({
          daily: sql<number>`(count(*) filter (where ${users.lastLoginAt} >= now() - interval '1 day'))::int`,
          weekly: sql<number>`(count(*) filter (where ${users.lastLoginAt} >= now() - interval '7 days'))::int`,
          monthly: sql<number>`(count(*) filter (where ${users.lastLoginAt} >= now() - interval '30 days'))::int`,
        })
        .from(users)
        .where(isNull(users.deletedAt)),

      // Cohorts are anchored to the current week rather than to the report's
      // range: "are the people who joined in March still here" is a question
      // about now, and eight weeks is as far back as the answer stays useful.
      db.execute<{ cohort: string; users: number; retained: number; rate: number | null }>(sql`
        with weeks as (
          select date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' as current_start
        ),
        cohorts as (
          select date_trunc('week', ${users.createdAt} at time zone 'UTC') as cohort,
                 count(*)::int as users,
                 (count(*) filter (where ${users.lastLoginAt} >= now() - interval '7 days'))::int
                   as retained
          from ${users} cross join weeks
          where ${users.deletedAt} is null
            and ${users.createdAt} >= weeks.current_start - interval '7 weeks'
          group by 1
        )
        select to_char(cohort, 'YYYY-MM-DD') as cohort,
               users,
               retained,
               round(retained::numeric / nullif(users, 0), 3)::float8 as rate
        from cohorts
        order by cohort
      `),

      /*
       * New versus returning, within the day.
       *
       * `visitor_hash` is a daily-rotating HMAC, so "returning" cannot mean
       * "came back next week". The identifier is designed not to survive that
       * long, and no query can recover what was never stored. What is
       * measurable, and what this reports, is whether a visitor opened more than
       * one visit before their identifier rotated, where a gap longer than
       * `SESSION_GAP` starts a new visit.
       */
      db.execute<{ new: number; returning: number }>(sql`
        with touches as (
          select ${analyticsEvents.visitorHash} as visitor,
                 ${analyticsEvents.createdAt} as seen_at,
                 lag(${analyticsEvents.createdAt}) over (
                   partition by ${analyticsEvents.visitorHash}
                   order by ${analyticsEvents.createdAt}
                 ) as previous_seen_at
          from ${analyticsEvents}
          where ${analyticsEvents.createdAt} >= ${from}
            and ${analyticsEvents.createdAt} < ${to}
            and ${analyticsEvents.visitorHash} is not null
        ),
        visits as (
          select visitor,
                 (count(*) filter (
                   where previous_seen_at is null
                     or seen_at - previous_seen_at > ${SESSION_GAP}::interval
                 ))::int as visit_count
          from touches
          group by visitor
        )
        select (count(*) filter (where visit_count <= 1))::int as "new",
               (count(*) filter (where visit_count > 1))::int as "returning"
        from visits
      `),

      /*
       * The running total deliberately starts before the window: a growth curve
       * that restarts at zero on the first day of whatever range is selected
       * describes uploads, not storage. Only the presentation is clipped, by the
       * outer filter.
       */
      db.execute<{ date: string; addedBytes: number; cumulativeBytes: number }>(sql`
        with daily as (
          select ${utcDayBucket(attachments.createdAt)} as day,
                 sum(${attachments.byteSize})::bigint as added
          from ${attachments}
          where ${attachments.createdAt} < ${to}
          group by 1
        ),
        running as (
          select day, added, (sum(added) over (order by day))::bigint as cumulative from daily
        )
        select to_char(day, 'YYYY-MM-DD') as date,
               added as "addedBytes",
               cumulative as "cumulativeBytes"
        from running
        where day >= date_trunc('day', ${from}::timestamptz at time zone 'UTC')
        order by day
      `),

      /*
       * Exports are counted from the audit trail because that is the only record
       * they leave: a download is streamed to the caller and nothing about it is
       * stored anywhere else, so `data.export` entries are the export history.
       */
      db
        .select({
          date: sql<string>`to_char(${utcDayBucket(auditLogs.createdAt)}, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'data.export'),
            gte(auditLogs.createdAt, from),
            lt(auditLogs.createdAt, to),
          ),
        )
        .groupBy(utcDayBucket(auditLogs.createdAt))
        .orderBy(utcDayBucket(auditLogs.createdAt)),

      db
        .select({
          date: sql<string>`to_char(${utcDayBucket(attachments.createdAt)}, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
          bytes: sql<number>`coalesce(sum(${attachments.byteSize}), 0)::bigint`,
        })
        .from(attachments)
        .where(and(gte(attachments.createdAt, from), lt(attachments.createdAt, to)))
        .groupBy(utcDayBucket(attachments.createdAt))
        .orderBy(utcDayBucket(attachments.createdAt)),
    ]);

  const [active] = activeUsers;
  const split = visitors.rows[0];

  return {
    ...summary,
    activeUsers: {
      daily: active?.daily ?? 0,
      weekly: active?.weekly ?? 0,
      monthly: active?.monthly ?? 0,
    },
    retention: retention.rows,
    newVsReturningVisitors: { new: split?.new ?? 0, returning: split?.returning ?? 0 },
    storageGrowth: storageGrowth.rows,
    exportVolume,
    uploadVolume,
  };
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Render the summary as CSV.
 *
 * Long format puts one row per (section, label, metric) rather than using a wide
 * table, because the sections do not share columns: a day of traffic, a referring
 * origin and a device bucket have nothing in common to line up under one header.
 * A wide file would be mostly empty cells, and it would break every time a
 * metric was added. Long format pivots cleanly in a spreadsheet, which is what
 * an operator is going to do with it anyway.
 */
export function summaryToCsv(summary: AnalyticsSummary): { buffer: Buffer; filename: string } {
  const records: Array<{ section: string; label: string; metric: string; value: string | number }> =
    [
      { section: 'range', label: '', metric: 'from', value: summary.range.from },
      { section: 'range', label: '', metric: 'to', value: summary.range.to },
      { section: 'range', label: '', metric: 'granularity', value: summary.range.granularity },
      { section: 'totals', label: '', metric: 'pageViews', value: summary.totals.pageViews },
      {
        section: 'totals',
        label: '',
        metric: 'uniqueVisitors',
        value: summary.totals.uniqueVisitors,
      },
      { section: 'totals', label: '', metric: 'events', value: summary.totals.events },
    ];

  for (const row of summary.series) {
    records.push(
      { section: 'series', label: row.bucket, metric: 'pageViews', value: row.pageViews },
      { section: 'series', label: row.bucket, metric: 'uniqueVisitors', value: row.uniqueVisitors },
      { section: 'series', label: row.bucket, metric: 'events', value: row.events },
    );
  }

  for (const row of summary.topPaths) {
    records.push(
      { section: 'topPaths', label: row.path, metric: 'views', value: row.views },
      { section: 'topPaths', label: row.path, metric: 'visitors', value: row.visitors },
    );
  }

  for (const row of summary.topReferrers) {
    records.push(
      { section: 'topReferrers', label: row.referrer, metric: 'views', value: row.views },
      { section: 'topReferrers', label: row.referrer, metric: 'visitors', value: row.visitors },
    );
  }

  for (const row of summary.deviceBreakdown) {
    records.push(
      { section: 'deviceBreakdown', label: row.device, metric: 'events', value: row.events },
      { section: 'deviceBreakdown', label: row.device, metric: 'visitors', value: row.visitors },
    );
  }

  const body = stringify(records, {
    header: true,
    /*
     * Excel on Windows decodes a `.csv` using the machine's ANSI codepage unless
     * the file opens with a UTF-8 byte order mark, so without this a path or a
     * referring host containing a non-ASCII character arrives as mojibake.
     */
    bom: true,
    columns: [
      { key: 'section', header: 'Section' },
      { key: 'label', header: 'Label' },
      { key: 'metric', header: 'Metric' },
      { key: 'value', header: 'Value' },
    ],
  });

  return {
    buffer: Buffer.from(body, 'utf8'),
    filename: `analytics-summary-${summary.range.from.slice(0, 10)}-to-${summary.range.to.slice(0, 10)}.csv`,
  };
}

/* -------------------------------------------------------------------------- */
/* Token usage                                                                */
/* -------------------------------------------------------------------------- */

export interface TokenUsageReport {
  range: { from: string; to: string; days: number };
  tokens: Array<{
    id: string;
    name: string;
    tokenPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    /** Requests inside the window, not the token's lifetime total. */
    requests: number;
    series: Array<{ date: string; requests: number }>;
  }>;
}

/**
 * Per-token daily request counts for the caller's own tokens.
 *
 * The ownership predicate is on `api_tokens.user_id` in the WHERE clause, so the
 * join can only ever reach usage rows belonging to the caller. Filtering after
 * the fetch would mean the database had already handed over someone else's
 * traffic.
 *
 * Revoked and expired tokens are included: their history is the answer to "what
 * was that thing doing before I turned it off", and the timestamps are returned
 * so the client can present them as dead.
 */
export async function getTokenUsage(
  userId: string,
  input: TokenUsageQuery,
): Promise<TokenUsageReport> {
  const to = new Date();
  const from = new Date(to.getTime() - input.days * 86_400_000);

  // `api_token_usage.day` is a `YYYY-MM-DD` text key, and ISO dates order
  // lexicographically, so a text comparison is a chronological one, and it hits
  // the index, which casting the column to a date would not.
  const since = usageDay(from);

  // `json_agg` builds the per-token series in Postgres. The alternative, one
  // flat row per token-day regrouped in JavaScript, is the same data twice
  // over, once as rows and once as the objects it was always going to become.
  const result = await db.execute<{
    id: string;
    name: string;
    tokenPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    requests: number;
    series: Array<{ date: string; requests: number }>;
  }>(sql`
    select ${apiTokens.id} as id,
           ${apiTokens.name} as name,
           ${apiTokens.tokenPrefix} as "tokenPrefix",
           ${apiTokens.lastUsedAt} as "lastUsedAt",
           ${apiTokens.expiresAt} as "expiresAt",
           ${apiTokens.revokedAt} as "revokedAt",
           coalesce(sum(${apiTokenUsage.requestCount}), 0)::int as requests,
           -- A token with no traffic in the window still belongs in the report,
           -- so the LEFT JOIN's null row is filtered out of the aggregate rather
           -- than out of the result.
           coalesce(
             json_agg(
               json_build_object('date', ${apiTokenUsage.day}, 'requests', ${apiTokenUsage.requestCount})
               order by ${apiTokenUsage.day}
             ) filter (where ${apiTokenUsage.day} is not null),
             '[]'::json
           ) as series
    from ${apiTokens}
    left join ${apiTokenUsage}
      on ${apiTokenUsage.tokenId} = ${apiTokens.id} and ${apiTokenUsage.day} >= ${since}
    where ${apiTokens.userId} = ${userId}
    group by ${apiTokens.id}
    order by requests desc, ${apiTokens.createdAt} desc
  `);

  return {
    range: { from: from.toISOString(), to: to.toISOString(), days: input.days },
    tokens: result.rows,
  };
}

/* -------------------------------------------------------------------------- */
/* Retention                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Delete events past the configured retention window.
 *
 * Called by the retention job as well as the root endpoint. The affected-row
 * count is taken from the driver instead of `RETURNING`, because a first purge
 * on a busy installation can span millions of rows and there is no reason to
 * carry every one of their ids back into memory to arrive at a single number.
 */
export async function purgeExpiredEvents(): Promise<number> {
  const { retentionDays } = await getSettings('analytics');
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  const result = await db.delete(analyticsEvents).where(lt(analyticsEvents.createdAt, cutoff));

  return result.rowCount ?? 0;
}

/** The instant `purgeExpiredEvents` would delete up to, so a caller can report it. */
export async function retentionCutoff(): Promise<{ retentionDays: number; cutoff: Date }> {
  const { retentionDays } = await getSettings('analytics');
  return { retentionDays, cutoff: new Date(Date.now() - retentionDays * 86_400_000) };
}
