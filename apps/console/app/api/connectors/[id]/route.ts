import { ConnectorId } from '@tempo/contracts/connectors';
import { SetConnectorEnabledRequest } from '@tempo/contracts/http';
import { disconnectConnector, setConnectorEnabled } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { authFromRequest } from '../../../../server/actor';
import { err, ok, parseBody, toResponse } from '../../../../server/http';

// PATCH /api/connectors/:id — admin only. Flip the workspace allowlist toggle.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);

  const { id } = await params;
  const parsed = ConnectorId.safeParse(id);
  if (!parsed.success) return err('unknown_connector', 400);

  const body = await parseBody(req, SetConnectorEnabledRequest);
  if (!body.ok) return body.response;

  try {
    await setConnectorEnabled(auth.workspace_id, parsed.data, body.data.enabled);
    return ok({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}

// DELETE /api/connectors/:id — admin only. Drop the workspace_connectors row.
// Note: the actual OAuth grant or GitHub App install is NOT revoked here — that
// must be done by the user in Pipedream/GitHub directly. We only drop our
// local binding record.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);

  const { id } = await params;
  const parsed = ConnectorId.safeParse(id);
  if (!parsed.success) return err('unknown_connector', 400);

  try {
    await disconnectConnector(auth.workspace_id, parsed.data);
    return ok({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
