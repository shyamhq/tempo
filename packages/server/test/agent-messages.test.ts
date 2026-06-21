import { describe, expect, test } from 'bun:test';
import type { TempoUIMessage, UIMessageChunk } from '@tempo/contracts/agent-message';
import { assembleMessage, hasRenderableContent } from '../src/agent-messages';

// A turn as the producers emit it: reasoning, text, a dynamic-tool round-trip
// (input then output under one toolCallId), and a web-search source-url.
const CHUNKS: UIMessageChunk[] = [
  { type: 'start', messageId: 'amsg_test' },
  { type: 'reasoning-start', id: 'r1' },
  { type: 'reasoning-delta', id: 'r1', delta: 'Looking at the repo.' },
  { type: 'reasoning-end', id: 'r1' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Here is the plan.' },
  { type: 'text-end', id: 't1' },
  { type: 'tool-input-start', toolCallId: 'c1', toolName: 'tempo_pull_plan', dynamic: true },
  {
    type: 'tool-input-available',
    toolCallId: 'c1',
    toolName: 'tempo_pull_plan',
    input: {},
    dynamic: true,
  },
  { type: 'tool-output-available', toolCallId: 'c1', output: { blocks: [] }, dynamic: true },
  { type: 'source-url', sourceId: 's1', url: 'https://example.com/docs' },
  { type: 'finish' },
];

describe('assembleMessage', () => {
  test('assembles chunks into reasoning + text + dynamic-tool + source-url parts', async () => {
    const message = await assembleMessage(CHUNKS);
    expect(message?.parts.map((p) => p.type)).toEqual([
      'reasoning',
      'text',
      'dynamic-tool',
      'source-url',
    ]);
    const tool = message?.parts.find((p) => p.type === 'dynamic-tool');
    expect(tool?.state).toBe('output-available');
    expect(tool && 'output' in tool ? tool.output : null).toEqual({ blocks: [] });
  });

  test('returns null for an empty chunk sequence', async () => {
    expect(await assembleMessage([])).toBeNull();
  });
});

describe('hasRenderableContent', () => {
  const msg = (parts: TempoUIMessage['parts']): TempoUIMessage => ({
    id: 'm',
    role: 'assistant',
    parts,
  });

  test('false for an empty turn (no text/tools)', async () => {
    const empty = await assembleMessage([
      { type: 'start', messageId: 'm' },
      { type: 'start-step' },
      { type: 'finish-step' },
      { type: 'finish' },
    ]);
    expect(empty?.parts).toEqual([]);
    expect(empty && hasRenderableContent(empty)).toBe(false);
  });

  test('false for blank text', () => {
    expect(hasRenderableContent(msg([{ type: 'step-start' }, { type: 'text', text: '  ' }]))).toBe(
      false,
    );
  });

  test('true when a tool part is present', () => {
    expect(
      hasRenderableContent(
        msg([
          { type: 'step-start' },
          {
            type: 'dynamic-tool',
            toolName: 'x',
            toolCallId: 'c',
            state: 'output-available',
            input: {},
            output: {},
          },
        ]),
      ),
    ).toBe(true);
  });
});
