'use client';

import { useCallback, useId, useRef, useState } from 'react';
import useSWR from 'swr';
import { App, Alert, Button, Progress, Tooltip, Typography } from 'antd';
import { DeleteOutlined, DownloadOutlined, FileOutlined, UploadOutlined } from '@ant-design/icons';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import type { AttachmentMeta } from '@/types/api';
import { attachmentHref, formatBytes, isImageMime } from './task-utils';

interface AttachmentPanelProps {
  todoId: string;
  initialAttachments: AttachmentMeta[];
  onChanged?: () => void;
}

interface PendingUpload {
  key: string;
  name: string;
  size: number;
  status: 'waiting' | 'uploading' | 'failed';
  error?: string;
}

/**
 * The per-file ceiling, mirroring `Server/src/config/settings.ts`.
 *
 * `limits` is deliberately excluded from `/api/settings/public` (it describes
 * how to attack the installation), so the browser cannot read the real number.
 * These are a hint for the person choosing a file; the server's rejection, which
 * carries the actual figures, is the authority.
 */
const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024;
const PRIVILEGED_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function AttachmentPanel({ todoId, initialAttachments, onChanged }: AttachmentPanelProps) {
  const { message, modal } = App.useApp();
  const { user, isPrivileged } = useAuth();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [queue, setQueue] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data, mutate } = useSWR<{ attachments: AttachmentMeta[] }>(
    `/api/attachments?todoId=${todoId}&pageSize=100`,
    swrFetcher,
    {
      fallbackData: { attachments: initialAttachments },
      revalidateOnFocus: false,
    },
  );

  const attachments = data?.attachments ?? [];
  const maxUploadBytes = isPrivileged ? PRIVILEGED_MAX_UPLOAD_BYTES : DEFAULT_MAX_UPLOAD_BYTES;
  const quota = user?.storageQuotaBytes ?? null;
  const used = user?.storageUsedBytes ?? 0;

  const describeFailure = useCallback((err: unknown, filename: string): string => {
    if (!(err instanceof ApiError)) return `${filename} could not be uploaded.`;

    if (err.code === 'QUOTA_EXCEEDED') {
      const size = numberFrom(err.details, 'size');
      const limit = numberFrom(err.details, 'limit');
      const usedBytes = numberFrom(err.details, 'used');
      const quotaBytes = numberFrom(err.details, 'quota');
      const required = numberFrom(err.details, 'required');

      if (size !== null && limit !== null) {
        return `${filename} is ${formatBytes(size)}. The limit is ${formatBytes(limit)} per file.`;
      }
      if (usedBytes !== null && quotaBytes !== null && required !== null) {
        const free = Math.max(quotaBytes - usedBytes, 0);
        return `${filename} needs ${formatBytes(required)} but only ${formatBytes(free)} of your ${formatBytes(quotaBytes)} allowance is free. Delete a file to make room.`;
      }
      if (limit !== null) {
        // formatBytes, like the two branches above: the raw figure renders as
        // "(limit: 1048576)", which is the number in the units the database
        // uses rather than the ones the person reading it thinks in.
        // The server message may or may not end in a full stop, so trim one
        // before appending rather than risking "at most 1 MB. (limit: 1 MB).".
        return `${err.message.replace(/\.\s*$/, '')} (limit: ${formatBytes(limit)}).`;
      }
      return err.message;
    }

    if (err.code === 'UNSUPPORTED_MEDIA_TYPE') {
      return `${filename} is not a file type this installation accepts. ${err.message}`;
    }

    return err.message;
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const pending: PendingUpload[] = files.map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        size: file.size,
        status: 'waiting',
      }));

      setQueue(pending);
      setUploading(true);

      let succeeded = 0;

      /*
       * Uploaded one at a time. The API serialises on the owner's row to keep the
       * storage counter honest, so parallel uploads would only queue there. Doing
       * it here means the file that trips the quota is named in the error rather
       * than one of five racing requests.
       */
      for (const [index, item] of pending.entries()) {
        const file = files[index];
        if (!file) continue;

        setQueue((current) =>
          current.map((entry) =>
            entry.key === item.key ? { ...entry, status: 'uploading' } : entry,
          ),
        );

        try {
          await api.upload<{ attachment: AttachmentMeta }>(
            `/api/attachments/todos/${todoId}`,
            file,
          );
          succeeded += 1;
          setQueue((current) => current.filter((entry) => entry.key !== item.key));
        } catch (err) {
          const reason = describeFailure(err, file.name);
          setQueue((current) =>
            current.map((entry) =>
              entry.key === item.key ? { ...entry, status: 'failed', error: reason } : entry,
            ),
          );
        }
      }

      setUploading(false);

      if (succeeded > 0) {
        await mutate();
        onChanged?.();
        message.success(`${succeeded} ${succeeded === 1 ? 'file' : 'files'} attached`);
      }
    },
    [describeFailure, message, mutate, onChanged, todoId],
  );

  const handleDelete = useCallback(
    (attachment: AttachmentMeta) => {
      modal.confirm({
        title: 'Delete this file?',
        content: `"${attachment.filename}" will be removed permanently and its ${formatBytes(attachment.byteSize)} returned to your allowance.`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        cancelText: 'Keep it',
        onOk: async () => {
          try {
            await api.delete<{ attachment: AttachmentMeta }>(`/api/attachments/${attachment.id}`);
            await mutate();
            onChanged?.();
            message.success('File deleted');
          } catch (err) {
            message.error(err instanceof ApiError ? err.message : 'Could not delete that file');
          }
        },
      });
    },
    [message, modal, mutate, onChanged],
  );

  return (
    <div className="tf-stack" style={{ gap: '0.75rem' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.6rem',
        }}
      >
        <Button
          icon={<UploadOutlined />}
          onClick={() => inputRef.current?.click()}
          loading={uploading}
        >
          Add files
        </Button>

        {/* The visible control is the button above; this input stays in the
            accessibility tree with a real label so it is reachable by keyboard
            and by screen readers. */}
        <label
          htmlFor={inputId}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
          }}
        >
          Choose files to attach
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Reset so choosing the same file twice still fires a change event.
            event.target.value = '';
            void uploadFiles(files);
          }}
        />

        <Typography.Text className="tf-muted" style={{ fontSize: '0.8125rem' }}>
          Up to about {formatBytes(maxUploadBytes)} per file
          {quota !== null
            ? ` · ${formatBytes(Math.max(quota - used, 0))} of ${formatBytes(quota)} storage free`
            : ` · ${formatBytes(used)} stored`}
        </Typography.Text>
      </div>

      <div aria-live="polite" className="tf-stack" style={{ gap: '0.5rem' }}>
        {queue.map((item) => (
          <div key={item.key}>
            {item.status === 'failed' ? (
              <Alert
                type="error"
                showIcon
                message={item.error ?? `${item.name} could not be uploaded.`}
                closable
                onClose={() =>
                  setQueue((current) => current.filter((entry) => entry.key !== item.key))
                }
              />
            ) : (
              <div>
                <Typography.Text style={{ fontSize: '0.8125rem' }}>
                  {item.status === 'uploading' ? 'Uploading' : 'Waiting'} · {item.name} (
                  {formatBytes(item.size)})
                </Typography.Text>
                {/* Indeterminate on purpose: uploads go out through `fetch`,
                    which reports no progress events, and a bar that invents a
                    percentage is worse than one that admits it is working. */}
                <Progress
                  percent={100}
                  status={item.status === 'uploading' ? 'active' : 'normal'}
                  showInfo={false}
                  size="small"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {attachments.length === 0 ? (
        <Typography.Text className="tf-muted" style={{ fontSize: '0.8125rem' }}>
          Nothing attached yet.
        </Typography.Text>
      ) : (
        <ul
          className="tf-stack"
          style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.5rem' }}
        >
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.7rem',
                padding: '0.5rem 0.6rem',
                border: '1px solid var(--tf-border)',
                borderRadius: 10,
                background: 'var(--tf-surface)',
              }}
            >
              {isImageMime(attachment.mimeType) ? (
                /* A plain <img>: these bytes are served by our own API with an
                   immutable ETag, and routing user uploads through the image
                   optimiser would buy nothing and cost a proxy hop. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={attachmentHref(attachment.id)}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: '1px solid var(--tf-border)',
                    flex: 'none',
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 40,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 6,
                    border: '1px solid var(--tf-border)',
                    color: 'var(--tf-text-muted)',
                    flex: 'none',
                  }}
                >
                  <FileOutlined />
                </span>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflowWrap: 'anywhere', fontSize: '0.875rem' }}>
                  {attachment.filename}
                </div>
                <div className="tf-muted" style={{ fontSize: '0.75rem' }}>
                  {formatBytes(attachment.byteSize)} · {attachment.mimeType}
                  {attachment.width && attachment.height
                    ? ` · ${attachment.width}×${attachment.height}`
                    : ''}
                </div>
              </div>

              <Tooltip title="Download">
                <Button
                  type="text"
                  icon={<DownloadOutlined />}
                  href={attachmentHref(attachment.id)}
                  download={attachment.filename}
                  aria-label={`Download ${attachment.filename}`}
                />
              </Tooltip>

              <Tooltip title="Delete">
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(attachment)}
                  aria-label={`Delete ${attachment.filename}`}
                />
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pull a number out of an `ApiError.details` payload without trusting its shape. */
function numberFrom(details: unknown, key: string): number | null {
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}
