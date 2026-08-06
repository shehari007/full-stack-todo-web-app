/**
 * Generate the secrets the API requires.
 *
 *   npm run gen:secret          print a ready-to-paste block for .env
 *   npm run gen:secret -- key   print a single value
 *
 * Deliberately a script rather than a documented `openssl` one-liner: the
 * ENCRYPTION_KEY must decode to exactly 32 bytes, and the usual copy-pasted
 * commands produce a 32-*character* string instead, which then fails validation
 * at boot with an error most people find puzzling.
 */
import { randomBytes } from 'node:crypto';

const which = process.argv[2];

/** URL-safe, no padding, so it survives being pasted into a .env or a dashboard. */
const token = (bytes: number) => randomBytes(bytes).toString('base64url');

/** AES-256-GCM needs exactly 32 bytes; standard base64 is what the API decodes. */
const key32 = () => randomBytes(32).toString('base64');

if (which === 'key') {
  process.stdout.write(`${key32()}\n`);
} else if (which === 'token') {
  process.stdout.write(`${token(48)}\n`);
} else {
  process.stdout.write(
    [
      '',
      '# Generated secrets. Paste these into Server/.env',
      '# Treat them like passwords. Rotating JWT_ACCESS_SECRET or',
      '# JWT_REFRESH_SECRET signs everyone out; rotating ENCRYPTION_KEY',
      '# makes existing MFA enrolments undecryptable, so users must re-enrol.',
      '',
      `JWT_ACCESS_SECRET=${token(48)}`,
      `JWT_REFRESH_SECRET=${token(48)}`,
      `ENCRYPTION_KEY=${key32()}`,
      '',
    ].join('\n'),
  );
}
