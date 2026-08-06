'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Result, Select, Typography } from 'antd';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';

const { Text } = Typography;

/**
 * What `GET /api/contact/config` returns.
 *
 * Declared beside the form rather than in `types/api.ts` for the same reason the
 * ticket shapes live in `components/support/ticket-meta.ts`: the support
 * surfaces keep their own vocabulary next to the screens that use it, and this
 * one is read by exactly two files.
 */
export interface ContactConfig {
  /**
   * `features.contactFormEnabled`. False means the operator closed the form.
   * The page renders the notice instead of this component, because posting
   * would only earn a 403 after the visitor had written the whole message.
   */
  enabled: boolean;
  categories: string[];
  heading: string;
  intro: string;
  responseTimeNote: string;
  /** Operator-editable copy shown after a successful send. */
  acknowledgement: string;
  requiresAccount: boolean;
  maxMessageLength: number;
  minFillSeconds: number;
}

/**
 * `POST /api/contact` on success.
 *
 * The route deliberately returns the reference and the acknowledgement and
 * nothing else. It never echoes the submitted subject or body back.
 */
interface ContactResult {
  ticketNumber: number | string;
  acknowledgement: string;
}

interface ContactValues {
  /** Absent when signed in: those two fields are not rendered and the identity
   *  comes from the session instead. */
  name?: string;
  email?: string;
  subject: string;
  category: string;
  message: string;
}

interface Banner {
  type: 'error' | 'warning';
  title: string;
  text: string;
}

const MESSAGE_HINT_ID = 'tf-contact-message-hint';
const MESSAGE_COUNT_ID = 'tf-contact-message-count';

/* Client-side guards only. The API re-checks all of them. The numbers are not
   guesses: they are `contactSubmissionSchema` in the API's support.schemas.ts,
   and they are here so a rejection happens under the field rather than as a
   round trip. The message cap is absent because it is operator-configurable and
   arrives in the config. */
const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_SUBJECT = 200;
const MIN_SUBJECT = 3;

/** The API trims before it measures, so the client has to measure the same string. */
const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/** Matches the inline heading style the auth screens use inside a `Result`. */
const RESULT_HEADING: React.CSSProperties = { fontSize: 'inherit', fontWeight: 'inherit', margin: 0 };

const CSS = `
/*
 * The honeypot is moved off-screen rather than hidden with display:none or
 * hidden="". Spam bots skip fields the CSS removes from the layout (that is the
 * cheapest tell there is), but they happily fill one that is merely positioned
 * out of view, which is the whole point of the trap. People never reach it: it
 * is out of the tab order and out of the accessibility tree.
 */
.tf-cf__trap {
  position: absolute;
  left: -9999px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.tf-cf__identity {
  margin: 0 0 1.25rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--tf-border);
  border-radius: 10px;
  background: var(--tf-border-subtle);
  font-size: 0.9375rem;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.tf-cf__counter { display: block; text-align: right; font-size: 0.8125rem; margin-top: 0.3rem; }
.tf-cf__ref {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  max-width: 22rem;
  margin: 0 auto;
  padding: 1rem 1.25rem;
  border: 1px dashed var(--tf-border);
  border-radius: 12px;
  background: var(--tf-surface-raised);
}
.tf-cf__ref-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tf-text-muted);
}
.tf-cf__ref-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: clamp(1.5rem, 6vw, 2rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
`;

/**
 * `#1042`.
 *
 * The reference is an integer in the schema, but this endpoint's contract does
 * not pin the type, and a server that already formats it must not come out
 * `##1042`.
 */
function formatReference(value: number | string): string {
  const text = String(value).trim();
  return text.startsWith('#') ? text : `#${text}`;
}

/**
 * Two different 429s reach this form, and only one of them can be read exactly.
 *
 * The route's own per-IP database cap raises an `AppError` carrying
 * `details.retryAfterSeconds`, which `ApiError` keeps, so that wait is stated
 * precisely. `contactLimiter` in front of it is `express-rate-limit`, whose
 * handler writes `retryAfterSeconds` as a sibling of `error.code` rather than
 * inside `details`; `ApiError` drops that key, so the limiter's own sentence
 * (which does say "an hour") is all there is to go on.
 */
