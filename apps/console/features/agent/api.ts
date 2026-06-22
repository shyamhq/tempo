// Agent feature client: the persisted UIMessages read. Refetched on
// agent_turn_ended (the gateway's onAgentTurnEnded → useThreadSession) so the
// merge dedups the just-finished live turn by id.
//
// Agent messages are AI SDK UIMessage objects — Zod can't express the full
// union. The route already runs validateTempoMessages, so parse the envelope as
// unknown[] and cast at the boundary.

import type { TempoUIMessage } from '@tempo/contracts/agent-message';
import { z } from 'zod';
import { request } from '../../lib/api-client';

const AgentMessagesResponse = z.object({ messages: z.array(z.unknown()) });

export function getPersistedMessages(threadId: string): Promise<TempoUIMessage[]> {
  return request(
    'GET',
    `/api/threads/${encodeURIComponent(threadId)}/agent-messages`,
    undefined,
    AgentMessagesResponse,
  ).then((r) => r.messages as TempoUIMessage[]);
}
