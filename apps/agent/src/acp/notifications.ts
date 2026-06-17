import type { AgentEventRequest } from '@tempo/contracts/http';
import type { SessionNotification } from '@zed-industries/agent-client-protocol';

type Event = AgentEventRequest['event'];

type TextKind = 'narration' | 'thought';

// Maps ACP session/update notifications into Worker AgentEvent payloads.
// Holds the per-session state (streamed text buffer, tool-name lookup) so
// session.ts can stay thin. One instance per AcpSession.
export class NotificationMapper {
  // Single tagged buffer so interleaved narration/thought chunks preserve
  // arrival order on flush — two parallel arrays would emit all narration
  // first then all thought, reversing what the model actually produced.
  private chunks: { kind: TextKind; text: string }[] = [];
  // tool_call_update only carries toolCallId, never the tool name — so we
  // remember the name at tool_call time to attach it to failure events.
  // Entries are cleared on every tool_call_update so the Map can't outgrow
  // the number of in-flight tools (typically 1).
  private toolNames = new Map<string, string>();

  handle(n: SessionNotification): Event[] {
    const u = n.update;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        if (u.content.type === 'text')
          this.chunks.push({ kind: 'narration', text: u.content.text });
        return [];

      case 'agent_thought_chunk':
        if (u.content.type === 'text') this.chunks.push({ kind: 'thought', text: u.content.text });
        return [];

      case 'tool_call': {
        const tool = (u.title || u.kind || 'tool').slice(0, 64);
        this.toolNames.set(u.toolCallId, tool);
        return [
          ...this.flushText(),
          { kind: 'agent_tool_use', tool, summary: summarizeInput(u.rawInput).slice(0, 200) },
        ];
      }

      case 'tool_call_update': {
        // Only failures surface to the Console. Success is implicit — the
        // chip already says "tool ran." ponytail: if running/done states
        // become user-visibly missed, add them here.
        const tool = this.toolNames.get(u.toolCallId) ?? 'tool';
        this.toolNames.delete(u.toolCallId);
        if (u.status !== 'failed') return [];
        return [{ kind: 'agent_tool_failed', tool }];
      }

      case 'plan': {
        const todos = u.entries.slice(0, 50).map((e) => ({
          content: e.content.slice(0, 500),
          status: planStatus(e.status),
        }));
        return [{ kind: 'agent_todos_updated', todos }];
      }

      case 'current_mode_update':
        return [{ kind: 'agent_mode_changed', mode_id: u.currentModeId.slice(0, 64) }];

      // user_message_chunk, available_commands_update, and any future variant
      // are intentionally ignored.
      default:
        return [];
    }
  }

  // Drain whatever text is buffered. Consecutive same-kind chunks merge
  // into one event; a kind switch emits the previous run and starts fresh.
  // Called at turn end and before each tool-call event so chip order
  // matches what the model produced.
  flushText(): Event[] {
    if (this.chunks.length === 0) return [];
    const events: Event[] = [];
    let run: { kind: TextKind; text: string } | null = null;
    for (const c of this.chunks) {
      if (run && run.kind === c.kind) {
        run.text += c.text;
      } else {
        if (run) events.push(textEvent(run));
        run = { kind: c.kind, text: c.text };
      }
    }
    if (run) events.push(textEvent(run));
    this.chunks = [];
    return events;
  }
}

function textEvent(r: { kind: TextKind; text: string }): Event {
  const text = r.text.slice(0, 8000);
  return r.kind === 'narration'
    ? { kind: 'agent_narration', text }
    : { kind: 'agent_thought', text };
}

function planStatus(s: string): 'pending' | 'in_progress' | 'completed' {
  return s === 'in_progress' || s === 'completed' ? s : 'pending';
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'description']) {
    const v = obj[key];
    if (typeof v === 'string') return v;
  }
  return '';
}