function retryWindowSeconds(details: unknown): number | null {
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function describeWait(seconds: number): string {
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'about an hour' : `about ${hours} hours`;
}

/** Does the server's own sentence already tell the sender how long to wait? */
const STATES_A_WAIT = /\b(second|minute|hour|day|moment|shortly|later)/i;

function retryAdvice(error: ApiError): string {
  const seconds = retryWindowSeconds(error.details);
  if (seconds !== null) {
    return `${error.message} You can send another message in ${describeWait(seconds)}.`;
  }

  return STATES_A_WAIT.test(error.message)
    ? error.message
    : `${error.message} You can send another message in about an hour.`;
}

export function ContactForm({ config }: { config: ContactConfig }) {
  const { user, settings } = useAuth();
  const [form] = Form.useForm<ContactValues>();

  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [submitted, setSubmitted] = useState<ContactResult | null>(null);
  /* The form can be switched off between this page rendering and the submit
     landing, and the API answers that with a 403. That is the same shape of
     problem the registration screen has, and the same terminal screen solves
     it. */
  const [closedReason, setClosedReason] = useState<string | null>(null);
  /* Likewise for `contactRequiresAccount` being turned on mid-visit, which
     arrives as a 401 rather than a 403. */
  const [sessionRequired, setSessionRequired] = useState(false);

  const inFlight = useRef(false);
  const successHeading = useRef<HTMLHeadingElement>(null);

  /**
   * The honeypot, deliberately outside the Ant Design form store.
   *
   * A controlled input only reports what React saw an event for, so a bot that
   * assigns `input.value` straight onto the DOM node would leave the store
   * empty and walk through the trap. Reading the node at submit time catches
   * the write however it was made.
   */
  const trap = useRef<HTMLInputElement>(null);

  /**
   * When the visitor arrived, as a millisecond timestamp.
   *
   * Sent with the submission because the API rejects anything posted less than
   * `minFillSeconds` after it: a script fills and posts a form instantly, a
   * person cannot. Set in an effect rather than during render so it is the
   * browser's clock at mount, not the server's clock at render time, which for
   * a cached or slow response would be arbitrarily far in the past.
   */
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (submitted) successHeading.current?.focus();
  }, [submitted]);

  const hasSession = user !== null;

  const identity = useMemo(
    () =>
      user ? { name: user.displayName?.trim() || user.username, email: user.email } : null,
    [user],
  );

  /**
   * The fields actually on screen. An error set on a field that is not rendered
   * is an error nobody can see or clear, which leaves the form unsubmittable
   * with no explanation. Anything outside this list therefore becomes a banner.
   */
  const visibleFields = useMemo<readonly (keyof ContactValues)[]>(
    () =>
      hasSession
        ? ['subject', 'category', 'message']
        : ['name', 'email', 'subject', 'category', 'message'],
    [hasSession],
  );

  const messageValue = Form.useWatch('message', form) ?? '';
  const used = messageValue.length;
  const nearLimit = used >= config.maxMessageLength * 0.9;

  const handleApiError = useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError)) {
        setBanner({
          type: 'error',
          title: `Could not reach ${settings.branding.siteName}`,
          text: 'The server did not respond. Check your connection and try again.',
        });
        return;
      }

      if (error.code === 'RATE_LIMITED') {
        setBanner({
          type: 'warning',
          title: 'Too many messages',
          text: retryAdvice(error),
        });
        return;
      }

      /*
       * FORBIDDEN is not specific to this endpoint: `csrfProtection` returns it
       * too. Only a 403 that is actually about the contact form may swap in the
       * terminal "closed" screen, which has no route back to the form; anything
       * else stays on the banner so the message can be sent again. Same
       * message-matching convention as the registration screen: the API offers
       * no finer signal than the prose.
       */
      if (error.code === 'FORBIDDEN' && /contact|closed|accepting|disabled/i.test(error.message)) {
        setClosedReason(error.message);
        return;
      }

      if (error.code === 'UNAUTHORIZED') {
        setSessionRequired(true);
        return;
      }

      const fieldErrors = error.fieldErrors;
      if (fieldErrors) {
        const shown = visibleFields
          .filter((key) => (fieldErrors[key]?.length ?? 0) > 0)
          .map((key) => ({ name: key, errors: fieldErrors[key] ?? [] }));

        if (shown.length > 0) {
          form.setFields(shown);
          const first = shown[0];
          if (first) form.scrollToField(first.name);

          setBanner({
            type: 'error',
            title: 'Some details need attention',
            text: error.message,
          });
          return;
        }

        /*
         * Nothing on screen was rejected, so this is the honeypot or the timing
         * check. Neither is something a person can correct, and naming them
         * would only tell a spammer which trap it tripped.
         */
        setBanner({
          type: 'error',
          title: 'That message could not be accepted',
          text:
            config.minFillSeconds > 0
              ? `Please take at least ${config.minFillSeconds} seconds over the form and send it again.`
              : 'Please try sending it again.',
        });
        return;
      }

      setBanner({ type: 'error', title: 'Your message was not sent', text: error.message });
    },
    [config.minFillSeconds, form, settings.branding.siteName, visibleFields],
  );

  const handleSubmit = async (values: ContactValues) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBanner(null);
    setSubmitting(true);

    try {
      const result = await api.post<ContactResult>('/api/contact', {
        name: identity?.name ?? values.name?.trim() ?? '',
        email: identity?.email ?? values.email?.trim() ?? '',
        subject: values.subject.trim(),
        category: values.category,
        message: values.message.trim(),
        // Sent even when empty: an absent honeypot is indistinguishable from a
        // bot that stripped the field.
        website: trap.current?.value ?? '',
        startedAt: startedAt.current,
      });

      setSubmitted(result);
    } catch (error) {
      handleApiError(error);
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  /* The page owns the <h1>, so every heading rendered inside this card is an
     <h2>. A Result's own title is a plain <div> and would leave a gap in the
     outline otherwise. */

  if (submitted) {
    return (
      <Card>
        <Result
          status="success"
          title={
            <h2 ref={successHeading} tabIndex={-1} style={RESULT_HEADING}>
              Message received
            </h2>
          }
          subTitle={submitted.acknowledgement || config.acknowledgement}
          extra={[
            hasSession ? (
              <Button key="support" type="primary" href="/support">
                Track it in your support desk
              </Button>
            ) : null,
            <Button key="home" href="/">
              Back to home
            </Button>,
          ].filter(Boolean)}
        >
          <style href="tf-contact-form" precedence="medium">
            {CSS}
          </style>
          <p className="tf-cf__ref">
            <span className="tf-cf__ref-label">Your reference</span>
            <span className="tf-cf__ref-value">{formatReference(submitted.ticketNumber)}</span>
          </p>
        </Result>
      </Card>
    );
  }

  if (closedReason) {
    return (
      <Card>
        <Result
          status="info"
          title={<h2 style={RESULT_HEADING}>The contact form is closed</h2>}
          subTitle={
            settings.legal.contactEmail
              ? `${closedReason} You can still email ${settings.legal.contactEmail}.`
              : closedReason
          }
          extra={
            <Button type="primary" href="/">
              Back to home
            </Button>
          }
        />
      </Card>
    );
  }

  if (config.requiresAccount && !hasSession) {
    return (
      <Card>
        <Result
          status="info"
          title={<h2 style={RESULT_HEADING}>Sign in to send a message</h2>}
          subTitle={`${settings.branding.siteName} only accepts messages from signed-in accounts, so replies can reach you in the support desk.`}
          extra={[
            <Button key="login" type="primary" href="/login">
              Sign in
            </Button>,
            settings.features.registrationEnabled ? (
              <Button key="register" href="/register">
                Create an account
              </Button>
            ) : null,
          ].filter(Boolean)}
        />
      </Card>
    );
  }

  if (sessionRequired) {
    return (
      <Card>
        <Result
          status="warning"
          title={<h2 style={RESULT_HEADING}>Your message needs an account</h2>}
          subTitle="Guest messages were switched off while this form was open, so your message was not sent. Sign in and send it again."
          extra={
            <Button type="primary" href="/login">
              Sign in
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <style href="tf-contact-form" precedence="medium">
        {CSS}
      </style>

      {/* Mounted before any error exists so the first one is announced too, not
          only the ones after it. */}
      <div aria-live="assertive" aria-atomic="true">
        {banner ? (
          <Alert
            type={banner.type}
            showIcon
            message={banner.title}
            description={banner.text}
            style={{ marginBottom: 16 }}
          />
        ) : null}
      </div>

      {identity ? (
        <p className="tf-cf__identity">
          Sending as <strong>{identity.name}</strong> ({identity.email}).{' '}
          <Text type="secondary">Update these in your profile.</Text>
        </p>
      ) : null}

      <Form<ContactValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void handleSubmit(values)}
      >
        {identity ? null : (
          <>
            <Form.Item
              name="name"
              label="Your name"
              rules={[
                { required: true, transform: trimmed, message: 'Tell us who you are' },
                { transform: trimmed, max: MAX_NAME, message: 'That name is too long' },
              ]}
            >
              <Input autoComplete="name" maxLength={MAX_NAME} placeholder="Jane Doe" />
            </Form.Item>

            <Form.Item
              name="email"
              label="Email"
              extra="Only used to reply to this message."
              rules={[
                { required: true, message: 'Enter an email address we can reply to' },
                { type: 'email', message: 'Enter a valid email address' },
                { max: MAX_EMAIL, message: 'That email address is too long' },
              ]}
            >
              <Input
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={MAX_EMAIL}
                placeholder="you@example.com"
              />
            </Form.Item>
          </>
        )}

        <Form.Item
          name="subject"
          label="Subject"
          rules={[
            { required: true, transform: trimmed, message: 'Give the message a subject' },
            {
              transform: trimmed,
              min: MIN_SUBJECT,
              message: `Use at least ${MIN_SUBJECT} characters so the queue can be scanned`,
            },
            { transform: trimmed, max: MAX_SUBJECT, message: 'That subject is too long' },
          ]}
        >
          <Input maxLength={MAX_SUBJECT} placeholder="What is this about?" />
        </Form.Item>

        <Form.Item
          name="category"
          label="Topic"
          rules={[{ required: true, message: 'Choose the closest topic' }]}
        >
          <Select<string>
            placeholder="Choose a topic"
            options={config.categories.map((category) => ({ value: category, label: category }))}
          />
        </Form.Item>

        <Form.Item
          name="message"
          label="Message"
          style={{ marginBottom: 8 }}
          rules={[
            { required: true, message: 'Write your message' },
            {
              max: config.maxMessageLength,
              message: `Messages are limited to ${config.maxMessageLength} characters`,
            },
          ]}
        >
          {/*
            The counter is a real element referenced by aria-describedby rather
            than antd's `showCount`, which renders a decoration the input is not
            associated with, so a screen reader user would never hear it. It is
            deliberately not a live region: announcing a new number on every
            keystroke makes the field unusable.
          */}
          <Input.TextArea
            autoSize={{ minRows: 6, maxRows: 16 }}
            maxLength={config.maxMessageLength}
            placeholder="As much detail as you can give us."
            aria-describedby={`${MESSAGE_HINT_ID} ${MESSAGE_COUNT_ID}`}
          />
        </Form.Item>

        <Text id={MESSAGE_HINT_ID} type="secondary" style={{ fontSize: '0.8125rem' }}>
          Steps you took, what you expected, and what happened instead.
        </Text>
        <Text
          id={MESSAGE_COUNT_ID}
          className="tf-cf__counter"
          type={nearLimit ? 'warning' : 'secondary'}
        >
          {used} / {config.maxMessageLength} characters
        </Text>

        <div className="tf-cf__trap" aria-hidden="true">
          <label htmlFor="tf-contact-website">Leave this field empty</label>
          <input
            ref={trap}
            id="tf-contact-website"
            name="website"
            type="text"
            defaultValue=""
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        </div>

        <Button
          type="primary"
          htmlType="submit"
          block
          loading={submitting}
          aria-busy={submitting}
          style={{ marginTop: 20 }}
        >
          Send message
        </Button>

        <p aria-live="polite" style={SR_ONLY}>
          {submitting ? 'Sending your message.' : ''}
        </p>
      </Form>
    </Card>
  );
}
