'use client';

// The @mention autocomplete candidates: the org's members (via Clerk's
// useOrganization memberships — the data is already client-side, no hand-rolled
// endpoint) plus the Agent sentinel. Shared by every composer that embeds the
// MentionableInput (comments + discussion). The Mention shape is the wire shape
// (@tempo/contracts) so a picked candidate threads straight through to the API.

import { useOrganization } from '@clerk/nextjs';
import type { Mention } from '@tempo/contracts';

const AGENT_CANDIDATE: Mention = { id: 'agent', kind: 'agent', label: 'Agent' };

export type MentionCandidate = Mention;

export function useMentionCandidates(): MentionCandidate[] {
  const { memberships } = useOrganization({ memberships: true });

  const userCandidates: MentionCandidate[] =
    memberships?.data?.flatMap((m) => {
      const pub = m.publicUserData;
      // Skip members without a resolvable user id: a membership id (orgmem_…)
      // never matches downstream name resolution (keyed on userId). Mirrors the
      // guard resolveAuthorUser uses.
      if (!pub?.userId) return [];
      const first = pub.firstName ?? '';
      const last = pub.lastName ?? '';
      const fullName = `${first} ${last}`.trim();
      return [
        {
          id: pub.userId,
          kind: 'user' as const,
          label: fullName || pub.identifier || pub.userId,
        },
      ];
    }) ?? [];

  return [AGENT_CANDIDATE, ...userCandidates];
}
