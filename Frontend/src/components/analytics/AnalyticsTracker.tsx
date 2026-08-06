'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { CONSENT_CHANGED_EVENT, hasAnalyticsConsent } from '@/components/consent/CookieConsent';

/**
 * First-party page-view reporting.
 *
 * Every rule here is also enforced by the API, which is the point: the server
 * cannot trust a client, and the client should not be sending events the server
 * is only going to throw away. Doing the checks twice means a visitor who
 * declined is not making a request at all, rather than making one that quietly
 * 204s.
 */

/**
 * Long enough that holding the back button through five pages of history
 * reports the page the visitor actually stopped on, short enough that a normal
 * click is recorded well before they leave.
 */
const DEBOUNCE_MS = 700;

/**
 * Do Not Track and Global Privacy Control are both explicit opt-outs.
 * `globalPrivacyControl` is not in the DOM typings, so the shape is asserted
 * rather than the whole `Navigator` being widened.
 */
function hasPrivacyOptOut(): boolean {
  const nav = navigator as unknown as {
    doNotTrack?: string | null;
    globalPrivacyControl?: boolean;
  };

  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function PageViewReporter() {
  // The published policy version, so a consent cookie left over from an earlier
  // policy is treated as no consent, exactly as the API treats it.
  const { settings } = useAuth();
  const policyVersion = settings.legal.policyVersion;

  const pathname = usePathname();
  // Read as a string: the object identity changes on every render, which would
  // restart the debounce timer forever if it were used as the dependency.
  const query = useSearchParams().toString();

  // `null` means "not established yet" and is deliberately not `false`: the
  // first render happens before any cookie can be read, and an event sent then
  // would be an event sent without knowing whether it was allowed.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const lastReported = useRef<string | null>(null);
  const sentFirstEvent = useRef(false);

  useEffect(() => {
    const evaluate = () => setAllowed(!hasPrivacyOptOut() && hasAnalyticsConsent(policyVersion));

    evaluate();
    // Consent can be granted or withdrawn mid-session from the banner or the
    // footer, and neither reloads the page.
    window.addEventListener(CONSENT_CHANGED_EVENT, evaluate);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, evaluate);
  }, [policyVersion]);

  useEffect(() => {
    if (allowed !== true) return;

    // The API stores the pathname only, because query strings routinely carry
    // reset tokens and search terms. Stripping it here means those values never
    // leave the browser, and it is why a filter change on the same page is not
    // reported twice.
    const path = (pathname || '/').split(/[?#]/)[0] || '/';
    if (path === lastReported.current) return;

    const timer = window.setTimeout(() => {
      lastReported.current = path;

      /*
       * `document.referrer` still holds the original external referrer after an
       * in-app navigation, so sending it every time would count one arrival
       * once per page the visitor looked at.
       */
      const referrer = sentFirstEvent.current ? '' : document.referrer;
      sentFirstEvent.current = true;

      api
        .post('/api/analytics/collect', {
          name: 'page_view',
          path,
          ...(referrer ? { referrer } : {}),
        })
        .catch(() => {
          // Swallowed on purpose. A visitor has no interest in, and no way to
          // act on, a failed analytics write.
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [allowed, pathname, query]);

  return null;
}

/**
 * `useSearchParams` opts everything above it into client-side rendering unless
 * it sits under a Suspense boundary. This component is mounted in the root
 * layout, so without the boundary it would deopt every page in the app.
 */
export function AnalyticsTracker() {
  return (
    <Suspense fallback={null}>
      <PageViewReporter />
    </Suspense>
  );
}
