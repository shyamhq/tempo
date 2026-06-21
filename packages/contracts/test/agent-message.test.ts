import { describe, expect, test } from 'bun:test';
import type { AgentChunkFrame, TempoUIMessage } from '../src/agent-message';
import { validateTempoMessages } from '../src/agent-message';
import { isEmptyAgentResponse, stripEmptyAgentText } from '../src/agent-text';
import { shouldDeliverToAgent } from '../src/events';

// One sample message exercising every part the renderer must handle: text,
// reasoning, a dynamic-tool (MCP) round-trip, a static tool-* (Bash) round-trip,
// and a source-url citation. If the SDK ever tightens its schema, this fails.
const SAMPLE: TempoUIMessage = {
  id: 'msg_1',
  role: 'assistant',
  parts: [
    { type: 'reasoning', text: 'Thinking about the repo layout.', state: 'done' },
    { type: 'text', text: 'Here is the plan.', state: 'done' },
    {
      type: 'dynamic-tool',
      toolName: 'tempo_post_discussion_message',
      toolCallId: 'call_mcp_1',
      state: 'output-available',
      input: { text: 'hello' },
      output: { ok: true },
    },
    {
      type: 'tool-Bash',
      toolCallId: 'call_bash_1',
      state: 'output-available',
      input: { command: 'ls' },
      output: { stdout: 'src\n' },
    },
    { type: 'source-url', sourceId: 'src_1', url: 'https://example.com/docs' },
  ],
};

describe('TempoUIMessage', () => {
  test('round-trips through JSON + validateTempoMessages with all part types', async () => {
    const wire = JSON.parse(JSON.stringify([SAMPLE])) as unknown;
    const [msg] = await validateTempoMessages(wire);
    expect(msg?.parts.map((p) => p.type)).toEqual([
      'reasoning',
      'text',
      'dynamic-tool',
      'tool-Bash',
      'source-url',
    ]);
    const tool = msg?.parts.find((p) => p.type === 'dynamic-tool');
    expect(tool && 'output' in tool ? tool.output : null).toEqual({ ok: true });
  });

  test('rejects a structurally invalid message', () => {
    expect(validateTempoMessages([{ role: 'assistant' }])).rejects.toThrow();
  });
});

describe('shouldDeliverToAgent', () => {
  test('agent_chunk is browser-only — excluded from agent delivery', () => {
    const frame: AgentChunkFrame = {
      kind: 'agent_chunk',
      turn: 'turn_1',
      chunk: { type: 'text-delta', id: 'msg_1', delta: 'hi' },
    };
    expect(shouldDeliverToAgent(frame)).toBe(false);
  });
});

describe('empty-response placeholders', () => {
  test('detects both providers’ empty-turn placeholder text', () => {
    expect(isEmptyAgentResponse("(Empty response: {'content': []})")).toBe(true);
    expect(isEmptyAgentResponse('(Empty response: {"annotations": [{"type":"success"}]})')).toBe(
      true,
    );
    expect(isEmptyAgentResponse('I drafted a plan.')).toBe(false);
  });

  test('strips placeholder text parts, keeps real content', () => {
    const msg: TempoUIMessage = {
      id: 'm',
      role: 'assistant',
      parts: [
        { type: 'text', text: '(Empty response: {})' },
        {
          type: 'dynamic-tool',
          toolName: 'tempo_post_discussion_message',
          toolCallId: 'c1',
          state: 'output-available',
          input: {},
          output: { ok: true },
        },
      ],
    };
    expect(stripEmptyAgentText(msg).parts.map((p) => p.type)).toEqual(['dynamic-tool']);
  });
});
