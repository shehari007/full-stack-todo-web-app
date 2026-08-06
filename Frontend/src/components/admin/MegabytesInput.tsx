'use client';

import { InputNumber } from 'antd';
import { BYTES_PER_MB, bytesToMb, mbToBytes } from '@/components/admin/format';

interface Props {
  /** Bytes: the unit the API stores and every size check compares against. */
  value?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
}

/**
 * Megabytes on screen, bytes on the wire.
 *
 * The limits section is stored in bytes because that is the unit every upload
 * check compares against. Converting at the point of comparison would mean
 * doing it in five places, one of which would eventually be wrong. But asking an
 * operator to type `26214400` for 25 MB is how a quota ends up off by a factor
 * of ten, so the conversion is pinned here, in the one component the numbers
 * pass through. `min`/`max` are given in bytes too, so callers can paste the
 * bounds straight out of `limitsSchema` without converting anything themselves.
 */
export function MegabytesInput({
  value,
  onChange,
  min = 0,
  max,
  step = 0.5,
  disabled,
  id,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <InputNumber
      id={id}
      aria-label={ariaLabel}
      value={value === undefined ? undefined : bytesToMb(value)}
      onChange={(next) => {
        // InputNumber yields null while the box is empty; treat that as the
        // floor rather than pushing null into a field the schema types as int.
        onChange?.(next === null ? min : mbToBytes(next));
      }}
      min={bytesToMb(min)}
      max={max === undefined ? undefined : bytesToMb(max)}
      step={step}
      disabled={disabled}
      style={{ width: '100%' }}
      addonAfter="MB"
      // Two decimals is enough for a limit; more just exposes the fact that
      // 1_500_000 bytes is not a round number of megabytes.
      precision={2}
    />
  );
}

export { BYTES_PER_MB };
