/**
 * Password hashing.
 *
 * Argon2id replaces v1's bcrypt. Argon2id is the current OWASP recommendation:
 * it is memory-hard, so an attacker with GPUs gains far less advantage than
 * against bcrypt. `@node-rs/argon2` ships prebuilt binaries for every common
 * platform, so `npm install` never needs a C toolchain.
 */
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

/**
 * Argon2id. The numeric literal is used rather than the library's `Algorithm`
 * enum because that enum is an ambient `const enum`, which cannot be imported
 * under `isolatedModules` (TypeScript would have to inline a value it is not
 * allowed to read across the module boundary).
 */
const ARGON2ID = 2;

/**
 * OWASP's recommended Argon2id baseline: 19 MiB of memory, 2 passes, 1 lane.
 * Raising `memoryCost` is the most effective way to harden this if your host
 * has room to spare.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

/**
 * Check a password. Returns false rather than throwing on a malformed digest,
 * so a corrupt row cannot turn into a 500 that distinguishes it from a wrong
 * password.
 */
export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext);
  } catch {
    return false;
  }
}

/**
 * The 20 most-abused passwords. A full breach-corpus check belongs behind an
 * API like Pwned Passwords; this cheap list stops the worst offenders offline
 * and without a network dependency.
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

/**
 * Password policy.
 *
 * Length is the requirement that actually matters, so the floor is 12 rather
 * than the more common 8. NIST 800-63B advises against forcing symbol/number
 * composition (it pushes people toward `Password1!`), so this checks for
 * variety without mandating a specific recipe.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    message: 'That password is too common. Please choose another',
  })
  .refine((value) => new Set(value).size >= 5, {
    message: 'Password must use at least 5 different characters',
  });

/** Strength score 0 to 4 for the client-side meter. Mirrors the checks above. */
export function scorePassword(value: string): number {
  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^\w\s]/.test(value)) score += 1;
  if (COMMON_PASSWORDS.has(value.toLowerCase())) score = 0;
  return Math.min(score, 4);
}
