import { describe, expect, test } from 'bun:test';
import { parseWakeEvent } from '../../src/hosted/event-source';

// parseWakeEvent is the pure classifier; it receives already-parsed frames (the
// transport handles JSON.parse + heartbeat skipping) and reconnect (not ours to
// test). Valid IDs per primitives.ts regexes.
const TS = '2026-06-19T00:00:00.000Z';
const CMT_1 = 'cmt_01234567890123456789ABCDEF';
const THR_1 = 'thr_01234567890123456789ABCDEF';

const COMMENT_ADDED = {
  id: 'evt_20260619000001',
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

const replyAdded = (authorUserId: string | null) => ({
  id: 'evt_20260619000002',
  created_at: TS,
  kind: 'reply_added',
  comment_id: CMT_1,
  reply: {
    id: 'rep_0123456789012345678901234A',
    comment_id: CMT_1,
    author_user_id: authorUserId,
    payload: { text: 'x' },
    attachments: [],
    mentions: [],
    created_at: TS,
  },
});

const discussion = (authorUserId: string | null) => ({
  id: 'evt_20260619000003',
  created_at: TS,
  kind: 'discussion_message_posted',
  message: {
    id: 'msg_01234567890123456789012345',
    thread_id: THR_1,
    author_user_id: authorUserId,
    text: 'x',
    questions: null,
    attachments: [],
    mentions: [],
    created_at: TS,
  },
});

describe('parseWakeEvent', () => {
  test('comment_added is always a wake', () => {
    expect(parseWakeEvent(COMMENT_ADDED)?.kind).toBe('comment_added');
  });

  test('human-authored reply wakes; agent-authored does not', () => {
    expect(parseWakeEvent(replyAdded('usr_01'))?.kind).toBe('reply_added');
    expect(parseWakeEvent(replyAdded(null))).toBeNull();
  });

  test('human discussion message wakes; agent message does not', () => {
    expect(parseWakeEvent(discussion('usr_01'))?.kind).toBe('discussion_message_posted');
    expect(parseWakeEvent(discussion(null))).toBeNull();
  });

  test('agent activity (narration) is never a wake', () => {
    expect(
      parseWakeEvent({
        id: 'evt_20260619000004',
        created_at: TS,
        kind: 'agent_narration',
        text: 'hi',
      }),
    ).toBeNull();
  });

  test('frames with no kind return null', () => {
    expect(parseWakeEvent(null)).toBeNull();
    expect(parseWakeEvent({})).toBeNull();
  });
});
