import { NextResponse, type NextRequest } from 'next/server';

/**
 * Routing guard.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`, and it now runs on
 * the Node.js runtime rather than the edge.
 *
 * This is a *redirect* layer, not an authorisation layer. It only checks
 * whether a session cookie is present, so that signed-out visitors land on the
 * sign-in page instead of a dashboard that would flash and then fail. It cannot
 * verify the token (the signing key lives on the API), and a forged cookie gets
 * past it trivially.
 *
 * The real check happens on the API for every request. Nothing here is load
 * bearing for security; removing this file would cost UX, not safety.
 */
const ACCESS_COOKIE = 'tf_access';
const REFRESH_COOKIE = 'tf_refresh';
const CSRF_COOKIE = 'tf_csrf';

/**
 * Marker the signed-in layouts add when the API rejects the cookies they were
 * given. See `clearRejectedSession` below for why it has to exist.
 */
export const SESSION_REJECTED_PARAM = 'expired';

/** `tf_refresh` is scoped to /api/auth, so clearing it needs the same path. */
const COOKIE_PATHS: ReadonlyArray<readonly [string, string]> = [
  [ACCESS_COOKIE, '/'],
  [REFRESH_COOKIE, '/api/auth'],
  [CSRF_COOKIE, '/'],
];

/** Paths that require a session. */
const PROTECTED_PREFIXES = ['/dashboard', '/tasks', '/profile', '/settings', '/admin'];

/** Paths that a signed-in user should be bounced away from. */
const AUTH_PREFIXES = ['/login', '/register'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  /*
   * The refresh cookie is scoped to /api/auth and so is not visible here; the
   * access cookie is the only usable signal. It expires after 15 minutes, which
   * would bounce a still-valid session to the sign-in page. The client refreshes
   * on a 401, so treat "no access cookie" as signed out only for the redirect
   * decision and let the page itself recover if a refresh succeeds.
   */
  /*
   * A session the API has already refused.
   *
   * This file and the signed-in layouts answer "is this visitor signed in?"
   * differently: here it is only whether a cookie exists; there it is whether
   * `/api/auth/me` accepts it. A cookie that exists but is worthless makes them
   * disagree permanently: the layout redirects to /login, this redirects
   * straight back to /dashboard, and the browser gives up with
   * ERR_TOO_MANY_REDIRECTS. It happens whenever the API restarts with new JWT
   * secrets, after the sessions table is cleared, or while the API is simply
   * unreachable.
   *
   * The layouts flag it, and the cookies are cleared here rather than merely
   * skipping the redirect. Clearing is what ends it: the next request carries
   * nothing, so both checks finally agree that nobody is signed in.
   */
  if (pathname === '/login' && request.nextUrl.searchParams.has(SESSION_REJECTED_PARAM)) {
    const response = NextResponse.next();
    for (const [name, path] of COOKIE_PATHS) {
      response.cookies.set(name, '', { path, maxAge: 0 });
    }
    return response;
  }

  const hasSession = Boolean(
    request.cookies.get(ACCESS_COOKIE) ?? request.cookies.get(REFRESH_COOKIE),
  );

  if (PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they were going so sign-in can return them there.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Skip Next.js internals, the API proxy and static files. Running this on
   * every image request is pure latency.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)',
  ],
};
