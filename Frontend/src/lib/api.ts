/**
 * Browser-side API client.
 *
 * Requests go to a relative `/api/...` path, which `next.config.ts` rewrites to
 * the Express server. Because that keeps everything same-origin, the session
 * cookies are sent automatically and no token is ever handled in JavaScript. An
 * XSS bug cannot read an HttpOnly cookie.
 *
 * For anything that changes state we echo the CSRF cookie back in a header;
 * see `csrfProtection` in the API for why that is sufficient.
 */
import type { ApiErrorBody, ApiErrorCode } from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level messages from a 422, shaped for an Ant Design form. */
  get fieldErrors(): Record<string, string[]> | null {
    if (this.code !== 'VALIDATION_FAILED' || !this.details) return null;
    return this.details as Record<string, string[]>;
  }
}

const CSRF_COOKIE = 'tf_csrf';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for file uploads, where the body is raw bytes rather than JSON. */
  rawBody?: BodyInit;
  query?: Record<string, unknown>;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    // Repeat the key for arrays so Express parses `status=a&status=b` as a list.
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.append(key, String(value));
    }
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Single in-flight refresh promise.
 *
 * Without this, a page that fires six requests at once on a stale access token
 * would trigger six concurrent refreshes. Refresh tokens rotate, so five of
 * them would present an already-rotated token, which the API correctly treats
 * as a stolen-token replay and responds to by revoking every session. Sharing
 * one promise is what keeps that from happening.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': readCookie(CSRF_COOKIE) ?? '' },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so every awaiting caller sees the same result.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    /* Not JSON, so fall through to a generic message. */
  }

  return new ApiError(
    response.status,
    body?.error?.code ?? 'INTERNAL',
    body?.error?.message ?? `Request failed (${response.status})`,
    body?.error?.details,
  );
}

async function execute(path: string, options: RequestOptions, isRetry = false): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(path, options.query), {
    ...options,
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  /*
   * A 401 usually just means the 15-minute access token expired. Refresh once
   * and replay. The `isRetry` guard stops this recursing when the refresh
   * itself is what is failing.
   */
  if (response.status === 401 && !isRetry && !path.startsWith('/api/auth/refresh')) {
    if (await refreshSession()) {
      return execute(path, options, true);
    }
  }

  return response;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await execute(path, options);

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Download a file, returning the blob and the server-supplied filename. */
export async function apiDownload(
  path: string,
  query?: Record<string, unknown>,
): Promise<{ blob: Blob; filename: string }> {
  const response = await execute(path, { query });

  if (!response.ok) {
    throw await toApiError(response);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);

  return {
    blob: await response.blob(),
    filename: match?.[1] ? decodeURIComponent(match[1]) : 'download',
  };
}

/** Trigger a browser save dialog for a downloaded blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in Safari, so defer it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>) =>
    apiRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),

  /**
   * Upload raw bytes. The API reads the filename from a header rather than
   * parsing multipart, so there is no multipart dependency on either side.
   */
  upload: <T>(path: string, file: File) =>
    apiRequest<T>(path, {
      method: 'POST',
      rawBody: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
      },
    }),
};

/** Default fetcher for SWR. */
export const swrFetcher = <T>(path: string) => apiRequest<T>(path);
