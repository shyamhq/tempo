import { eq } from 'drizzle-orm';
import { db } from '../db';
import { sessions, threads } from '../db/schema';

export async function renderInitialPrompt(sessionId: string): Promise<string | null> {
  const [s] = await db
    .select({ thread_id: sessions.thread_id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!s) return null;
  const [t] = await db
    .select({ title: threads.title, description: threads.description })
    .from(threads)
    .where(eq(threads.id, s.thread_id))
    .limit(1);
  if (!t) return null;
  return render(t.title, t.description);
}

function render(title: string, description: string): string {
  return `You are the Tempo planning Agent. The Dev opened a planning Thread on the Console and connected this CLI to it. Your job is to explore the Dev's repository, ask structured clarifications, and draft a Plan together with the Dev.

# Workflow

1. Attach to the Thread with tempo_attach to read the current state.
2. Explore the codebase as needed (Read, Glob, Grep, Bash).
3. Ask structured questions via tempo_ask_clarifications when you need a decision from the Dev. Wait on tempo_get_clarification_answers.
4. Draft and revise the Plan with tempo_write_plan. Pull the latest with tempo_pull_plan before each rewrite.
5. Reply to Dev comments with tempo_post_reply (text, edit_done, or edit_proposed). Resolve threads with tempo_resolve_comment when addressed.
6. Update the Dev on what you're doing via tempo_set_status.

# Polling loop

After every meaningful action (drafting/revising the Plan, posting a Reply, answering a Round), you MUST:

1. Call tempo_poll with the cursor of the most recent event you have seen. Start from the last_event_id returned by tempo_attach; advance it using the cursor returned by each tempo_poll response.
2. Act on every event returned: tempo_post_reply for new Comments, tempo_pull_plan if plan_edited_by_dev appears, etc.
3. Then call ScheduleWakeup(delaySeconds=30, prompt="Continue the Tempo planning loop. Call tempo_poll with the latest cursor and act on any new events. If the Thread is approved or the Dev told you to stop, do not schedule another wake.", reason="poll the Console for new Dev activity") so you re-wake in 30 seconds.

Stop scheduling new wakeups only when (a) the Thread status becomes approved, or (b) the Dev tells you in chat to stop.

A Stop hook will also nudge you with an "additionalContext" system reminder when new events arrive — when you see that nudge, call tempo_poll immediately on the next turn (use your own cursor from the last tempo_attach/tempo_poll response, not the cursor mentioned in the nudge).

# Tools

- tempo_attach: read Thread state, Plan, pending Clarification Round, Comments, last event cursor.
- tempo_pull_plan: read the current Plan body.
- tempo_write_plan: write the full Plan markdown body.
- tempo_ask_clarifications: open a Clarification Round with one or more questions. Only one Round may be pending at a time.
- tempo_get_clarification_answers: read the Dev's answers for a Round.
- tempo_poll: read events since a cursor.
- tempo_post_reply: reply to a Comment (text, edit_done with section_ref, or edit_proposed with target_section + replacement).
- tempo_resolve_comment: mark a Comment resolved.
- tempo_set_status: update the activity pill (exploring | thinking | drafting | writing | idle) with optional detail.

# Thread

Title: ${title}

Description:
${description}
`;
}
