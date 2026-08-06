/**
 * Runtime access to site settings.
 *
 * Settings are read on almost every request (limits, feature flags, branding)
 * but written rarely, so values are cached in memory for a short window.
 *
 * The TTL is deliberately short rather than the cache being invalidated on
 * write: in a multi-instance or serverless deployment, one instance clearing
 * its own map says nothing about the others. A 30-second ceiling means a
 * settings change is live everywhere within 30 seconds without any coordination
 * between instances.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { siteSettings } from '../db/schema.js';
import {
  SETTINGS_REGISTRY,
  SETTINGS_KEYS,
  defaultsFor,
  type SettingsKey,
  type SettingsShape,
} from '../config/settings.js';
import { logger } from './logger.js';

const CACHE_TTL_MS = 30_000;

interface CacheEntry<K extends SettingsKey> {
  value: SettingsShape[K];
  expiresAt: number;
}

const cache = new Map<SettingsKey, CacheEntry<SettingsKey>>();

/**
 * Merge a stored value over the section's defaults, then validate.
 *
 * Merging first is what makes adding a new setting a non-breaking change: rows
 * written before the field existed simply inherit its default. If the stored
 * value is corrupt or fails validation we fall back to defaults and log it,
 * because a broken settings row must not take the whole site down.
 */
function reconcile<K extends SettingsKey>(key: K, stored: unknown): SettingsShape[K] {
  const defaults = defaultsFor(key);

  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) {
    return defaults;
  }

  const merged = { ...defaults, ...(stored as Record<string, unknown>) };
  const parsed = SETTINGS_REGISTRY[key].schema.safeParse(merged);

  if (!parsed.success) {
    logger.warn(
      { key, issues: parsed.error.issues },
      'Stored site settings failed validation, falling back to defaults for this section',
    );
    return defaults;
  }

  return parsed.data as SettingsShape[K];
}

export async function getSettings<K extends SettingsKey>(key: K): Promise<SettingsShape[K]> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as SettingsShape[K];
  }

  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, key))
    .limit(1);

  const value = reconcile(key, row?.value);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Every section at once. Used by the admin panel and the public settings feed. */
export async function getAllSettings(): Promise<SettingsShape> {
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings);

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = {} as SettingsShape;

  for (const key of SETTINGS_KEYS) {
    const value = reconcile(key, byKey.get(key));
    result[key] = value as never;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return result;
}

/**
 * Apply a partial update to one section.
 *
 * The patch is merged over the *current* value and the result is validated as a
 * whole, so a partial update can never leave a section in a state the schema
 * would reject.
 */
export async function updateSettings<K extends SettingsKey>(
  key: K,
  patch: Record<string, unknown>,
  actorId: string,
): Promise<SettingsShape[K]> {
  const current = await getSettings(key);
  const merged = { ...current, ...patch };

  // Throws on invalid input; the route's error handler turns it into a 422.
  const value = SETTINGS_REGISTRY[key].schema.parse(merged) as SettingsShape[K];

  await db
    .insert(siteSettings)
    .values({
      key,
      value,
      isPublic: SETTINGS_REGISTRY[key].isPublic,
      updatedBy: actorId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Restore one section to its shipped defaults. */
export async function resetSettings<K extends SettingsKey>(
  key: K,
  actorId: string,
): Promise<SettingsShape[K]> {
  const value = defaultsFor(key);

  await db
    .insert(siteSettings)
    .values({
      key,
      value,
      isPublic: SETTINGS_REGISTRY[key].isPublic,
      updatedBy: actorId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Drop the cache. Used by tests; production relies on the TTL. */
export function clearSettingsCache(): void {
  cache.clear();
}
