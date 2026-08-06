/**
 * Cryptographic helpers.
 *
 * Everything here wraps `node:crypto`, with no hand-rolled primitives. The three
 * jobs are: reversible encryption for TOTP secrets at rest, one-way hashing for
 * tokens we store, and generating unguessable random values.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'base64');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the size GCM is specified for.

/**
 * Encrypt a short secret for storage. Output is `iv.authTag.ciphertext`, all
 * base64url. A fresh random IV per call is required: reusing an IV with GCM
 * under the same key breaks the cipher completely.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join(
    '.',
  );
}

/**
 * Reverse `encrypt`. Throws if the ciphertext was tampered with: GCM
 * authenticates as well as encrypts, so a modified value fails rather than
 * decrypting to garbage.
 */
export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext');
  }
  const [ivPart, tagPart, dataPart] = parts as [string, string, string];

  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** SHA-256, hex encoded. Used for refresh-token lookup keys and file checksums. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Daily-rotating visitor fingerprint for analytics. The date is mixed in so the
 * same visitor produces a different hash tomorrow, which makes the value
 * useless for long-term tracking while still allowing a daily unique count.
 */
export function visitorHash(ip: string, userAgent: string, day: string): string {
  return createHmac('sha256', KEY).update(`${ip}|${userAgent}|${day}`).digest('hex').slice(0, 32);
}

/** Cryptographically random URL-safe token. 32 bytes ≈ 256 bits of entropy. */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/**
 * Human-friendly recovery code, e.g. `K7F2-9QXM-4TRW`.
 * Alphabet excludes I/O/0/1 so codes can be transcribed from a screen without
 * ambiguity. 15 characters from a 32-symbol alphabet ≈ 75 bits.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < 3; group += 1) {
    let chunk = '';
    for (let index = 0; index < 5; index += 1) {
      chunk += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    groups.push(chunk);
  }
  return groups.join('-');
}

/**
 * Constant-time string comparison. Plain `===` leaks how many leading
 * characters matched via timing, which is enough to recover a token one
 * character at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  // Length is not itself a secret here.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
