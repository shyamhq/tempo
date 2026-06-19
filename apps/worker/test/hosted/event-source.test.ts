import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// event-source.ts uses global fetch — mock it before importing the module.
// bun:test resets mock.module between files, so we install once per file.

let fetchMock: ReturnType<typeof mock>;

// Valid IDs per primitives.ts regexes:
//   EventId  = /^evt_[0-9]{14,}$/
//   CommentId = /^cmt_[A-Z0-9]{26}$/
//   ReplyId  = /^rep_[A-Z0-9]{26}$/
//   MessageId = /^msg_[A-Z0-9]{26}$/
//   ThreadId = /^thr_[A-Z0-9]{26}$/
const EVT_1 = 'evt_20260619000001';
const EVT_2 = 'evt_20260619000002';
const EVT_3 = 'evt_20260619000003';
const EVT_4 = 'evt_20260619000004';
const EVT_5 = 'evt_20260619000005';
const EVT_6 = 'evt_20260619000006';
const CMT_1 = 'cmt_01234567890123456789ABCDEF';
const REP_HUMAN = 'rep_0123456789012345HUMAN01234';
const REP_AGENT = 'rep_0123456789012345AGENT01234';
const MSG_HUMAN = 'msg_01234567890123HUMANMSG0001';
const MSG_AGENT = 'msg_01234567890123AGENTMSG0001';
const THR_1 = 'thr_01234567890123456789ABCDEF';
const TS = '2026-06-19T00:00:00.000Z';

function makeSseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < frames.length) {
        // biome-ignore lint/style/noNonNullAssertion: i is bounds-checked above
        ctrl.enqueue(encoder.encode(frames[i++]!));
      } else {
        ctrl.close();
      }
    },
  });
}

