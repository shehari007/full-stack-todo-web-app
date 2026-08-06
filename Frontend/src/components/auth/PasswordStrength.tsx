'use client';

import { CheckCircleFilled, CloseCircleFilled, MinusCircleFilled } from '@ant-design/icons';
import { theme } from 'antd';

type Token = ReturnType<typeof theme.useToken>['token'];

/**
 * Mirrors `COMMON_PASSWORDS` in `Server/src/lib/password.ts`.
 *
 * Duplicated rather than fetched: the list is the reason a password is rejected,
 * and telling someone that only after a round trip (with the password already
 * typed twice) is the frustrating version of this interaction. The server list
 * stays authoritative; this one exists to warn early.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'welcome1',
  'admin',
  'admin123',
  'root',
  'root123',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'changeme',
  'taskflow',
]);

export interface PasswordRequirement {
  key: string;
  label: string;
  met: boolean;
  /**
   * True when `passwordSchema` on the server rejects the password outright.
   * The rest only move the score, so the form must not block on them.
   */
  blocking: boolean;
}

export interface PasswordAssessment {
  /** 0 to 4, matching `scorePassword` on the server. */
  score: number;
  requirements: PasswordRequirement[];
  /** Message for the first unmet hard requirement, or null when submittable. */
  blocker: string | null;
}

/** Wording matches the server's zod messages so the two never contradict. */
const BLOCKER_MESSAGES: Record<string, string> = {
  length: 'Password must be at least 12 characters',
  distinct: 'Password must use at least 5 different characters',
  common: 'That password is too common. Please choose another',
};

/**
 * Evaluate a candidate password against the server policy.
 *
 * Exported so the register form's validator and this meter cannot drift apart.
 * A meter that says "Strong" while the submit button reports an error is worse
 * than no meter at all.
 */
export function assessPassword(value: string): PasswordAssessment {
  const longEnough = value.length >= 12;
  const veryLong = value.length >= 16;
  const mixedCase = /[a-z]/.test(value) && /[A-Z]/.test(value);
  const digitAndSymbol = /\d/.test(value) && /[^\w\s]/.test(value);
  const distinct = new Set(value).size >= 5;
  const common = COMMON_PASSWORDS.has(value.toLowerCase());

  let score = 0;
  if (longEnough) score += 1;
  if (veryLong) score += 1;
  if (mixedCase) score += 1;
  if (digitAndSymbol) score += 1;
  // A password on the list is worthless no matter how long it is.
  if (common) score = 0;

  const requirements: PasswordRequirement[] = [
    { key: 'length', label: 'At least 12 characters', met: longEnough, blocking: true },
    { key: 'distinct', label: 'At least 5 different characters', met: distinct, blocking: true },
    { key: 'common', label: 'Not a commonly used password', met: !common, blocking: true },
    { key: 'long', label: '16 characters or more', met: veryLong, blocking: false },
    { key: 'case', label: 'Upper and lower case letters', met: mixedCase, blocking: false },
    { key: 'symbol', label: 'A number and a symbol', met: digitAndSymbol, blocking: false },
  ];

  const failed = requirements.find((requirement) => requirement.blocking && !requirement.met);

  return {
    score: Math.min(score, 4),
    requirements,
    blocker: failed ? BLOCKER_MESSAGES[failed.key] ?? failed.label : null,
  };
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const SEGMENTS = [0, 1, 2, 3];

function strengthColor(score: number, token: Token): string {
  if (score <= 1) return token.colorError;
  if (score === 2) return token.colorWarning;
  if (score === 3) return token.colorInfo;
  return token.colorSuccess;
}

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

export function PasswordStrength({ value, id }: { value: string; id?: string }) {
  const { token } = theme.useToken();

  const password = value ?? '';
  const empty = password.length === 0;
  const { score, requirements } = assessPassword(password);
  const label = LABELS[score] ?? LABELS[0];
  const tone = strengthColor(score, token);

  return (
    <div id={id} style={{ marginTop: 10 }}>
      <div
        role="progressbar"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={empty ? 0 : score}
        aria-valuetext={empty ? 'No password entered' : label}
        style={{ display: 'flex', gap: 4 }}
      >
        {SEGMENTS.map((segment) => (
          <span
            key={segment}
            aria-hidden="true"
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: !empty && segment < score ? tone : 'var(--tf-border)',
              transition: 'background 160ms ease',
            }}
          />
        ))}
      </div>

      <p
        aria-live="polite"
        style={{
          margin: '6px 0 0',
          fontSize: 12,
          fontWeight: 500,
          color: empty ? token.colorTextTertiary : tone,
        }}
      >
        {empty ? 'Strength: not set' : `Strength: ${label}`}
      </p>

      {/* Listing what is missing beats a bare bar: a bar tells you that you
          failed; a list tells you what to change. */}
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
        {requirements.map((requirement) => {
          const pending = empty || !requirement.met;
          const Icon = requirement.met
            ? CheckCircleFilled
            : empty || !requirement.blocking
              ? MinusCircleFilled
              : CloseCircleFilled;

          const iconColor = requirement.met
            ? token.colorSuccess
            : empty || !requirement.blocking
              ? token.colorTextQuaternary
              : token.colorError;

          return (
            <li
              key={requirement.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
                fontSize: 12,
                lineHeight: 1.5,
                color: pending ? token.colorTextSecondary : token.colorTextTertiary,
              }}
            >
              <Icon aria-hidden="true" style={{ color: iconColor, fontSize: 12, marginTop: 3 }} />
              <span>
                {requirement.label}
                {requirement.blocking ? '' : ' (recommended)'}
                {/* State is carried by an icon shape and this text, never by
                    colour alone. */}
                <span style={SR_ONLY}>{requirement.met ? ': met' : ': not yet met'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
