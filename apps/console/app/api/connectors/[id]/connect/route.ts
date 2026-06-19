import { ConnectorId, pipedreamAppFor } from '@tempo/contracts/connectors';
import { StartConnectResponse } from '@tempo/contracts/http';
import {
  createPipedreamConnectToken,
  githubAppInstallUrl,
  signConnectorState,
} from '@tempo/server';
import type { NextRequest } from 'next/server';
import { env } from '../../../../../env';
import { authFromRequest } from '../../../../../server/actor';
import { err, ok } from '../../../../../server/http';

// POST /api/connectors/:id/connect — admin only.
// Returns a connect_url the browser redirects to:
//   - github  → GitHub App install page (GitHub sends the user back to
//               /api/connectors/github/callback with installation_id + state)
//   - tier2   → Pipedream Connect Link (Pipedream sends the user back to
//               /api/connectors/:id/callback once the account is authorised)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);

  const { id } = await params;
  const parsed = ConnectorId.safeParse(id);
  if (!parsed.success) return err('unknown_connector', 400);
  const connectorId = parsed.data;

  let connect_url: string;

  if (connectorId === 'github') {
    // state is a signed, short-lived token binding the workspace id — the
    // callback verifies it so a forged install (attacker-chosen installation_id)
    // can't be accepted for this workspace.
    connect_url = githubAppInstallUrl(signConnectorState(auth.workspace_id));
  } else {
    const app = pipedreamAppFor(connectorId);
    if (!app) return err('no_pipedream_app', 400);
    // Bind the Connect Link to our callback at token-mint time so Pipedream
    // returns the admin here (and only here). The redirect base is the
    // server-configured CONSOLE_URL, never the request Host header (which an
    // attacker could spoof into an open redirect).
    const successRedirectUri = `${env.CONSOLE_URL}/api/connectors/${connectorId}/callback`;
    const { connectLinkUrl } = await createPipedreamConnectToken(
      auth.workspace_id,
      app,
      successRedirectUri,
    );
    connect_url = connectLinkUrl;
  }

  return ok(StartConnectResponse.parse({ connect_url }));
}
