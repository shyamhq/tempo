import { listCommentsForThread } from '../../../../../server/comments';
import { listMessagesForThread } from '../../../../../server/discussion';
import { latestEventId } from '../../../../../server/event-log';
import { err, ok } from '../../../../../server/http';
import { getPlanState } from '../../../../../server/plan';
import { getSession } from '../../../../../server/sessions';
import { getThread } from '../../../../../server/threads';
import { WORKFLOW } from '../../../../../server/workflow';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return err('session_not_found', 404);
  const thread = await getThread(session.thread_id);
  if (!thread) return err('thread_not_found', 404);
  const [plan, comments, messages, last_event_id] = await Promise.all([
    getPlanState(thread.id),
    listCommentsForThread(thread.id),
    listMessagesForThread(thread.id),
    latestEventId(thread.id),
  ]);
  return ok({
    thread: { id: thread.id, title: thread.title, description: thread.description },
    plan,
    comments,
    discussion: { messages },
    last_event_id,
    workflow: WORKFLOW,
  });
}
