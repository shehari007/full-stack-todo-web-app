'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AriaAttributes, FC } from 'react';
import Link from 'next/link';
import { App, Button, Drawer, Switch, Typography } from 'antd';
import type { SwitchProps } from 'antd';
import { ApiError, api } from '@/lib/api';
import type { LegalSettings } from '@/types/api';

/**
 * Cookie consent banner and preference drawer.
 *
 * The cookie is written by the API, not here. That is deliberate: the record in
 * `consent_records` is what makes the consent demonstrable, and a client that
 * set its own cookie could claim an agreement the server never witnessed. If
 * the request fails, the banner stays up, because no consent is better than
 * invented consent.
 */

/** Readable by scripts on purpose: the banner must decide whether to render before any fetch. */
export const CONSENT_COOKIE = 'tf_consent';

/** Dispatched by the footer's "Cookie preferences" control to reopen the drawer. */
export const OPEN_CONSENT_EVENT = 'taskflow:open-consent';

/** Dispatched after a successful save so the analytics tracker can start or stop without a reload. */
export const CONSENT_CHANGED_EVENT = 'taskflow:consent-changed';

export interface StoredConsent {
  analytics: boolean;
  preferences: boolean;
  policyVersion: string;
}

/**
 * Parse the `tf_consent` cookie. Anything malformed is treated as no consent:
 * a tampered or half-written cookie must never read as permission.
 */
export function readConsentCookie(): StoredConsent | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
  const raw = match?.[1];
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { a, p, v } = parsed as { a?: unknown; p?: unknown; v?: unknown };
    if ((a !== 0 && a !== 1) || (p !== 0 && p !== 1) || typeof v !== 'string' || !v) return null;

    return { analytics: a === 1, preferences: p === 1, policyVersion: v };
  } catch {
    return null;
  }
}

/**
 * Whether analytics collection is permitted in this browser right now.
 *
 * `policyVersion` is optional but should be passed: consent recorded against a
 * superseded policy is consent to text the visitor never saw, and the API
 * rejects it for the same reason.
 */
export function hasAnalyticsConsent(policyVersion?: string): boolean {
  const consent = readConsentCookie();
  if (!consent) return false;
  if (policyVersion !== undefined && consent.policyVersion !== policyVersion) return false;
  return consent.analytics;
}

interface Categories {
  analytics: boolean;
  preferences: boolean;
}

type Pending = 'all' | 'necessary' | 'custom' | null;

