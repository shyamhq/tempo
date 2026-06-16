import { z } from 'zod';
import { AgentTodo, Event } from './events';
import {
  AttachmentId,
  Comment,
  ConnectToken,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  Plan,
  Reply,
  ReplyPayload,
  SessionId,
  SessionStatus,
  Space,
  SpaceId,
  SpaceThreadLite,
  ThreadId,
  ThreadStatus,
  ThreadSummary,
} from './primitives';
import { Trail } from './trails';

// POST /api/threads
export const CreateThreadRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000),
  space_id: SpaceId,
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

// GET /api/threads/:id/hosted/state — live Hosted-runtime snapshot.
// `hosted_enabled` mirrors the workspace flag; `vm` is non-null when a
// Sandbox is currently provisioned (vm_runs row with ended_at IS NULL).
export const HostedStateResponse = z.object({
  hosted_enabled: z.boolean(),
  vm: z
    .object({
      sandbox_id: z.string(),
      started_at: z.iso.datetime(),
    })
    .nullable(),
});

// POST /api/threads/:id/hosted/wake — explicit user-triggered Sandbox spawn.
// `spawned`: a new Sandbox is provisioning.
// `already_running`: a Sandbox is alive (or mid-spawn) for this thread.
// `hosted_off`: workspace has Hosted disabled — flip it in Settings.
export const WakeHostedResponse = z.union([
  z.object({
    status: z.literal('spawned'),
    vm_run_id: z.string(),
    sandbox_id: z.string(),
  }),
  z.object({
    status: z.literal('already_running'),
    sandbox_id: z.string(),
  }),
  z.object({ status: z.literal('hosted_off') }),
]);

// GET /api/threads?space_id=spc_…
export const ListThreadsQuery = z.object({
  space_id: SpaceId.optional(),
});
export const ListThreadsResponse = z.object({
  threads: z.array(
    ThreadSummary.extend({
      status: ThreadStatus,
      session_status: SessionStatus,
      updated_at: IsoTimestamp,
    }),
  ),
});

// GET /api/spaces
export const ListSpacesResponse = z.object({
  spaces: z.array(Space),
});

// POST /api/spaces
export const CreateSpaceRequest = z.object({
  name: z.string().min(1).max(80),
});
export const CreateSpaceResponse = z.object({ space: Space });

// PATCH /api/spaces/:id  — rename and/or reorder. At least one of `name` /
// `sort_order` must be present. Body returns `{ ok: true }`; the caller
// invalidates the `['spaces']` query rather than reading from the response.
export const UpdateSpaceRequest = z
  .object({
    name: z.string().min(1).max(80).optional(),
    sort_order: z.number().finite().optional(),
  })
  .refine((d) => d.name !== undefined || d.sort_order !== undefined, {
    message: 'at_least_one_of_name_or_sort_order_required',
  });
export const UpdateSpaceResponse = z.object({ ok: z.literal(true) });

// DELETE /api/spaces/:id  — cascades to every Thread in the Space (+ their deps)
export const DeleteSpaceResponse = z.object({ ok: z.literal(true) });

// GET /api/spaces/:id/threads — lightweight list used by the sidebar (no
// session-status, no updated_at). Avoids amplifying the existing N+1 in
// listThreads when a Space is expanded in the rail.
export const ListSpaceThreadsResponse = z.object({
  threads: z.array(SpaceThreadLite),
});

// GET /api/threads/:id
export const GetThreadResponse = z.object({
  thread: ThreadSummary,
  space_id: SpaceId,
  status: ThreadStatus,
  plan: Plan,
  comments: z.array(Comment),
  discussion: z.object({
    messages: z.array(DiscussionMessage),
  }),
  session_status: SessionStatus,
  // Populated by the SSE reducer on `session_failed`; never written by the
  // server. Optional so older event-log replays without the field still parse.
  session_failed_reason: z.string().nullable().optional(),
  // Repo chrome for the Thread header (D5). Drawn from the latest connected
  // session's `attached_repo_*`. Both null when no session has connected yet.
  attached_repo_remote: z.string().nullable(),
  attached_repo_path: z.string().nullable(),
  last_event_id: EventId,
});

// GET /api/threads/:id/trails — derived view of the agent's work, grouped
// into one trail per produced output (Comment reply, Plan edit, Discussion
// message). Newest first.
export const GetTrailsResponse = z.object({
  trails: z.array(Trail),
});

