'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, App, Button, Card, Checkbox, Form, Input, Result, Typography } from 'antd';
import { IdcardOutlined, LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { PasswordStrength, assessPassword } from '@/components/auth/PasswordStrength';
import type { User } from '@/types/api';

const { Text } = Typography;

interface RegisterValues {
  username: string;
  email: string;
  displayName?: string;
  password: string;
  acceptedTerms: boolean;
}

interface SessionPayload {
  user: User;
  accessToken: string;
  csrfToken: string;
}

interface Banner {
  type: 'error' | 'warning';
  title: string;
  text: string;
}

/** Mirrors `usernameSchema` in `Server/src/modules/auth/auth.schemas.ts`. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

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

export function RegisterForm({ registrationEnabled }: { registrationEnabled: boolean }) {
  const router = useRouter();
  const { setUser, settings } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm<RegisterValues>();

  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  /*
   * Registration can be switched off between this page rendering and the form
   * being submitted, and the API answers that with a 403. Tracking it in state
   * lets the same "closed" screen cover both cases.
   */
  const [closed, setClosed] = useState(!registrationEnabled);

  const inFlight = useRef(false);
  const password = Form.useWatch('password', form) ?? '';

  const handleApiError = useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError)) {
        setBanner({
          type: 'error',
          title: 'Could not reach TaskFlow',
          text: 'The server did not respond. Check your connection and try again.',
        });
        return;
      }

      /*
       * FORBIDDEN is not specific to this endpoint: `csrfProtection` and the
       * generic `forbidden()` helper use it too. Only a 403 that is actually
       * about registration may swap in the terminal "closed" screen, which has
       * no route back to the form. Anything else stays on the banner so the
       * user can retry. Same message-matching convention as the CONFLICT branch
       * below: the server offers no other signal.
       */
      if (error.code === 'FORBIDDEN' && /registration/i.test(error.message)) {
        setClosed(true);
        return;
      }

      if (error.code === 'CONFLICT') {
        /*
         * The API deliberately returns one of two distinct messages here rather
         * than a field name, so this is the only place the two can be told
         * apart. Anything unrecognised falls back to the banner instead of
         * blaming the wrong field.
         */
        const target = /username/i.test(error.message)
          ? 'username'
          : /email/i.test(error.message)
            ? 'email'
            : null;

        if (target) {
          form.setFields([{ name: target, errors: [error.message] }]);
          form.scrollToField(target);
          setBanner({ type: 'error', title: 'Check the highlighted field', text: error.message });
          return;
        }
      }

      const fieldErrors = error.fieldErrors;
      if (fieldErrors) {
        const fields = (['username', 'email', 'displayName', 'password', 'acceptedTerms'] as const)
          .filter((key) => (fieldErrors[key]?.length ?? 0) > 0)
          .map((key) => ({ name: key, errors: fieldErrors[key] ?? [] }));

        if (fields.length > 0) {
          form.setFields(fields);
          const first = fields[0];
          if (first) form.scrollToField(first.name);
        }

        setBanner({
          type: 'error',
          title: 'Some details need attention',
          text: error.message,
        });
        return;
      }

      setBanner({
        type: error.code === 'RATE_LIMITED' ? 'warning' : 'error',
        title: error.code === 'RATE_LIMITED' ? 'Too many attempts' : 'Could not create your account',
        text: error.message,
      });
    },
    [form],
  );

  const handleSubmit = async (values: RegisterValues) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBanner(null);
    setSubmitting(true);

    try {
      const displayName = values.displayName?.trim();

      const result = await api.post<SessionPayload>('/api/auth/register', {
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
        // Omitted rather than sent empty: the column is nullable and an empty
        // string would render as a blank name everywhere.
        ...(displayName ? { displayName } : {}),
        acceptedTerms: values.acceptedTerms,
      });

      setUser(result.user);
      message.success('Your account is ready.');
      router.push('/dashboard');
      router.refresh();
      // Left submitting on purpose: the route transition finishes the story.
    } catch (error) {
      handleApiError(error);
      setSubmitting(false);
    } finally {
      inFlight.current = false;
    }
  };

  if (closed) {
    return (
      <Card>
        <Result
          status="info"
          // Result renders its title in a plain <div>. The other two states of
          // this route render an <h1>, so without this the closed screen is the
          // one page in the group with no top-level heading.
          title={
            <h1 style={{ fontSize: 'inherit', fontWeight: 'inherit', margin: 0 }}>
              Registration is closed
            </h1>
          }
          subTitle={
            settings.legal.contactEmail
              ? `${settings.branding.siteName} is not accepting new accounts right now. Contact ${settings.legal.contactEmail} if you need access.`
              : `${settings.branding.siteName} is not accepting new accounts right now. Ask an administrator to create one for you.`
          }
          // antd renders Button-with-href as an anchor, so these stay real links
          // rather than a button nested inside next/link's <a>.
          extra={[
            <Button key="signin" type="primary" href="/login">
              Go to sign in
            </Button>,
            <Button key="home" href="/">
              Back to home
            </Button>,
          ]}
        />
      </Card>
    );
  }

  return (
    <>
      <h1 className="tf-auth__title">Create your account</h1>
      <p className="tf-auth__subtitle">
        It takes about a minute, and you can export or delete everything you add at any time.
      </p>

      <Card>
        {/* Always mounted so the first error is announced, not just later ones. */}
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

        <Form<RegisterValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ acceptedTerms: false }}
          onFinish={(values) => void handleSubmit(values)}
        >
          <Form.Item
            name="username"
            label="Username"
            // Server-side this is lower-cased, so say so rather than silently
            // changing what the user typed after they submit.
            extra="Letters, numbers, hyphens and underscores. Stored in lower case."
            rules={[
              { required: true, message: 'Choose a username' },
              { min: 3, message: 'Username must be at least 3 characters' },
              { max: 32, message: 'Username must be at most 32 characters' },
              {
                pattern: USERNAME_PATTERN,
                message: 'Only letters, numbers, hyphens and underscores',
              },
            ]}
          >
            <Input
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              placeholder="jane-doe"
              prefix={<UserOutlined aria-hidden="true" />}
            />
          </Form.Item>

          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Enter your email address' },
              { type: 'email', message: 'Enter a valid email address' },
              { max: 254, message: 'That email address is too long' },
            ]}
          >
            <Input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              placeholder="you@example.com"
              prefix={<MailOutlined aria-hidden="true" />}
            />
          </Form.Item>

          <Form.Item
            name="displayName"
            label={
              <span>
                Display name <Text type="secondary">(optional)</Text>
              </span>
            }
            rules={[{ max: 64, message: 'Display name must be at most 64 characters' }]}
          >
            <Input
              autoComplete="name"
              maxLength={64}
              placeholder="Jane Doe"
              prefix={<IdcardOutlined aria-hidden="true" />}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Choose a password' },
              {
                validator: (_rule, value: string | undefined) => {
                  if (!value) return Promise.resolve();
                  const { blocker } = assessPassword(value);
                  return blocker ? Promise.reject(new Error(blocker)) : Promise.resolve();
                },
              },
            ]}
            style={{ marginBottom: 8 }}
          >
            <Input.Password
              autoComplete="new-password"
              maxLength={128}
              placeholder="At least 12 characters"
              aria-describedby="password-requirements"
              prefix={<LockOutlined aria-hidden="true" />}
            />
          </Form.Item>

          <PasswordStrength id="password-requirements" value={password} />

          <Form.Item
            name="acceptedTerms"
            valuePropName="checked"
            style={{ marginTop: 20, marginBottom: 16 }}
            rules={[
              {
                validator: (_rule, value: boolean | undefined) =>
                  value
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error('You must accept the terms of service to create an account'),
                      ),
              },
            ]}
          >
            {/* Never pre-ticked: the API rejects anything but an explicit true,
                and a pre-ticked consent box is not consent.
                The policies open in a new tab so reading them does not discard a
                half-filled form, and the clicks are stopped from reaching the
                surrounding <label>, which would otherwise toggle the box. */}
            <Checkbox>
              I agree to the{' '}
              <Link
                href="/legal/terms"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Terms of Service
                <span style={SR_ONLY}> (opens in a new tab)</span>
              </Link>{' '}
              and the{' '}
              <Link
                href="/legal/privacy"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Privacy Policy
                <span style={SR_ONLY}> (opens in a new tab)</span>
              </Link>
            </Checkbox>
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={submitting}
            aria-busy={submitting}
          >
            Create account
          </Button>
        </Form>
      </Card>

      <p style={{ marginTop: 20, textAlign: 'center' }}>
        <Text type="secondary">Already have an account? </Text>
        <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
