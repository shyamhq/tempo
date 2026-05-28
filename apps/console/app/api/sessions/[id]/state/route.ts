import { listCommentsForThread } from '../../../../../server/comments';
import { latestEventId } from '../../../../../server/event-log';
import { err, ok } from '../../../../../server/http';
import { getPlan } from '../../../../../server/plan';
import { getPendingRound } from '../../../../../server/rounds';
import { getSession } from '../../../../../server/sessions';
import { getThread } from '../../../../../server/threads';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return err('session_not_found', 404);
  const thread = await getThread(session.thread_id);
  if (!thread) return err('thread_not_found', 404);
  const [plan, pending_round, { active }, last_event_id] = await Promise.all([
    getPlan(thread.id),
    getPendingRound(thread.id),
    listCommentsForThread(thread.id),
    latestEventId(thread.id),
  ]);
  return ok({
    thread: { id: thread.id, title: thread.title, description: thread.description },
    plan,
    pending_round,
    comments: active,
    last_event_id,
  });
}
