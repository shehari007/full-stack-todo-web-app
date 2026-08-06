/**
 * Audit trail for privileged and security-relevant actions.
 *
 * Writes are fire-and-forget: an audit failure logs a warning but never turns a
 * successful operation into an error response. The alternative (failing the
 * request) would mean a full audit table could lock every administrator out of
 * the system.
 */
import type { Request } from 'express';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { clientIp, clientUserAgent } from './http.js';
import { logger } from './logger.js';

/**
 * Known actions, as a union rather than free-form strings so that a typo is a
 * compile error and the admin UI can offer a complete filter list.
 */
export type AuditAction =
  /* Authentication */
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.register'
  | 'auth.password_change'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.mfa_recovery_used'
  | 'auth.session_revoked'
  /* Account lifecycle */
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.suspend'
  | 'user.reactivate'
  | 'user.role_change'
  | 'user.password_reset'
  | 'user.quota_change'
  | 'user.mfa_reset'
  /* Personal access tokens */
  | 'token.create'
  | 'token.revoke'
  /* Content */
  | 'todo.bulk_delete'
  | 'attachment.delete'
  /* Support desk */
  | 'ticket.create'
  | 'ticket.reply'
  | 'ticket.update'
  | 'contact.submit'
  /* Installation */
  | 'settings.update'
  | 'settings.reset'
  | 'site_asset.upload'
  | 'analytics.purge'
  | 'data.export';

export interface AuditEntry {
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record an action.
 *
 * `actorUsername` is denormalised alongside the foreign key so the entry stays
 * readable after the account is deleted. A log that says "someone deleted this
 * user" is not much of a log.
 */
export async function recordAudit(
  req: Request,
  entry: AuditEntry,
  actor?: { id: string; username: string },
): Promise<void> {
  const resolved = actor ?? (req.auth ? { id: req.auth.userId, username: req.auth.username } : null);

  try {
    await db.insert(auditLogs).values({
      actorId: resolved?.id ?? null,
      actorUsername: resolved?.username ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: clientIp(req),
      userAgent: clientUserAgent(req),
    });
  } catch (error) {
    logger.warn({ err: error, action: entry.action }, 'Failed to write audit entry');
  }
}

/**
 * Summarise a change for the audit metadata.
 *
 * Only the keys that actually changed are kept, and values are replaced with
 * `[redacted]` for sensitive fields. An audit log must never become the place
 * where password hashes or TOTP secrets are stored in the clear.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'mfaSecret',
  'mfaRecoveryCodes',
  'data',
]);

export function diffForAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of Object.keys(after)) {
    const previous = before[key];
    const next = after[key];

    if (JSON.stringify(previous) === JSON.stringify(next)) continue;

    changes[key] = REDACTED_FIELDS.has(key)
      ? { from: '[redacted]', to: '[redacted]' }
      : { from: previous ?? null, to: next ?? null };
  }

  return changes;
}
