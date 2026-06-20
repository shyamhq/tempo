import { describe, expect, it, mock } from 'bun:test';
import { dispatch } from '../../src/events/subscriber';

// dispatch is the pure classifier; it receives already-parsed frames (the
// transport handles JSON.parse + heartbeat skipping). Reconnect is the
// transport's job, not ours to test.
describe('dispatch', () => {
  const handlers = () => ({ onWake: mock(() => {}), onCancel: mock(() => {}) });

  it('routes a human comment to onWake', () => {
    const h = handlers();
    dispatch({ kind: 'comment_added' }, h);
    expect(h.onWake).toHaveBeenCalledTimes(1);
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('routes agent_cancel_requested (Dev Stop) to onCancel', () => {
    const h = handlers();
    dispatch({ kind: 'agent_cancel_requested' }, h);
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onWake).not.toHaveBeenCalled();
  });

  it("ignores the agent's own echoed activity", () => {
    const h = handlers();
    dispatch({ kind: 'agent_narration', text: 'hi' }, h);
    expect(h.onWake).not.toHaveBeenCalled();
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('ignores an agent-authored reply (author_user_id null)', () => {
    const h = handlers();
    dispatch({ kind: 'reply_added', reply: { author_user_id: null } }, h);
    expect(h.onWake).not.toHaveBeenCalled();
  });

  it('wakes on a human-authored reply', () => {
    const h = handlers();
    dispatch({ kind: 'reply_added', reply: { author_user_id: 'user_123' } }, h);
    expect(h.onWake).toHaveBeenCalledTimes(1);
  });

  it('ignores frames with no kind', () => {
    const h = handlers();
    dispatch(null, h);
    expect(h.onWake).not.toHaveBeenCalled();
    expect(h.onCancel).not.toHaveBeenCalled();
  });
});
