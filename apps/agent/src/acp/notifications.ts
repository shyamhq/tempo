import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { UIMessageChunk } from '@tempo/contracts';

// Maps ACP session/update notifications to AI SDK UIMessageChunks — the same wire
// shape the hosted runtime emits, so both converge on one persisted UIMessage per
// turn. Streams deltas live (no buffer-and-flush-at-end). Tools are emitted as
// `dynamic-tool` parts: the ACP stream carries no input schema to distinguish
// static `tool-*` tools. One instance per AcpSession; one open run at a time.
export class NotificationMapper {
  private openText: string | null = null;
  private openReasoning: string | null = null;
  private seq = 0;
  // Tool ids we've started. An output frame for an unknown id would make
  // readUIMessageStream throw and drop the whole turn, so we skip orphans.
  private tools = new Set<string>();
  // Tool ids we've emitted `tool-input-available` for. The adapter streams the
  // tool_call with empty input, then refines it with the full rawInput on a
  // tool_call_update — so input-available is deferred until the input arrives.
  private toolInputSent = new Set<string>();

  startTurn(turn: string): UIMessageChunk[] {
    this.openText = null;
    this.openReasoning = null;
    this.seq = 0;
    this.tools.clear();
    this.toolInputSent.clear();
    return [{ type: 'start', messageId: turn }];
  }

  handle(n: SessionNotification): UIMessageChunk[] {
    const u = n.update;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        if (u.content.type !== 'text') return [];
        const out = this.closeReasoning();
        if (!this.openText) {
          this.openText = `t${this.seq++}`;
          out.push({ type: 'text-start', id: this.openText });
        }
        out.push({ type: 'text-delta', id: this.openText, delta: u.content.text });
        return out;
      }
      case 'agent_thought_chunk': {
        if (u.content.type !== 'text') return [];
        const out = this.closeText();
        if (!this.openReasoning) {
          this.openReasoning = `r${this.seq++}`;
          out.push({ type: 'reasoning-start', id: this.openReasoning });
        }
        out.push({ type: 'reasoning-delta', id: this.openReasoning, delta: u.content.text });
        return out;
      }
      case 'tool_call': {
        const out = this.closeOpen();
        this.tools.add(u.toolCallId);
        const toolName = toolNameOf(u);
        out.push({ type: 'tool-input-start', toolCallId: u.toolCallId, toolName, dynamic: true });
        // The adapter usually streams the call with empty input and refines it on
        // a later update — only emit input-available once we actually have input.
        if (hasInput(u.rawInput)) {
          out.push({
            type: 'tool-input-available',
            toolCallId: u.toolCallId,
            toolName,
            input: u.rawInput,
            dynamic: true,
          });
          this.toolInputSent.add(u.toolCallId);
        }
        return out;
      }
      case 'tool_call_update': {
        if (!this.tools.has(u.toolCallId)) return [];
        const out: UIMessageChunk[] = [];
        // The refining update carries the full rawInput (and the real tool name).
        if (!this.toolInputSent.has(u.toolCallId) && hasInput(u.rawInput)) {
          out.push({
            type: 'tool-input-available',
            toolCallId: u.toolCallId,
            toolName: toolNameOf(u),
            input: u.rawInput,
            dynamic: true,
          });
          this.toolInputSent.add(u.toolCallId);
        }
        if (u.status === 'completed' || u.status === 'failed') {
          // readUIMessageStream requires input-available before any output frame.
          if (!this.toolInputSent.has(u.toolCallId)) {
            out.push({
              type: 'tool-input-available',
              toolCallId: u.toolCallId,
              toolName: toolNameOf(u),
              input: {},
              dynamic: true,
            });
            this.toolInputSent.add(u.toolCallId);
          }
          out.push(
            u.status === 'completed'
              ? {
                  type: 'tool-output-available',
                  toolCallId: u.toolCallId,
                  output: u.rawOutput ?? u.content ?? null,
                  dynamic: true,
                }
              : {
                  type: 'tool-output-error',
                  toolCallId: u.toolCallId,
                  errorText: typeof u.rawOutput === 'string' ? u.rawOutput : 'Tool call failed',
                  dynamic: true,
                },
          );
        }
        return out;
      }
      // plan/plan_update (working todos — not a message part), current_mode_update,
      // available_commands_update, user_message_chunk: intentionally dropped.
      default:
        return [];
    }
  }

  endTurn(): UIMessageChunk[] {
    return [...this.closeOpen(), { type: 'finish' }];
  }

  private closeText(): UIMessageChunk[] {
    if (!this.openText) return [];
    const id = this.openText;
    this.openText = null;
    return [{ type: 'text-end', id }];
  }

  private closeReasoning(): UIMessageChunk[] {
    if (!this.openReasoning) return [];
    const id = this.openReasoning;
    this.openReasoning = null;
    return [{ type: 'reasoning-end', id }];
  }

  private closeOpen(): UIMessageChunk[] {
    return [...this.closeText(), ...this.closeReasoning()];
  }
}

// The real tool name. Claude Code carries it on `_meta.claudeCode.toolName`
// (e.g. "Bash", "Glob", "mcp__tempo__tempo_pull_plan"); `title` is a display
// string (often the command, or generic "Terminal"), so prefer the meta name.
function toolNameOf(u: { _meta?: unknown; title?: string | null }): string {
  const meta = (u._meta as { claudeCode?: { toolName?: unknown } } | null | undefined)?.claudeCode
    ?.toolName;
  const name = typeof meta === 'string' ? meta : (u.title ?? '');
  return (name || 'tool').slice(0, 64);
}

function hasInput(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'object') return Object.keys(raw as object).length > 0;
  return true;
}
