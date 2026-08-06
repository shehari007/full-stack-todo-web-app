import 'server-only';

import { cookies } from 'next/headers';
import { cache } from 'react';
import type { PublicSettings, User } from '@/types/api';

/**
 * Server-side API access, for server components, `generateMetadata` and route
 * handlers.
 *
 * The browser client in `api.ts` uses relative URLs and lets Next.js rewrite
 * them. That does not work here: server-side `fetch` has no notion of "this
 * site", so it needs the API's absolute origin and must forward the incoming
 * cookies by hand.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8000';

async function serverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Public settings                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The branding, SEO and legal copy used to render every page.
 *
 * `cache` deduplicates this within a single render pass: the root layout,
 * `generateMetadata` and the footer all ask for it, and without deduplication
 * that would be three round trips per request. The `revalidate` window then
 * keeps it from being fetched on every request at all, so a settings change
 * appears within a minute.
 */
export const getPublicSettings = cache(async (): Promise<PublicSettings | null> => {
  try {
    const response = await fetch(`${API_ORIGIN}/api/settings/public`, {
      next: { revalidate: 60, tags: ['settings'] },
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { settings: PublicSettings };
    return body.settings;
  } catch {
    /*
     * The API being unreachable must not turn the whole site into an error
     * page. Callers fall back to the defaults in `settings-defaults.ts`, so the
     * marketing and legal pages still render while the API is restarting.
     */
    return null;
  }
});

/* -------------------------------------------------------------------------- */
/* Current user                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the signed-in user for a server component.
 *
 * Returns null rather than throwing when there is no session, so layouts can
 * decide between redirecting and rendering a signed-out view.
 *
 * The logging is not decoration. Every reason this can fail (a rejected
 * cookie, an API that is not running, `API_ORIGIN` pointing at the wrong port)
 * collapses into the same `null`, and the user is then shown "your session has
 * ended", which is only true for the first of them. Without a line in the
 * server log, an unreachable API is indistinguishable from an expired session.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  try {
    const response = await serverFetch('/api/auth/me', { cache: 'no-store' });

    if (!response.ok) {
      if (process.env.NODE_ENV !== 'production' && response.status !== 401) {
        console.warn(
          `[taskflow] GET ${API_ORIGIN}/api/auth/me responded ${response.status}. ` +
            `Treating the visitor as signed out.`,
        );
      }
      return null;
    }

    const body = (await response.json()) as { user: User };
    return body.user;
  } catch (error) {
    // A throw here is a transport failure: the API is down, or API_ORIGIN is
    // wrong. It is never "the session expired", so say so plainly.
    console.warn(
      `[taskflow] Could not reach the API at ${API_ORIGIN}. Is it running, and ` +
        `does API_ORIGIN in your Next.js env match its port? ` +
        `(${(error as Error).message})`,
    );
    return null;
  }
});

/** Generic authenticated read for server components. */
export async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const response = await serverFetch(path, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Absolute URL for an attachment served by the API (logos, avatars). */
export function attachmentUrl(id: string | null | undefined): string | null {
  return id ? `/api/attachments/${id}` : null;
}
