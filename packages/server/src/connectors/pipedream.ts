// Pipedream Tier-2 connector client. Dumb transport — read-only governance and
// the allowlist gate live in the Worker gateway, not here. Every call passes
// external_user_id = workspaceId; the LLM is never an identity decision point.
//
// SDK: @pipedream/sdk v3 — PipedreamClient is the current/recommended entry
// point (createBackendClient still exists but is the older server-only form).
// Dispatch path:
//   client.actions.run({ id: action, externalUserId: workspaceId, configuredProps })
// where configuredProps carries the app auth prop ({ authProvisionId }) plus the
// caller-supplied params spread in at the top level.

import { PipedreamClient } from '@pipedream/sdk';
import { getOrLoad } from '../cache';
import { getConnectorConfig } from './queries';

// One read action as the Agent sees it: the exact Pipedream key plus the props
// it fills. `readOnlyHint` is kept on the cached shape so the same catalog backs
// both discovery (listReadActions) and the gate (getActionPolicy).
export type CatalogAction = {
  key: string;
  name: string;
  description?: string;
  readOnlyHint: boolean | null;
  props: { name: string; type: string; optional: boolean; description?: string }[];
};

// The SDK's ConfigurableProp is a union whose common base isn't exported; every
// variant carries these fields. Upcast to read them without narrowing each variant.
type ConfigurablePropLike = {
  name: string;
  type: string;
  optional?: boolean;
  hidden?: boolean;
  description?: string;
};

// Lazy singleton — constructed on first use so tests that mock the SDK module
// get the mocked constructor when the module actually executes.
let _client: PipedreamClient | undefined;

function getClient(): PipedreamClient {
  if (_client) return _client;

  const clientId = process.env.PIPEDREAM_CLIENT_ID;
  const clientSecret = process.env.PIPEDREAM_CLIENT_SECRET;
  const projectId = process.env.PIPEDREAM_PROJECT_ID;
  const projectEnvironment =
    (process.env.PIPEDREAM_ENVIRONMENT as 'development' | 'production' | undefined) ??
    'development';

  if (!clientId) throw new Error('PIPEDREAM_CLIENT_ID is not set');
  if (!clientSecret) throw new Error('PIPEDREAM_CLIENT_SECRET is not set');
  if (!projectId) throw new Error('PIPEDREAM_PROJECT_ID is not set');

  _client = new PipedreamClient({
    clientId,
    clientSecret,
    projectId,
    projectEnvironment,
  });

  return _client;
}

// Exposed for test reset only — never call in production paths.
export function _resetPipedreamClient(): void {
  _client = undefined;
}

// Connect Link the Console redirects the admin to (Console-side connect flow).
// Creates a short-lived token scoped to this workspace's external_user_id, and
// returns the hosted Connect Link URL the frontend embeds in a redirect or iframe.
export async function createPipedreamConnectToken(
  workspaceId: string,
  app: string,
  successRedirectUri?: string,
): Promise<{ connectLinkUrl: string }> {
  const client = getClient();
  // external_user_id is the workspace id — the invariant this whole module is
  // built on. successRedirectUri binds the Connect Link to our callback so the
  // admin is returned to the Console (and only there) once the account is linked.
  const resp = await client.tokens.create({ externalUserId: workspaceId, successRedirectUri });
  // The SDK's connectLinkUrl is app-agnostic; Pipedream rejects it ("include the
  // app in the Connect URL") unless the target app slug is appended.
  const url = new URL(resp.connectLinkUrl);
  url.searchParams.set('app', app);
  return { connectLinkUrl: url.toString() };
}

// Runs a read action for `app` against the workspace's connected Pipedream
// account. The Worker gateway has already confirmed read-safety + connector
// enablement before calling here.
//
// Dispatch method chosen: client.actions.run (SDK v3, documented at
// https://pipedream.com/docs/connect/api-reference/run-action).
// Reason: it is the only SDK-native way to run an arbitrary named action
// (by component slug) with a connected account's auth and caller params. The
// Connect Proxy is for raw HTTP calls; the Pipedream MCP requires a separate
// server; actions.run is the simplest, documented, type-safe path.
//
// configuredProps shape: the app auth prop is keyed by the app slug and carries
// { authProvisionId: accountId }; the remaining caller params are spread at the
// top level (they become named action props). This matches the SDK's documented
// usage for pre-built component actions.
export async function dispatchIntegration(
  workspaceId: string,
  app: string,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const client = getClient();

  // Resolve the account id from the stored connector config. The Console's
  // connect callback writes pipedream_account_id when the user authorises.
  const config = await getConnectorConfig(workspaceId, app);
  const accountId = config?.pipedream_account_id as string | undefined;
  // Enabled-but-unconfigured: the connector row exists and is enabled, but the
  // connect flow never captured an account. Fail with a clear message instead of
  // dispatching a credential-less request that Pipedream would reject opaquely.
  if (!accountId) {
    throw new Error(`${app} is connected but has no Pipedream account; reconnect required`);
  }

  // Build configuredProps: the app auth prop (SDK's ConfiguredPropValueApp
  // shape) plus the caller-supplied params.
  const configuredProps: Record<string, unknown> = {
    ...params,
    [app]: { authProvisionId: accountId },
  };

  const resp = await client.actions.run({
    id: action,
    externalUserId: workspaceId,
    // Type cast required: configuredProps is statically typed over known
    // ConfigurableProps generics, but we are passing a runtime-shaped object
    // whose prop names are determined by the action component at runtime.
    configuredProps: configuredProps as Parameters<typeof client.actions.run>[0]['configuredProps'],
  });

  return resp;
}