// POST /api/sessions
// Header: Authorization: Bearer tmp_...
// Body: { repo_remote?, repo_path? } — display-only metadata reported by Agent.
export const CreateSessionRequest = z.object({
  repo_remote: z.string().url().nullable().optional(),
  repo_path: z.string().nullable().optional(),
});
// `agent_api_key` is returned from the handshake. The CLI exchanges its
// thread-scoped `tmp_…` connect-token for this workspace-scoped key and uses
// it as Bearer on every subsequent request. The connect-token is valid only
// on this one route after Phase 4b.
export const AgentApiKey = z.string().regex(/^sk_agent_/);
export const CreateSessionResponse = z.object({
  session_id: SessionId,
  thread_id: ThreadId,
  agent_api_key: AgentApiKey,
});

// GET /api/sessions/:id/state
// Same shape as MCP attach output, but server-rendered.
export { AttachOutput as GetSessionStateResponse } from './mcp';

// POST /api/sessions/:id/tool-use
// Recorded by the Agent driver when an assistant `tool_use` content block is
// observed (one row per call).
export const RecordToolUseRequest = z.object({
  tool: z.string().min(1).max(64),
  summary: z.string().max(200),
});
export const RecordToolUseResponse = z.object({ ok: z.literal(true) });

// POST /api/sessions/:id/narration
// Recorded by the stream-json Agent driver when an assistant `text` content
// block is observed between tool calls. Bounded at ~4 paragraphs; longer prose
// is rare and would be drift, not signal.
export const RecordAgentNarrationRequest = z.object({
  text: z.string().min(1).max(8000),
});
export const RecordAgentNarrationResponse = z.object({ ok: z.literal(true) });

// POST /api/sessions/:id/todos-updated
// Recorded by the Agent driver when a tool_use block names `TodoWrite`.
// Carries the full todo list — each call rewrites the slate.
export const RecordTodosUpdatedRequest = z.object({
  todos: z.array(AgentTodo).max(50),
});
export const RecordTodosUpdatedResponse = z.object({ ok: z.literal(true) });

// POST /api/sessions/:id/turn-ended
// Recorded by the Agent driver when the per-turn `claude -p` child exits
// cleanly. Empty body — the act of POSTing is the end-of-turn signal.
export const RecordTurnEndedRequest = z.object({});
export const RecordTurnEndedResponse = z.object({ ok: z.literal(true) });

// GET /api/threads/:id/plan
export const GetPlanResponse = Plan;

// POST /api/threads/:id/plan
// Both Dev (Console) and Agent write through this single endpoint. PM JSON
// is the wire format for both — the Agent no longer round-trips through
// annotated Markdown, so BlockNote `comment` marks survive untouched edits.
export const WritePlanRequest = z.object({
  pm_json: z.unknown(),
});
export const WritePlanResponse = z.object({
  ok: z.literal(true),
  updated_at: IsoTimestamp,
});

// POST /api/threads/:id/plan/recheck — Dev-initiated nudge. Appends a
// `plan_edited_by_dev` event without touching the Plan body. The Plan body
// itself is no longer auto-nudged on Dev writes (auto-save runs constantly);
// the Dev hits Recheck when they want the Agent to re-read.
export const RecheckPlanResponse = z.object({
  ok: z.literal(true),
  updated_at: IsoTimestamp,
});

// POST /api/threads/:id/comments
// `first_reply_text` is the Dev's first message on the new comment. When
// present, the server inserts the comment + reply atomically and emits a
// single `comment_added` event with the reply already in `comment.replies` —
// the UI never has to render an empty-comment intermediate state.
export const CreateCommentRequest = z.object({
  plan_quote: z.string(),
  plan_context: z.string(),
  anchor_block_id: z.string().max(128).nullable().optional(),
  first_reply_text: z.string().min(1).optional(),
  attachments: z.array(AttachmentId).max(8).default([]),
});
export const CreateCommentResponse = Comment;

// DELETE /api/comments/:id
export const DeleteCommentResponse = z.object({ ok: z.literal(true) });

// POST /api/comments/:id/replies
export const CreateReplyRequest = z.object({
  payload: ReplyPayload,
  attachments: z.array(AttachmentId).max(8).default([]),
});
export const CreateReplyResponse = Reply;

// POST /api/comments/:id/resolve
export const ResolveCommentRequest = z.object({});
export const ResolveCommentResponse = z.object({ ok: z.literal(true) });

// POST /api/comments/:id/unresolve
export const UnresolveCommentRequest = z.object({});
export const UnresolveCommentResponse = z.object({ ok: z.literal(true) });

