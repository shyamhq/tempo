import { describe, expect, it } from 'bun:test';
import { parseStreamEvent } from '../src/redis';

describe('parseStreamEvent', () => {
  it('extracts the JSON event from the payload field', () => {
    const event = {
      id: 'evt_00000000000001',
      kind: 'comment_added',
      created_at: '2026-06-19T00:00:00.000Z',
    };
    expect(parseStreamEvent(['payload', JSON.stringify(event)])).toEqual(event);
  });

  it('finds payload regardless of field position', () => {
    const event = { id: 'evt_00000000000002', kind: 'reply_added' };
    expect(parseStreamEvent(['ignored', 'x', 'payload', JSON.stringify(event)])).toEqual(event);
  });

  it('returns null when no payload field is present', () => {
    expect(parseStreamEvent(['other', 'value'])).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseStreamEvent(['payload', '{not json'])).toBeNull();
  });
});
