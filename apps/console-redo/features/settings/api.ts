// Settings feature client: the only server calls the settings surface makes are
// the agent-key read + rotate, which hit OUR DB (the masked key lives on the
// workspaces row, not in Clerk). Everything else — org name, members,
// invitations, leave/delete — goes through Clerk hooks directly in the section
// components, not through here. This is a Console-internal admin response, not
// an Agent⇄Console wire contract, so the schema stays local (not @tempo/contracts).

import type { ConnectorId } from '@tempo/contracts/connectors';
import {
  ConnectorOkResponse,
  ConnectorStatusResponse,
  StartConnectResponse,
} from '@tempo/contracts/http';
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

// Connectors: the full catalog + per-workspace connection state, plus the
// admin-gated connect / enable / disconnect mutations. Wire shapes come from
// @tempo/contracts/http; the server fns live in @tempo/server (reused via the
// thin /api/connectors routes). The PATCH/DELETE replies are the shared
// ConnectorOkResponse the section discards (it re-fetches the list).

export function listConnectors() {
  return request('GET', '/api/connectors', undefined, ConnectorStatusResponse);
}

export function startConnect(id: ConnectorId) {
  return request('POST', `/api/connectors/${id}/connect`, undefined, StartConnectResponse);
}

export function setConnectorEnabled(id: ConnectorId, enabled: boolean): Promise<void> {
  return request('PATCH', `/api/connectors/${id}`, { enabled }, ConnectorOkResponse).then(
    () => undefined,
  );
}

export function disconnectConnector(id: ConnectorId): Promise<void> {
  return request('DELETE', `/api/connectors/${id}`, undefined, ConnectorOkResponse).then(
    () => undefined,
  );
}
