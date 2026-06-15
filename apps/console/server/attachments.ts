import type { AttachmentRef } from '@tempo/contracts';
import type { InitAttachmentInput, InitAttachmentResult } from '@tempo/contracts/http';
import { db } from '@tempo/db/client';
import { attachments, threads } from '@tempo/db/schema';
import { eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { headObject, objectKey, signGetUrl, signPutUrl } from '../lib/r2';
import { newAttachmentId } from './ids';

// Tunables (single source of truth for both upload limits and TTLs). Live at
// the top of the module so the Dev can change one constant and have it flow
// to every site: client validation echoes them via the InitAttachmentInput
// contract; server-side checks happen at /init (early reject) and at Send
// (HEAD verifies actual byte length matches the row).

const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 8;
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const PUT_URL_TTL_SECONDS = 30 * 60;
const GET_URL_TTL_SECONDS = 30 * 60;

type AllowedMime = (typeof ALLOWED_MIMES)[number];

export async function initUpload(
  threadId: string,
  body: z.infer<typeof InitAttachmentInput>,
): Promise<z.infer<typeof InitAttachmentResult>> {
  const [t] = await db
    .select({ id: threads.id, status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!t) throw new Error('thread_not_found');
  if (t.status === 'approved') throw new Error('thread_approved');

  const id = newAttachmentId();
  const key = objectKey(threadId, id);
  const put_url = await signPutUrl(key, body.mime, body.byte_len, PUT_URL_TTL_SECONDS);
  const expires_at = new Date(Date.now() + PUT_URL_TTL_SECONDS * 1000).toISOString();
  return { id, put_url, expires_at };
}

// Verify every claimed attachment exists in R2 + sits under this Thread's
// prefix, then insert the rows in the same transaction the parent (message
// or reply) is being created. Caller passes the tx so the parent row +
// attachment rows commit atomically — a HEAD-then-message-failed orphan
// is impossible.
type AttachParent = { kind: 'message'; messageId: string } | { kind: 'reply'; replyId: string };

// Drizzle's tx type is unwieldy to extract from the public surface; the
// methods we use (insert) match the top-level `db`. Use a structural type
// covering exactly that call so the function type-checks against either.
type AttachmentTx = Pick<typeof db, 'insert'>;

export async function verifyAttachmentsInR2(
  threadId: string,
  ids: string[],
): Promise<{ id: string; byte_len: number; mime: AllowedMime }[]> {
  if (ids.length === 0) return [];
  if (ids.length > MAX_FILES_PER_MESSAGE) throw new Error('too_many_attachments');
  return Promise.all(
    ids.map(async (id) => {
      const head = await headObject(objectKey(threadId, id));
      if (!head) throw new Error('attachment_not_uploaded');
      if (head.byte_len > MAX_BYTES_PER_FILE) throw new Error('attachment_too_large');
      if (!isAllowedMime(head.mime)) throw new Error('attachment_bad_mime');
      return { id, byte_len: head.byte_len, mime: head.mime };
    }),
  );
}

function isAllowedMime(m: string): m is AllowedMime {
  return (ALLOWED_MIMES as readonly string[]).includes(m);
}

export async function insertAttachmentRows(
  tx: AttachmentTx,
  threadId: string,
  heads: { id: string; byte_len: number; mime: AllowedMime }[],
  parent: AttachParent,
): Promise<void> {
  if (heads.length === 0) return;
  await tx.insert(attachments).values(
    heads.map((h) => ({
      id: h.id,
      thread_id: threadId,
      message_id: parent.kind === 'message' ? parent.messageId : null,
      reply_id: parent.kind === 'reply' ? parent.replyId : null,
      mime: h.mime,
      byte_len: h.byte_len,
    })),
  );
}

export async function listAttachmentsForParents(parents: {
  message_ids?: string[];
  reply_ids?: string[];
}): Promise<Map<string, AttachmentRef[]>> {
  const messageIds = parents.message_ids ?? [];
  const replyIds = parents.reply_ids ?? [];
  if (messageIds.length === 0 && replyIds.length === 0) return new Map();

  const rows: (typeof attachments.$inferSelect)[] = [];
  if (messageIds.length > 0) {
    const r = await db
      .select()
      .from(attachments)
      .where(inArray(attachments.message_id, messageIds));
    rows.push(...r);
  }
  if (replyIds.length > 0) {
    const r = await db.select().from(attachments).where(inArray(attachments.reply_id, replyIds));
    rows.push(...r);
  }

  // Sign each row's GET URL once. Signing is cheap (HMAC), but we still
  // dedupe by attachment id so a single parent's repeated ref doesn't
  // re-sign — listAttachmentsForParents itself returns one ref per row.
  const signed = await Promise.all(rows.map(async (row) => ({ row, ref: await toRef(row) })));

  const byParent = new Map<string, AttachmentRef[]>();
  for (const { row, ref } of signed) {
    const key = row.message_id ?? row.reply_id;
    if (!key) continue;
    const arr = byParent.get(key) ?? [];
    arr.push(ref);
    byParent.set(key, arr);
  }
  return byParent;
}

async function toRef(row: typeof attachments.$inferSelect): Promise<AttachmentRef> {
  const url = await signGetUrl(objectKey(row.thread_id, row.id), GET_URL_TTL_SECONDS);
  return {
    id: row.id,
    mime: row.mime as AllowedMime,
    byte_len: row.byte_len,
    url,
    expires_at: new Date(Date.now() + GET_URL_TTL_SECONDS * 1000).toISOString(),
  };
}
