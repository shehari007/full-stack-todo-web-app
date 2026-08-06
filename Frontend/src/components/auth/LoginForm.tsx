'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, App, Button, Card, Checkbox, Form, Input, Typography } from 'antd';
import type { GetRef } from 'antd';
import { LockOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import type { User } from '@/types/api';

const { Text } = Typography;

interface CredentialValues {
  identifier: string;
  password: string;
  rememberMe: boolean;
}

interface CodeValues {
  code: string;
}

/** `POST /api/auth/login` and `POST /api/auth/mfa/verify` on success. */
interface SessionPayload {
  user: User;
  accessToken: string;
  csrfToken: string;
}

/** `POST /api/auth/login` when the account has a second factor. */
interface MfaChallengePayload {
  mfaRequired: true;
  challengeToken: string;
  methods: string[];
}

type LoginResult = SessionPayload | MfaChallengePayload;

function isMfaChallenge(result: LoginResult): result is MfaChallengePayload {
  return 'mfaRequired' in result && result.mfaRequired;
}

interface Banner {
  type: 'error' | 'warning' | 'info';
  title: string;
  text: string;
}

const OTP_LENGTH = 6;

/**
 * The server signs the challenge for five minutes. Flipping a little early means
 * the user is told the challenge lapsed instead of being told their correct code
 * was wrong, which is what the raw MFA_INVALID response would look like.
 */
const CHALLENGE_TTL_MS = 4 * 60_000 + 45_000;

/**
 * `next` arrives from the query string, so an unchecked redirect here would turn
 * the sign-in page into an open redirect, the classic credential-phishing
 * primitive. Only same-origin paths are honoured.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return '/dashboard';
  // `//evil.com` and `/\evil.com` are both protocol-relative in a browser.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  return raw;
}

/**
 * Recovery codes are printed as XXXXX-XXXXX-XXXXX. Inserting the separators as
 * the user types means a code typed by hand and a code pasted from a password
 * manager both end up in the same shape.
 */
function formatRecoveryCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  return clean.match(/.{1,5}/g)?.join('-') ?? '';
}

