import type { ConnectorId, ConnectorTier } from '@tempo/contracts/connectors';
import { db } from '@tempo/db/client';
import { auditLog, workspaceConnectors } from '@tempo/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { newAuditLogId, newWorkspaceConnectorId } from '../ids';

// Connector persistence — the DB layer shared by the Worker gateway (allowlist
// read + audit append, on the Agent's tool-call path) and the Console
// (admin connect / disconnect / enable, in Settings → Integrations). No HTTP,
// no policy — just rows.

// --- Allowlist (Worker gateway hot path) ---------------------------------

// The single gate the Agent's connector tools consult. A missing row OR
// enabled=false both mean "off": the Agent never reaches the connector.
export async function isConnectorEnabled(
  workspaceId: string,
  connectorId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: workspaceConnectors.enabled })
    .from(workspaceConnectors)
    .where(
      and(
        eq(workspaceConnectors.workspace_id, workspaceId),
        eq(workspaceConnectors.connector_id, connectorId),
      ),
    )
    .limit(1);
  return row?.enabled === true;
}

// Tier-specific binding the clients need to act: GitHub stores
// { installation_id }, Pipedream stores { pipedream_account_id }. Null when the
// workspace has never connected this connector.
export async function getConnectorConfig(
  workspaceId: string,
  connectorId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ config: workspaceConnectors.config })
    .from(workspaceConnectors)
    .where(
      and(
        eq(workspaceConnectors.workspace_id, workspaceId),
        eq(workspaceConnectors.connector_id, connectorId),
      ),
    )
    .limit(1);
  return (row?.config as Record<string, unknown> | null) ?? null;
}

// --- Console management (Settings → Integrations) ------------------------

export type ConnectorRow = {
  connector_id: string;
  tier: string;
  enabled: boolean;
  connected_at: Date | null;
};

export async function listConnectorRows(workspaceId: string): Promise<ConnectorRow[]> {
  return db
    .select({
      connector_id: workspaceConnectors.connector_id,
      tier: workspaceConnectors.tier,
      enabled: workspaceConnectors.enabled,
      connected_at: workspaceConnectors.connected_at,
    })
    .from(workspaceConnectors)
    .where(eq(workspaceConnectors.workspace_id, workspaceId));
}

// Connect (or reconnect) a connector: write/refresh the binding row. A
// first-time connect enables it (`enabled: true` on insert); a reconnect (OAuth
// re-auth, token rotation) refreshes the config but DELIBERATELY does not touch
// `enabled` — an admin who turned a connector off must not have it silently
// re-enabled by any later reconnect. The UNIQUE(workspace_id, connector_id)
// index makes this an upsert.
export async function upsertConnector(input: {
  workspaceId: string;
  connectorId: ConnectorId;
  tier: ConnectorTier;
  config: Record<string, unknown>;
  connectedBy: string;
}): Promise<void> {
  await db
    .insert(workspaceConnectors)
    .values({
      id: newWorkspaceConnectorId(),
      workspace_id: input.workspaceId,
      connector_id: input.connectorId,
      tier: input.tier,
      config: input.config,
      enabled: true,
      connected_by: input.connectedBy,
    })
    .onConflictDoUpdate({
      target: [workspaceConnectors.workspace_id, workspaceConnectors.connector_id],
      set: {
        config: input.config,
        connected_by: input.connectedBy,
        connected_at: sql`now()`,
      },
    });
}

// Flip the workspace allowlist toggle without dropping the connection.
export async function setConnectorEnabled(
  workspaceId: string,
  connectorId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(workspaceConnectors)
    .set({ enabled })
    .where(
      and(
        eq(workspaceConnectors.workspace_id, workspaceId),
        eq(workspaceConnectors.connector_id, connectorId),
      ),
    );
}

// Drop the binding entirely (the token lives in Pipedream's vault / GitHub's
// install, revoked separately by the client).
export async function disconnectConnector(workspaceId: string, connectorId: string): Promise<void> {
  await db
    .delete(workspaceConnectors)
    .where(
      and(
        eq(workspaceConnectors.workspace_id, workspaceId),
        eq(workspaceConnectors.connector_id, connectorId),
      ),
    );
}

// --- Audit (Worker gateway, append-only) ---------------------------------

export type AuditEntry = {
  workspaceId: string;
  threadId: string;
  connectorId: string;
  toolName: string;
  requestSummary: string;
  responseSummary: string;
  durationMs: number;
};

export async function insertAuditRow(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: newAuditLogId(),
    workspace_id: entry.workspaceId,
    thread_id: entry.threadId,
    connector_id: entry.connectorId,
    tool_name: entry.toolName,
    request_summary: entry.requestSummary,
    response_summary: entry.responseSummary,
    duration_ms: entry.durationMs,
  });
}
