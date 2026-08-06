/**
 * The scopes a personal access token can carry, with the wording used wherever
 * one is offered or explained.
 *
 * Held apart from the components because the create form and the API reference
 * must not describe the same grant differently. The checkbox label is the only
 * place most people will ever read what they are handing out.
 */
import type { TokenScope } from '@/types/api';

/** Listed in the order they are offered, narrowest reach first. */
export const TOKEN_SCOPES: readonly TokenScope[] = ['tasks:read', 'stats:read', 'profile:read'];

/**
 * Narrow a scope name the API sent us.
 *
 * `GET /api/tokens` ships `availableScopes` so the create form offers the
 * server's list rather than this file's copy of it. A scope that build knows
 * about but this one has no wording for cannot be offered, because an unlabelled
 * checkbox is worse than a missing one, so it is filtered out here.
 */
export function isKnownScope(scope: string): scope is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(scope);
}

export interface ScopeInfo {
  label: string;
  /** One line, plain English: exactly what the holder of the token can read. */
  grants: string;
  /** The endpoints the scope unlocks, for the reference table. */
  endpoints: string[];
}

export const SCOPE_INFO: Record<TokenScope, ScopeInfo> = {
  'tasks:read': {
    label: 'Read your tasks',
    grants:
      'Read your tasks: titles, descriptions, due dates, tags and status. Nothing can be created, changed or deleted.',
    endpoints: ['GET /api/v1/tasks', 'GET /api/v1/tasks/{id}'],
  },
  'stats:read': {
    label: 'Read your statistics',
    grants:
      'Read counts and your completion rate only: how many tasks, how many done, your streak. No titles, no descriptions.',
    endpoints: ['GET /api/v1/stats'],
  },
  'profile:read': {
    label: 'Read your profile',
    grants:
      'Read your username, display name and the id of your avatar image, but not the image itself, which still needs a signed-in session. Never your email address, and never your password or security settings.',
    endpoints: ['GET /api/v1/me'],
  },
};
