'use client';

import { useId, useState } from 'react';
import { App, Button, Space, Spin, Typography, theme } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { ApiError, api } from '@/lib/api';
import { formatBytes } from '@/components/admin/format';
import type { AttachmentMeta } from '@/types/api';

interface Props {
  label: string;
  hint?: string;
  /** The attachment id currently stored in the branding section, or null. */
  value?: string | null;
  onChange?: (value: string | null) => void;
  accept?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Preview box size; a favicon and an OG image want very different frames. */
  previewHeight?: number;
  /** Checkerboard behind the preview, so a transparent logo is visible. */
  transparent?: boolean;
}

/**
 * Upload a site asset and keep its id.
 *
 * `POST /api/admin/assets` takes the raw bytes and answers with an attachment
 * record; the id then has to be saved into the matching branding field with the
 * section's own PUT. That two-step is why this component owns only the id: the
 * upload happens immediately, but nothing about the site changes until the form
 * around it is saved.
 *
 * A plain `<input type="file">` rather than a styled control: it is already
 * keyboard-operable, already announces its label, and already tells the user
 * which file is selected, none of which a div pretending to be a button does.
 */
export function AssetUpload({
  label,
  hint,
  value,
  onChange,
  accept = 'image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon',
  disabled = false,
  disabledReason,
  previewHeight = 72,
  transparent = true,
}: Props) {
  const inputId = useId();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState<AttachmentMeta | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setUploading(true);
    try {
      const { attachment } = await api.upload<{ attachment: AttachmentMeta }>(
        '/api/admin/assets',
        file,
      );
      setMeta(attachment);
      onChange?.(attachment.id);
      message.success(`${label} uploaded. Save the form to apply it.`);
    } catch (error) {
      message.error(
        error instanceof ApiError ? error.message : 'The file could not be uploaded.',
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <div
        style={{
          height: previewHeight,
          display: 'grid',
          placeItems: 'center',
          padding: 8,
          border: `1px dashed ${token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
          background: transparent
            ? // Two-tone check pattern from theme tokens, so a transparent PNG
              // reads the same in light and dark mode.
              `repeating-conic-gradient(${token.colorFillQuaternary} 0% 25%, transparent 0% 50%) 50% / 16px 16px`
            : token.colorFillQuaternary,
        }}
      >
        {uploading ? (
          <Spin aria-label={`Uploading ${label}`} />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element -- served as raw
          // bytes from our own API with no width/height known ahead of time, so
          // next/image would add an optimiser hop for no benefit.
          <img
            src={`/api/attachments/${value}`}
            alt={`Current ${label.toLowerCase()}`}
            style={{ maxHeight: previewHeight - 16, maxWidth: '100%', objectFit: 'contain' }}
          />
        ) : (
          <Typography.Text className="tf-muted" style={{ fontSize: 13 }}>
            No {label.toLowerCase()} set
          </Typography.Text>
        )}
      </div>

      <label htmlFor={inputId} style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
        {label}
      </label>

      <input
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled || uploading}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          // Reset so re-picking the same file after a failure still fires.
          event.target.value = '';
        }}
        style={{ maxWidth: '100%', fontSize: 13 }}
      />

      <Space size={8} wrap>
        {value ? (
          <Button
            size="small"
            icon={<DeleteOutlined />}
            disabled={disabled || uploading}
            onClick={() => {
              setMeta(null);
              onChange?.(null);
            }}
          >
            Remove
          </Button>
        ) : null}

        <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
          {disabled && disabledReason
            ? disabledReason
            : meta
              ? `${meta.filename} · ${meta.mimeType} · ${formatBytes(meta.byteSize)}`
              : hint}
        </Typography.Text>
      </Space>
    </Space>
  );
}
