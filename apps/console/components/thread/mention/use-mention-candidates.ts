'use client';

import { useOrganization } from '@clerk/nextjs';
import type { Mention } from '@tempo/contracts';

const AGENT_CANDIDATE: Mention = { id: 'agent', kind: 'agent', label: 'Agent' };

export type MentionCandidate = Mention;

export function useMentionCandidates(): MentionCandidate[] {
  const { memberships } = useOrganization({ memberships: true });

  const userCandidates: MentionCandidate[] =
    memberships?.data?.flatMap((m) => {
      const pub = m.publicUserData;
      if (!pub) return [];
      const first = pub.firstName ?? '';
      const last = pub.lastName ?? '';
      const fullName = `${first} ${last}`.trim();
      return [
        {
          id: pub.userId ?? m.id,
          kind: 'user' as const,
          label: fullName || pub.identifier || m.id,
        },
      ];
    }) ?? [];

  return [AGENT_CANDIDATE, ...userCandidates];
}
