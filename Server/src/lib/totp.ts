/**
 * Time-based one-time passwords (RFC 6238) for multi-factor authentication.
 *
 * Compatible with Google Authenticator, Authy, 1Password, Bitwarden, and
 * anything else that reads an `otpauth://` URI. Secrets are generated here but
 * always stored encrypted; see `crypto.ts`.
 */
import {
  NobleCryptoPlugin,
  ScureBase32Plugin,
  TOTP,
  generateSecret as otpGenerateSecret,
} from 'otplib';
import QRCode from 'qrcode';

const plugins = {
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
} as const;

/**
 * Accept codes from the adjacent 30-second steps as well as the current one.
 * One step of slack each way covers ordinary clock drift and the few seconds it
 * takes to type six digits, without meaningfully widening the attack window.
 */
const EPOCH_TOLERANCE = 30;

/** 20 bytes / 160 bits, the size RFC 4226 specifies for HMAC-SHA1. */
export async function generateTotpSecret(): Promise<string> {
  return otpGenerateSecret({ ...plugins, length: 20 });
}

/** Build the `otpauth://` URI that becomes the enrolment QR code. */
export async function buildOtpAuthUri(params: {
  secret: string;
  accountLabel: string;
  issuer: string;
}): Promise<string> {
  const totp = new TOTP({ ...plugins, secret: params.secret });
  return totp.toURI({ label: params.accountLabel, issuer: params.issuer });
}

/** Render the URI as a data-URI PNG for the enrolment screen. */
export async function renderQrCode(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
}

export interface TotpVerification {
  valid: boolean;
  /**
   * The time step the code belonged to. Persist it and pass it back as
   * `afterTimeStep` on the next check so a code cannot be used twice. Without
   * this, an intercepted code stays usable for the rest of its window.
   */
  timeStep?: number;
}

export async function verifyTotp(params: {
  token: string;
  secret: string;
  /** Highest time step already consumed by this account, if any. */
  afterTimeStep?: number | null;
}): Promise<TotpVerification> {
  // Reject anything that is not exactly six digits before doing crypto work.
  if (!/^\d{6}$/.test(params.token)) {
    return { valid: false };
  }

  try {
    const totp = new TOTP({ ...plugins, secret: params.secret });

    // Tolerance and replay protection are verification-time options, not
    // constructor options: the instance only carries the secret and plugins.
    const result = await totp.verify(params.token, {
      epochTolerance: EPOCH_TOLERANCE,
      ...(params.afterTimeStep != null ? { afterTimeStep: params.afterTimeStep } : {}),
    });

    return result.valid ? { valid: true, timeStep: result.timeStep } : { valid: false };
  } catch {
    // A malformed stored secret must read as "wrong code", not as a 500.
    return { valid: false };
  }
}