/** Turn an API failure into copy that tells the user what to actually do next. */
function describeError(error: ApiError, contactEmail: string): Banner {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return {
        type: 'error',
        title: 'Incorrect username or password',
        text: 'Check for typos and remember that the password is case sensitive. Accounts lock for 15 minutes after 8 failed attempts.',
      };

    case 'ACCOUNT_LOCKED':
      return {
        // The message carries the remaining wait, so it is shown verbatim.
        type: 'warning',
        title: 'Account temporarily locked',
        text: `${error.message} The lock lifts on its own, so no action is needed.`,
      };

    case 'ACCOUNT_SUSPENDED':
      return {
        type: 'error',
        title: 'Account suspended',
        text: contactEmail
          ? `${error.message}. Contact ${contactEmail} if you believe this is a mistake.`
          : `${error.message}. Contact an administrator if you believe this is a mistake.`,
      };

    case 'MFA_INVALID':
      return {
        type: 'error',
        title: 'That code was not accepted',
        text: `${error.message}. Authenticator codes are only valid for about 30 seconds, so try the next one your app shows, or use a recovery code.`,
      };

    case 'RATE_LIMITED':
      return { type: 'warning', title: 'Too many attempts', text: error.message };

    case 'MAINTENANCE':
      return { type: 'info', title: 'TaskFlow is in maintenance mode', text: error.message };

    default:
      return { type: 'error', title: 'Could not sign you in', text: error.message };
  }
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, settings } = useAuth();
  const { message } = App.useApp();

  const [credentialsForm] = Form.useForm<CredentialValues>();
  const [codeForm] = Form.useForm<CodeValues>();

  const [challenge, setChallenge] = useState<MfaChallengePayload | null>(null);
  const [challengeExpired, setChallengeExpired] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  /*
   * A ref rather than the `submitting` state: the OTP field auto-submits from
   * its change handler, which can fire again before React has re-rendered with
   * the new state.
   */
  const inFlight = useRef(false);
  const otpRef = useRef<GetRef<typeof Input.OTP>>(null);

  const contactEmail = settings.legal.contactEmail;
  const registrationEnabled = settings.features.registrationEnabled;
  const supportsRecovery = challenge?.methods.includes('recovery_code') ?? true;

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setTimeout(() => setChallengeExpired(true), CHALLENGE_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [challenge]);

  const finishSignIn = useCallback(
    (user: User) => {
      setUser(user);
      message.success(`Welcome back, ${user.displayName ?? user.username}`);
      router.push(safeNext(searchParams.get('next')));
      // Drops server-rendered markup cached for the signed-out visitor.
      router.refresh();
    },
    [message, router, searchParams, setUser],
  );

  const reportError = useCallback(
    (error: unknown): ApiError | null => {
      if (!(error instanceof ApiError)) {
        setBanner({
          type: 'error',
          title: 'Could not reach TaskFlow',
          text: 'The server did not respond. Check your connection and try again.',
        });
        return null;
      }
      setBanner(describeError(error, contactEmail));
      return error;
    },
    [contactEmail],
  );

  const handleCredentials = async (values: CredentialValues) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBanner(null);
    setSubmitting(true);

    try {
      const result = await api.post<LoginResult>('/api/auth/login', {
        identifier: values.identifier.trim(),
        password: values.password,
        rememberMe: values.rememberMe ?? false,
      });

      if (isMfaChallenge(result)) {
        setChallenge(result);
        setChallengeExpired(false);
        setUseRecoveryCode(false);
        codeForm.resetFields();
        setSubmitting(false);
        return;
      }

      // Deliberately left submitting: re-enabling the button for the instant
      // before the route transition reads as a click that did nothing.
      finishSignIn(result.user);
    } catch (error) {
      const apiError = reportError(error);
      const fieldErrors = apiError?.fieldErrors;

      if (fieldErrors) {
        const fields = (['identifier', 'password'] as const)
          .filter((key) => (fieldErrors[key]?.length ?? 0) > 0)
          .map((key) => ({ name: key, errors: fieldErrors[key] ?? [] }));
        if (fields.length > 0) credentialsForm.setFields(fields);
      }

      // Only wipe the password when it is the thing that was wrong; clearing it
      // after a rate-limit or a network blip just makes people retype it.
      if (apiError?.code === 'INVALID_CREDENTIALS') {
        credentialsForm.setFieldValue('password', '');
      }

      setSubmitting(false);
    } finally {
      inFlight.current = false;
    }
  };

  const submitCode = useCallback(
    async (raw: string) => {
      const code = raw.trim().toUpperCase();
      if (inFlight.current || !challenge || challengeExpired || code.length < OTP_LENGTH) return;

      inFlight.current = true;
      setBanner(null);
      setSubmitting(true);

      try {
        const result = await api.post<SessionPayload>('/api/auth/mfa/verify', {
          challengeToken: challenge.challengeToken,
          code,
        });
        finishSignIn(result.user);
      } catch (error) {
        const apiError = reportError(error);
        const fieldErrors = apiError?.fieldErrors;

        if (fieldErrors && (fieldErrors['code']?.length ?? 0) > 0) {
          codeForm.setFields([{ name: 'code', errors: fieldErrors['code'] ?? [] }]);
        }

        // Clearing lets the next attempt start from an empty field rather than
        // making the user select-all first; focus has to be put back by hand,
        // because clearing the value leaves the caret in the last OTP box.
        codeForm.setFieldValue('code', '');
        otpRef.current?.focus();
        setSubmitting(false);
      } finally {
        inFlight.current = false;
      }
    },
    [challenge, challengeExpired, codeForm, finishSignIn, reportError],
  );

  const restart = useCallback(() => {
    setChallenge(null);
    setChallengeExpired(false);
    setUseRecoveryCode(false);
    setBanner(null);
    setSubmitting(false);
    codeForm.resetFields();
    credentialsForm.setFieldValue('password', '');
  }, [codeForm, credentialsForm]);

  /* Region is always mounted so assistive tech announces the first error too. */
  const status = (
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
  );

  if (challenge) {
    return (
      <>
        <h1 className="tf-auth__title">Two-factor verification</h1>
        <p className="tf-auth__subtitle">
          {useRecoveryCode
            ? 'Enter one of the recovery codes you saved when you set up two-factor sign-in. Each code works once.'
            : 'Open your authenticator app and enter the 6-digit code for this account.'}
        </p>

        <Card>
          {status}

          {challengeExpired ? (
            <Alert
              type="warning"
              showIcon
              message="This verification step expired"
              description="For safety the challenge only lasts a few minutes. Sign in again to get a new one."
              action={
                <Button size="small" onClick={restart}>
                  Sign in again
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          ) : null}

          <Form<CodeValues>
            form={codeForm}
            layout="vertical"
            requiredMark={false}
            disabled={challengeExpired}
            onFinish={(values) => void submitCode(values.code ?? '')}
          >
            {useRecoveryCode ? (
              <Form.Item
                name="code"
                label="Recovery code"
                getValueFromEvent={(event: React.ChangeEvent<HTMLInputElement>) =>
                  formatRecoveryCode(event.target.value)
                }
                rules={[
                  { required: true, message: 'Enter one of your recovery codes' },
                  {
                    pattern: /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/,
                    message: 'Recovery codes look like ABCDE-FGHJK-LMNPQ',
                  },
                ]}
              >
                <Input
                  autoFocus
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={17}
                  placeholder="ABCDE-FGHJK-LMNPQ"
                  prefix={<SafetyOutlined aria-hidden="true" />}
                />
              </Form.Item>
            ) : (
              <Form.Item
                name="code"
                label="Authentication code"
                rules={[{ required: true, message: 'Enter the 6-digit code' }]}
              >
                <Input.OTP
                  ref={otpRef}
                  autoFocus
                  length={OTP_LENGTH}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label="6-digit authentication code"
                  formatter={(text) => text.replace(/\D/g, '')}
                  // Submitting the moment the last digit lands saves a step that
                  // has no decision in it.
                  onChange={(next) => {
                    if (next.length === OTP_LENGTH) void submitCode(next);
                  }}
                />
              </Form.Item>
            )}

            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting}
              aria-busy={submitting}
            >
              Verify and sign in
            </Button>
          </Form>

          {supportsRecovery ? (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Button
                type="link"
                onClick={() => {
                  setUseRecoveryCode((previous) => !previous);
                  setBanner(null);
                  codeForm.resetFields();
                }}
              >
                {useRecoveryCode
                  ? 'Use my authenticator app instead'
                  : 'Use a recovery code instead'}
              </Button>
            </div>
          ) : null}
        </Card>

        <p style={{ marginTop: 16, textAlign: 'center' }}>
          <Button type="link" onClick={restart}>
            Back to sign in
          </Button>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="tf-auth__title">Sign in</h1>
      <p className="tf-auth__subtitle">Welcome back. Enter your details to pick up where you left off.</p>

      {/* Set when a layout found the session cookie no longer works, so the
          proxy has just cleared it. Saying so beats appearing to log the user
          out for no reason. */}
      {searchParams.has('expired') ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Your session has ended"
          description="You were signed out because the session expired or was revoked. Please sign in again."
        />
      ) : null}

      <Card>
        {status}

        <Form<CredentialValues>
          form={credentialsForm}
          layout="vertical"
          requiredMark={false}
          initialValues={{ rememberMe: true }}
          onFinish={(values) => void handleCredentials(values)}
        >
          <Form.Item
            name="identifier"
            label="Username or email"
            rules={[{ required: true, message: 'Enter your username or email' }]}
          >
            <Input
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              placeholder="you@example.com"
              prefix={<UserOutlined aria-hidden="true" />}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password
              autoComplete="current-password"
              maxLength={128}
              placeholder="Your password"
              prefix={<LockOutlined aria-hidden="true" />}
            />
          </Form.Item>

          <Form.Item name="rememberMe" valuePropName="checked" style={{ marginBottom: 16 }}>
            <Checkbox>Keep me signed in on this device</Checkbox>
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={submitting}
            aria-busy={submitting}
          >
            Sign in
          </Button>
        </Form>
      </Card>

      {registrationEnabled ? (
        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Text type="secondary">New to {settings.branding.siteName}? </Text>
          <Link href="/register">Create an account</Link>
        </p>
      ) : null}
    </>
  );
}
