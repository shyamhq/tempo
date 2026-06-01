import { z } from 'zod';
import { Event } from './events';
import {
  Comment,
  ConnectToken,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  Plan,
  ProposalStatus,
  Reply,
  ReplyPayload,
  SessionId,
  SessionStatus,
  ThreadId,
  ThreadStatus,
  ThreadSummary,
} from './primitives';

// POST /api/threads
export const CreateThreadRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000),
});
export const CreateThreadResponse = z.object({
  thread: ThreadSummary,
  connect_token: ConnectToken,
});

// GET /api/threads/:id/connect-token — Dev-only, returns the Thread's
// stable connect token for re-display ("Connect" button on the Thread page).
export const GetConnectTokenResponse = z.object({
  connect_token: ConnectToken,
});

// GET /api/threads
export const ListThreadsResponse = z.object({
  threads: z.array(
    ThreadSummary.extend({
      status: ThreadStatus,
      session_status: SessionStatus,
      updated_at: IsoTimestamp,
    }),
  ),
});

// GET /api/threads/:id
export const GetThreadResponse = z.object({
  thread: ThreadSummary,
  status: ThreadStatus,
  plan: Plan,
  comments: z.array(Comment),
  discussion: z.object({
    messages: z.array(DiscussionMessage),
  }),
  session_status: SessionStatus,
  // Repo chrome for the Thread header (D5). Drawn from the latest connected
  // session's `attached_repo_*`. Both null when no session has connected yet.
  attached_repo_remote: z.string().nullable(),
  attached_repo_path: z.string().nullable(),
  last_event_id: EventId,
});

// POST /api/sessions
// Header: Authorization: Bearer tmp_...
// Body: { repo_remote?, repo_path? } — display-only metadata reported by Agent.
export const CreateSessionRequest = z.object({
  repo_remote: z.string().url().nullable().optional(),
  repo_path: z.string().nullable().optional(),
});
export const CreateSessionResponse = z.object({
  session_id: SessionId,
  thread_id: ThreadId,
});

// GET /api/sessions/:id/state
// Same shape as MCP attach output, but server-rendered.
export { AttachOutput as GetSessionStateResponse } from './mcp';

// POST /api/sessions/:id/tool-use
// Recorded by the Agent's Claude Code PreToolUse hook (fire-and-forget).
export const RecordToolUseRequest = z.object({
  tool: z.string().min(1).max(64),
  summary: z.string().max(200),
});
export const RecordToolUseResponse = z.object({ ok: z.literal(true) });

// GET /api/threads/:id/plan
export const GetPlanResponse = Plan;

// POST /api/threads/:id/plan
// Actor (dev | agent) derived from auth: bearer token = agent, session cookie = dev.
export const WritePlanRequest = z.object({
  markdown: z.string(),
});
export const WritePlanResponse = z.object({
  ok: z.literal(true),
  updated_at: IsoTimestamp,
});

// POST /api/threads/:id/comments
export const CreateCommentRequest = z.object({
  plan_quote: z.string(),
  plan_context: z.string(),
});
export const CreateCommentResponse = Comment;

// POST /api/comments/:id/replies
export const CreateReplyRequest = z.object({
  payload: ReplyPayload,
});
export const CreateReplyResponse = Reply;

// POST /api/comments/:id/resolve
export const ResolveCommentRequest = z.object({});
export const ResolveCommentResponse = z.object({ ok: z.literal(true) });

// POST /api/comments/:id/unresolve
export const UnresolveCommentRequest = z.object({});
export const UnresolveCommentResponse = z.object({ ok: z.literal(true) });

// POST /api/replies/:id/decision
export const DecideProposalRequest = z.object({
  decision: ProposalStatus,
  rejection_reason: z.string().max(2_000).nullable().optional(),
});
export const DecideProposalResponse = z.object({ ok: z.literal(true) });

// POST /api/threads/:id/discussion/messages
// Wire body is identical to the MCP tool's input — re-export so the two
// surfaces can't drift. The `author='dev'` + questions rejection lives in
// `server/discussion.ts`, not the schema.
export { PostDiscussionMessageInput as CreateDiscussionMessageRequest } from './mcp';
export const CreateDiscussionMessageResponse = DiscussionMessage;

// POST /api/threads/:id/approve
export const ApproveThreadResponse = z.object({ ok: z.literal(true) });

// POST /api/threads/:id/reopen
export const ReopenThreadResponse = z.object({ ok: z.literal(true) });

// DELETE /api/threads/:id
export const DeleteThreadResponse = z.object({ ok: z.literal(true) });

// GET /api/threads/:id/events  — long-poll OR SSE
// Query: ?cursor=evt_…&wait=30s  (wait omitted = SSE stream)
export const EventsQuery = z.object({
  cursor: EventId,
  wait: z.coerce.number().int().min(0).max(60).optional(),
});
export const EventsLongPollResponse = z.object({
  events: z.array(Event),
  cursor: EventId,
});
// SSE response is a stream of `event: <kind>\ndata: <Event JSON>\n\n` frames.

// Error envelope for all 4xx/5xx responses
export const HttpError = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type HttpError = z.infer<typeof HttpError>;
