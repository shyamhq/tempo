import { describe, expect, test } from 'bun:test';
import type { UIMessageChunk } from 'ai';
import { pumpChunks } from '../../src/hosted/agent-tools';

// pumpChunks batches a turn's UIMessageChunk stream to a sink (CHUNK_BATCH = 16),
// in order, flushing the remainder at stream end.
function streamOf(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}
const delta = (i: number): UIMessageChunk => ({ type: 'text-delta', id: 't0', delta: `${i}` });

describe('pumpChunks', () => {
  test('flushes full batches of 16 then the remainder', async () => {
    const batches: number[] = [];
    const chunks = Array.from({ length: 20 }, (_, i) => delta(i));
    await pumpChunks(streamOf(chunks), async (b) => {
      batches.push(b.length);
    });
    expect(batches).toEqual([16, 4]);
  });

  test('a sub-batch stream flushes once', async () => {
    const batches: number[] = [];
    await pumpChunks(streamOf([delta(0), delta(1)]), async (b) => {
      batches.push(b.length);
    });
    expect(batches).toEqual([2]);
  });

  test('an empty stream never calls the sink', async () => {
    let called = false;
    await pumpChunks(streamOf([]), async () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});
