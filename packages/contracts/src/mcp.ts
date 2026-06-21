import { z } from 'zod';
import { Tier2ConnectorId } from './connectors';
import { AttachmentId, CommentId, Mention, QuestionInput, ReplyPayload } from './primitives';

export const PullPlanInput = z.object({});

export const UpdateBlockInput = z.object({
  block_id: z.string(),
  html: z.string().min(1).max(200_000),
});

export const AddBlocksInput = z.object({
  reference_id: z.string().nullable(),
  position: z.enum(['before', 'after', 'end']),
  blocks: z.array(z.string()).min(1),
});

export const DeleteBlockInput = z.object({ block_id: z.string() });

// First-time Plan write. The whole Plan as a single HTML document — server
// parses into top-level blocks, assigns ids, and persists in one shot. Legal
// only when the Plan is empty (`body_pm_json IS NULL`); otherwise the route
// returns 409 and the Agent must use the block-level tools so anchored
// Comments survive.
// 200 KB is well above any plausible Plan and well below Next's default body
// limit, so an accidentally-pasted whole-repo dump fails at the contract
// boundary instead of consuming a request.
export const UpdatePlanInput = z.object({ html: z.string().min(1).max(200_000) });

export const PostReplyInput = z.object({
  comment_id: CommentId,
  payload: ReplyPayload,
  attachments: z.array(AttachmentId).max(8).default([]),
  mentions: z.array(Mention).optional(),
});

// One Discussion Message — free-form prose, an inline batch of structured
// questions (server assigns ids on insert), attachments, or any combination.
// Server-side rules: only the Agent may set `questions`; a message with no
// text, no questions, and no attachments is rejected.
// `repos` is Dev-only (enforced server-side by an author-role check, exactly
// as `questions` is Agent-only today). It is intentionally absent from the MCP
// tool description so the Agent never learns about or attempts to set it.
export const PostDiscussionMessageInput = z
  .object({
    text: z.string().min(1).max(8_000).optional(),
    questions: z.array(QuestionInput).min(1).max(10).optional(),
    attachments: z.array(AttachmentId).max(8).default([]),
    mentions: z.array(Mention).optional(),
    repos: z
      .array(z.string().regex(/^[^/\s]+\/[^/\s]+$/))
      .max(10)
      .optional(),
  })
  .refine((m) => m.text !== undefined || m.questions !== undefined || m.attachments.length > 0, {
    message: 'message must carry text, questions, attachments, or any combination',
  });

export const SetThreadMetaInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
});

// Connector tools (Connectors slice). GitHub is tier-1 (native App install);
// the generic tempo_use_integration fronts every tier-2 Pipedream connector.
// Output schemas are permissive on purpose — server.tool only consumes the
// Input `.shape`, so these document the wire shape without constraining the
// pass-through JSON the connector clients return.
export const GithubSearchIssuesInput = z.object({
  query: z.string().min(1),
  repo: z.string().optional(),
});

export const GithubGetIssueInput = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
});

export const GithubGetPullRequestInput = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
});

export const GithubListPullRequestsInput = z.object({
  owner: z.string(),
  repo: z.string(),
  state: z.enum(['open', 'closed', 'all']).default('open'),
});

export const GithubListReposInput = z.object({});

// Discovery for the tier-2 dispatcher. Returns the app's read-only actions —
// their exact Pipedream keys and the props the Agent fills — so the Agent picks
// from the real catalog instead of guessing slugs. `app` is constrained to the
// tier-2 connector ids (GitHub has dedicated tier-1 tools).
export const ListIntegrationActionsInput = z.object({
  app: Tier2ConnectorId,
});

// Generic tier-2 escape hatch. `app` is constrained to the tier-2 connector ids
// (GitHub has dedicated tier-1 tools, so it is rejected here) — this blocks the
// Agent from routing a tier-1 or unknown app through Pipedream. `action` is an
// exact Pipedream component key from tempo_list_integration_actions; the gateway
// rejects any key that isn't a known read action before dispatch.
export const UseIntegrationInput = z.object({
  app: Tier2ConnectorId,
  action: z.string().min(1).max(128),
  params: z.record(z.string(), z.unknown()).default({}),
});