// POST /api/threads/:id/attachments/init
// Browser declares the file it's about to upload; server returns a signed PUT
// URL into R2. No DB row yet — the row is written at message/reply create
// time alongside the parent. 10 MB hard cap; R2 lifecycle sweeps orphans.
export const InitAttachmentInput = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  byte_len: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export const InitAttachmentResult = z.object({
  id: AttachmentId,
  put_url: z.string().url(),
  expires_at: IsoTimestamp,
});

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

// PATCH /api/threads/:id  — rename, move between Spaces, reorder, and/or
// rewrite the description. At least one field must be present.
export const UpdateThreadRequest = z
  .object({
    title: z.string().min(1).max(200).optional(),
    space_id: SpaceId.optional(),
    sort_order: z.number().finite().optional(),
    description: z.string().max(10_000).optional(),
  })
  .refine(
    (d) =>
      d.title !== undefined ||
      d.space_id !== undefined ||
      d.sort_order !== undefined ||
      d.description !== undefined,
    { message: 'at_least_one_field_required' },
  );
export const UpdateThreadResponse = z.object({ thread: ThreadSummary });

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

// POST /api/cli/exchange — exchanges an OAuth code for a CLI user token.
// The code is a short-lived signed JWT minted by Console's /cli/authorize page.
// code_verifier shape per RFC 7636 §4.1: 43–128 chars from the unreserved set.
export const CliExchangeRequest = z.object({
  code: z.string(),
  code_verifier: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9\-_]+$/),
});
export type CliExchangeRequest = z.infer<typeof CliExchangeRequest>;

export const CliExchangeResponse = z.object({
  token: z.string(),
  refresh_token: z.string(),
  expires_at: z.string().datetime(),
  user_id: z.string(),
  email: z.string().email(),
});
export type CliExchangeResponse = z.infer<typeof CliExchangeResponse>;

// POST /api/cli/refresh — rotate-on-use token refresh.
export const CliRefreshRequest = z.object({ refresh_token: z.string() });
export type CliRefreshRequest = z.infer<typeof CliRefreshRequest>;

// Same shape as exchange — rotate issues a fresh pair.
export const CliRefreshResponse = CliExchangeResponse;
export type CliRefreshResponse = z.infer<typeof CliRefreshResponse>;

// GET /api/threads/:id/access — thread membership check for CLI callers.
// `latest_event_id` seeds the CLI's SSE-cursor so the first nudge after
// Turn 1 anchors at the same point Turn 1's tempo_attach observed.
export const ThreadAccessResponse = z.object({
  thread_id: ThreadId,
  thread_title: z.string(),
  workspace_id: z.string(),
  workspace_name: z.string(),
  latest_event_id: z.string(),
});
export type ThreadAccessResponse = z.infer<typeof ThreadAccessResponse>;

// POST /api/agent-events — structured events emitted by the new CLI.
// Shape mirrors the existing event-log union in packages/contracts/src/events.ts
// minus the server-stamped id + created_at fields (Worker adds those on append).
// Using the same `agent_*` kind strings means Console's UI renders these
// without any UI-side changes.

export const AgentTodoInput = z.object({
  content: z.string().max(500),
  status: z.enum(['pending', 'in_progress', 'completed']),
  activeForm: z.string().max(500).optional(),
});

export const AgentToolUseEvent = z.object({
  kind: z.literal('agent_tool_use'),
  tool: z.string().max(64),
  summary: z.string().max(200),
});

export const AgentNarrationEvent = z.object({
  kind: z.literal('agent_narration'),
  text: z.string().min(1).max(8000),
});

export const AgentTodosUpdatedEvent = z.object({
  kind: z.literal('agent_todos_updated'),
  todos: z.array(AgentTodoInput).max(50),
});

export const AgentTurnEndedEvent = z.object({
  kind: z.literal('agent_turn_ended'),
});

export const AgentSessionInitiatingEvent = z.object({
  kind: z.literal('session_initiating'),
});

export const AgentSessionConnectedEvent = z.object({
  kind: z.literal('session_connected'),
});

export const AgentSessionDisconnectedEvent = z.object({
  kind: z.literal('session_disconnected'),
});

export const AgentSessionFailedEvent = z.object({
  kind: z.literal('session_failed'),
  reason: z.string().max(200),
});

export const AgentEventRequest = z.object({
  thread_id: ThreadId,
  event: z.discriminatedUnion('kind', [
    AgentToolUseEvent,
    AgentNarrationEvent,
    AgentTodosUpdatedEvent,
    AgentTurnEndedEvent,
    AgentSessionInitiatingEvent,
    AgentSessionConnectedEvent,
    AgentSessionDisconnectedEvent,
    AgentSessionFailedEvent,
  ]),
});
export type AgentEventRequest = z.infer<typeof AgentEventRequest>;
