/**
 * Attachment storage.
 *
 * File bytes live in Postgres, which shapes everything here. Two rules follow
 * from it and are worth stating once:
 *
 *  1. `attachments.data` is only ever read by the download path, and only after
 *     the caller's access and their `If-None-Match` have already been settled
 *     from the metadata columns. Every other query projects `metadataColumns`.
 *  2. `users.storageUsedBytes` is the only thing standing between a user and an
 *     unbounded database, so it moves in the same transaction as the row it
 *     accounts for. A counter that can drift from reality is not a quota.
 *
 * The third theme is that the client is never believed about what it uploaded.
 * The stored MIME type comes from the file's magic bytes; the `Content-Type`
 * header is a hint used only where a format has no magic bytes to read.
 */
import { and, count, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { db } from '../../db/index.js';
import {
  attachments,
  todos,
  users,
  type Attachment,
  type AttachmentKind,
  type UserRole,
} from '../../db/schema.js';
import type { SettingsShape } from '../../config/settings.js';
import { sha256 } from '../../lib/crypto.js';
import { badRequest, notFound, quotaExceeded, unsupportedMediaType } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';

type Limits = SettingsShape['limits'];

/** Everything about an attachment except its payload. */
export type AttachmentMetadata = Omit<Attachment, 'data'>;

/**
 * The projection used by every query that is not serving bytes. Naming the
 * columns explicitly is what keeps `data` out: `select()` with no argument
 * would pull the whole `bytea` for every row.
 */
const metadataColumns = {
  id: attachments.id,
  kind: attachments.kind,
  userId: attachments.userId,
  todoId: attachments.todoId,
  ticketMessageId: attachments.ticketMessageId,
  filename: attachments.filename,
  mimeType: attachments.mimeType,
  byteSize: attachments.byteSize,
  checksum: attachments.checksum,
  width: attachments.width,
  height: attachments.height,
  createdAt: attachments.createdAt,
} as const;

const MAX_FILENAME_LENGTH = 200;

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

export function isPrivileged(role: UserRole): boolean {
  return role === 'root' || role === 'admin';
}

export function maxUploadBytesFor(role: UserRole, limits: Limits): number {
  return isPrivileged(role) ? limits.maxUploadBytesPrivileged : limits.maxUploadBytes;
}

/** A per-user override wins; otherwise the role's default from site settings. */
export function storageQuotaFor(
  role: UserRole,
  override: number | null,
  limits: Limits,
): number {
  if (override != null) return override;
  return isPrivileged(role) ? limits.privilegedStorageQuotaBytes : limits.userStorageQuotaBytes;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.round(value / 1024)} KB`;
}

/* -------------------------------------------------------------------------- */
/* Filenames                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reduce a client-supplied name to something safe to store and to echo back in
 * a header.
 *
 * Path separators matter most: `../../.ssh/authorized_keys` is inert while the
 * bytes sit in a database column, and stops being inert the first time anyone
 * writes one of these files to disk or into a zip export. Control characters
 * would let a name inject a line break into `Content-Disposition`, and a leading
 * dot produces both hidden files and the degenerate names `.` and `..`.
 */
export function sanitiseFilename(raw: string | undefined | null): string {
  let name = raw ?? '';

  try {
    name = decodeURIComponent(name);
  } catch {
    // Not percent-encoded, or encoded badly. The raw value is still usable once
    // it has been through the rules below.
  }

  name = name
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();

  return name || 'upload';
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(index + 1).toLowerCase() : '';
}

/* -------------------------------------------------------------------------- */
/* Type detection                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Formats with no magic bytes. `file-type` cannot see these (a CSV is just
 * text), so the extension picks the candidate and the *content* has to back it
 * up before the candidate is accepted.
 */
const TEXT_EXTENSION_MIME: Record<string, string> = {
  txt: 'text/plain',
  text: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  svg: 'image/svg+xml',
};

/**
 * A NUL byte or an invalid UTF-8 sequence means the payload is not the text
 * format its extension claims, which is exactly how a binary payload would be
 * smuggled in as `report.txt` and later served back with a text content type.
 */
function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide the MIME type to store.
 *
 * Magic bytes are authoritative, so renaming `payload.html` to `photo.png` gains
 * nothing. The extension is consulted only for the text formats that have no
 * magic bytes at all, and even then the bytes must decode as UTF-8. The client's
 * declared type is the last resort and is never allowed to select
 * `image/svg+xml`: an SVG is a scriptable document, and it must be reachable
 * only by uploading a file that genuinely says `.svg`.
 */
async function resolveMimeType(
  buffer: Buffer,
  filename: string,
  declaredMime: string | null,
  allowed: string[],
): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);

  if (detected) {
    /*
     * Most drawing tools open an SVG with an XML prolog, which `file-type`
     * reports as plain `application/xml`, so without this narrowing, half of
     * all real SVGs would be rejected by an installation that allows them. It
     * only ever moves the answer to a type the allowlist still has to accept,
     * and SVGs are served as downloads whichever way they were identified.
     */
    const mime =
      detected.mime === 'application/xml' &&
      extensionOf(filename) === 'svg' &&
      isUtf8Text(buffer)
        ? 'image/svg+xml'
        : detected.mime;

    if (!allowed.includes(mime)) {
      throw unsupportedMediaType(`Files of type ${mime} are not accepted on this installation`);
    }
    return mime;
  }

  const declared = declaredMime?.split(';')[0]?.trim().toLowerCase() ?? '';
  const candidate =
    TEXT_EXTENSION_MIME[extensionOf(filename)] ??
    (declared !== 'image/svg+xml' && Object.values(TEXT_EXTENSION_MIME).includes(declared)
      ? declared
      : undefined);

  if (!candidate || !allowed.includes(candidate)) {
    throw unsupportedMediaType('That file type could not be identified and was not accepted');
  }

  if (!isUtf8Text(buffer)) {
    throw unsupportedMediaType(
      `A ${candidate} file must be valid UTF-8 text, but this one contains binary data`,
    );
  }

  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Image dimensions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Pixel dimensions read straight out of the header bytes.
 *
 * Deliberately not a decoder: `sharp` would add a platform-specific native
 * binary and tens of megabytes to the deployment in order to recover two numbers
 * that sit in the first few dozen bytes of every format we accept. Anything
 * unrecognised or truncated returns null, which the UI renders as "size
 * unknown" rather than as an error.
 */
export function readImageDimensions(
  buffer: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }

    if (mimeType === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }

    if (mimeType === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === 'VP8L') {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') {
        return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
      }
      return null;
    }

    if (mimeType === 'image/jpeg') {
      // JPEG metadata segments have no fixed length, so the frame header has no
      // fixed offset. The marker chain has to be walked to find it.
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1] ?? 0;
        const isStartOfFrame =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isStartOfFrame) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch {
    // A malformed header is a reason to give up on the dimensions, not to
    // reject a file that already passed magic-byte detection.
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Storing                                                                    */
/* -------------------------------------------------------------------------- */

export interface StoreAttachmentInput {
  buffer: Buffer;
  /** Raw client-supplied name; sanitised here so every caller gets the same rules. */
  filename: string;
  /** The request's `Content-Type`. A hint only: magic bytes decide what is stored. */
  declaredMime?: string | null;
  kind: AttachmentKind;
  /** NULL only for `site_asset` rows, which belong to the installation, not a person. */
  userId: string | null;
  todoId?: string | null;
  /** Drives the size ceiling and the quota default. */
  actorRole: UserRole;
}

/**
 * Validate and persist an upload, returning the row without its payload.
 *
 * Checks run cheapest-first: a size that is already over the ceiling is rejected
 * before the buffer is hashed or sniffed, and the quota (the only check that
 * needs the database) runs last, inside the transaction that will change the
 * number it read.
 */
export async function storeAttachment(input: StoreAttachmentInput): Promise<AttachmentMetadata> {
  const limits = await getSettings('limits');
  const byteSize = input.buffer.byteLength;

  if (byteSize === 0) {
    throw badRequest('The uploaded file is empty');
  }

  const ceiling = maxUploadBytesFor(input.actorRole, limits);
  if (byteSize > ceiling) {
    throw quotaExceeded(`Files may be at most ${formatBytes(ceiling)}`, {
      size: byteSize,
      limit: ceiling,
    });
  }

  const filename = sanitiseFilename(input.filename);
  const mimeType = await resolveMimeType(
    input.buffer,
    filename,
    input.declaredMime ?? null,
    limits.allowedUploadMimeTypes,
  );
  const dimensions = readImageDimensions(input.buffer, mimeType);

  return db.transaction(async (tx) => {
    if (input.todoId) {
      // Ownership is a WHERE predicate rather than a check on a fetched row, so
      // another user's task id is a 404 and not a signal that it exists.
      const [todo] = await tx
        .select({ id: todos.id })
        .from(todos)
        .where(
          and(
            eq(todos.id, input.todoId),
            input.userId ? eq(todos.userId, input.userId) : sql`false`,
            isNull(todos.deletedAt),
          ),
        )
        .limit(1);

      if (!todo) {
        throw notFound('That task does not exist');
      }

      const [existing] = await tx
        .select({ value: count() })
        .from(attachments)
        .where(eq(attachments.todoId, input.todoId));

      if ((existing?.value ?? 0) >= limits.maxAttachmentsPerTodo) {
        throw quotaExceeded(
          `A task may have at most ${limits.maxAttachmentsPerTodo} attachments`,
          { limit: limits.maxAttachmentsPerTodo },
        );
      }
    }

    if (input.userId) {
      /*
       * `FOR UPDATE` serialises concurrent uploads by the same user. Without it
       * two requests can both read the same `storageUsedBytes`, both decide
       * there is room, and both commit, which is how a quota gets doubled.
       */
      const [owner] = await tx
        .select({
          role: users.role,
          storageUsedBytes: users.storageUsedBytes,
          storageQuotaBytes: users.storageQuotaBytes,
        })
        .from(users)
        .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
        .for('update')
        .limit(1);

      if (!owner) {
        throw notFound('That account no longer exists');
      }

      const quota = storageQuotaFor(owner.role, owner.storageQuotaBytes, limits);

      if (owner.storageUsedBytes + byteSize > quota) {
        throw quotaExceeded('This upload would exceed your storage allowance', {
          used: owner.storageUsedBytes,
          quota,
          required: byteSize,
        });
      }
    }

    const [created] = await tx
      .insert(attachments)
      .values({
        kind: input.kind,
        userId: input.userId,
        todoId: input.todoId ?? null,
        filename,
        mimeType,
        byteSize,
        checksum: sha256(input.buffer),
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        data: input.buffer,
      })
      .returning(metadataColumns);

    if (!created) {
      throw badRequest('Failed to store the uploaded file');
    }

    if (input.userId) {
      // An increment computed in SQL rather than read-modify-write in JS, so the
      // counter cannot lose a concurrent update from another connection.
      await tx
        .update(users)
        .set({ storageUsedBytes: sql`${users.storageUsedBytes} + ${byteSize}` })
        .where(eq(users.id, input.userId));
    }

    return created;
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export interface AttachmentViewer {
  userId: string;
  role: UserRole;
}

/**
 * Metadata for a file the viewer is allowed to see, or null.
 *
 * `site_asset` rows are readable by anyone, since logos and favicons are fetched
 * by signed-out visitors. Everything else is the owner's, or a moderator's to
 * inspect. Returning null rather than throwing lets the caller answer 404 for
 * "missing" and "not yours" alike.
 */
export async function findAccessibleAttachment(
  id: string,
  viewer: AttachmentViewer | null,
): Promise<AttachmentMetadata | null> {
  const visibility =
    viewer && isPrivileged(viewer.role)
      ? undefined
      : or(
          eq(attachments.kind, 'site_asset'),
          viewer ? eq(attachments.userId, viewer.userId) : undefined,
        );

  const [row] = await db
    .select(metadataColumns)
    .from(attachments)
    .where(and(eq(attachments.id, id), visibility))
    .limit(1);

  return row ?? null;
}

/**
 * Fetch the payload for an id whose access has already been established.
 *
 * Kept separate from the metadata lookup so a conditional request that ends in
 * 304 never pulls the bytes out of Postgres at all.
 */
export async function readAttachmentBytes(id: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ data: attachments.data })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  return row?.data ?? null;
}

export interface ListAttachmentsOptions {
  userId: string;
  page: number;
  pageSize: number;
  kind?: AttachmentKind | undefined;
  todoId?: string | undefined;
}

/**
 * A page of the caller's own files.
 *
 * Attachments belonging to a soft-deleted task are deliberately still listed:
 * they keep occupying the owner's quota until the task is purged, so hiding them
 * would leave a storage figure that cannot be reconciled with anything visible.
 */
export async function listAttachments(
  options: ListAttachmentsOptions,
): Promise<{ items: AttachmentMetadata[]; total: number }> {
  const predicate = and(
    eq(attachments.userId, options.userId),
    options.kind ? eq(attachments.kind, options.kind) : undefined,
    options.todoId ? eq(attachments.todoId, options.todoId) : undefined,
  );

  const [items, totals] = await Promise.all([
    db
      .select(metadataColumns)
      .from(attachments)
      .where(predicate)
      .orderBy(desc(attachments.createdAt))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    db.select({ value: count() }).from(attachments).where(predicate),
  ]);

  return { items, total: totals[0]?.value ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Deleting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Remove a file and give its bytes back to the owner's allowance.
 *
 * Attachments are hard-deleted rather than soft-deleted: the point of deleting a
 * file is to stop paying for it, and a row that still holds its `bytea` still
 * costs the same. The returned metadata is what the caller writes to the audit
 * log, since after this the row is gone.
 */
export async function deleteAttachment(
  id: string,
  actorUserId: string,
  actorRole: UserRole,
): Promise<AttachmentMetadata> {
  return db.transaction(async (tx) => {
    /*
     * A moderator may remove any *user's* file. That is what this path exists
     * for. Site assets are not a user's file: they are the installation's logo,
     * favicon and social image, and creating one is root-only
     * (`POST /api/admin/assets` sits behind `requireRoot`). Letting a delegated
     * admin delete one would hand them a root-restricted, irreversible action
     * through the side door. Expressed as a predicate rather than a check on a
     * fetched row, so it answers 404 like every other refusal here.
     */
    const ownership =
      actorRole === 'root'
        ? undefined
        : isPrivileged(actorRole)
          ? ne(attachments.kind, 'site_asset')
          : eq(attachments.userId, actorUserId);

    const [row] = await tx
      .select(metadataColumns)
      .from(attachments)
      .where(and(eq(attachments.id, id), ownership))
      .for('update')
      .limit(1);

    if (!row) {
      throw notFound('That file does not exist');
    }

    await tx.delete(attachments).where(eq(attachments.id, row.id));

    if (row.userId) {
      // `users.avatar_id` carries no foreign key, so nothing else clears it and
      // a deleted avatar would otherwise leave the profile pointing at a ghost.
      await tx.update(users).set({ avatarId: null }).where(eq(users.avatarId, row.id));

      // GREATEST keeps the counter at or above zero. It should never be able to
      // go negative, and if a past bug ever let it drift, a negative quota would
      // silently grant that user unlimited storage.
      await tx
        .update(users)
        .set({
          storageUsedBytes: sql`GREATEST(${users.storageUsedBytes} - ${row.byteSize}, 0)`,
        })
        .where(eq(users.id, row.userId));
    }

    return row;
  });
}
