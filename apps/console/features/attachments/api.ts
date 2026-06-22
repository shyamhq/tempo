// Attachments feature client. Shared by the discussion composer and the
// new-thread compose — both mint a presigned upload then PUT the bytes.
//
// initAttachment mirrors apps/console's workerApi.initAttachment: a Worker write
// (Bearer Clerk JWT) that declares the file and gets back a signed PUT URL into
// R2. The id it returns is then passed in postDiscussionMessage({ attachments }).
// getToken is passed per-call (useAuth().getToken) so every request carries a
// fresh JWT — never cached.

import { type InitAttachmentInput, InitAttachmentResult } from '@tempo/contracts/http';
import type { z } from 'zod';
import { workerRequest } from '../../lib/api-client';

export function initAttachment(
  threadId: string,
  input: z.input<typeof InitAttachmentInput>,
  getToken: () => Promise<string | null>,
) {
  return workerRequest(
    'POST',
    `/api/threads/${encodeURIComponent(threadId)}/attachments/init`,
    input,
    InitAttachmentResult,
    getToken,
  );
}
