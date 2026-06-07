import type { Event } from '@tempo/contracts';

// One short nudge per poll batch — just kind counts. Claude pulls full payloads
// via tempo_poll rather than reading them from the injected text.
export function buildNudge(events: Event[]): string | null {
  const kinds = new Map<string, number>();
  for (const ev of events) {
    if (!shouldNotify(ev)) continue;
    kinds.set(ev.kind, (kinds.get(ev.kind) ?? 0) + 1);
  }
  if (kinds.size === 0) return null;
  const summary = Array.from(kinds.entries())
    .map(([k, n]) => (n > 1 ? `${n}× ${k}` : k))
    .join(', ');
  const total = Array.from(kinds.values()).reduce((a, b) => a + b, 0);
  return `[Tempo] ${total} new Console event(s): ${summary}. Call tempo_poll with your last cursor to fetch payloads, then act (tempo_post_reply / tempo_pull_plan / tempo_post_discussion_message as needed).`;
}

function shouldNotify(ev: Event): boolean {
  switch (ev.kind) {
    case 'comment_added':
    case 'plan_edited_by_dev':
    case 'comment_unresolved':
    case 'status_changed':
      return true;
    case 'discussion_message_posted':
      return ev.message.author === 'dev';
    case 'reply_added':
      return ev.reply.author === 'dev';
    // comment_resolved / comment_deleted are informational only — the Dev is
    // closing the loop on a comment, no action needed. Claude will see the
    // change next time it polls for a real reason; no point burning a turn.
    case 'comment_resolved':
    case 'comment_deleted':
    // Agent-originated and meta events are silently skipped — Claude doesn't
    // need to hear about its own tool calls, plan writes, or session pings.
    case 'plan_edited_by_agent':
    case 'agent_tool_use':
    case 'agent_narration':
    case 'agent_todos_updated':
    case 'agent_turn_ended':
    case 'session_connected':
    case 'session_disconnected':
    // Title changes are pure UI sync — the Agent already knows the title (it
    // either set it itself via tempo_set_thread_meta or it pulled it from
    // tempo_attach). Nothing to react to.
    case 'thread_renamed':
      return false;
  }
}