function sseFrame(kind: string, data: unknown): string {
  return `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
}

const COMMENT_ADDED_EVENT = {
  id: EVT_1,
  created_at: TS,
  kind: 'comment_added',
  comment: {
    id: CMT_1,
    thread_id: THR_1,
    plan_quote: '',
    plan_context: '',
    anchor_block_id: null,
    author_user_id: 'usr_01',
    resolved_by_user_id: null,
    created_at: TS,
    replies: [],
  },
};

const AGENT_NARRATION_EVENT = {
  id: EVT_2,
  created_at: TS,
  kind: 'agent_narration',
  text: 'thinking...',
};

const REPLY_ADDED_HUMAN = {
  id: EVT_3,
  created_at: TS,
  kind: 'reply_added',
  comment_id: CMT_1,
  reply: {
    id: REP_HUMAN,
    comment_id: CMT_1,
    author_user_id: 'usr_01', // human author — shouldWake = true
    payload: { text: 'follow-up' },
    attachments: [],
    mentions: [],
    created_at: TS,
  },
};

const REPLY_ADDED_AGENT = {
  id: EVT_4,
  created_at: TS,
  kind: 'reply_added',
  comment_id: CMT_1,
  reply: {
    id: REP_AGENT,
    comment_id: CMT_1,
    author_user_id: null, // agent reply — shouldWake = false
    payload: { text: 'agent response' },
    attachments: [],
    mentions: [],
    created_at: TS,
  },
};

const DISCUSSION_HUMAN = {
  id: EVT_5,
  created_at: TS,
  kind: 'discussion_message_posted',
  message: {
    id: MSG_HUMAN,
    thread_id: THR_1,
    author_user_id: 'usr_01', // human — shouldWake = true
    text: 'looks good',
    questions: null,
    attachments: [],
    mentions: [],
    created_at: TS,
  },
};

const DISCUSSION_AGENT = {
  id: EVT_6,
  created_at: TS,
  kind: 'discussion_message_posted',
  message: {
    id: MSG_AGENT,
    thread_id: THR_1,
    author_user_id: null, // agent — shouldWake = false
    text: 'my analysis',
    questions: null,
    attachments: [],
    mentions: [],
    created_at: TS,
  },
};

beforeEach(() => {
  fetchMock = mock(async () => {
    throw new Error('fetch not configured for this test');
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetch;
});

// Import after mocking global fetch so the module uses our mock.
const { wakeEvents } = await import('../../src/hosted/event-source');

describe('wakeEvents — SSE frame parsing', () => {
  test('yields comment_added events (always a wake)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: makeSseBody([sseFrame('comment_added', COMMENT_ADDED_EVENT)]),
    });

    const ctrl = new AbortController();
    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
      ctrl.abort();
    }

    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe('comment_added');
  });

  test('filters out agent_narration (not a wake kind)', async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      setTimeout(() => ctrl.abort(), 10);
      return { ok: true, body: makeSseBody([sseFrame('agent_narration', AGENT_NARRATION_EVENT)]) };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
    }

    expect(events).toHaveLength(0);
  });

  test('filters agent-authored reply_added (author_user_id = null)', async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      setTimeout(() => ctrl.abort(), 10);
      return { ok: true, body: makeSseBody([sseFrame('reply_added', REPLY_ADDED_AGENT)]) };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
    }
    expect(events).toHaveLength(0);
  });

  test('yields human-authored reply_added', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: makeSseBody([sseFrame('reply_added', REPLY_ADDED_HUMAN)]),
    });

    const ctrl = new AbortController();
    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
      ctrl.abort();
    }
    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe('reply_added');
  });

  test('yields human discussion_message_posted, drops agent-authored', async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      return {
        ok: true,
        body: makeSseBody([
          sseFrame('discussion_message_posted', DISCUSSION_AGENT),
          sseFrame('discussion_message_posted', DISCUSSION_HUMAN),
        ]),
      };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
      ctrl.abort();
    }
    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe('discussion_message_posted');
    expect((events[0] as { message: { author_user_id: string } }).message.author_user_id).toBe(
      'usr_01',
    );
  });

  test('skips heartbeat frames (no data)', async () => {
    const ctrl = new AbortController();
    // SSE comment is a line starting with ':' — EventSourceParserStream
    // parses it as a comment and emits an event with no data field.
    const heartbeat = ': heartbeat\n\n';
    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      setTimeout(() => ctrl.abort(), 10);
      return {
        ok: true,
        body: makeSseBody([heartbeat, sseFrame('agent_narration', AGENT_NARRATION_EVENT)]),
      };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
    }
    expect(events).toHaveLength(0);
  });

  test('skips malformed JSON without throwing', async () => {
    const ctrl = new AbortController();
    const badFrame = 'event: comment_added\ndata: not-json\n\n';
    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      setTimeout(() => ctrl.abort(), 10);
      return { ok: true, body: makeSseBody([badFrame]) };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
    }
    expect(events).toHaveLength(0);
  });
});

describe('wakeEvents — reconnect on stream end', () => {
  test('reconnects when the stream ends normally', async () => {
    let calls = 0;
    const ctrl = new AbortController();

    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        // First call: stream closes without yielding any events.
        return { ok: true, body: makeSseBody([]) };
      }
      // Second call: abort the signal so the reconnect loop terminates.
      setTimeout(() => ctrl.abort(), 0);
      return { ok: true, body: makeSseBody([]) };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
    }

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(events).toHaveLength(0);
  });

  test('stops reconnecting when signal is pre-aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    let calls = 0;
    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      calls += 1;
      return { ok: true, body: makeSseBody([]) };
    });

    const events: unknown[] = [];
    for await (const ev of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      events.push(ev);
    }

    expect(calls).toBe(0);
    expect(events).toHaveLength(0);
  });

  test('reconnects after a non-OK response', async () => {
    let calls = 0;
    const ctrl = new AbortController();

    fetchMock.mockImplementation(async (_url: string, _opts: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, body: null };
      }
      ctrl.abort();
      return { ok: true, body: makeSseBody([]) };
    });

    for await (const _ of wakeEvents('http://worker', THR_1, 'token', ctrl.signal)) {
      // nothing expected
    }
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
