// Settings feature client: the only server calls the settings surface makes are
// the agent-key read + rotate, which hit OUR DB (the masked key lives on the
// workspaces row, not in Clerk). Everything else — org name, members,
// invitations, leave/delete — goes through Clerk hooks directly in the section
// components, not through here. This is a Console-internal admin response, not
// an Agent⇄Console wire contract, so the schema stays local (not @tempo/contracts).

import { z } from 'zod';
import { request } from '../../lib/api-client';

const AgentKeyResponse = z.object({ agent_api_key: z.string() });

export function getAgentKey(): Promise<string> {
  return request('GET', '/api/workspace/agent-key', undefined, AgentKeyResponse).then(
    (r) => r.agent_api_key,
  );
}

export function rotateAgentKey(): Promise<string> {
  return request('POST', '/api/workspace/agent-key/rotate', undefined, AgentKeyResponse).then(
    (r) => r.agent_api_key,
  );
}
