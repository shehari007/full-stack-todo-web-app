/**
 * Request schemas for the attachments module.
 *
 * The upload body is raw bytes rather than JSON, so there is nothing for zod to
 * validate there. The filename header and the bytes themselves are checked in
 * the service, where the magic-byte and quota rules live.
 */
import { z } from 'zod';
import { attachmentKindEnum } from '../../db/schema.js';

export const attachmentIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const todoAttachmentParamSchema = z.object({
  todoId: z.string().uuid(),
});

/**
 * Listing is paginated with a hard ceiling on the page size. Attachments are the
 * one table where an unbounded page is genuinely expensive: even projecting only
 * metadata, an uncapped `pageSize` invites a full scan of a table whose rows are
 * interleaved with megabytes of `bytea`.
 */
export const listAttachmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  kind: z.enum(attachmentKindEnum.enumValues).optional(),
  todoId: z.string().uuid().optional(),
});

export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
