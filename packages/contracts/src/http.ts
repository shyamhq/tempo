import { z } from 'zod';
import { ConnectorId, ConnectorTier } from './connectors';
import {
  AgentBlock,
  AgentType,
  AttachmentId,
  AttachmentRef,
  Comment,
  ConnectToken,
  DiscussionMessage,
  EventId,
  IsoTimestamp,
  Mention,
  Plan,
  Question,
  Reply,
  ReplyPayload,
  Space,
  SpaceId,
  SpaceThreadLite,
  ThreadId,
  ThreadSummary,
} from './primitives';
import { Trail } from './trails';

// POST /api/threads
export const CreateThreadRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000),
  space_id: SpaceId,
  agent_type: AgentType,
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
// `vm` is non-null when a Sandbox is currently provisioned (vm_runs row
// with ended_at IS NULL). Endpoint rejects with 400 when the Thread's
// agent_type is not 'hosted'.
export const HostedStateResponse = z.object({
  vm: z
    .object({
      sandbox_id: z.string(),
      started_at: z.iso.datetime(),
    })
    .nullable(),
});

// POST /api/threads/:id/hosted/wake — Sandbox spawn (user-triggered button
// or server-side post-hook on Dev wake-events). Rejects with 400 for
// agent_type='local' Threads.
// `spawned`: a new Sandbox is provisioning.
// `already_running`: a Sandbox is alive (or mid-spawn) for this thread.
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
]);

