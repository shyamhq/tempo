// Comments feature client: the create writes go to the Worker (Bearer Clerk
// JWT), mirroring apps/console's workerApi() — the comment/reply create routes
// live on the Worker, not Console. The server appends comment_added / reply_added
// to the event stream; the gateway's apply* dedups the echo by id against the
// optimistic local write (see features/comments/store.ts upsert*).
//
// getToken is passed per-call (useAuth().getToken) so every request carries a
// fresh JWT — never cached.

import {
  type CreateCommentRequest,
  CreateCommentResponse,
  type CreateReplyRequest,
  CreateReplyResponse,
} from '@tempo/contracts/http';
import type { z } from 'zod';
import { workerRequest } from '../../lib/api-client';

export function createComment(
  threadId: string,
  input: z.input<typeof CreateCommentRequest>,
  getToken: () => Promise<string | null>,
) {
  return workerRequest(
    'POST',
    `/api/threads/${encodeURIComponent(threadId)}/comments`,
    input,
    CreateCommentResponse,
    getToken,
  );
}

export function createReply(
  commentId: string,
  input: z.input<typeof CreateReplyRequest>,
  getToken: () => Promise<string | null>,
) {
  return workerRequest(
    'POST',
    `/api/comments/${encodeURIComponent(commentId)}/replies`,
    input,
    CreateReplyResponse,
    getToken,
  );
}
