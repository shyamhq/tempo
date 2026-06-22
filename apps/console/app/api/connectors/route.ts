import { CONNECTORS } from '@tempo/contracts/connectors';
import { ConnectorStatusResponse } from '@tempo/contracts/http';
import { listConnectorRows } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../server/actor';
import { err, ok, toResponse } from '../../../server/http';

// GET /api/connectors — any authenticated workspace member.
// Returns the full 8-connector catalog left-joined with the workspace's
// workspace_connectors rows so the UI always renders all connectors, not just
// connected ones.
export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user') return err('forbidden', 403);

  try {
    const rows = await listConnectorRows(auth.workspace_id);
    const rowById = new Map(rows.map((r) => [r.connector_id, r]));

    const connectors = CONNECTORS.map((c) => {
      const row = rowById.get(c.id);
      return {
        connector_id: c.id,
        tier: c.tier,
        connected: row !== undefined,
        enabled: row?.enabled ?? false,
        connected_at: row?.connected_at?.toISOString() ?? null,
      };
    });

    return ok(ConnectorStatusResponse.parse({ connectors }));
  } catch (e) {
    return toResponse(e);
  }
}