// GET /api/threads?space_id=spc_…
export const ListThreadsQuery = z.object({
  space_id: SpaceId.optional(),
});
export const ListThreadsResponse = z.object({
  threads: z.array(
    ThreadSummary.extend({
      updated_at: IsoTimestamp,
      agent_last_seen_at: IsoTimestamp.nullable(),
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
  plan: Plan,
  comments: z.array(Comment),
  discussion: z.object({
    messages: z.array(DiscussionMessage),
  }),
  // Console derives "is the Agent reachable" as
  // `now() - agent_last_seen_at < 60s`. Null until first Agent contact.
  agent_last_seen_at: IsoTimestamp.nullable(),
  last_event_id: EventId,
});

// GET /api/threads/:id/trails — derived view of the agent's work, grouped
// into one trail per produced output (Comment reply, Plan edit, Discussion
// message). Newest first.
export const GetTrailsResponse = z.object({
  trails: z.array(Trail),
});

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
  first_reply_mentions: z.array(Mention).optional(),
  attachments: z.array(AttachmentId).max(8).default([]),
});
export const CreateCommentResponse = Comment;

// DELETE /api/comments/:id
export const DeleteCommentResponse = z.object({ ok: z.literal(true) });

// POST /api/comments/:id/replies
export const CreateReplyRequest = z.object({
  payload: ReplyPayload,
  attachments: z.array(AttachmentId).max(8).default([]),
  mentions: z.array(Mention).optional(),
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

// GET /api/threads/:id/events — Redis-backed SSE stream (no query params). Full
// Thread state loads via GET /api/threads/:id, then this delivers new events as
// a stream of `event: <kind>\ndata: <Event JSON>\n\n` frames.

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

// Slim Turn 1 context snapshot — same shape the hosted drain returns on
// first:true. Both CLI (/access) and hosted (drain) inject this as the
// first user message so the agent starts with full state and zero MCP
// round-trips for data.
const TurnHydrationReply = z.object({
  id: z.string(),
  author_user_id: z.string().nullable(),
  text: z.string(),
  mentions: z.array(Mention).nullable(),
});
const TurnHydrationComment = z.object({
  id: z.string(),
  plan_quote: z.string(),
  anchor_block_id: z.string().nullable(),
  author_user_id: z.string().nullable(),
  resolved_by_user_id: z.string().nullable(),
  replies: z.array(TurnHydrationReply),
});
const TurnHydrationMessage = z.object({
  id: z.string(),
  author_user_id: z.string().nullable(),
  text: z.string().nullable(),
  questions: z.array(Question).nullable(),
  attachments: z.array(AttachmentRef),
  mentions: z.array(Mention).nullable(),
});
export const TurnHydration = z.object({
  thread: z.object({ title: z.string(), description: z.string().nullable() }),
  plan: z.object({ blocks: z.array(AgentBlock) }),
  comments: z.array(TurnHydrationComment),
  discussion: z.object({ messages: z.array(TurnHydrationMessage) }),
});
export type TurnHydration = z.infer<typeof TurnHydration>;

// GET /api/threads/:id/access — thread membership check for CLI callers.
// `latest_event_id` seeds the CLI's SSE-cursor. `context` is the full Turn 1
// snapshot injected into `--print` so the agent starts without MCP round-trips.
export const ThreadAccessResponse = z.object({
  thread_id: ThreadId,
  thread_title: z.string(),
  workspace_id: z.string(),
  workspace_name: z.string(),
  latest_event_id: z.string(),
  context: TurnHydration,
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

export const AgentThoughtEvent = z.object({
  kind: z.literal('agent_thought'),
  text: z.string().min(1).max(8000),
});

export const AgentToolFailedEvent = z.object({
  kind: z.literal('agent_tool_failed'),
  tool: z.string().max(64),
});

export const AgentModeChangedEvent = z.object({
  kind: z.literal('agent_mode_changed'),
  mode_id: z.string().max(64),
});

export const AgentDisconnectedEvent = z.object({
  kind: z.literal('agent_disconnected'),
});

export const AgentEventRequest = z.object({
  thread_id: ThreadId,
  event: z.discriminatedUnion('kind', [
    AgentToolUseEvent,
    AgentToolFailedEvent,
    AgentNarrationEvent,
    AgentThoughtEvent,
    AgentTodosUpdatedEvent,
    AgentModeChangedEvent,
    AgentTurnEndedEvent,
    AgentDisconnectedEvent,
  ]),
});
export type AgentEventRequest = z.infer<typeof AgentEventRequest>;

// --- Connectors (Settings → Integrations) ---------------------------------
// Console-side management API. The Worker never serves these — admin connect /
// disconnect / enable flows run through the Console (Clerk org-admin gated),
// the same place workspace members + invitations are managed. The Worker only
// reads `enabled` (the allowlist gate) on the Agent's tool-call path.

// GET /api/connectors — connection + enablement state for every connector in
// the catalog, scoped to the active workspace.
export const ConnectorState = z.object({
  connector_id: ConnectorId,
  tier: ConnectorTier,
  // A workspace_connectors row exists (admin linked an account / install).
  connected: z.boolean(),
  // The allowlist gate — the Agent can reach this connector iff enabled.
  enabled: z.boolean(),
  connected_at: IsoTimestamp.nullable(),
});
export type ConnectorState = z.infer<typeof ConnectorState>;

export const ConnectorStatusResponse = z.object({ connectors: z.array(ConnectorState) });
export type ConnectorStatusResponse = z.infer<typeof ConnectorStatusResponse>;

// POST /api/connectors/:id/connect — start the connect flow. The browser
// redirects to connect_url (GitHub App install page, or a Pipedream Connect
// Link); the callback finishes by writing the workspace_connectors row.
export const StartConnectResponse = z.object({ connect_url: z.url() });
export type StartConnectResponse = z.infer<typeof StartConnectResponse>;

// PATCH /api/connectors/:id — flip the workspace allowlist toggle.
export const SetConnectorEnabledRequest = z.object({ enabled: z.boolean() });
export type SetConnectorEnabledRequest = z.infer<typeof SetConnectorEnabledRequest>;

// Shared OK response for disconnect / enable mutations.
export const ConnectorOkResponse = z.object({ ok: z.literal(true) });
export type ConnectorOkResponse = z.infer<typeof ConnectorOkResponse>;
