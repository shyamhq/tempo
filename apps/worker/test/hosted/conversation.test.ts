import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { installTempoServerMock } from '../_mocks/tempo-server';

// Coordination-only coverage for the in-process conversation runtime: the Redis
// turn lock (second concurrent caller no-ops; owner CAS release) and the
// re-drain loop (keeps draining while events present, stops when empty). The
// streamText turn itself is stubbed — we assert the loop's control flow and the
// lock lifecycle, not a real LLM call.

// Mock @tempo/server (the lock + drain + hydration boundary) BEFORE importing
// the SUT so its imports bind to the mock. One shared registration (bun caches
// the first); the handle controls the same instances.
const server = installTempoServerMock();

// Stub `ai.streamText` so no LLM call is made. `tool` / `stepCountIs` stay real
// (buildToolset uses tool()). Each call records, then resolves consumeStream and
// totalUsage so runStreamTurn completes deterministically.
const streamTextCalls: unknown[] = [];
mock.module('ai', () => {
  const real = require('ai');
  return {
    ...real,
    streamText: (opts: unknown) => {
      streamTextCalls.push(opts);
      return {
        consumeStream: async () => {},
        totalUsage: Promise.resolve({
          inputTokens: 0,
          outputTokens: 0,
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
        }),
        response: Promise.resolve({ messages: [] }),
      };
    },
  };
});

const { runConversationTurn } = await import('../../src/hosted/conversation');

const THREAD = 'thr_01234567890123456789ABCDEF';
const EV = (seq: number) => ({ id: `evt_2026061900000${seq}`, kind: 'discussion_message_posted' });

beforeEach(() => {
  server.reset();
  streamTextCalls.length = 0;
});

describe('runConversationTurn — turn lock', () => {
  test('a second concurrent caller no-ops when the lock is held elsewhere', async () => {
    server.acquireTurnLock.mockResolvedValueOnce(false);
    server.getEventsSinceLastTurn.mockResolvedValue([EV(1)]);

    await runConversationTurn(THREAD);

    // Lock not acquired → no drain, no turn, and crucially no release (we never
    // owned it, so a release would evict the real holder's lock).
    expect(server.getEventsSinceLastTurn).not.toHaveBeenCalled();
    expect(streamTextCalls).toHaveLength(0);
    expect(server.releaseTurnLock).not.toHaveBeenCalled();
  });

  test('the owner releases its lock with the SAME nonce it acquired', async () => {
    server.acquireTurnLock.mockResolvedValue(true);
    server.getEventsSinceLastTurn.mockResolvedValue([]); // nothing to drain

    await runConversationTurn(THREAD);

    expect(server.acquireTurnLock).toHaveBeenCalledTimes(1);
    expect(server.releaseTurnLock).toHaveBeenCalledTimes(1);
    const acquiredNonce = server.acquireTurnLock.mock.calls[0]?.[1];
    const releasedNonce = server.releaseTurnLock.mock.calls[0]?.[1];
    expect(typeof acquiredNonce).toBe('string');
    expect(releasedNonce).toBe(acquiredNonce);
  });

  test('the lock is released even when a turn throws', async () => {
    server.acquireTurnLock.mockResolvedValue(true);
    server.getEventsSinceLastTurn.mockResolvedValue([EV(1)]);
    // getTurnHydration is on the turn path; make it throw to simulate a turn fault.
    server.getTurnHydration.mockRejectedValueOnce(new Error('boom'));

    await runConversationTurn(THREAD); // must not throw into the wake handler

    expect(server.releaseTurnLock).toHaveBeenCalledTimes(1);
  });
});

describe('runConversationTurn — coalescing re-drain loop', () => {
  test('keeps draining while events are present, stops when empty', async () => {
    server.acquireTurnLock.mockResolvedValue(true);
    // Three non-empty drains, then empty → exactly three turns, then break.
    server.getEventsSinceLastTurn
      .mockResolvedValueOnce([EV(1)])
      .mockResolvedValueOnce([EV(2)])
      .mockResolvedValueOnce([EV(3)])
      .mockResolvedValue([]);

    await runConversationTurn(THREAD);

    expect(server.getEventsSinceLastTurn).toHaveBeenCalledTimes(4); // 3 with events + 1 empty
    expect(streamTextCalls).toHaveLength(3);
    expect(server.appendEvent).toHaveBeenCalled(); // agent_turn_ended per turn
  });

  test('runs zero turns when the very first drain is empty', async () => {
    server.acquireTurnLock.mockResolvedValue(true);
    server.getEventsSinceLastTurn.mockResolvedValue([]);

    await runConversationTurn(THREAD);

    expect(server.getEventsSinceLastTurn).toHaveBeenCalledTimes(1);
    expect(streamTextCalls).toHaveLength(0);
    expect(server.releaseTurnLock).toHaveBeenCalledTimes(1);
  });

  test('a missing thread releases the lock and runs no turn', async () => {
    server.acquireTurnLock.mockResolvedValue(true);
    server.getThread.mockResolvedValueOnce(null);
    server.getEventsSinceLastTurn.mockResolvedValue([EV(1)]);

    await runConversationTurn(THREAD);

    expect(streamTextCalls).toHaveLength(0);
    expect(server.releaseTurnLock).toHaveBeenCalledTimes(1);
  });
});
