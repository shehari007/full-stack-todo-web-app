/**
 * Request schemas for the auth module.
 */
import { z } from 'zod';
import { passwordSchema } from '../../lib/password.js';

/**
 * Usernames are restricted to a conservative character set: they appear in
 * URLs, in exports and in the admin UI, and a permissive set invites
 * homoglyph impersonation (`admın` versus `admin`).
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Username may only contain letters, numbers, hyphens and underscores',
  )
  .transform((value) => value.toLowerCase());

export const emailSchema = z
  .string()
  .trim()
  .email('Enter a valid email address')
  .max(254)
  .transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(64).optional(),
  /** Must be explicitly true: the checkbox cannot be pre-ticked. */
  acceptedTerms: z.literal(true, {
    message: 'You must accept the terms of service to create an account',
  }),
});

export const loginSchema = z.object({
  /** Accepts either identifier; which one it is gets resolved server-side. */
  identifier: z.string().trim().min(1, 'Enter your username or email').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
  /** Keeps the session alive for the full refresh window rather than the browser session. */
  rememberMe: z.boolean().optional().default(false),
});

/**
 * Accepts either factor: a 6-digit authenticator code, or a 17-character
 * recovery code in `XXXXX-XXXXX-XXXXX` form. The upper bound must clear 17:
 * a tighter cap rejects every recovery code, which silently removes the only
 * way back in for someone who has lost their authenticator.
 */
const secondFactorCode = z.string().trim().min(6).max(20);

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(1),
  code: secondFactorCode,
});

export const mfaEnableSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

export const mfaDisableSchema = z.object({
  /** Re-authentication: disabling MFA is exactly what a session hijacker wants. */
  password: z.string().min(1, 'Confirm your password'),
  code: secondFactorCode.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
