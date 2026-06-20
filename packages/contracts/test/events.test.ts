import { describe, expect, test } from 'bun:test';
import { RepoLinkedEvent, VmProgressEvent, shouldDeliverToAgent, shouldWake } from '../src/events';
import type { Event } from '../src/events';
import { CreateThreadRequest } from '../src/http';
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

function makeVmProgress(step: 'sandbox_ready' | 'repos_cloned' | 'agent_started' | 'failed'): Event {
  return VmProgressEvent.parse({ ...eventBase, kind: 'vm_progress', step });
}

// ---------------------------------------------------------------------------
// shouldWake
// ---------------------------------------------------------------------------

describe('shouldWake', () => {
  test('repo_linked wakes the agent', () => {
    expect(shouldWake(makeRepoLinked(['acme/api']))).toBe(true);
  });

  test('vm_progress does NOT wake the agent', () => {
    expect(shouldWake(makeVmProgress('sandbox_ready'))).toBe(false);
    expect(shouldWake(makeVmProgress('repos_cloned'))).toBe(false);
    expect(shouldWake(makeVmProgress('agent_started'))).toBe(false);
    expect(shouldWake(makeVmProgress('failed'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldDeliverToAgent
// ---------------------------------------------------------------------------

describe('shouldDeliverToAgent', () => {
  test('vm_progress is excluded from agent delivery', () => {
    expect(shouldDeliverToAgent(makeVmProgress('sandbox_ready'))).toBe(false);
    expect(shouldDeliverToAgent(makeVmProgress('failed'))).toBe(false);
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
// vm_progress — optional reason on failed step
// ---------------------------------------------------------------------------

describe('VmProgressEvent', () => {
  test('failed step accepts an optional reason', () => {
    const ev = VmProgressEvent.parse({
      ...eventBase,
      kind: 'vm_progress',
      step: 'failed',
      reason: 'clone timed out',
    });
    expect(ev.reason).toBe('clone timed out');
  });

  test('non-failed steps accept no reason', () => {
    const ev = VmProgressEvent.parse({ ...eventBase, kind: 'vm_progress', step: 'sandbox_ready' });
    expect(ev.reason).toBeUndefined();
  });
});
