import { describe, expect, test } from 'bun:test';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { NotificationMapper } from '../../src/acp/notifications';

// Minimal notification builder — the mapper only reads the fields below.
function note(update: Record<string, unknown>): SessionNotification {
  return { sessionId: 'sess_1', update } as unknown as SessionNotification;
}
const text = (t: string) =>
  note({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
const thought = (t: string) =>
  note({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: t } });
const toolCall = (toolCallId: string, title: string, rawInput: unknown) =>
  note({ sessionUpdate: 'tool_call', toolCallId, title, rawInput });
const toolDone = (toolCallId: string, rawOutput: unknown) =>
  note({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput });

describe('NotificationMapper', () => {
  test('startTurn emits a start chunk carrying the turn id', () => {
    expect(new NotificationMapper().startTurn('amsg_1')).toEqual([
      { type: 'start', messageId: 'amsg_1' },
    ]);
  });

  test('streams text deltas and closes the run on a kind switch', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    expect(m.handle(text('Hel'))).toEqual([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'Hel' },
    ]);
    expect(m.handle(text('lo'))).toEqual([{ type: 'text-delta', id: 't0', delta: 'lo' }]);
    expect(m.handle(thought('hmm'))).toEqual([
      { type: 'text-end', id: 't0' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'hmm' },
    ]);
  });

  test('a tool round-trips input -> output under one toolCallId', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    m.handle(text('running'));
    expect(m.handle(toolCall('c1', 'Bash', { command: 'ls' }))).toEqual([
      { type: 'text-end', id: 't0' },
      { type: 'tool-input-start', toolCallId: 'c1', toolName: 'Bash', dynamic: true },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'Bash',
        input: { command: 'ls' },
        dynamic: true,
      },
    ]);
    expect(m.handle(toolDone('c1', { stdout: 'src' }))).toEqual([
      { type: 'tool-output-available', toolCallId: 'c1', output: { stdout: 'src' }, dynamic: true },
    ]);
  });

  test('defers input until the refining update carries it; reads the real name from _meta', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    // Streamed tool_call: empty input, generic title, real name in _meta.
    expect(
      m.handle(
        note({
          sessionUpdate: 'tool_call',
          toolCallId: 'c1',
          title: 'Terminal',
          _meta: { claudeCode: { toolName: 'Bash' } },
        }),
      ),
    ).toEqual([{ type: 'tool-input-start', toolCallId: 'c1', toolName: 'Bash', dynamic: true }]);
    // Refining update: the full input arrives here.
    expect(
      m.handle(
        note({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'c1',
          rawInput: { command: 'ls' },
          _meta: { claudeCode: { toolName: 'Bash' } },
        }),
      ),
    ).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'Bash',
        input: { command: 'ls' },
        dynamic: true,
      },
    ]);
    // Completion: input already sent, just the output.
    expect(
      m.handle(
        note({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'c1',
          status: 'completed',
          rawOutput: { stdout: 'x' },
        }),
      ),
    ).toEqual([
      { type: 'tool-output-available', toolCallId: 'c1', output: { stdout: 'x' }, dynamic: true },
    ]);
  });

  test('synthesizes an empty input-available before output if input never arrived', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    m.handle(note({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Terminal' }));
    expect(
      m.handle(
        note({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'c1',
          status: 'completed',
          rawOutput: 'done',
        }),
      ),
    ).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'tool',
        input: {},
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'done', dynamic: true },
    ]);
  });

  test('drops output for a tool id we never issued input for', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    // An orphan output would make readUIMessageStream throw and lose the turn.
    expect(m.handle(toolDone('ghost', { x: 1 }))).toEqual([]);
  });

  test('drops plan updates — working todos are not a message part', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    expect(m.handle(note({ sessionUpdate: 'plan', entries: [] }))).toEqual([]);
  });

  test('endTurn closes the open part and finishes', () => {
    const m = new NotificationMapper();
    m.startTurn('amsg_1');
    m.handle(text('hi'));
    expect(m.endTurn()).toEqual([{ type: 'text-end', id: 't0' }, { type: 'finish' }]);
  });
});
