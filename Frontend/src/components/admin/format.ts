/**
 * Formatting shared by the control panel.
 */

export const BYTES_PER_MB = 1024 * 1024;

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human-readable size. Binary steps, because that is what the API's limits use. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const unit = UNITS[exponent] ?? 'B';
  const value = bytes / 1024 ** exponent;

  // Whole numbers below KB; one decimal above, which is as much precision as a
  // storage figure can honestly claim.
  return `${exponent === 0 ? value : value.toFixed(1)} ${unit}`;
}

/**
 * Bytes to megabytes for display.
 *
 * Rounded to two places rather than left exact: 26214400 / 1048576 is 25, but
 * 1500000 is 1.4305114746 and on. A form field holding sixteen digits is a form
 * field nobody can read.
 */
export function bytesToMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

export function mbToBytes(mb: number): number {
  return Math.round(mb * BYTES_PER_MB);
}

/** `0.734` -> `73.4%`. The server already rounds the rate to three places. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * A foreground that stays legible on an operator-chosen background.
 *
 * Branding colours come from the CMS, so no fixed text colour works for all of
 * them: white on `#fde047` is unreadable. This is the WCAG relative-luminance
 * formula, thresholded where black and white swap over.
 */
export function readableTextOn(hex: string): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';

  const channel = (offset: number): number => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? '#111111' : '#ffffff';
}

/** ColorPicker hands back a Color object; settings want a 6-digit hex string. */
export function normalizeHex(input: unknown): string {
  if (typeof input === 'string') {
    return /^#[0-9a-fA-F]{6}$/.test(input) ? input.toLowerCase() : input;
  }

  if (input && typeof (input as { toHexString?: unknown }).toHexString === 'function') {
    // `toHexString()` appends the alpha channel when it is not opaque, and the
    // API's `hexColor` schema rejects an 8-digit value.
    return (input as { toHexString: () => string }).toHexString().slice(0, 7).toLowerCase();
  }

  return '';
}
