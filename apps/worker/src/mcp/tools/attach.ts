import type {
  AgentPlanState,
  Comment,
  DiscussionMessage,
  Question,
  Reply,
  ThreadStatus,
} from '@tempo/contracts';
import type { AttachOutput } from '@tempo/contracts/mcp';
import { db } from '@tempo/db/client';
import { newEventId } from '@tempo/db/ids';
import {
  comments,
  discussion_messages,
  events,
  plans,
  replies,
  sessions,
  threads,
} from '@tempo/db/schema';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import type { z } from 'zod';
import { assertMembership, getSessionByMcpId, NotAMemberError } from '../../server/auth-lookup';
import type { AuthContext } from '../transport';
// TODO(slice-1b-review): WORKFLOW is inlined here pending Dev decision per judge note 3.
// Options presented in the slice-1b implementation report; Dev resolves before 1c.
import { WORKFLOW } from './workflow-stub';

// ULID alphabet (Crockford base32, uppercase) — matches Console's ses_${ulid()} format.
const ulidAlphabet = customAlphabet('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 26);
const newSessionId = () => `ses_${ulidAlphabet()}`;

type AttachResult = z.infer<typeof AttachOutput>;

// Reads the six data sources that Console's GET /api/sessions/[id]/state reads,
// using the same @tempo/db queries. Returns the identical AttachOutput shape.
//
// thread_id is the attach input (per AttachInput from contracts).
// auth carries the caller's identity. For 'cli' callers (sk_user_*) we resolve
// workspace via assertMembership(userId, threadId) and 403 if not a Member.
// For 'agent' (sk_agent_*) and 'browser' (Clerk JWT) callers we use the
// workspaceId already resolved in middleware and verify thread isolation.
// mcpSessionId is the UUID assigned by the MCP transport layer — used to
// establish a sticky session row so reconnects resume the same session.
export async function runAttach(
  threadId: string,
  auth: AuthContext,
  mcpSessionId: string | undefined,
): Promise<AttachResult | { error: string }> {
  // Resolve thread.
  const [thread] = await db
    .select({
      id: threads.id,
      title: threads.title,
      description: threads.description,
      status: threads.status,
      workspace_id: threads.workspace_id,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) return { error: 'thread_not_found' };

  // Auth check, by source.
  if (auth.source === 'cli') {
    try {
      await assertMembership(auth.userId, thread.id);
    } catch (err) {
      if (err instanceof NotAMemberError) return { error: 'not_a_member' };
      throw err;
    }
  } else {
    // agent + browser both carry workspaceId in the AuthContext.
    // For 'agent' it's required; for 'browser' it's only set when the Clerk
    // JWT had an active org claim — missing means "no active org → reject".
    if (!auth.workspaceId || thread.workspace_id !== auth.workspaceId) {
      return { error: 'unauthorized' };
    }
  }

  // Sticky session: find or create a sessions row keyed by MCP session UUID.
  // This allows the Agent to reconnect (e.g. after a network blip) and resume
  // the same logical session without re-creating a row each time.
  if (mcpSessionId) {
    const existing = await getSessionByMcpId(mcpSessionId, thread.id);
    if (!existing) {
      // The partial unique index on (mcp_session_id) WHERE NOT NULL turns the
      // concurrent-reconnect race into a clean no-op for the loser.
      await db
        .insert(sessions)
        .values({
          id: newSessionId(),
          thread_id: thread.id,
          mcp_session_id: mcpSessionId,
          status: 'connected',
        })
        .onConflictDoNothing();
    }
  }

  const [plan, threadComments, messages, last_event_id] = await Promise.all([
    getPlanState(thread.id, thread.status),
    listCommentsForThread(thread.id),
    listMessagesForThread(thread.id),
    latestEventId(thread.id),
  ]);

  return {
    thread: { id: thread.id, title: thread.title, description: thread.description },
    plan,
    comments: threadComments,
    discussion: { messages },
    last_event_id,
    workflow: WORKFLOW,
  };
}

// ---------------------------------------------------------------------------
// DB read helpers — mirroring Console server modules exactly
// (Console: server/plan.ts#getPlanState)

async function getPlanState(threadId: string, threadStatus: ThreadStatus): Promise<AgentPlanState> {
  const [row] = await db
    .select({
      body_pm_json: plans.body_pm_json,
      updated_at: plans.updated_at,
      updated_by: plans.updated_by,
    })
    .from(plans)
    .where(eq(plans.thread_id, threadId))
    .limit(1);
  return {
    status: threadStatus,
    updated_at: row?.updated_at?.toISOString() ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

// (Console: server/event-log.ts#latestEventId)
async function latestEventId(threadId: string): Promise<string> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.thread_id, threadId))
    .orderBy(desc(events.id))
    .limit(1);
  return rows[0]?.id ?? newEventId(0);
}

// (Console: server/comments.ts#listCommentsForThread)
async function listCommentsForThread(threadId: string): Promise<Comment[]> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.thread_id, threadId))
    .orderBy(asc(comments.created_at), asc(comments.id));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const replyRows = await db
    .select()
    .from(replies)
    .where(inArray(replies.comment_id, ids))
    .orderBy(asc(replies.created_at), asc(replies.id));

  // Attachments on replies — sign URLs for each ref (same as Console).
  // Worker reads R2 credentials from env for signing; 1b has no R2 env wired,
  // so attachment URL signing is omitted here and replies carry empty attachment
  // arrays. This is safe: tempo_attach is primarily for planning state; images
  // arrive via tempo_poll events. If attachments are needed in attach, wire R2
  // env vars and call signGetUrl here.
  const grouped = new Map<string, typeof replyRows>();
  for (const r of replyRows) {
    const arr = grouped.get(r.comment_id) ?? [];
    arr.push(r);
    grouped.set(r.comment_id, arr);
  }

  return rows.map((row) => shapeComment(row, grouped.get(row.id) ?? []));
}

// (Console: server/discussion.ts#listMessagesForThread)
async function listMessagesForThread(threadId: string): Promise<DiscussionMessage[]> {
  const rows = await db
    .select()
    .from(discussion_messages)
    .where(eq(discussion_messages.thread_id, threadId))
    .orderBy(asc(discussion_messages.created_at), asc(discussion_messages.id));
  // Attachment signing omitted in 1b (see note in listCommentsForThread above).
  return rows.map((row) => shapeMessage(row));
}

// ---------------------------------------------------------------------------
// Row shapers — same field mapping as Console

function shapeComment(
  row: typeof comments.$inferSelect,
  replyRows: (typeof replies.$inferSelect)[],
): Comment {
  return {
    id: row.id,
    thread_id: row.thread_id,
    plan_quote: row.plan_quote,
    plan_context: row.plan_context,
    anchor_block_id: row.anchor_block_id,
    resolved_by: row.resolved_by,
    created_at: row.created_at.toISOString(),
    replies: replyRows.map(shapeReply),
  };
}

function shapeReply(row: typeof replies.$inferSelect): Reply {
  return {
    id: row.id,
    comment_id: row.comment_id,
    author: row.author,
    payload: { text: row.text ?? '' },
    attachments: [],
    created_at: row.created_at.toISOString(),
  };
}

function shapeMessage(row: typeof discussion_messages.$inferSelect): DiscussionMessage {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author: row.author,
    text: row.text,
    questions: row.questions as Question[] | null,
    attachments: [],
    created_at: row.created_at.toISOString(),
  };
}
