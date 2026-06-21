import { describe, expect, test } from 'bun:test';
import type { Event } from '../src/events';
import { RepoLinkedEvent, shouldDeliverToAgent, shouldWake, VmSignal } from '../src/events';
import { AgentEventRequest, CreateThreadRequest } from '../src/http';
import { PostDiscussionMessageInput } from '../src/mcp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// EventId pattern: evt_ + 14+ digits
const EVENT_ID = 'evt_00000000000001';
const SPACE_ID = 'spc_AAAAAAAAAAAAAAAAAAAAAAAAAA';
const eventBase = { id: EVENT_ID, created_at: new Date().toISOString() } as const;

function makeRepoLinked(repos: string[]): Event {
  return RepoLinkedEvent.parse({ ...eventBase, kind: 'repo_linked', repos });
}

// ---------------------------------------------------------------------------
// shouldWake
// ---------------------------------------------------------------------------

describe('shouldWake', () => {
  test('repo_linked wakes the agent', () => {
    expect(shouldWake(makeRepoLinked(['acme/api']))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldDeliverToAgent
// ---------------------------------------------------------------------------

describe('shouldDeliverToAgent', () => {
  test('vm signal is browser-only — excluded from agent delivery', () => {
    expect(shouldDeliverToAgent(VmSignal.parse({ kind: 'vm', vm: null }))).toBe(false);
  });

  test('repo_linked is delivered to the agent (wake-eligible)', () => {
    expect(shouldDeliverToAgent(makeRepoLinked(['acme/api']))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repos regex — owner/name form
// ---------------------------------------------------------------------------

describe('repos regex (owner/name)', () => {
  const repoSchema = PostDiscussionMessageInput.shape.repos;

  test('accepts valid owner/name', () => {
    const result = repoSchema?.safeParse(['acme/api', 'org-name/repo-name']);
    expect(result?.success).toBe(true);
  });

  test('rejects a bare name with no slash', () => {
    const result = repoSchema?.safeParse(['just-a-name']);
    expect(result?.success).toBe(false);
  });

  test('rejects a full URL', () => {
    const result = repoSchema?.safeParse(['https://github.com/acme/api']);
    expect(result?.success).toBe(false);
  });

  test('rejects owner/name with internal spaces', () => {
    const result = repoSchema?.safeParse(['acme/my repo']);
    expect(result?.success).toBe(false);
  });

  test('CreateThreadRequest.repos accepts valid list and defaults to []', () => {
    const withRepos = CreateThreadRequest.parse({
      title: 'T',
      description: '',
      space_id: SPACE_ID,
      agent_type: 'hosted',
      repos: ['acme/api'],
    });
    expect(withRepos.repos).toEqual(['acme/api']);

    const withDefault = CreateThreadRequest.parse({
      title: 'T',
      description: '',
      space_id: SPACE_ID,
      agent_type: 'hosted',
    });
    expect(withDefault.repos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VmSignal — ephemeral SSE-only VM lifecycle frame
// ---------------------------------------------------------------------------

describe('VmSignal', () => {
  const startedAt = new Date().toISOString();

  test('carries a vm state with its derived phase', () => {
    const f = VmSignal.parse({
      kind: 'vm',
      vm: { sandbox_id: 'sbx_1', started_at: startedAt, phase: 'cloning' },
    });
    expect(f.vm?.phase).toBe('cloning');
    expect(f.vm?.sandbox_id).toBe('sbx_1');
  });

  test('vm is null on teardown', () => {
    expect(VmSignal.parse({ kind: 'vm', vm: null }).vm).toBeNull();
  });

  test('provisioning carries a null sandbox_id', () => {
    const f = VmSignal.parse({
      kind: 'vm',
      vm: { sandbox_id: null, started_at: startedAt, phase: 'provisioning' },
    });
    expect(f.vm?.sandbox_id).toBeNull();
  });

  test('failed carries an optional reason', () => {
    const f = VmSignal.parse({
      kind: 'vm',
      vm: { sandbox_id: null, started_at: startedAt, phase: 'failed', reason: 'clone timed out' },
    });
    expect(f.vm?.reason).toBe('clone timed out');
  });

  test('rejects an unknown phase', () => {
    const r = VmSignal.safeParse({
      kind: 'vm',
      vm: { sandbox_id: null, started_at: startedAt, phase: 'ready' },
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentEventRequest — the only two things an agent runtime posts to
// /agent-events: the agent_turn_ended boundary and a vm_failed report (the
// handler routes the latter to failVmRun instead of the event log).
// ---------------------------------------------------------------------------

describe('AgentEventRequest', () => {
  const THREAD_ID = 'thr_01KVJW7TGR5PSQP3JDYW8088XE';

  test('accepts a vm_failed report', () => {
    const r = AgentEventRequest.safeParse({
      thread_id: THREAD_ID,
      event: { kind: 'vm_failed', reason: 'clone failed' },
    });
    expect(r.success).toBe(true);
  });

  test('accepts the agent_turn_ended boundary event', () => {
    const r = AgentEventRequest.safeParse({
      thread_id: THREAD_ID,
      event: { kind: 'agent_turn_ended' },
    });
    expect(r.success).toBe(true);
  });

  test('rejects an unknown kind', () => {
    const r = AgentEventRequest.safeParse({
      thread_id: THREAD_ID,
      event: { kind: 'not_a_real_kind' },
    });
    expect(r.success).toBe(false);
  });
});