// Action catalogs are structurally stable (a given action's readOnlyHint never
// flips on an existing key), so a long TTL is safe — the only cost is a day's
// delay before a brand-new action becomes usable.
const ACTIONS_TTL_MS = 24 * 60 * 60 * 1000;

// The full action catalog for an app, keyed by Pipedream component key. One
// Connect API call per app (paginated via for-await), cached so both discovery
// and the gate read it in-memory. `actions.list` already returns each action's
// name, description, props, and readOnlyHint — so this one fetch answers "what
// actions exist", "what props do they take", and "is each a read".
async function loadActionCatalog(app: string): Promise<Record<string, CatalogAction>> {
  const page = await getClient().actions.list({ app });
  const map: Record<string, CatalogAction> = {};
  for await (const action of page) {
    const hint = action.annotations?.readOnlyHint;
    map[action.key] = {
      key: action.key,
      name: action.name,
      description: action.description,
      readOnlyHint: typeof hint === 'boolean' ? hint : null,
      // Drop the app-auth prop (dispatchIntegration injects it) and hidden props;
      // the Agent never sets those.
      props: (action.configurableProps as ConfigurablePropLike[])
        .filter((p) => p.type !== 'app' && !p.hidden)
        .map((p) => ({
          name: p.name,
          type: p.type,
          optional: p.optional ?? false,
          description: p.description,
        })),
    };
  }
  return map;
}

function getCatalog(app: string): Promise<Record<string, CatalogAction>> {
  return getOrLoad(`pd:actions:${app}`, ACTIONS_TTL_MS, () => loadActionCatalog(app));
}

// Discovery: the read-only actions for an app, sourced from Pipedream's own
// readOnlyHint annotation. The Agent picks an exact key from this list instead
// of guessing a slug. Throws if the catalog can't be fetched.
export async function listReadActions(app: string): Promise<CatalogAction[]> {
  const catalog = await getCatalog(app);
  return Object.values(catalog).filter((a) => a.readOnlyHint === true);
}

// The gate's verdict for one action key, sourced from the same catalog:
//   'read'    — Pipedream marks it read-only; allow.
//   'write'   — Pipedream marks it a write; reject.
//   'unknown' — key not in the catalog, or unannotated; reject (the Agent should
//               discover valid keys via listReadActions).
// Throws if the catalog can't be fetched (Pipedream unavailable).
export async function getActionPolicy(
  app: string,
  key: string,
): Promise<'read' | 'write' | 'unknown'> {
  const catalog = await getCatalog(app);
  const hint = catalog[key]?.readOnlyHint;
  if (hint === true) return 'read';
  if (hint === false) return 'write';
  return 'unknown';
}

// Resolves the most recently connected Pipedream account for `app` under this
// workspace. Used by the Console's connect callback to capture the
// pipedream_account_id that dispatchIntegration needs. Returns null when the
// workspace has never connected this app.
export async function getPipedreamAccount(
  workspaceId: string,
  app: string,
): Promise<{ accountId: string } | null> {
  const client = getClient();
  // listByExternalUser resolves to Account[] directly (HttpResponsePromise<T>
  // extends Promise<T>). Filter by app slug; take the most recent by updatedAt.
  const accounts = await client.accounts.listByExternalUser(workspaceId, { app });

  if (!accounts.length) return null;

  // Most recently updated first. updatedAt may be undefined if the API omits it
  // for an account; treat those as oldest.
  const sorted = [...accounts].sort((a, b) => {
    const aTime = a.updatedAt?.getTime() ?? 0;
    const bTime = b.updatedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  const first = sorted[0];
  if (!first) return null;

  return { accountId: first.id };
}
