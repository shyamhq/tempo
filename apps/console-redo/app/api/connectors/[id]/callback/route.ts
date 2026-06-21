import { ConnectorId, pipedreamAppFor } from '@tempo/contracts/connectors';
import { getPipedreamAccount, upsertConnector, verifyConnectorState } from '@tempo/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authFromRequest } from '../../../../../server/actor';
import { err, toResponse } from '../../../../../server/http';

// console-redo has no central env module (it reads process.env inline). The
// post-callback redirect base is the server-configured console origin, never the
// request Host header (which an attacker could spoof into an open redirect).
const CONSOLE_URL = process.env.CONSOLE_URL ?? 'http://localhost:3000';

// GET /api/connectors/:id/callback
//
// Handles the post-authorization redirect for both connector tiers:
//
//   GitHub (tier1):
//     GitHub App sends the admin here with ?installation_id=<n>&state=<workspaceId>
//     after they install/authorize the app. We read installation_id, re-auth the
//     caller to confirm they are admin of the workspace encoded in `state`, write
//     the workspace_connectors row, then redirect back into the app.
//     GitHub App must be configured with:
//       Callback URL: <CONSOLE_URL>/api/connectors/github/callback
//       (routed here via the dynamic [id] segment with id==='github')
//
//   Pipedream tier2:
//     Pipedream Connect fires the success_redirect_uri the server passed when it
//     minted the Connect Link token (createPipedreamConnectToken). We then call
//     getPipedreamAccount to resolve the pipedream_account_id for the workspace,
//     write the workspace_connectors row, and redirect back.
//     The success_redirect_uri must be registered in the Pipedream project settings.
//
// Neither callback is E2E-testable in this environment (GitHub App install page
// and Pipedream Connect Link both require live provider config). The logic below
// follows the documented provider patterns and is integration-tested at deploy time.

// console-redo's settings modal is transient state (no ?settings= deep-link — the
// section is deliberately excluded from URL/persistence), so the callback lands
// the admin on the app root; they reopen Workspace settings → Connectors to see
// the now-Active row.
const POST_CALLBACK_URL = '/';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authFromRequest(req);
  if (auth?.actor !== 'user' || auth.role !== 'admin') return err('forbidden', 403);

  const { id } = await params;
  const parsed = ConnectorId.safeParse(id);
  if (!parsed.success) return err('unknown_connector', 400);
  const connectorId = parsed.data;

  const url = req.nextUrl;

  try {
    if (connectorId === 'github') {
      const installationIdRaw = url.searchParams.get('installation_id');
      const state = url.searchParams.get('state');

      if (!installationIdRaw || !state) return err('missing_params', 400);

      // `state` is the signed token minted at connect time. Verify the signature +
      // expiry, then confirm it was minted for THIS admin's workspace. An attacker
      // can't forge a valid state (no CLI_AUTH_SECRET), so a foreign install can't
      // be bound here.
      const stateWorkspaceId = verifyConnectorState(state);
      if (!stateWorkspaceId || stateWorkspaceId !== auth.workspace_id) {
        return err('state_mismatch', 403);
      }

      // installation_id is an untrusted query param. Reject anything that isn't a
      // positive integer so we never persist NaN/0 (which would pass the
      // `typeof === 'number'` guard downstream and produce opaque GitHub errors).
      const installationId = Number(installationIdRaw);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        return err('invalid_installation_id', 400);
      }

      await upsertConnector({
        workspaceId: auth.workspace_id,
        connectorId: 'github',
        tier: 'tier1',
        config: { installation_id: installationId },
        connectedBy: auth.user_id,
      });
    } else {
      // Tier2 — Pipedream Connect callback.
      // Pipedream passes the external_user_id (workspaceId) back on the redirect
      // so we can confirm workspace ownership. We call getPipedreamAccount to
      // resolve the live account id from Pipedream's vault.
      const app = pipedreamAppFor(connectorId);
      if (!app) return err('no_pipedream_app', 400);

      const account = await getPipedreamAccount(auth.workspace_id, app);
      if (!account) return err('pipedream_account_not_found', 400);

      await upsertConnector({
        workspaceId: auth.workspace_id,
        connectorId,
        tier: 'tier2',
        config: { pipedream_account_id: account.accountId },
        connectedBy: auth.user_id,
      });
    }
  } catch (e) {
    return toResponse(e);
  }

  // Redirect back into the app off the server-configured origin (not the request
  // Host header).
  return NextResponse.redirect(new URL(POST_CALLBACK_URL, CONSOLE_URL));
}
