// Discussion feature client: the Dev's message post goes to the Worker (Bearer
// Clerk JWT), mirroring features/comments/api.ts — the discussion create route
// lives on the Worker, not Console. The server appends discussion_message_posted
// to the event stream; the gateway's applyDiscussionMessagePosted appends the
// echoed row (the slice dedups by id).
//
// getToken is passed per-call (useAuth().getToken) so every request carries a
// fresh JWT — never cached.

import {
  type CreateDiscussionMessageRequest,
  CreateDiscussionMessageResponse,
} from '@tempo/contracts/http';
import type { z } from 'zod';
import { workerRequest } from '../../lib/api-client';

export function postDiscussionMessage(
  threadId: string,
  input: z.input<typeof CreateDiscussionMessageRequest>,
  getToken: () => Promise<string | null>,
) {
  return workerRequest(
    'POST',
    `/api/threads/${encodeURIComponent(threadId)}/discussion/messages`,
    input,
    CreateDiscussionMessageResponse,
    getToken,
  );
}
