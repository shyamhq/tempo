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
    case 'proposal_decided':
    case 'comment_unresolved':
    case 'status_changed':
      return true;
    case 'discussion_message_posted':
      return ev.message.author === 'dev';
    // comment_resolved is informational only — the Dev is saying "I'm done
    // with this, no action needed." Claude will see the resolution next time
    // it polls for a real reason; no point burning a turn here.
    case 'comment_resolved':
    // Agent-originated and meta events are silently skipped — Claude doesn't
    // need to hear about its own tool calls, plan writes, or session pings.
    case 'reply_added':
    case 'plan_edited_by_agent':
    case 'agent_tool_use':
    case 'agent_todos_updated':
    case 'session_connected':
    case 'session_disconnected':
      return false;
  }
}
