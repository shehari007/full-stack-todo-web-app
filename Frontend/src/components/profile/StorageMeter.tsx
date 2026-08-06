'use client';

import { Progress, Typography, theme } from 'antd';
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Point at which the meter starts telling the user to do something about it. */
const WARN_AT_PERCENT = 80;

/**
 * Human-readable byte size.
 *
 * Binary steps (1024) with decimal-looking labels, because that is what every
 * operating system's file browser shows. Matching the number a user can see
 * elsewhere matters more here than unit pedantry.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const unit = UNITS[exponent] ?? 'B';
  const value = bytes / 1024 ** exponent;

  // A decimal place on bytes and kilobytes is noise; on megabytes and up it is
  // the difference between "1 GB" and "1.4 GB".
  return `${value.toFixed(exponent < 2 ? 0 : 1)} ${unit}`;
}

export interface StorageMeterProps {
  usedBytes: number;
  /**
   * Resolved allowance for this account, with the role default already applied
   * by the API. Null when that resolution was unavailable: a bar drawn from a
   * guessed denominator is worse than no bar.
   */
  quotaBytes: number | null;
  attachmentCount?: number | null;
}

export function StorageMeter({ usedBytes, quotaBytes, attachmentCount }: StorageMeterProps) {
  const { token } = theme.useToken();

  if (quotaBytes === null) {
    return (
      <Typography.Paragraph style={{ margin: 0 }}>
        <strong>{formatBytes(usedBytes)}</strong> used.{' '}
        <span className="tf-muted">Your allowance is unavailable right now.</span>
      </Typography.Paragraph>
    );
  }

  // A zero quota is fully consumed by definition; reporting 0% there would draw
  // an empty, reassuring bar for an account that cannot store anything at all.
  const percent =
    quotaBytes > 0 ? Math.min(Math.round((usedBytes / quotaBytes) * 100), 100) : 100;

  const full = percent >= 100;
  const near = !full && percent >= WARN_AT_PERCENT;

  const strokeColor = full ? token.colorError : near ? token.colorWarning : token.colorPrimary;
  const remaining = Math.max(quotaBytes - usedBytes, 0);

  const summary = `${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} used`;

  return (
    <div>
      {/* The wrapper carries the ARIA, not <Progress>: screen readers need the
          byte figures, and the bar itself only knows a percentage.

          antd's Progress puts `role="progressbar"` and its own `aria-valuenow`
          on its root, so the inner subtree is hidden. Two nested progressbars
          would be announced twice, the second time as the bare percentage this
          wrapper exists to replace. `aria-hidden` cannot go on <Progress>
          itself: its props only admit `aria-label` and `aria-labelledby`. */}
      <div
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${summary} (${percent}%)`}
      >
        <div aria-hidden="true">
          <Progress percent={percent} strokeColor={strokeColor} showInfo={false} />
        </div>
      </div>

      <Typography.Paragraph style={{ margin: '0.35rem 0 0' }}>
        <strong>{summary}</strong>{' '}
        <span className="tf-muted">({percent}%)</span>
      </Typography.Paragraph>

      {/* Icon plus wording carry the state, so it survives greyscale and colour
          blindness; the bar's colour is reinforcement only. */}
      <Typography.Paragraph
        aria-live="polite"
        style={{ margin: 0, fontSize: '0.85rem' }}
        type={full ? 'danger' : near ? 'warning' : undefined}
      >
        {full ? (
          <>
            <WarningFilled aria-hidden /> Storage is full. Delete some attachments before
            uploading again.
          </>
        ) : near ? (
          <>
            <WarningFilled aria-hidden /> Running low: {formatBytes(remaining)} left.
          </>
        ) : (
          <span className="tf-muted">
            <CheckCircleFilled aria-hidden /> {formatBytes(remaining)} available
            {typeof attachmentCount === 'number'
              ? ` across ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`
              : ''}
            .
          </span>
        )}
      </Typography.Paragraph>
    </div>
  );
}