export function CookieConsent({ legal }: { legal: LegalSettings }) {
  const { message } = App.useApp();

  const [bannerVisible, setBannerVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [status, setStatus] = useState('');
  const [choices, setChoices] = useState<Categories>({ analytics: false, preferences: false });

  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Only the browser can answer this, so it happens after mount rather than
   * during render. A server-rendered banner would either flash for people who
   * already answered or hydrate into a mismatch.
   */
  const syncFromCookie = useCallback((): StoredConsent | null => {
    const stored = readConsentCookie();
    const current = stored?.policyVersion === legal.policyVersion;

    // Choices are pre-filled from the previous answer only while it still
    // applies to the published policy; after a version bump the switches start
    // from the privacy-preserving default instead of implying a prior yes.
    setChoices({
      analytics: current ? Boolean(stored?.analytics) : false,
      preferences: current ? Boolean(stored?.preferences) : false,
    });

    return stored;
  }, [legal.policyVersion]);

  useEffect(() => {
    const stored = syncFromCookie();
    setBannerVisible(!stored || stored.policyVersion !== legal.policyVersion);
  }, [legal.policyVersion, syncFromCookie]);

  useEffect(() => {
    const open = () => {
      syncFromCookie();
      setDrawerOpen(true);
    };

    window.addEventListener(OPEN_CONSENT_EVENT, open);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, open);
  }, [syncFromCookie]);

  /*
   * rc-drawer does not handle Escape itself, and a dialog that cannot be
   * dismissed from the keyboard is a trap. The listener is only bound while the
   * drawer is open.
   */
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  /*
   * Focus moves to the banner so a screen reader announces it and the buttons
   * are one Tab away. Focus is not trapped: this is `aria-modal="false"`, the
   * page behind it stays fully usable, and a visitor who wants to read the
   * cookie policy before answering must be able to Tab into the page.
   */
  useEffect(() => {
    if (bannerVisible) panelRef.current?.focus({ preventScroll: true });
  }, [bannerVisible]);

  const save = useCallback(
    async (categories: Categories, source: Exclude<Pending, null>) => {
      setPending(source);
      setStatus('Saving your cookie preferences.');

      try {
        await api.post('/api/analytics/consent', { categories });

        setChoices(categories);
        setBannerVisible(false);
        setDrawerOpen(false);
        setStatus('Cookie preferences saved.');
        // Lets the tracker react immediately; otherwise the page view for the
        // page the visitor consented on is lost.
        window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT));
        message.success('Your cookie preferences have been saved.');
      } catch (error) {
        const text =
          error instanceof ApiError
            ? error.message
            : 'Your cookie preferences could not be saved. Please try again.';
        setStatus(text);
        message.error(text);
      } finally {
        setPending(null);
      }
    },
    [message],
  );

  const busy = pending !== null;

  return (
    <>
      {bannerVisible ? (
        <div className="tf-consent">
          <div
            className="tf-consent__panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tf-consent-title"
            aria-describedby="tf-consent-description"
          >
            <div className="tf-consent__text">
              <strong id="tf-consent-title" style={{ display: 'block', color: 'var(--tf-text)' }}>
                Your privacy choices
              </strong>
              <p id="tf-consent-description" style={{ margin: '0.35rem 0 0' }}>
                {legal.cookieBannerText}{' '}
                <Link href="/legal/cookies">Read the cookie policy</Link>.
              </p>
            </div>

            <div className="tf-consent__actions">
              <Button
                onClick={() => setDrawerOpen(true)}
                disabled={busy}
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
              >
                Customise
              </Button>
              <Button
                onClick={() => void save({ analytics: false, preferences: false }, 'necessary')}
                loading={pending === 'necessary'}
                disabled={busy && pending !== 'necessary'}
              >
                Necessary only
              </Button>
              <Button
                type="primary"
                onClick={() => void save({ analytics: true, preferences: true }, 'all')}
                loading={pending === 'all'}
                disabled={busy && pending !== 'all'}
              >
                Accept all
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Drawer
        title="Cookie preferences"
        placement="right"
        size="min(420px, 100vw)"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        footer={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDrawerOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="primary"
              onClick={() => void save(choices, 'custom')}
              loading={pending === 'custom'}
            >
              Save preferences
            </Button>
          </div>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: '1.5rem' }}>
          You can change these at any time from the &ldquo;Cookie preferences&rdquo; link in the
          footer. Withdrawing consent stops collection immediately.
        </Typography.Paragraph>

        {/* Shown as on and disabled, never as an unchecked option the visitor
            could grant: these cookies are what the sign-in and CSRF defences
            are built from, so offering a toggle would be offering a lie. */}
        <ConsentOption
          id="tf-consent-necessary"
          name="Strictly necessary"
          description="Keeps you signed in, protects forms against cross-site requests, and remembers this choice."
          note="Always on. The service cannot run without these."
          checked
          disabled
        />

        <ConsentOption
          id="tf-consent-analytics"
          name="Analytics"
          description="Anonymous page counts so the administrator can see which pages are used. No third-party scripts."
          checked={choices.analytics}
          onChange={(analytics) => setChoices((previous) => ({ ...previous, analytics }))}
        />

        <ConsentOption
          id="tf-consent-preferences"
          name="Preferences"
          description="Remembers display choices such as your theme and list layout."
          checked={choices.preferences}
          onChange={(preferences) => setChoices((previous) => ({ ...previous, preferences }))}
        />
      </Drawer>

      {/* Announces the outcome to a screen reader; the toast alone is invisible
          to assistive technology once it has been dismissed. */}
      <div aria-live="polite" role="status" className="tf-consent__status">
        {status}
      </div>

      <style href="tf-consent-extra" precedence="default">
        {CONSENT_CSS}
      </style>
    </>
  );
}

/**
 * antd's `SwitchProps` declares no ARIA attributes, but antd and rc-switch both
 * spread unknown props straight onto the underlying `<button>`, so they do
 * reach the DOM. The alternative, wrapping the switch in a `<label>`, does not
 * work: a button's accessible name is computed from its own subtree, not from
 * an associated label, so the switches would all be called "On".
 */
const LabelledSwitch = Switch as FC<SwitchProps & AriaAttributes>;

function ConsentOption({
  id,
  name,
  description,
  checked,
  disabled,
  note,
  onChange,
}: {
  id: string;
  name: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onChange?: (checked: boolean) => void;
}) {
  const nameId = `${id}-name`;
  const descriptionId = `${id}-desc`;

  return (
    <div className="tf-consent-option">
      <span className="tf-consent-option__text">
        <span className="tf-consent-option__name" id={nameId}>
          {name}
        </span>
        <span className="tf-consent-option__desc tf-muted" id={descriptionId}>
          {description}
          {note ? ` ${note}` : ''}
        </span>
      </span>
      {/* "On"/"Off" is rendered inside the switch so the state is legible
          without perceiving the colour change. */}
      <LabelledSwitch
        id={id}
        aria-labelledby={nameId}
        aria-describedby={descriptionId}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        checkedChildren="On"
        unCheckedChildren="Off"
      />
    </div>
  );
}

const CONSENT_CSS = `
.tf-consent__status { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.tf-consent-option { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding-block: 1rem; border-top: 1px solid var(--tf-border); }
.tf-consent-option:last-of-type { border-bottom: 1px solid var(--tf-border); }
.tf-consent-option__text { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.tf-consent-option__name { font-weight: 600; }
.tf-consent-option__desc { font-size: 0.85rem; line-height: 1.5; }
`;
